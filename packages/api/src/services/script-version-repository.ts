import { randomUUID } from "node:crypto";
import type {
	ScriptVersionEditableSnapshot,
	ScriptVersionHistoryItem,
	ScriptVersionReadModel,
	SubjectAwareScriptClaim,
} from "@affichannel/core";
import {
	buildScriptClaimRefreshSourceProjection,
	canonicalizeJson,
	confirmClaimSubject,
	parseSubjectAwareScriptClaim,
	scriptVersionEditableSnapshotSchema,
	validateCurrentOrganicScriptClaimInventory,
	validateScriptVersionDraft,
} from "@affichannel/core";
import {
	db,
	factDependency,
	project,
	scriptGeneration,
	scriptVersion,
} from "@affichannel/db";
import { and, desc, eq, isNotNull, isNull, max, sql } from "drizzle-orm";

import type { WorkspaceActor } from "./workspace";

type ScriptVersionRow = typeof scriptVersion.$inferSelect;

export type InitializeSourceRecord = {
	id: string;
	workspaceId: string;
	projectId: string;
	status: string;
	outputJson: unknown;
};

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ScriptVersionMutationResult =
	| { kind: "success"; record: ScriptVersionReadModel }
	| { kind: "not_found" }
	| { kind: "immutable" }
	| { kind: "invalid_snapshot" }
	| { kind: "conflict"; latestRevision: number };

export type ConfirmClaimSubjectsDecision = {
	claimIndex: number;
	subject: "GENERAL" | "PRODUCT";
};

export type ConfirmClaimSubjectsRepositoryResult =
	| {
			kind: "confirmed";
			record: ScriptVersionReadModel;
			previousRevision: number;
			resultRevision: number;
	  }
	| { kind: "not_required"; record: ScriptVersionReadModel }
	| { kind: "not_found" }
	| { kind: "immutable" }
	| { kind: "not_eligible" }
	| { kind: "claims_not_current" }
	| { kind: "invalid_subject" }
	| { kind: "confirmation_required" }
	| { kind: "invalid_decisions" }
	| { kind: "conflict"; latestRevision: number };

async function lockProjectForMutation(
	transaction: DbTransaction,
	actor: WorkspaceActor,
	projectId: string,
) {
	const [record] = await transaction
		.select({
			id: project.id,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			archivedAt: project.archivedAt,
		})
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: project });
	return record;
}

/**
 * Atomically confirms the complete unresolved claim set for one current
 * Organic v3 draft. The project and draft locks deliberately live in this
 * repository boundary so autosave/save/restore cannot produce a lost update.
 */
export async function confirmScriptVersionClaimSubjectsRecord(input: {
	actor: WorkspaceActor;
	scriptVersionId: string;
	expectedScriptVersionRevision: number;
	decisions: readonly ConfirmClaimSubjectsDecision[];
}): Promise<ConfirmClaimSubjectsRepositoryResult> {
	return db.transaction(async (transaction) => {
		const candidate = await findScriptVersionInTransaction(
			transaction,
			input.actor,
			input.scriptVersionId,
		);
		if (!candidate) return { kind: "not_found" };

		const lockedProject = await lockProjectForMutation(
			transaction,
			input.actor,
			candidate.projectId,
		);
		if (!lockedProject || lockedProject.archivedAt)
			return { kind: "not_found" };

		const draft = await findDraftForUpdate(
			transaction,
			input.actor,
			input.scriptVersionId,
		);
		if (!draft) return { kind: "immutable" };
		if (draft.revision !== input.expectedScriptVersionRevision) {
			return { kind: "conflict", latestRevision: draft.revision };
		}

		if (
			lockedProject.contentType !== "ORGANIC" ||
			lockedProject.creationPath !== "SCRIPTED" ||
			lockedProject.contentFormatKey !== "SCRIPTED_STANDARD" ||
			lockedProject.contentFormatVersion !== 1
		)
			return { kind: "not_eligible" };

		const parsed = scriptVersionEditableSnapshotSchema.safeParse(
			draft.editableSnapshotJson,
		);
		if (!parsed.success) return { kind: "invalid_subject" };
		if (parsed.data.schemaVersion !== "script-draft.v3")
			return { kind: "not_eligible" };

		const snapshot = parsed.data as unknown as Omit<
			ScriptVersionEditableSnapshot,
			"claims"
		> & {
			claims: readonly SubjectAwareScriptClaim[];
		};
		if (
			snapshot.claimsStatus !== "current" ||
			snapshot.claimsSourceRevision !== draft.revision
		)
			return { kind: "claims_not_current" };

		if (snapshot.claims.length === 0) {
			return input.decisions.length === 0
				? { kind: "not_required", record: mapScriptVersionRecord(draft) }
				: { kind: "invalid_decisions" };
		}

		let source: ReturnType<typeof buildScriptClaimRefreshSourceProjection>;
		try {
			source = buildScriptClaimRefreshSourceProjection(snapshot);
		} catch {
			return { kind: "invalid_subject" };
		}
		if (!validateCurrentOrganicScriptClaimInventory(snapshot.claims, source)) {
			return { kind: "invalid_subject" };
		}

		const byIndex = new Map<number, ConfirmClaimSubjectsDecision>();
		for (const decision of input.decisions) {
			if (
				!Number.isInteger(decision.claimIndex) ||
				decision.claimIndex < 0 ||
				decision.claimIndex >= snapshot.claims.length ||
				byIndex.has(decision.claimIndex) ||
				(decision.subject !== "GENERAL" && decision.subject !== "PRODUCT")
			)
				return { kind: "invalid_decisions" };
			byIndex.set(decision.claimIndex, decision);
		}

		const unresolved = snapshot.claims.reduce<number[]>(
			(indices, claim, index) => {
				if (claim.subjectStatus === "NEEDS_CONFIRMATION") indices.push(index);
				return indices;
			},
			[],
		);
		if (unresolved.length > 0) {
			if (input.decisions.length === 0)
				return { kind: "confirmation_required" };
			if (unresolved.some((index) => !byIndex.has(index)))
				return { kind: "confirmation_required" };
		}

		const nextClaims = snapshot.claims.map((rawClaim, index) => {
			const decision = byIndex.get(index);
			if (!decision) return rawClaim;
			const claim = parseSubjectAwareScriptClaim(
				rawClaim,
			) as SubjectAwareScriptClaim;
			return confirmClaimSubject({
				claim,
				subject:
					decision.subject === "GENERAL"
						? { kind: "GENERAL" }
						: { kind: "PRODUCT", binding: "PROJECT_PRODUCT" },
			});
		});

		if (canonicalizeJson(nextClaims) === canonicalizeJson(snapshot.claims)) {
			return { kind: "not_required", record: mapScriptVersionRecord(draft) };
		}

		const resultRevision = draft.revision + 1;
		const nextSnapshot = {
			...snapshot,
			claims: nextClaims,
			claimsStatus: "current" as const,
			claimsSourceRevision: resultRevision,
		};
		if (!scriptVersionEditableSnapshotSchema.safeParse(nextSnapshot).success)
			return { kind: "invalid_subject" };

		const [updated] = await transaction
			.update(scriptVersion)
			.set({
				editableSnapshotJson: nextSnapshot,
				revision: sql`${scriptVersion.revision} + 1`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(scriptVersion.id, input.scriptVersionId),
					eq(scriptVersion.workspaceId, input.actor.workspaceId),
					eq(scriptVersion.status, "draft"),
					eq(scriptVersion.revision, input.expectedScriptVersionRevision),
				),
			)
			.returning();
		if (updated) {
			return {
				kind: "confirmed",
				record: mapScriptVersionRecord(updated),
				previousRevision: draft.revision,
				resultRevision,
			};
		}

		const latest = await findScriptVersionInTransaction(
			transaction,
			input.actor,
			input.scriptVersionId,
		);
		if (!latest) return { kind: "not_found" };
		return { kind: "conflict", latestRevision: latest.revision };
	});
}

async function findDraftForUpdate(
	transaction: DbTransaction,
	actor: WorkspaceActor,
	scriptVersionId: string,
) {
	const [record] = await transaction
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.id, scriptVersionId),
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.status, "draft"),
			),
		)
		.limit(1)
		.for("update", { of: scriptVersion });
	return record;
}

async function findScriptVersionInTransaction(
	transaction: DbTransaction,
	actor: WorkspaceActor,
	scriptVersionId: string,
) {
	const [record] = await transaction
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.id, scriptVersionId),
				eq(scriptVersion.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return record;
}

export function mapScriptVersionRecord(
	record: ScriptVersionRow,
): ScriptVersionReadModel {
	return {
		id: record.id,
		workspaceId: record.workspaceId,
		projectId: record.projectId,
		sourceGenerationId: record.sourceGenerationId,
		status: record.status as ScriptVersionReadModel["status"],
		versionNumber: record.versionNumber,
		editableSnapshot:
			record.editableSnapshotJson as ScriptVersionEditableSnapshot,
		revision: record.revision,
		restoredFromVersionId: record.restoredFromVersionId,
		createdByUserId: record.createdByUserId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		savedAt: record.savedAt,
	};
}

function mapScriptVersionHistoryRecord(
	record: ScriptVersionRow,
): ScriptVersionHistoryItem {
	return {
		id: record.id,
		workspaceId: record.workspaceId,
		projectId: record.projectId,
		sourceGenerationId: record.sourceGenerationId,
		status: "saved",
		versionNumber: record.versionNumber as number,
		restoredFromVersionId: record.restoredFromVersionId,
		createdByUserId: record.createdByUserId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		savedAt: record.savedAt,
	};
}

export async function hasAccessibleProject(
	actor: WorkspaceActor,
	projectId: string,
) {
	const [record] = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return Boolean(record);
}

export async function findCurrentScriptVersion(
	actor: WorkspaceActor,
	projectId: string,
) {
	const [record] = await db
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.projectId, projectId),
				eq(scriptVersion.status, "draft"),
			),
		)
		.orderBy(desc(scriptVersion.updatedAt), desc(scriptVersion.id))
		.limit(1);
	return record ? mapScriptVersionRecord(record) : undefined;
}

export async function findScriptVersion(
	actor: WorkspaceActor,
	scriptVersionId: string,
) {
	const [record] = await db
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.id, scriptVersionId),
			),
		)
		.limit(1);
	return record ? mapScriptVersionRecord(record) : undefined;
}

export async function findInitializeSource(
	actor: WorkspaceActor,
	projectId: string,
	sourceGenerationId: string,
): Promise<InitializeSourceRecord | undefined> {
	const [record] = await db
		.select({
			id: scriptGeneration.id,
			workspaceId: scriptGeneration.workspaceId,
			projectId: scriptGeneration.projectId,
			status: scriptGeneration.status,
			outputJson: scriptGeneration.outputJson,
		})
		.from(scriptGeneration)
		.innerJoin(project, eq(project.id, scriptGeneration.projectId))
		.where(
			and(
				eq(scriptGeneration.id, sourceGenerationId),
				eq(scriptGeneration.workspaceId, actor.workspaceId),
				eq(scriptGeneration.projectId, projectId),
				eq(project.workspaceId, actor.workspaceId),
				isNull(project.archivedAt),
			),
		)
		.limit(1);
	return record;
}

export async function hasInvalidatedSourceDependency(
	actor: WorkspaceActor,
	sourceGenerationId: string,
) {
	const [record] = await db
		.select({ id: factDependency.id })
		.from(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				eq(factDependency.dependentType, "script_generation"),
				eq(factDependency.dependentId, sourceGenerationId),
				isNull(factDependency.detachedAt),
				isNotNull(factDependency.invalidatedAt),
			),
		)
		.limit(1);
	return Boolean(record);
}

export async function insertScriptVersionDraft(input: {
	actor: WorkspaceActor;
	projectId: string;
	sourceGenerationId: string;
	editableSnapshot: ScriptVersionEditableSnapshot;
}) {
	const [record] = await db
		.insert(scriptVersion)
		.values({
			id: randomUUID(),
			workspaceId: input.actor.workspaceId,
			projectId: input.projectId,
			sourceGenerationId: input.sourceGenerationId,
			status: "draft",
			versionNumber: null,
			editableSnapshotJson: input.editableSnapshot,
			revision: 1,
			createdByUserId: input.actor.userId,
		})
		.returning();
	if (!record) throw new Error("ScriptVersion insert returned no row.");
	return mapScriptVersionRecord(record);
}

export async function initializeScriptVersionDraftAtomic(input: {
	actor: WorkspaceActor;
	projectId: string;
	sourceGenerationId: string;
	editableSnapshot: ScriptVersionEditableSnapshot;
}) {
	return db.transaction(async (transaction) => {
		const projectRecord = await lockProjectForMutation(
			transaction,
			input.actor,
			input.projectId,
		);
		if (!projectRecord) return undefined;

		const [existing] = await transaction
			.select()
			.from(scriptVersion)
			.where(
				and(
					eq(scriptVersion.workspaceId, input.actor.workspaceId),
					eq(scriptVersion.projectId, input.projectId),
					eq(scriptVersion.status, "draft"),
				),
			)
			.limit(1)
			.for("update", { of: scriptVersion });
		if (existing) return mapScriptVersionRecord(existing);

		const [record] = await transaction
			.insert(scriptVersion)
			.values({
				id: randomUUID(),
				workspaceId: input.actor.workspaceId,
				projectId: input.projectId,
				sourceGenerationId: input.sourceGenerationId,
				status: "draft",
				versionNumber: null,
				editableSnapshotJson: input.editableSnapshot,
				revision: 1,
				createdByUserId: input.actor.userId,
			})
			.returning();
		if (!record) throw new Error("ScriptVersion insert returned no row.");
		return mapScriptVersionRecord(record);
	});
}

export async function updateDraftScriptVersion(input: {
	actor: WorkspaceActor;
	scriptVersionId: string;
	baseRevision: number;
	editableSnapshot: ScriptVersionEditableSnapshot;
}) {
	const [record] = await db
		.update(scriptVersion)
		.set({
			editableSnapshotJson: input.editableSnapshot,
			revision: sql`${scriptVersion.revision} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(scriptVersion.id, input.scriptVersionId),
				eq(scriptVersion.workspaceId, input.actor.workspaceId),
				eq(scriptVersion.status, "draft"),
				eq(scriptVersion.revision, input.baseRevision),
			),
		)
		.returning();
	return record ? mapScriptVersionRecord(record) : undefined;
}

export async function saveScriptVersionRecord(input: {
	actor: WorkspaceActor;
	scriptVersionId: string;
	baseRevision: number;
}): Promise<ScriptVersionMutationResult> {
	return db.transaction(async (transaction) => {
		const candidate = await findScriptVersionInTransaction(
			transaction,
			input.actor,
			input.scriptVersionId,
		);
		if (!candidate) return { kind: "not_found" };

		const lockedProject = await lockProjectForMutation(
			transaction,
			input.actor,
			candidate.projectId,
		);
		if (!lockedProject) return { kind: "not_found" };

		const draft = await findDraftForUpdate(
			transaction,
			input.actor,
			input.scriptVersionId,
		);
		if (!draft) return { kind: "immutable" };
		if (draft.revision !== input.baseRevision) {
			return { kind: "conflict", latestRevision: draft.revision };
		}

		const parsed = validateScriptVersionDraft(draft.editableSnapshotJson);
		if (!parsed.success) return { kind: "invalid_snapshot" };

		const [highest] = await transaction
			.select({ versionNumber: max(scriptVersion.versionNumber) })
			.from(scriptVersion)
			.where(
				and(
					eq(scriptVersion.workspaceId, input.actor.workspaceId),
					eq(scriptVersion.projectId, draft.projectId),
					eq(scriptVersion.status, "saved"),
				),
			);
		const nextVersionNumber = (highest?.versionNumber ?? 0) + 1;
		const savedAt = new Date();
		const [saved] = await transaction
			.insert(scriptVersion)
			.values({
				id: randomUUID(),
				workspaceId: draft.workspaceId,
				projectId: draft.projectId,
				sourceGenerationId: draft.sourceGenerationId,
				status: "saved",
				versionNumber: nextVersionNumber,
				editableSnapshotJson: parsed.data,
				revision: draft.revision,
				// Restore lineage belongs to the mutable current draft only. Saved history
				// remains an immutable snapshot and does not point at another version.
				restoredFromVersionId: null,
				createdByUserId: input.actor.userId,
				createdAt: savedAt,
				updatedAt: savedAt,
				savedAt,
			})
			.returning();
		if (!saved) throw new Error("Save Version insert returned no row.");
		return { kind: "success", record: mapScriptVersionRecord(saved) };
	});
}

export async function listScriptVersionHistory(
	actor: WorkspaceActor,
	projectId: string,
) {
	const records = await db
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.projectId, projectId),
				eq(scriptVersion.status, "saved"),
			),
		)
		.orderBy(desc(scriptVersion.versionNumber), desc(scriptVersion.savedAt));
	return records.map(mapScriptVersionHistoryRecord);
}

export async function findSavedScriptVersion(
	actor: WorkspaceActor,
	projectId: string,
	versionId: string,
) {
	const [record] = await db
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.id, versionId),
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.projectId, projectId),
				eq(scriptVersion.status, "saved"),
			),
		)
		.limit(1);
	return record ? mapScriptVersionRecord(record) : undefined;
}

export async function restoreScriptVersionRecord(input: {
	actor: WorkspaceActor;
	draftId: string;
	savedVersionId: string;
	baseRevision: number;
}): Promise<ScriptVersionMutationResult> {
	return db.transaction(async (transaction) => {
		const candidate = await findScriptVersionInTransaction(
			transaction,
			input.actor,
			input.draftId,
		);
		if (!candidate) return { kind: "not_found" };

		const lockedProject = await lockProjectForMutation(
			transaction,
			input.actor,
			candidate.projectId,
		);
		if (!lockedProject) return { kind: "not_found" };

		const draft = await findDraftForUpdate(
			transaction,
			input.actor,
			input.draftId,
		);
		if (!draft) return { kind: "immutable" };

		const [saved] = await transaction
			.select()
			.from(scriptVersion)
			.where(
				and(
					eq(scriptVersion.id, input.savedVersionId),
					eq(scriptVersion.workspaceId, input.actor.workspaceId),
					eq(scriptVersion.projectId, draft.projectId),
					eq(scriptVersion.status, "saved"),
				),
			)
			.limit(1);
		if (!saved) return { kind: "not_found" };
		if (draft.revision !== input.baseRevision) {
			return { kind: "conflict", latestRevision: draft.revision };
		}

		const parsed = validateScriptVersionDraft(saved.editableSnapshotJson);
		if (!parsed.success) return { kind: "invalid_snapshot" };
		const nextRevision = draft.revision + 1;
		const restoredSnapshot = {
			...parsed.data,
			claimsSourceRevision:
				parsed.data.claimsStatus === "current"
					? nextRevision
					: parsed.data.claimsSourceRevision,
		};
		const [restored] = await transaction
			.update(scriptVersion)
			.set({
				editableSnapshotJson: restoredSnapshot,
				revision: nextRevision,
				restoredFromVersionId: saved.id,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(scriptVersion.id, draft.id),
					eq(scriptVersion.workspaceId, input.actor.workspaceId),
					eq(scriptVersion.status, "draft"),
					eq(scriptVersion.revision, input.baseRevision),
				),
			)
			.returning();
		if (restored)
			return { kind: "success", record: mapScriptVersionRecord(restored) };

		const latest = await findScriptVersionInTransaction(
			transaction,
			input.actor,
			input.draftId,
		);
		if (!latest) return { kind: "not_found" };
		return { kind: "conflict", latestRevision: latest.revision };
	});
}

export function isUniqueViolation(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

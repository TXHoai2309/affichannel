import {
	type BuiltSubjectAwareClaimManifest,
	deriveFactLockEffectiveStatus,
	FactLockError,
	type FactLockGateEvaluationInput,
	type FactLockProductFactSnapshot,
	type FactLockReadModel,
	type FactLockReadRun,
	type FactLockRunStatus,
	factLockInputSnapshotSchema,
	manifestFactLockInputSnapshotAnySchema,
	type ParsedFactLockInputSnapshot,
	type ParsedManifestFactLockInputSnapshot,
	type ParsedManifestFactLockInputSnapshotV2,
	scriptVersionEditableSnapshotSchema,
	selectConfirmedProductManifestClaims,
} from "@affichannel/core";
import type { ClaimManifest } from "@affichannel/core/claim-manifest/types";
import { FACT_LOCK_MANIFEST_INPUT_MODE } from "@affichannel/core/fact-lock/manifest-contract";
import type { ScriptVersionEditableSnapshot } from "@affichannel/core/script-version/types";
import {
	db,
	factDependency,
	factLockRun,
	product,
	productFact,
	project,
	scriptVersion,
} from "@affichannel/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import {
	ClaimManifestRepositoryError,
	getClaimManifestByIdInTransaction,
} from "./claim-manifest-repository";
import { loadFactLockClaimsInTransaction } from "./fact-lock-claim-read-repository";
import type { WorkspaceActor } from "./workspace";

type FactLockRunRow = typeof factLockRun.$inferSelect;
type FactDependencyRow = typeof factDependency.$inferSelect;
type ProductFactRow = typeof productFact.$inferSelect;

type ReadProject = {
	id: string;
	workspaceId: string;
	productId: string | null;
	contentType: string | null;
	creationPath: string | null;
	contentFormatKey: string | null;
	contentFormatVersion: number | null;
	archivedAt: Date | null;
	productStatus?: string | null;
	productArchivedAt?: Date | null;
};

type ReadContextRun = FactLockReadRun & {
	dependenciesCurrent: boolean;
	sourceCurrent: boolean;
};

export type FactLockReadContext = {
	project: ReadProject;
	currentScriptVersion: FactLockGateEvaluationInput["currentScriptVersion"];
	runs: ReadContextRun[];
	gateInput: FactLockGateEvaluationInput;
};

function readFailure(message: string): never {
	throw new FactLockError("FACT_LOCK_SCRIPT_NOT_READY", message);
}

function manifestFailure(message: string): never {
	throw new FactLockError("CLAIM_MANIFEST_FINGERPRINT_MISMATCH", message);
}

/**
 * Legacy rows remain readable only when their persisted snapshot and the
 * database provenance still satisfy the exact legacy contract. A malformed
 * historical row is not normalized or repaired here; callers can represent
 * it as a blocked/degraded read entry without allowing it to satisfy the gate.
 */
export function tryParseLegacyFactLockSnapshot(
	row: FactLockRunRow,
): ParsedFactLockInputSnapshot | null {
	const parsed = factLockInputSnapshotSchema.safeParse(row.inputSnapshotJson);
	if (!parsed.success) return null;
	if (
		row.scriptVersionId === null ||
		row.sourceScriptRevision === null ||
		parsed.data.scriptVersion.id !== row.scriptVersionId ||
		parsed.data.scriptVersion.revision !== row.sourceScriptRevision
	) {
		return null;
	}
	return parsed.data;
}

type ParsedLegacyReadRun = {
	run: FactLockRunRow;
	mode: "LEGACY";
	snapshot: ParsedFactLockInputSnapshot | null;
	manifest: undefined;
};

type ParsedManifestReadRun = {
	run: FactLockRunRow;
	mode: "MANIFEST_V1";
	snapshot:
		| ParsedManifestFactLockInputSnapshot
		| import("@affichannel/core").ParsedManifestFactLockInputSnapshotV2;
	manifest: ClaimManifest | undefined;
};

type ParsedReadRun = ParsedLegacyReadRun | ParsedManifestReadRun;

function parseManifestSnapshot(
	row: FactLockRunRow,
): ParsedManifestReadRun["snapshot"] {
	const parsed = manifestFactLockInputSnapshotAnySchema.safeParse(
		row.inputSnapshotJson,
	);
	if (!parsed.success)
		manifestFailure("Manifest Fact Lock snapshot không hợp lệ.");
	if (
		row.claimManifestId === null ||
		row.claimManifestFingerprint === null ||
		parsed.data.claimManifest.id !== row.claimManifestId ||
		parsed.data.claimManifest.fingerprint !== row.claimManifestFingerprint ||
		parsed.data.source.sourceType !== "SCRIPT_VERSION" ||
		row.scriptVersionId === null ||
		row.sourceScriptRevision === null ||
		parsed.data.source.scriptVersionId !== row.scriptVersionId ||
		parsed.data.source.scriptVersionRevision !== row.sourceScriptRevision
	) {
		manifestFailure("Manifest Fact Lock provenance không khớp.");
	}
	return parsed.data;
}

function toSnapshotFacts(
	facts:
		| ParsedFactLockInputSnapshot["productFacts"]
		| ParsedManifestFactLockInputSnapshot["productFacts"],
): FactLockProductFactSnapshot[] {
	return facts as FactLockProductFactSnapshot[];
}

function currentFactsAreValid(
	snapshotFacts: readonly FactLockProductFactSnapshot[],
	dependencies: readonly FactDependencyRow[],
	facts: readonly ProductFactRow[],
	productId: string | null,
) {
	if (productId === null || dependencies.length !== snapshotFacts.length)
		return false;
	const factsById = new Map(facts.map((fact) => [fact.id, fact]));
	return snapshotFacts.every((snapshotFact) => {
		const dependency = dependencies.find(
			(candidate) => candidate.productFactId === snapshotFact.id,
		);
		const currentFact = factsById.get(snapshotFact.id);
		return (
			dependency !== undefined &&
			dependency.factRevision === snapshotFact.revision &&
			dependency.detachedAt === null &&
			dependency.invalidatedAt === null &&
			currentFact !== undefined &&
			currentFact.productId === productId &&
			currentFact.revision === snapshotFact.revision &&
			currentFact.status === "verified"
		);
	});
}

function legacySourceCurrent(
	run: FactLockRunRow,
	currentScriptVersion: FactLockGateEvaluationInput["currentScriptVersion"],
) {
	return (
		run.inputMode === null &&
		currentScriptVersion !== null &&
		run.scriptVersionId === currentScriptVersion.id &&
		run.sourceScriptRevision === currentScriptVersion.revision
	);
}

function manifestSourceCurrent(
	projectRecord: ReadProject,
	run: FactLockRunRow,
	manifest: ClaimManifest,
	currentScriptVersion: FactLockGateEvaluationInput["currentScriptVersion"],
) {
	const affiliateCurrent =
		projectRecord.archivedAt === null &&
		projectRecord.contentType === "AFFILIATE" &&
		projectRecord.creationPath === "SCRIPTED" &&
		projectRecord.contentFormatKey === "SCRIPTED_STANDARD" &&
		projectRecord.contentFormatVersion === 1 &&
		manifest.source.sourceType === "SCRIPT_VERSION" &&
		run.scriptVersionId === manifest.source.scriptVersionId &&
		run.sourceScriptRevision === manifest.source.scriptVersionRevision &&
		currentScriptVersion !== null &&
		currentScriptVersion.id === manifest.source.scriptVersionId &&
		currentScriptVersion.revision === manifest.source.scriptVersionRevision;
	const organicCurrent =
		projectRecord.archivedAt === null &&
		projectRecord.contentType === "ORGANIC" &&
		projectRecord.creationPath === "SCRIPTED" &&
		projectRecord.contentFormatKey === "SCRIPTED_STANDARD" &&
		projectRecord.contentFormatVersion === 1 &&
		manifest.builderVersion === "claim-manifest-builder.v2" &&
		(projectRecord.productStatus === undefined ||
			(projectRecord.productStatus === "active" &&
				projectRecord.productArchivedAt === null)) &&
		manifest.source.sourceType === "SCRIPT_VERSION" &&
		currentScriptVersion !== null &&
		scriptVersionEditableSnapshotSchema.safeParse(currentScriptVersion.snapshot)
			.success &&
		currentScriptVersion.snapshot.schemaVersion === "script-draft.v3" &&
		currentScriptVersion.snapshot.claimsStatus === "current" &&
		currentScriptVersion.snapshot.claims.every(
			(claim) =>
				"subjectStatus" in claim &&
				claim.subjectStatus === "CONFIRMED" &&
				(claim.subjectSource === "USER" ||
					claim.subjectSource === "STRUCTURED_SOURCE"),
		) &&
		currentScriptVersion.snapshot.claimsSourceRevision ===
			manifest.source.claimsSourceRevision &&
		currentScriptVersion.id === manifest.source.scriptVersionId &&
		currentScriptVersion.revision === manifest.source.scriptVersionRevision;
	return affiliateCurrent || organicCurrent;
}

function mapCurrentScript(
	row:
		| {
				id: string;
				revision: number;
				editableSnapshotJson: unknown;
		  }
		| undefined,
): FactLockGateEvaluationInput["currentScriptVersion"] {
	return row
		? {
				id: row.id,
				revision: row.revision,
				snapshot: row.editableSnapshotJson as ScriptVersionEditableSnapshot,
			}
		: null;
}

async function readManifest(
	actor: WorkspaceActor,
	projectId: string,
	claimManifestId: string,
): Promise<ClaimManifest> {
	try {
		const manifest = await db.transaction((transaction) =>
			getClaimManifestByIdInTransaction(transaction, {
				workspaceId: actor.workspaceId,
				projectId,
				claimManifestId,
			}),
		);
		if (!manifest) {
			throw new FactLockError(
				"CLAIM_MANIFEST_NOT_FOUND",
				"ClaimManifest không tồn tại trong phạm vi yêu cầu.",
			);
		}
		return manifest;
	} catch (error) {
		if (error instanceof FactLockError) throw error;
		if (
			error instanceof ClaimManifestRepositoryError &&
			error.code === "CLAIM_MANIFEST_PERSISTED_DATA_INVALID"
		)
			manifestFailure("ClaimManifest persisted data không hợp lệ.");
		manifestFailure("Không thể xác thực ClaimManifest.");
	}
}

async function readClaims(
	actor: WorkspaceActor,
	run: FactLockRunRow,
	manifest: ClaimManifest | undefined,
) {
	try {
		return await db.transaction((transaction) =>
			loadFactLockClaimsInTransaction(transaction, actor, run.id, manifest),
		);
	} catch (error) {
		if (manifest) manifestFailure("Fact Lock claim projection không hợp lệ.");
		throw error;
	}
}

function assertManifestClaimShape(
	run: FactLockRunRow,
	manifest: ClaimManifest,
	claims: FactLockReadRun["claims"],
) {
	const expectedCount =
		manifest.builderVersion === "claim-manifest-builder.v2"
			? selectConfirmedProductManifestClaims(
					manifest as unknown as BuiltSubjectAwareClaimManifest,
				).length
			: manifest.claimCount;
	if (manifest.builderVersion === "claim-manifest-builder.v2") {
		const expectedKeys = new Set(
			selectConfirmedProductManifestClaims(
				manifest as unknown as BuiltSubjectAwareClaimManifest,
			).map((claim) => claim.claimKey),
		);
		if (claims.some((claim) => !expectedKeys.has(claim.claimKey)))
			manifestFailure("Fact Lock claims chứa General claim.");
	}
	if (claims.length > expectedCount) {
		manifestFailure("Fact Lock claims chứa claim không thuộc Manifest.");
	}
	if (
		(run.status === "passed" || run.status === "review_required") &&
		claims.length !== expectedCount
	) {
		manifestFailure("Fact Lock terminal claims không khớp Manifest.");
	}
	if (manifest.isEmpty && claims.length !== 0) {
		manifestFailure("Zero-claim Manifest không được có Fact Lock claim.");
	}
}

function manifestDependenciesCurrent(
	snapshot:
		| ParsedManifestFactLockInputSnapshot
		| ParsedManifestFactLockInputSnapshotV2,
	manifest: ClaimManifest,
	dependencies: readonly FactDependencyRow[],
	facts: readonly ProductFactRow[],
	productId: string | null,
) {
	if (manifest.claimCount === 0 && manifest.isEmpty) {
		return (
			snapshot.zeroClaim !== null &&
			snapshot.productFacts.length === 0 &&
			productId !== null &&
			manifest.productId === productId &&
			dependencies.length === 0
		);
	}
	if (manifest.builderVersion === "claim-manifest-builder.v2") {
		const productClaims = selectConfirmedProductManifestClaims(
			manifest as unknown as BuiltSubjectAwareClaimManifest,
		);
		if (
			snapshot.inputVersion !== "fact-lock.manifest.v2" ||
			snapshot.productClaims.length !== productClaims.length ||
			snapshot.productClaims.some(
				(claim, index) =>
					JSON.stringify(claim) !== JSON.stringify(productClaims[index]),
			)
		)
			return false;
	}
	return (
		snapshot.zeroClaim === null &&
		manifest.claimCount > 0 &&
		manifest.productId === productId &&
		currentFactsAreValid(
			toSnapshotFacts(snapshot.productFacts),
			dependencies,
			facts,
			productId,
		)
	);
}

export async function loadFactLockReadContext(
	actor: WorkspaceActor,
	projectId: string,
	options: { includeArchived?: boolean } = {},
): Promise<FactLockReadContext> {
	const projectConditions = [
		eq(project.workspaceId, actor.workspaceId),
		eq(project.id, projectId),
	];
	if (!options.includeArchived)
		projectConditions.push(isNull(project.archivedAt));
	const [projectRecord] = await db
		.select({
			id: project.id,
			workspaceId: project.workspaceId,
			productId: project.productId,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			archivedAt: project.archivedAt,
		})
		.from(project)
		.where(and(...projectConditions))
		.limit(1);
	if (!projectRecord) {
		throw new FactLockError(
			"FACT_LOCK_NOT_FOUND",
			"Project không tồn tại trong workspace.",
		);
	}
	const [productRecord] = projectRecord.productId
		? await db
				.select({ status: product.status, archivedAt: product.archivedAt })
				.from(product)
				.where(
					and(
						eq(product.workspaceId, actor.workspaceId),
						eq(product.id, projectRecord.productId),
					),
				)
				.limit(1)
		: [];
	const readProject = {
		...projectRecord,
		productStatus: productRecord?.status ?? null,
		productArchivedAt: productRecord?.archivedAt ?? null,
	};

	const [currentScript] = await db
		.select({
			id: scriptVersion.id,
			revision: scriptVersion.revision,
			editableSnapshotJson: scriptVersion.editableSnapshotJson,
		})
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
	const currentScriptVersion = mapCurrentScript(currentScript);

	const runs = await db
		.select()
		.from(factLockRun)
		.where(
			and(
				eq(factLockRun.workspaceId, actor.workspaceId),
				eq(factLockRun.projectId, projectId),
			),
		)
		.orderBy(desc(factLockRun.createdAt), desc(factLockRun.id));

	const parsedRuns: ParsedReadRun[] = runs.map((run) => {
		if (run.inputMode === null) {
			return {
				run,
				mode: "LEGACY" as const,
				snapshot: tryParseLegacyFactLockSnapshot(run),
				manifest: undefined,
			};
		}
		if (run.inputMode !== FACT_LOCK_MANIFEST_INPUT_MODE)
			readFailure("Fact Lock input mode không được hỗ trợ.");
		if (run.claimManifestId === null || run.claimManifestFingerprint === null)
			manifestFailure("Manifest Fact Lock reference không đầy đủ.");
		return {
			run,
			mode: "MANIFEST_V1" as const,
			snapshot: parseManifestSnapshot(run),
			manifest: undefined as ClaimManifest | undefined,
		};
	});

	const manifests = new Map<string, ClaimManifest>();
	for (const parsed of parsedRuns) {
		if (parsed.mode !== "MANIFEST_V1") continue;
		const manifest = await readManifest(
			actor,
			projectId,
			parsed.run.claimManifestId as string,
		);
		if (
			manifest.fingerprint !== parsed.run.claimManifestFingerprint ||
			manifest.workspaceId !== actor.workspaceId ||
			manifest.projectId !== projectId ||
			parsed.snapshot.claimManifest.fingerprint !== manifest.fingerprint
		)
			manifestFailure("Fact Lock run không khớp ClaimManifest.");
		manifests.set(manifest.id, manifest);
		parsed.manifest = manifest;
	}

	const runIds = runs.map((run) => run.id);
	const dependencies =
		runIds.length === 0
			? []
			: await db
					.select()
					.from(factDependency)
					.where(
						and(
							eq(factDependency.workspaceId, actor.workspaceId),
							eq(factDependency.dependentType, "fact_lock"),
							inArray(factDependency.dependentId, runIds),
						),
					);
	const dependenciesByRun = new Map<string, FactDependencyRow[]>();
	for (const dependency of dependencies) {
		const list = dependenciesByRun.get(dependency.dependentId) ?? [];
		list.push(dependency);
		dependenciesByRun.set(dependency.dependentId, list);
	}

	const allFactIds = [
		...new Set(
			parsedRuns.flatMap(
				(parsed) => parsed.snapshot?.productFacts.map((fact) => fact.id) ?? [],
			),
		),
	];
	const currentFacts =
		projectRecord.productId === null || allFactIds.length === 0
			? []
			: await db
					.select()
					.from(productFact)
					.where(
						and(
							eq(productFact.workspaceId, actor.workspaceId),
							eq(productFact.productId, projectRecord.productId),
							inArray(productFact.id, allFactIds),
						),
					);

	const contextRuns: ReadContextRun[] = [];
	for (const parsed of parsedRuns) {
		const manifest = parsed.manifest;
		// An invalid historical snapshot is already unusable for gating. Avoid
		// depending on its claim projection so one corrupted run cannot abort the
		// surrounding project/list or dashboard read.
		const claims =
			parsed.snapshot === null
				? []
				: await readClaims(actor, parsed.run, manifest);
		if (parsed.snapshot === null) {
			contextRuns.push({
				id: parsed.run.id,
				inputMode: "LEGACY",
				status: parsed.run.status as FactLockRunStatus,
				effectiveStatus: deriveFactLockEffectiveStatus(
					parsed.run.status as FactLockRunStatus,
					parsed.run.sourceScriptRevision ?? 0,
					currentScriptVersion?.revision ?? null,
					false,
				),
				createdAt: parsed.run.createdAt,
				finishedAt: parsed.run.finishedAt,
				errorCode: parsed.run.errorCode,
				scriptVersionId: parsed.run.scriptVersionId,
				sourceScriptRevision: parsed.run.sourceScriptRevision,
				claimManifest: null,
				facts: [],
				claims,
				dependenciesCurrent: false,
				sourceCurrent: false,
			});
			continue;
		}
		if (parsed.mode === "MANIFEST_V1" && manifest)
			assertManifestClaimShape(parsed.run, manifest, claims);
		const sourceCurrent = manifest
			? manifestSourceCurrent(
					projectRecord,
					parsed.run,
					manifest,
					currentScriptVersion,
				)
			: legacySourceCurrent(parsed.run, currentScriptVersion);
		const dependenciesCurrent =
			parsed.mode === "MANIFEST_V1" && manifest
				? manifestDependenciesCurrent(
						parsed.snapshot,
						manifest,
						dependenciesByRun.get(parsed.run.id) ?? [],
						currentFacts,
						projectRecord.productId,
					)
				: currentFactsAreValid(
						toSnapshotFacts(parsed.snapshot.productFacts),
						dependenciesByRun.get(parsed.run.id) ?? [],
						currentFacts,
						projectRecord.productId,
					);
		const effectiveStatus = deriveFactLockEffectiveStatus(
			parsed.run.status as FactLockRunStatus,
			parsed.run.sourceScriptRevision ?? 0,
			currentScriptVersion?.revision ?? null,
			dependenciesCurrent && sourceCurrent,
		);
		contextRuns.push({
			id: parsed.run.id,
			inputMode: parsed.mode,
			status: parsed.run.status as FactLockRunStatus,
			effectiveStatus,
			createdAt: parsed.run.createdAt,
			finishedAt: parsed.run.finishedAt,
			errorCode: parsed.run.errorCode,
			scriptVersionId: parsed.run.scriptVersionId,
			sourceScriptRevision: parsed.run.sourceScriptRevision,
			claimManifest: manifest
				? {
						id: manifest.id,
						fingerprint: manifest.fingerprint,
						productId: manifest.productId,
						sourceType: manifest.source.sourceType,
						sourceScriptVersionId:
							manifest.source.sourceType === "SCRIPT_VERSION"
								? manifest.source.scriptVersionId
								: null,
						sourceScriptRevision:
							manifest.source.sourceType === "SCRIPT_VERSION"
								? manifest.source.scriptVersionRevision
								: null,
					}
				: null,
			facts: toSnapshotFacts(parsed.snapshot.productFacts),
			claims,
			dependenciesCurrent,
			sourceCurrent,
		});
	}

	const gateInput: FactLockGateEvaluationInput = {
		currentScriptVersion,
		runs: contextRuns.map((run) => ({
			id: run.id,
			inputMode: run.inputMode,
			scriptVersionId: run.scriptVersionId,
			sourceScriptRevision: run.sourceScriptRevision,
			sourceCurrent: run.sourceCurrent,
			status: run.status,
			dependenciesCurrent: run.dependenciesCurrent,
			createdAt: run.createdAt,
		})),
	};
	return {
		project: readProject,
		currentScriptVersion,
		runs: contextRuns,
		gateInput,
	};
}

export function toFactLockReadModel(
	context: FactLockReadContext,
): FactLockReadModel {
	const applicable = context.runs.find(
		(run) =>
			run.effectiveStatus === "passed" ||
			run.effectiveStatus === "review_required",
	);
	const latestRequest = context.runs[0] ?? null;
	return {
		currentScriptVersion: context.currentScriptVersion
			? {
					id: context.currentScriptVersion.id,
					revision: context.currentScriptVersion.revision,
					claimsSourceRevision: (
						context.currentScriptVersion
							.snapshot as ScriptVersionEditableSnapshot
					).claimsSourceRevision,
					claimsStatus: (
						context.currentScriptVersion
							.snapshot as ScriptVersionEditableSnapshot
					).claimsStatus,
				}
			: null,
		latestRequest,
		latestApplicableRun: applicable ?? null,
		effectiveStatus: latestRequest?.effectiveStatus ?? null,
	};
}

export function factLockRunDependenciesAreCurrent(
	context: FactLockReadContext,
	runId: string,
) {
	return (
		context.runs.find((run) => run.id === runId)?.dependenciesCurrent ?? false
	);
}

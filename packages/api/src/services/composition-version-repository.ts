import { randomUUID } from "node:crypto";
import type { CompositionInputV1, CompositionInputV2 } from "@affichannel/core";
import {
	canonicalCompositionSemanticJson,
	compositionInputSchema,
	compositionInputV1Schema,
	compositionInputV2Schema,
	sha256Hex,
} from "@affichannel/core";
import { compositionVersion, db, project } from "@affichannel/db";
import { and, desc, eq } from "drizzle-orm";
import type { DbTransaction } from "./fact-dependency-repository";
import type { WorkspaceActor } from "./workspace";

type DbQuery = typeof db | DbTransaction;

type CompositionVersionReadModelBase = {
	id: string;
	workspaceId: string;
	projectId: string;
	compositionFingerprint: string;
	createdByUserId: string;
	createdAt: Date;
};

export type ScriptedCompositionVersionReadModel =
	CompositionVersionReadModelBase & {
		schemaVersion: "composition-input.v1";
		compositionInput: CompositionInputV1;
		sourceScriptVersionId: string;
		sourceScriptRevision: number;
	};

export type QuickImageCompositionVersionReadModel =
	CompositionVersionReadModelBase & {
		schemaVersion: "composition-input.v2";
		compositionInput: CompositionInputV2;
		sourceScriptVersionId: null;
		sourceScriptRevision: null;
		sourceMediaAssetId: string;
		sourceMediaChecksumSha256: string;
		sourceMediaStorageProvider: "local" | "r2";
		sourceMediaStorageKey: string;
		sourceMediaMimeType: "image/jpeg" | "image/png" | "image/webp";
		sourceMediaByteSize: number;
		sourceMediaWidth: number;
		sourceMediaHeight: number;
	};

export type CompositionVersionReadModel =
	| ScriptedCompositionVersionReadModel
	| QuickImageCompositionVersionReadModel;

/** Shared Preview/Render read boundary; intentionally omits storage internals. */
export type CompositionVersionDto = CompositionVersionReadModel;

async function mapRow(
	row: typeof compositionVersion.$inferSelect,
): Promise<CompositionVersionReadModel> {
	if (row.schemaVersion === "composition-input.v1") {
		const parsed = compositionInputV1Schema.parse(row.compositionInputJson);
		return {
			id: row.id,
			workspaceId: row.workspaceId,
			projectId: row.projectId,
			schemaVersion: "composition-input.v1",
			compositionInput: parsed,
			compositionFingerprint: row.compositionFingerprint,
			sourceScriptVersionId: row.sourceScriptVersionId,
			sourceScriptRevision: row.sourceScriptRevision,
			createdByUserId: row.createdByUserId,
			createdAt: row.createdAt,
		};
	}
	if (row.schemaVersion !== "composition-input.v2")
		throw new Error("COMPOSITION_INPUT_INVALID");
	const parsed = compositionInputV2Schema.safeParse(row.compositionInputJson);
	if (!parsed.success) throw new Error("COMPOSITION_INPUT_INVALID");
	const expectedFingerprint = await sha256Hex(
		canonicalCompositionSemanticJson(parsed.data),
	);
	const source = parsed.data.source;
	if (
		row.sourceKind !== "QUICK_IMAGE" ||
		row.workspaceId !== parsed.data.workspaceId ||
		row.projectId !== parsed.data.projectId ||
		row.sourceScriptVersionId !== null ||
		row.sourceScriptRevision !== null ||
		row.sourceMediaAssetId !== source.mediaAssetId ||
		row.sourceMediaChecksumSha256 !== source.checksumSha256 ||
		row.sourceMediaStorageProvider !== source.storageProvider ||
		row.sourceMediaStorageKey !== source.storageKey ||
		row.sourceMediaMimeType !== source.mimeType ||
		row.sourceMediaByteSize !== source.byteSize ||
		row.sourceMediaWidth !== source.width ||
		row.sourceMediaHeight !== source.height ||
		expectedFingerprint !== row.compositionFingerprint
	)
		throw new Error("COMPOSITION_INPUT_INVALID");
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		schemaVersion: "composition-input.v2",
		compositionInput: parsed.data,
		compositionFingerprint: row.compositionFingerprint,
		sourceScriptVersionId: null,
		sourceScriptRevision: null,
		sourceMediaAssetId: source.mediaAssetId,
		sourceMediaChecksumSha256: source.checksumSha256,
		sourceMediaStorageProvider: source.storageProvider,
		sourceMediaStorageKey: source.storageKey,
		sourceMediaMimeType: source.mimeType,
		sourceMediaByteSize: source.byteSize,
		sourceMediaWidth: source.width,
		sourceMediaHeight: source.height,
		createdByUserId: row.createdByUserId,
		createdAt: row.createdAt,
	};
}

export const toCompositionVersionDto = (
	record: CompositionVersionReadModel,
): CompositionVersionDto => record;

export async function insertCompositionVersionRecord(input: {
	actor: WorkspaceActor;
	projectId: string;
	compositionInput: CompositionInputV1 | CompositionInputV2;
	compositionFingerprint: string;
}) {
	const parsed = compositionInputSchema.safeParse(input.compositionInput);
	if (!parsed.success) throw new Error("COMPOSITION_INPUT_INVALID");
	const expectedFingerprint = await sha256Hex(
		canonicalCompositionSemanticJson(parsed.data),
	);
	if (expectedFingerprint !== input.compositionFingerprint)
		throw new Error("COMPOSITION_INPUT_INVALID");
	if (
		parsed.data.workspaceId !== input.actor.workspaceId ||
		parsed.data.projectId !== input.projectId
	) {
		throw new Error("COMPOSITION_SCOPE_MISMATCH");
	}
	const [accessibleProject] = await db
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.id, input.projectId),
				eq(project.workspaceId, input.actor.workspaceId),
			),
		)
		.limit(1);
	if (!accessibleProject) throw new Error("COMPOSITION_SCOPE_MISMATCH");
	const lineage =
		parsed.data.schemaVersion === "composition-input.v1"
			? {
					sourceKind: "SCRIPTED" as const,
					sourceScriptVersionId: parsed.data.script.provenance.scriptVersionId,
					sourceScriptRevision: parsed.data.script.provenance.revision,
				}
			: {
					sourceKind: "QUICK_IMAGE" as const,
					sourceScriptVersionId: null as unknown as string,
					sourceScriptRevision: null as unknown as number,
					sourceMediaAssetId: parsed.data.source.mediaAssetId,
					sourceMediaChecksumSha256: parsed.data.source.checksumSha256,
					sourceMediaStorageProvider: parsed.data.source.storageProvider,
					sourceMediaStorageKey: parsed.data.source.storageKey,
					sourceMediaMimeType: parsed.data.source.mimeType,
					sourceMediaByteSize: parsed.data.source.byteSize,
					sourceMediaWidth: parsed.data.source.width,
					sourceMediaHeight: parsed.data.source.height,
				};
	const [row] = await db
		.insert(compositionVersion)
		.values({
			id: randomUUID(),
			workspaceId: input.actor.workspaceId,
			projectId: input.projectId,
			schemaVersion: parsed.data.schemaVersion,
			compositionInputJson: parsed.data,
			compositionFingerprint: input.compositionFingerprint,
			...lineage,
			createdByUserId: input.actor.userId,
		})
		.returning();
	if (!row) throw new Error("CompositionVersion insert returned no row.");
	return mapRow(row);
}

export async function findCompositionVersionRecord(
	actor: WorkspaceActor,
	compositionVersionId: string,
) {
	return findCompositionVersionRecordInQuery(db, actor, compositionVersionId);
}

export async function findCompositionVersionRecordInQuery(
	query: DbQuery,
	actor: WorkspaceActor,
	compositionVersionId: string,
) {
	const [row] = await query
		.select()
		.from(compositionVersion)
		.where(
			and(
				eq(compositionVersion.id, compositionVersionId),
				eq(compositionVersion.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return row ? mapRow(row) : undefined;
}

/** Read-only raw boundary for technical preflight schema/fingerprint checks. */
export async function findCompositionVersionTechnicalRecord(
	actor: WorkspaceActor,
	compositionVersionId: string,
) {
	const [row] = await db
		.select({
			id: compositionVersion.id,
			workspaceId: compositionVersion.workspaceId,
			projectId: compositionVersion.projectId,
			schemaVersion: compositionVersion.schemaVersion,
			compositionInputJson: compositionVersion.compositionInputJson,
			compositionFingerprint: compositionVersion.compositionFingerprint,
		})
		.from(compositionVersion)
		.where(
			and(
				eq(compositionVersion.id, compositionVersionId),
				eq(compositionVersion.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return row;
}

export async function listCompositionVersionRecords(
	actor: WorkspaceActor,
	projectId: string,
) {
	const rows = await db
		.select()
		.from(compositionVersion)
		.where(
			and(
				eq(compositionVersion.workspaceId, actor.workspaceId),
				eq(compositionVersion.projectId, projectId),
			),
		)
		.orderBy(desc(compositionVersion.createdAt), desc(compositionVersion.id));
	return Promise.all(rows.map(mapRow));
}

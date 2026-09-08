import { randomUUID } from "node:crypto";
import type { CompositionInputV1 } from "@affichannel/core";
import {
	canonicalCompositionSemanticJson,
	compositionInputV1Schema,
	sha256Hex,
} from "@affichannel/core";
import { compositionVersion, db, project } from "@affichannel/db";
import { and, desc, eq } from "drizzle-orm";

import type { WorkspaceActor } from "./workspace";

export type CompositionVersionReadModel = {
	id: string;
	workspaceId: string;
	projectId: string;
	schemaVersion: "composition-input.v1";
	compositionInput: CompositionInputV1;
	compositionFingerprint: string;
	sourceScriptVersionId: string;
	sourceScriptRevision: number;
	createdByUserId: string;
	createdAt: Date;
};

/** Shared Preview/Render read boundary; intentionally omits storage internals. */
export type CompositionVersionDto = CompositionVersionReadModel;

function mapRow(
	row: typeof compositionVersion.$inferSelect,
): CompositionVersionReadModel {
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

export const toCompositionVersionDto = (
	record: CompositionVersionReadModel,
): CompositionVersionDto => record;

export async function insertCompositionVersionRecord(input: {
	actor: WorkspaceActor;
	projectId: string;
	compositionInput: CompositionInputV1;
	compositionFingerprint: string;
}) {
	const parsed = compositionInputV1Schema.safeParse(input.compositionInput);
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
	const [row] = await db
		.insert(compositionVersion)
		.values({
			id: randomUUID(),
			workspaceId: input.actor.workspaceId,
			projectId: input.projectId,
			schemaVersion: "composition-input.v1",
			compositionInputJson: parsed.data,
			compositionFingerprint: input.compositionFingerprint,
			sourceScriptVersionId: parsed.data.script.provenance.scriptVersionId,
			sourceScriptRevision: parsed.data.script.provenance.revision,
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
	const [row] = await db
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
	return rows.map(mapRow);
}

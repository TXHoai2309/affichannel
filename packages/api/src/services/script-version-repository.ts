import { randomUUID } from "node:crypto";
import type {
	ScriptVersionEditableSnapshot,
	ScriptVersionReadModel,
} from "@affichannel/core";
import {
	db,
	factDependency,
	project,
	scriptGeneration,
	scriptVersion,
} from "@affichannel/db";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { WorkspaceActor } from "./workspace";

type ScriptVersionRow = typeof scriptVersion.$inferSelect;

export type InitializeSourceRecord = {
	id: string;
	workspaceId: string;
	projectId: string;
	status: string;
	outputJson: unknown;
};

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

export function isUniqueViolation(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

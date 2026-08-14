import type {
	ScriptGenerationArtifact,
	ScriptGenerationMode,
	ScriptGenerationReadModel,
	ScriptGenerationSection,
	ScriptGenerationStatus,
} from "@affichannel/core/script-generation/types";
import { db, factDependency, scriptGeneration } from "@affichannel/db";
import { and, desc, eq } from "drizzle-orm";
import type { WorkspaceActor } from "./workspace";

export type ScriptGenerationRow = typeof scriptGeneration.$inferSelect;

function toArtifact(row: ScriptGenerationRow): ScriptGenerationArtifact {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		createdByUserId: row.createdByUserId,
		idempotencyKey: row.idempotencyKey,
		requestHash: row.requestHash,
		parentGenerationId: row.parentGenerationId,
		mode: row.mode as ScriptGenerationMode,
		provider: row.provider,
		model: row.model,
		promptVersion: row.promptVersion,
		outputSchemaVersion: row.outputSchemaVersion,
		inputSnapshot: row.inputSnapshotJson as ScriptGenerationArtifact["inputSnapshot"],
		inputHash: row.inputHash,
		promptHash: row.promptHash,
		status: row.status as ScriptGenerationStatus,
		output: row.outputJson as ScriptGenerationArtifact["output"],
		validSections: row.validSections as ScriptGenerationSection[],
		invalidSections: row.invalidSections as ScriptGenerationSection[],
		providerRequestId: row.providerRequestId,
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		estimatedCostMicros: row.estimatedCostMicros,
		actualCostMicros: row.actualCostMicros,
		currency: row.currency,
		errorCode: row.errorCode,
		finishedAt: row.finishedAt,
		createdAt: row.createdAt,
	};
}

export async function findScriptGenerationByIdempotencyKey(
	actor: WorkspaceActor,
	idempotencyKey: string,
) {
	const [row] = await db
		.select()
		.from(scriptGeneration)
		.where(
			and(
				eq(scriptGeneration.workspaceId, actor.workspaceId),
				eq(scriptGeneration.idempotencyKey, idempotencyKey),
			),
		)
		.limit(1);
	return row ? toArtifact(row) : undefined;
}

export async function findPendingScriptGeneration(
	actor: WorkspaceActor,
	projectId: string,
) {
	const [row] = await db
		.select()
		.from(scriptGeneration)
		.where(
			and(
				eq(scriptGeneration.workspaceId, actor.workspaceId),
				eq(scriptGeneration.projectId, projectId),
				eq(scriptGeneration.status, "pending"),
			),
		)
		.limit(1);
	return row ? toArtifact(row) : undefined;
}

export async function findScriptGenerationInTransaction(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	actor: WorkspaceActor,
	generationId: string,
	options: { lock?: boolean } = {},
) {
	const query = transaction
		.select()
		.from(scriptGeneration)
		.where(
			and(
				eq(scriptGeneration.workspaceId, actor.workspaceId),
				eq(scriptGeneration.id, generationId),
			),
		)
		.limit(1);
	const rows = options.lock
		? await query.for("update", { of: scriptGeneration })
		: await query;
	return rows[0];
}

export async function findScriptGeneration(
	actor: WorkspaceActor,
	generationId: string,
) {
	const [row] = await db
		.select()
		.from(scriptGeneration)
		.where(and(eq(scriptGeneration.workspaceId, actor.workspaceId), eq(scriptGeneration.id, generationId)))
		.limit(1);
	return row ? toArtifact(row) : undefined;
}

export async function listScriptGenerationReadModel(
	actor: WorkspaceActor,
	projectId: string,
): Promise<ScriptGenerationReadModel> {
	const rows = await db
		.select()
		.from(scriptGeneration)
		.where(
			and(
				eq(scriptGeneration.workspaceId, actor.workspaceId),
				eq(scriptGeneration.projectId, projectId),
			),
		)
		.orderBy(desc(scriptGeneration.createdAt), desc(scriptGeneration.id));
	const artifacts = rows.map(toArtifact);
	const latestRequest = artifacts[0] ?? null;
	const latestUsableArtifact =
		artifacts.find(
			(artifact) =>
				(artifact.status === "completed" || artifact.status === "partial") &&
				artifact.output !== null,
		) ?? null;

	if (!latestUsableArtifact) {
		return { latestRequest, latestUsableArtifact: null, dependencyState: null };
	}

	const dependencies = await db
		.select({ invalidatedAt: factDependency.invalidatedAt })
		.from(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				eq(factDependency.dependentType, "script_generation"),
				eq(factDependency.dependentId, latestUsableArtifact.id),
			),
		);
	const invalidatedFactCount = dependencies.filter((item) => item.invalidatedAt !== null).length;
	return {
		latestRequest,
		latestUsableArtifact,
		dependencyState: {
			state: invalidatedFactCount > 0 ? "invalidated" : "current",
			invalidatedFactCount,
		},
	};
}

export function toScriptGenerationArtifact(row: ScriptGenerationRow) {
	return toArtifact(row);
}

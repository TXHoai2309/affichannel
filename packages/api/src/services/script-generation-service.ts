import { randomUUID } from "node:crypto";
import {
	SCRIPT_OUTPUT_SCHEMA_VERSION,
	SCRIPT_PROMPT_VERSION,
	SCRIPT_SNAPSHOT_VERSION,
	ScriptGenerationError,
	evaluateFactGenerationUsability,
	resolveBusinessToday,
	validateScriptDraftOutput,
} from "@affichannel/core";
import { canonicalizeJson } from "@affichannel/core/script-generation/canonical-json";
import type {
	PartialScriptDraft,
	ScriptGenerationArtifact,
	ScriptGenerationInputSnapshot,
	ScriptGenerationMode,
	ScriptGenerationReadModel,
	ScriptGenerationSection,
} from "@affichannel/core/script-generation/types";
import type {
	ProductFactSourceType,
	ProductFactStatus,
	ProductFactType,
} from "@affichannel/core/product-fact/types";
import {
	contentBrief,
	db,
	factDependency,
	product,
	productFact,
	project,
	scriptGeneration,
} from "@affichannel/db";
import { and, eq, isNotNull } from "drizzle-orm";
import type { TextProvider, TextProviderResult } from "../providers/text/text-provider";
import { TextProviderError } from "../providers/text/text-provider";
import {
	detachFactDependenciesInTransaction,
	registerFactDependenciesInTransaction,
} from "./fact-dependency-repository";
import { renderScriptPrompt } from "./script-prompt";
import {
	findScriptGenerationByIdempotencyKey,
	findScriptGenerationInTransaction,
	findScriptGeneration,
	listScriptGenerationReadModel,
	toScriptGenerationArtifact,
} from "./script-generation-repository";
import { sha256Hex } from "./script-generation-hashing";
import type { WorkspaceActor } from "./workspace";

export type PrepareScriptGenerationInput = {
	projectId: string;
	idempotencyKey: string;
	mode: ScriptGenerationMode;
	parentGenerationId?: string;
	repairSections?: ScriptGenerationSection[];
	provider?: string;
	model?: string;
	promptVersion?: string;
	outputSchemaVersion?: string;
};

export type ScriptGenerationProviderConfig = Pick<
	PrepareScriptGenerationInput,
	"provider" | "model" | "promptVersion" | "outputSchemaVersion"
>;

function sortedSections(sections: ScriptGenerationSection[]) {
	return [...new Set(sections)].sort();
}

function buildRequestHash(input: PrepareScriptGenerationInput, config: Required<ScriptGenerationProviderConfig>) {
	return sha256Hex({
		projectId: input.projectId,
		mode: input.mode,
		parentGenerationId: input.parentGenerationId ?? null,
		repairSections: sortedSections(input.repairSections ?? []),
		provider: config.provider,
		model: config.model,
		promptVersion: config.promptVersion,
		outputSchemaVersion: config.outputSchemaVersion,
	});
}

function normalizeDescription(description: string | null) {
	const value = description?.trim() ?? "";
	return value.length > 0 ? value : null;
}

function evaluateDbFact(
	fact: {
		type: string;
		status: string;
		sourceType: string | null;
		sourceLabel: string | null;
		sourceUrl: string | null;
		confirmedAt: string | null;
		expiresAt: string | null;
	},
	today: string,
) {
	return evaluateFactGenerationUsability(
		{
			...fact,
			type: fact.type as ProductFactType,
			status: fact.status as ProductFactStatus,
			sourceType: fact.sourceType as ProductFactSourceType | null,
		},
		today,
	);
}

function assertPreparationInput(input: PrepareScriptGenerationInput) {
	const idempotencyKey = input.idempotencyKey.trim();
	if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
		throw new ScriptGenerationError("IDEMPOTENCY_CONFLICT", "Idempotency key must be between 8 and 200 characters.");
	}
	if (input.mode === "repair" && (!input.parentGenerationId || !input.repairSections?.length)) {
		throw new ScriptGenerationError("GENERATION_INVALID_TRANSITION", "Repair requires a parent generation and at least one section.");
	}
	return idempotencyKey;
}

function createSnapshot(
	projectRecord: {
		id: string;
		name: string;
		platform: string;
		goal: string;
		durationSeconds: number;
		angle: string;
		description: string | null;
		productId: string;
		productName: string;
		productCategory: string | null;
	},
	facts: Array<{
		id: string;
		revision: number;
		content: string;
		type: string;
		status: string;
		sourceType: string | null;
		sourceLabel: string | null;
		sourceUrl: string | null;
		confirmedAt: string | null;
		expiresAt: string | null;
	}> ,
	today: string,
	request: ScriptGenerationInputSnapshot["request"],
): ScriptGenerationInputSnapshot {
	const usableFacts = facts.flatMap((fact) => {
		const evaluated = evaluateDbFact(fact, today);
		if (evaluated.usability === "blocked") return [];
		return [{
			id: fact.id,
			revision: fact.revision,
			content: fact.content,
			type: fact.type as ScriptGenerationInputSnapshot["facts"][number]["type"],
			assessment: evaluated.assessment,
			generationUsability: evaluated.usability,
			source: {
				type: fact.sourceType,
				label: fact.sourceLabel,
				url: fact.sourceUrl,
				confirmedAt: fact.confirmedAt,
				expiresAt: fact.expiresAt,
			},
		}];
	});
	return {
		snapshotVersion: SCRIPT_SNAPSHOT_VERSION,
		request,
		project: {
			id: projectRecord.id,
			name: projectRecord.name,
			platform: projectRecord.platform as "tiktok",
			goal: projectRecord.goal,
			durationSeconds: projectRecord.durationSeconds,
			angle: projectRecord.angle,
			description: normalizeDescription(projectRecord.description),
		},
		product: {
			id: projectRecord.productId,
			name: projectRecord.productName,
			category: projectRecord.productCategory,
		},
		facts: usableFacts,
	};
}

async function prepareInTransaction(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	actor: WorkspaceActor,
	input: PrepareScriptGenerationInput,
	config: Required<ScriptGenerationProviderConfig>,
	requestHash: string,
	idempotencyKey: string,
) {
	const [projectRecord] = await transaction
		.select({
			id: project.id,
			name: project.name,
			productId: product.id,
			productName: product.name,
			productCategory: product.category,
			platform: contentBrief.platform,
			goal: contentBrief.goal,
			durationSeconds: contentBrief.durationSeconds,
			angle: contentBrief.angle,
			description: contentBrief.description,
		})
		.from(project)
		.innerJoin(product, eq(project.productId, product.id))
		.innerJoin(contentBrief, eq(contentBrief.projectId, project.id))
		.where(and(eq(project.id, input.projectId), eq(project.workspaceId, actor.workspaceId), eq(product.workspaceId, actor.workspaceId)))
		.limit(1)
		.for("update", { of: project });
	if (!projectRecord) throw new ScriptGenerationError("GENERATION_NOT_FOUND", "Project was not found in this workspace.");

	const facts = await transaction
		.select({
			id: productFact.id,
			revision: productFact.revision,
			content: productFact.content,
			type: productFact.type,
			status: productFact.status,
			sourceType: productFact.sourceType,
			sourceLabel: productFact.sourceLabel,
			sourceUrl: productFact.sourceUrl,
			confirmedAt: productFact.confirmedAt,
			expiresAt: productFact.expiresAt,
		})
		.from(productFact)
		.where(and(eq(productFact.workspaceId, actor.workspaceId), eq(productFact.productId, projectRecord.productId)))
		.orderBy(productFact.id)
		.for("update", { of: productFact });

	const today = resolveBusinessToday();
	let parentOutput: PartialScriptDraft | null = null;
	if (input.mode === "repair" && input.parentGenerationId) {
		const parent = await findScriptGenerationInTransaction(transaction, actor, input.parentGenerationId);
		if (!parent || parent.projectId !== input.projectId || (parent.status !== "completed" && parent.status !== "partial") || !parent.outputJson) {
			throw new ScriptGenerationError("GENERATION_INVALID_TRANSITION", "Repair parent is not a usable generation.");
		}
		const invalidated = await transaction
			.select({ id: factDependency.id })
			.from(factDependency)
			.where(and(eq(factDependency.workspaceId, actor.workspaceId), eq(factDependency.dependentType, "script_generation"), eq(factDependency.dependentId, input.parentGenerationId), isNotNull(factDependency.invalidatedAt)))
			.limit(1);
		if (invalidated.length > 0) throw new ScriptGenerationError("BASE_GENERATION_INVALIDATED", "Repair parent depends on invalidated Product Facts.");
		parentOutput = parent.outputJson as PartialScriptDraft;
	}

	const snapshot = createSnapshot(projectRecord, facts, today, {
		mode: input.mode,
		repair: input.mode === "repair" ? {
			parentGenerationId: input.parentGenerationId as string,
			sections: sortedSections(input.repairSections ?? []),
			baseOutput: parentOutput as PartialScriptDraft,
		} : null,
	});
	if (new TextEncoder().encode(canonicalizeJson(snapshot)).byteLength > 128 * 1024) {
		throw new ScriptGenerationError("INVALID_GENERATION_OUTPUT", "Generation input snapshot is too large.");
	}
	if (snapshot.facts.length === 0) throw new ScriptGenerationError("NO_USABLE_PRODUCT_FACTS", "No verified, eligible Product Facts are available for generation.");

	const prompt = renderScriptPrompt(snapshot);
	const inputHash = sha256Hex(snapshot);
	const promptHash = sha256Hex(prompt);
	const [created] = await transaction
		.insert(scriptGeneration)
		.values({
			id: randomUUID(),
			workspaceId: actor.workspaceId,
			projectId: input.projectId,
			createdByUserId: actor.userId,
			idempotencyKey,
			requestHash,
			parentGenerationId: input.parentGenerationId ?? null,
			mode: input.mode,
			provider: config.provider,
			model: config.model,
			promptVersion: config.promptVersion,
			outputSchemaVersion: config.outputSchemaVersion,
			inputSnapshotJson: snapshot,
			inputHash,
			promptHash,
			status: "pending",
			validSections: [],
			invalidSections: [],
		})
		.onConflictDoNothing()
		.returning();
	if (!created) return undefined;

	await registerFactDependenciesInTransaction(transaction, actor, {
		dependentType: "script_generation",
		dependentId: created.id,
		facts: facts.flatMap((fact) => {
			const evaluated = evaluateDbFact(fact, today);
			return evaluated.usability === "blocked" ? [] : [{ id: fact.id, revision: fact.revision }];
		}),
	});
	return created;
}

export async function prepareScriptGeneration(
	actor: WorkspaceActor,
	input: PrepareScriptGenerationInput,
) {
	const idempotencyKey = assertPreparationInput(input);
	const config: Required<ScriptGenerationProviderConfig> = {
		provider: input.provider ?? "deterministic",
		model: input.model ?? "foundation-deterministic-v1",
		promptVersion: input.promptVersion ?? SCRIPT_PROMPT_VERSION,
		outputSchemaVersion: input.outputSchemaVersion ?? SCRIPT_OUTPUT_SCHEMA_VERSION,
	};
	const requestHash = buildRequestHash(input, config);
	const existing = await findScriptGenerationByIdempotencyKey(actor, idempotencyKey);
	if (existing) {
		if (existing.requestHash !== requestHash) throw new ScriptGenerationError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different request.");
		return existing;
	}

	const created = await db.transaction((transaction) => prepareInTransaction(transaction, actor, input, config, requestHash, idempotencyKey));
	if (created) return toScriptGenerationArtifact(created);

	const retry = await findScriptGenerationByIdempotencyKey(actor, idempotencyKey);
	if (retry) {
		if (retry.requestHash !== requestHash) throw new ScriptGenerationError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different request.");
		return retry;
	}
	const pending = await import("./script-generation-repository").then(({ findPendingScriptGeneration }) => findPendingScriptGeneration(actor, input.projectId));
	if (pending) throw new ScriptGenerationError("GENERATION_ALREADY_IN_PROGRESS", "A generation is already pending for this project.");
	throw new ScriptGenerationError("GENERATION_INVALID_TRANSITION", "Generation could not be created.");
}

type FinalizeSuccess = { kind: "success"; result: TextProviderResult };
type FinalizeFailure = { kind: "failure"; code: "AI_TIMEOUT" | "AI_PROVIDER_ERROR" | "GENERATION_INDETERMINATE" };

export async function finalizeScriptGeneration(
	actor: WorkspaceActor,
	input: { generationId: string; outcome: FinalizeSuccess | FinalizeFailure },
) {
	return db.transaction(async (transaction) => {
		const row = await findScriptGenerationInTransaction(transaction, actor, input.generationId, { lock: true });
		if (!row) throw new ScriptGenerationError("GENERATION_NOT_FOUND", "Generation was not found in this workspace.");
		if (row.status !== "pending") return toScriptGenerationArtifact(row);
		const finishedAt = new Date();
		let status: "completed" | "partial" | "failed" | "indeterminate" = "failed";
		let outputJson: unknown = null;
		let validSections: ScriptGenerationSection[] = [];
		let invalidSections: ScriptGenerationSection[] = [];
		let errorCode: string | null = null;
		let providerRequestId: string | null = null;
		let inputTokens: number | null = null;
		let outputTokens: number | null = null;
		let estimatedCostMicros: bigint | null = null;
		let actualCostMicros: bigint | null = null;
		let currency: string | null = null;
		if (input.outcome.kind === "failure") {
			if (input.outcome.code === "GENERATION_INDETERMINATE") status = "indeterminate";
			errorCode = input.outcome.code;
			invalidSections = [...("hook voiceover scenes cta caption hashtags disclosure claims".split(" ") as ScriptGenerationSection[])];
		} else {
			const result = input.outcome.result;
			const validation = validateScriptDraftOutput(result.content, (row.inputSnapshotJson as ScriptGenerationInputSnapshot).project.durationSeconds);
			status = validation.status;
			outputJson = validation.output;
			validSections = validation.validSections;
			invalidSections = validation.invalidSections;
			errorCode = validation.errorCode;
			providerRequestId = result.providerRequestId;
			inputTokens = result.inputTokens;
			outputTokens = result.outputTokens;
			estimatedCostMicros = result.estimatedCostMicros;
			actualCostMicros = result.actualCostMicros;
			currency = result.currency;
		}
		await transaction
			.update(scriptGeneration)
			.set({ status, outputJson, validSections, invalidSections, providerRequestId, inputTokens, outputTokens, estimatedCostMicros, actualCostMicros, currency, errorCode, finishedAt })
			.where(and(eq(scriptGeneration.id, row.id), eq(scriptGeneration.workspaceId, actor.workspaceId), eq(scriptGeneration.status, "pending")));
		if (status === "failed") {
			await detachFactDependenciesInTransaction(transaction, actor, { dependentType: "script_generation", dependentId: row.id });
		}
		const finalRow = await findScriptGenerationInTransaction(transaction, actor, row.id);
		if (!finalRow) throw new Error("Could not reload finalized generation.");
		return toScriptGenerationArtifact(finalRow);
	});
}

export async function runPreparedScriptGeneration(
	actor: WorkspaceActor,
	generation: ScriptGenerationArtifact,
	provider: TextProvider,
) {
	try {
		const result = await provider.generate({
			prompt: renderScriptPrompt(generation.inputSnapshot),
			model: generation.model,
			mode: generation.mode,
			sections: generation.inputSnapshot.request.repair?.sections ?? ["hook", "voiceover", "scenes", "cta", "caption", "hashtags", "disclosure", "claims"],
			idempotencyKey: generation.idempotencyKey,
		});
		return finalizeScriptGeneration(actor, { generationId: generation.id, outcome: { kind: "success", result } });
	} catch (error) {
		const code = error instanceof TextProviderError ? error.code : "AI_PROVIDER_ERROR";
		return finalizeScriptGeneration(actor, { generationId: generation.id, outcome: { kind: "failure", code } });
	}
}

export async function markScriptGenerationIndeterminate(actor: WorkspaceActor, generationId: string) {
	return finalizeScriptGeneration(actor, { generationId, outcome: { kind: "failure", code: "GENERATION_INDETERMINATE" } });
}

export async function getScriptGenerationReadModel(actor: WorkspaceActor, projectId: string): Promise<ScriptGenerationReadModel> {
	return listScriptGenerationReadModel(actor, projectId);
}

export { findScriptGeneration };

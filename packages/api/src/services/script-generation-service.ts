import { randomUUID } from "node:crypto";
import {
	SCRIPT_OUTPUT_SCHEMA_VERSION,
	SCRIPT_PROMPT_VERSION,
	SCRIPT_SNAPSHOT_VERSION,
	ScriptGenerationError,
	evaluateFactGenerationUsability,
	resolveBusinessToday,
	scriptGenerationSections,
	validateRepairScriptOutput,
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
import { canonicalPrompt, renderScriptPrompt } from "./script-prompt";
import {
	findScriptGenerationByIdempotencyKey,
	findScriptGenerationInTransaction,
	findScriptGeneration,
	listScriptGenerationReadModel,
	toScriptGenerationArtifact,
} from "./script-generation-repository";
import { sha256Hex } from "./script-generation-hashing";
import type { WorkspaceActor } from "./workspace";

export type ClientGenerationIntent = {
	projectId: string;
	idempotencyKey: string;
	mode: ScriptGenerationMode;
	parentGenerationId?: string;
	repairSections?: ScriptGenerationSection[];
};

export type ServerGenerationConfig = {
	provider: string;
	model: string;
	promptVersion: string;
	outputSchemaVersion: string;
};

export type PrepareScriptGenerationInput = ClientGenerationIntent;
export type ScriptGenerationProviderConfig = ServerGenerationConfig;

function sortedSections(sections: ScriptGenerationSection[]) {
	return [...new Set(sections)].sort((a, b) => scriptGenerationSections.indexOf(a) - scriptGenerationSections.indexOf(b));
}

function normalizeClientGenerationIntent(input: ClientGenerationIntent): ClientGenerationIntent {
	const projectId = input.projectId.trim();
	const idempotencyKey = input.idempotencyKey.trim();
	const parentGenerationId = input.parentGenerationId?.trim() || undefined;
	const repairSections = sortedSections(input.repairSections ?? []);
	return input.mode === "repair"
		? { projectId, idempotencyKey, mode: input.mode, parentGenerationId, repairSections }
		: { projectId, idempotencyKey, mode: input.mode, parentGenerationId: undefined, repairSections: [] };
}

export function hashClientGenerationIntent(input: ClientGenerationIntent) {
	const intent = normalizeClientGenerationIntent(input);
	return sha256Hex({
		projectId: intent.projectId,
		mode: intent.mode,
		parentGenerationId: intent.parentGenerationId ?? null,
		repairSections: intent.repairSections ?? [],
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
	const normalized = normalizeClientGenerationIntent(input);
	const idempotencyKey = normalized.idempotencyKey;
	if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
		throw new ScriptGenerationError("IDEMPOTENCY_CONFLICT", "Idempotency key must be between 8 and 200 characters.");
	}
	if (!normalized.projectId) {
		throw new ScriptGenerationError("GENERATION_NOT_FOUND", "Project was not found in this workspace.");
	}
	if (normalized.mode === "repair") {
		const requested = input.repairSections ?? [];
		if (!normalized.parentGenerationId || requested.length === 0) {
			throw new ScriptGenerationError("INVALID_REPAIR_SECTIONS", "Repair requires a parent generation and at least one section.");
		}
		if (requested.some((section) => !scriptGenerationSections.includes(section)) || new Set(requested).size !== requested.length) {
			throw new ScriptGenerationError("INVALID_REPAIR_SECTIONS", "Repair sections must be known and unique.");
		}
	} else if (input.parentGenerationId || (input.repairSections && input.repairSections.length > 0)) {
		throw new ScriptGenerationError("GENERATION_INVALID_TRANSITION", "Full generation cannot include repair parameters.");
	}
	return { idempotencyKey, intent: normalized };
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
		if (!parent || parent.projectId !== input.projectId || parent.status !== "partial" || !parent.outputJson) {
			throw new ScriptGenerationError("GENERATION_INVALID_TRANSITION", "Repair parent must be a usable partial generation.");
		}
		const requestedSections = input.repairSections ?? [];
		const invalidSections = parent.invalidSections as ScriptGenerationSection[];
		if (requestedSections.length === 0 || new Set(requestedSections).size !== requestedSections.length || requestedSections.some((section) => !invalidSections.includes(section))) {
			throw new ScriptGenerationError("INVALID_REPAIR_SECTIONS", "Repair sections must be a unique subset of the parent invalid sections.");
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
	const promptHash = sha256Hex(canonicalPrompt(prompt));
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
	serverConfig: Partial<ServerGenerationConfig> = {},
) {
	const { idempotencyKey, intent } = assertPreparationInput(input);
	const config: ScriptGenerationProviderConfig = {
		provider: serverConfig.provider ?? "deterministic",
		model: serverConfig.model ?? "foundation-deterministic-v1",
		promptVersion: serverConfig.promptVersion ?? SCRIPT_PROMPT_VERSION,
		outputSchemaVersion: serverConfig.outputSchemaVersion ?? SCRIPT_OUTPUT_SCHEMA_VERSION,
	};
	const requestHash = hashClientGenerationIntent(intent);
	const existing = await findScriptGenerationByIdempotencyKey(actor, idempotencyKey);
	if (existing) {
		if (existing.requestHash !== requestHash) throw new ScriptGenerationError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different request.");
		return existing;
	}

	const created = await db.transaction((transaction) => prepareInTransaction(transaction, actor, intent, config, requestHash, idempotencyKey));
	if (created) return toScriptGenerationArtifact(created);

	const retry = await findScriptGenerationByIdempotencyKey(actor, idempotencyKey);
	if (retry) {
		if (retry.requestHash !== requestHash) throw new ScriptGenerationError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different request.");
		return retry;
	}
	const pending = await import("./script-generation-repository").then(({ findPendingScriptGeneration }) => findPendingScriptGeneration(actor, intent.projectId));
	if (pending) throw new ScriptGenerationError("GENERATION_ALREADY_IN_PROGRESS", "A generation is already pending for this project.");
	throw new ScriptGenerationError("GENERATION_INVALID_TRANSITION", "Generation could not be created.");
}

type FinalizeSuccess = { kind: "success"; result: TextProviderResult };
type FinalizeFailure = { kind: "failure"; code: "AI_TIMEOUT" | "AI_TIMEOUT_UNCERTAIN" | "AI_PROVIDER_ERROR" | "GENERATION_INDETERMINATE" };

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
			if (input.outcome.code === "GENERATION_INDETERMINATE" || input.outcome.code === "AI_TIMEOUT_UNCERTAIN") status = "indeterminate";
			errorCode = input.outcome.code;
			invalidSections = [...scriptGenerationSections];
		} else {
			const result = input.outcome.result;
			const snapshot = row.inputSnapshotJson as ScriptGenerationInputSnapshot;
			let validation = validateScriptDraftOutput(result.content, snapshot.project.durationSeconds);
			if (row.mode === "repair" && snapshot.request.repair) {
				const repairValidation = validateRepairScriptOutput(result.content, snapshot.request.repair.sections);
				if (repairValidation.success && repairValidation.output) {
					const merged = { ...snapshot.request.repair.baseOutput, ...repairValidation.output };
					const mergedValidation = validateScriptDraftOutput(merged, snapshot.project.durationSeconds);
					const preservesParentSections = snapshot.request.repair.baseOutput && snapshot.request.repair.sections.every((section) => mergedValidation.validSections.includes(section)) && (row.validSections as ScriptGenerationSection[]).every((section) => mergedValidation.validSections.includes(section));
					validation = preservesParentSections && mergedValidation.status !== "failed" && snapshot.request.repair.sections.every((section) => mergedValidation.validSections.includes(section))
						? mergedValidation
						: { status: "failed", output: null, validSections: [], invalidSections: [...scriptGenerationSections], errorCode: "INVALID_GENERATION_OUTPUT" };
				} else {
					validation = { status: "failed", output: null, validSections: [], invalidSections: [...scriptGenerationSections], errorCode: "INVALID_GENERATION_OUTPUT" };
				}
			}
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
	finalize: typeof finalizeScriptGeneration = finalizeScriptGeneration,
) {
	let result: TextProviderResult;
	try {
		const prompt = renderScriptPrompt(generation.inputSnapshot);
		result = await provider.generate({
			messages: [
				{ role: "system", content: prompt.system },
				{ role: "developer", content: prompt.developer },
				{ role: "user", content: prompt.user },
			],
			model: generation.model,
			mode: generation.mode,
			sections: generation.inputSnapshot.request.repair?.sections ?? [...scriptGenerationSections],
			idempotencyKey: generation.idempotencyKey,
		});
	} catch (error) {
		const code: FinalizeFailure["code"] = error instanceof TextProviderError ? error.code : "AI_PROVIDER_ERROR";
		return finalize(actor, { generationId: generation.id, outcome: { kind: "failure", code } });
	}
	return finalize(actor, { generationId: generation.id, outcome: { kind: "success", result } });
}

export async function markScriptGenerationIndeterminate(
	actor: WorkspaceActor,
	generationId: string,
	policy: { expectedCreatedAt: Date; staleBefore: Date },
) {
	return db.transaction(async (transaction) => {
		const row = await findScriptGenerationInTransaction(transaction, actor, generationId, { lock: true });
		if (!row) throw new ScriptGenerationError("GENERATION_NOT_FOUND", "Generation was not found in this workspace.");
		if (row.status !== "pending") return toScriptGenerationArtifact(row);
		if (row.createdAt.getTime() !== policy.expectedCreatedAt.getTime() || row.createdAt > policy.staleBefore) {
			throw new ScriptGenerationError("GENERATION_NOT_STALE", "Pending generation is not stale under the supplied server policy.");
		}
		await transaction
			.update(scriptGeneration)
			.set({ status: "indeterminate", outputJson: null, validSections: [], invalidSections: [...scriptGenerationSections], errorCode: "GENERATION_INDETERMINATE", finishedAt: new Date() })
			.where(and(eq(scriptGeneration.id, row.id), eq(scriptGeneration.workspaceId, actor.workspaceId), eq(scriptGeneration.status, "pending")));
		const finalRow = await findScriptGenerationInTransaction(transaction, actor, row.id);
		if (!finalRow) throw new Error("Could not reload indeterminate generation.");
		return toScriptGenerationArtifact(finalRow);
	});
}

export async function getScriptGenerationReadModel(actor: WorkspaceActor, projectId: string): Promise<ScriptGenerationReadModel> {
	return listScriptGenerationReadModel(actor, projectId);
}

export { findScriptGeneration };

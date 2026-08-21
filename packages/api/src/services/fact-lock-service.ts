import { randomUUID } from "node:crypto";
import {
	channelSettingsSchema,
	defaultOutputRules,
	deriveFactLockEffectiveStatus,
	deriveFactLockRunStatus,
	evaluateFactGenerationUsability,
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	FACT_LOCK_PROMPT_VERSION,
	FACT_LOCK_SNAPSHOT_VERSION,
	FactLockError,
	type FactLockSourceMutation,
	mutateFactLockClaimSource,
	outputRulesSchema,
	resolveBusinessToday,
	validateFactLockProviderOutput,
	validateScriptVersionForFactLockRun,
} from "@affichannel/core";
import type {
	FactLockEffectiveStatus,
	FactLockInputSnapshot,
	FactLockReadModel,
	FactLockRunStatus,
	FactLockStoredClaim,
} from "@affichannel/core/fact-lock/types";
import type {
	ProductFactSourceType,
	ProductFactStatus,
	ProductFactType,
} from "@affichannel/core/product-fact/types";
import type { ScriptVersionEditableSnapshot } from "@affichannel/core/script-version/types";
import {
	channelSettings,
	db,
	factDependency,
	factLockClaim,
	factLockClaimFact,
	factLockRun,
	outputRules,
	product,
	productFact,
	project,
	scriptVersion,
} from "@affichannel/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
	TextProvider,
	TextProviderEstimate,
	TextProviderResult,
} from "../providers/text/text-provider";
import { TextProviderError } from "../providers/text/text-provider";
import {
	detachFactDependenciesInTransaction,
	registerFactDependenciesInTransaction,
} from "./fact-dependency-repository";
import { renderFactLockPrompt } from "./fact-lock-prompt";
import { sha256Hex } from "./script-generation-hashing";
import { resolveServerGenerationConfig } from "./script-generation-service";
import type { WorkspaceActor } from "./workspace";

export type FactLockProviderConfig = {
	provider: string;
	model: string;
	promptVersion: typeof FACT_LOCK_PROMPT_VERSION;
	outputSchemaVersion: typeof FACT_LOCK_OUTPUT_SCHEMA_VERSION;
};

export type FactLockIntent = { projectId: string; idempotencyKey: string };

export type FactLockRunArtifact = {
	id: string;
	workspaceId: string;
	projectId: string;
	scriptVersionId: string;
	sourceScriptRevision: number;
	idempotencyKey: string;
	requestHash: string;
	inputHash: string;
	promptHash: string;
	provider: string;
	model: string;
	promptVersion: string;
	outputSchemaVersion: string;
	status: FactLockRunStatus;
	inputSnapshot: FactLockInputSnapshot;
	providerRequestId: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	estimatedCostMicros: bigint | null;
	actualCostMicros: bigint | null;
	currency: string | null;
	errorCode: string | null;
	executionClaimedAt: Date | null;
	createdAt: Date;
	finishedAt: Date | null;
};

export type PreparedFactLockRun = FactLockRunArtifact;

function toArtifact(row: typeof factLockRun.$inferSelect): FactLockRunArtifact {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		projectId: row.projectId,
		scriptVersionId: row.scriptVersionId,
		sourceScriptRevision: row.sourceScriptRevision,
		idempotencyKey: row.idempotencyKey,
		requestHash: row.requestHash,
		inputHash: row.inputHash,
		promptHash: row.promptHash,
		provider: row.provider,
		model: row.model,
		promptVersion: row.promptVersion,
		outputSchemaVersion: row.outputSchemaVersion,
		status: row.status as FactLockRunStatus,
		inputSnapshot: row.inputSnapshotJson as FactLockInputSnapshot,
		providerRequestId: row.providerRequestId,
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		estimatedCostMicros: row.estimatedCostMicros,
		actualCostMicros: row.actualCostMicros,
		currency: row.currency,
		errorCode: row.errorCode,
		executionClaimedAt: row.executionClaimedAt,
		createdAt: row.createdAt,
		finishedAt: row.finishedAt,
	};
}

function normalizeIntent(input: FactLockIntent) {
	const projectId = input.projectId.trim();
	const idempotencyKey = input.idempotencyKey.trim();
	if (!projectId)
		throw new FactLockError("FACT_LOCK_NOT_FOUND", "Project không hợp lệ.");
	if (idempotencyKey.length < 8 || idempotencyKey.length > 200)
		throw new FactLockError(
			"FACT_LOCK_IDEMPOTENCY_CONFLICT",
			"Idempotency key không hợp lệ.",
		);
	return { projectId, idempotencyKey };
}

function dbFactEvaluation(
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

async function buildSnapshotInTransaction(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	actor: WorkspaceActor,
	input: { projectId: string },
) {
	const [projectRecord] = await transaction
		.select({ id: project.id, productId: product.id })
		.from(project)
		.innerJoin(product, eq(product.id, project.productId))
		.where(
			and(
				eq(project.id, input.projectId),
				eq(project.workspaceId, actor.workspaceId),
				eq(product.workspaceId, actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: project });
	if (!projectRecord)
		throw new FactLockError(
			"FACT_LOCK_NOT_FOUND",
			"Project không tồn tại trong workspace.",
		);

	const [scriptRecord] = await transaction
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.projectId, input.projectId),
				eq(scriptVersion.status, "draft"),
			),
		)
		.limit(1)
		.for("update", { of: scriptVersion });
	if (!scriptRecord)
		throw new FactLockError(
			"FACT_LOCK_SCRIPT_NOT_READY",
			"Project chưa có ScriptVersion draft.",
		);
	const parsedScript = validateScriptVersionForFactLockRun(
		scriptRecord.editableSnapshotJson as ScriptVersionEditableSnapshot,
	);
	if (!parsedScript.success)
		throw new FactLockError(
			"FACT_LOCK_SCRIPT_NOT_READY",
			"Script chưa sẵn sàng cho Fact Lock.",
		);

	const facts = await transaction
		.select()
		.from(productFact)
		.where(
			and(
				eq(productFact.workspaceId, actor.workspaceId),
				eq(productFact.productId, projectRecord.productId),
			),
		)
		.orderBy(productFact.id)
		.for("update", { of: productFact });
	const today = resolveBusinessToday();
	const productFacts = facts.flatMap((fact) => {
		const evaluated = dbFactEvaluation(fact, today);
		if (evaluated.usability === "blocked") return [];
		return [
			{
				id: fact.id,
				revision: fact.revision,
				content: fact.content,
				type: fact.type as ProductFactType,
				status: "verified" as const,
				assessment: evaluated.assessment,
				generationUsability: evaluated.usability,
				source: {
					type: fact.sourceType,
					label: fact.sourceLabel,
					url: fact.sourceUrl,
					confirmedAt: fact.confirmedAt,
					expiresAt: fact.expiresAt,
				},
			},
		];
	});
	if (productFacts.length === 0)
		throw new FactLockError(
			"FACT_LOCK_NO_USABLE_FACTS",
			"Không có Product Fact đủ điều kiện cho Fact Lock.",
		);

	const [settings] = await transaction
		.select()
		.from(channelSettings)
		.where(eq(channelSettings.workspaceId, actor.workspaceId))
		.limit(1);
	const parsedSettings = channelSettingsSchema.safeParse(
		settings
			? {
					niche: settings.niche,
					targetAudience: settings.targetAudience,
					tone: settings.tone,
					contentPillar: settings.contentPillar,
					defaultCta: settings.defaultCta,
					affiliateDisclosure: settings.affiliateDisclosure,
					avoidWords: settings.avoidWords,
				}
			: undefined,
	);
	if (!parsedSettings.success)
		throw new FactLockError(
			"FACT_LOCK_SCRIPT_NOT_READY",
			"Channel Settings chưa hoàn chỉnh.",
		);

	const [rules] = await transaction
		.select()
		.from(outputRules)
		.where(eq(outputRules.workspaceId, actor.workspaceId))
		.limit(1);
	const parsedRules = outputRulesSchema.safeParse(
		rules
			? {
					language: rules.language,
					aspectRatio: rules.aspectRatio,
					subtitleSafeArea: rules.subtitleSafeArea,
					claimLimit: rules.claimLimit,
					requireFinalCta: rules.requireFinalCta,
				}
			: defaultOutputRules,
	);
	if (!parsedRules.success)
		throw new FactLockError(
			"FACT_LOCK_SCRIPT_NOT_READY",
			"Output Rules không hợp lệ.",
		);

	const snapshot: FactLockInputSnapshot = {
		snapshotVersion: FACT_LOCK_SNAPSHOT_VERSION,
		scriptVersion: {
			id: scriptRecord.id,
			revision: scriptRecord.revision,
			snapshot: parsedScript.data,
		},
		productFacts,
		policy: {
			avoidWords: parsedSettings.data.avoidWords,
			affiliateDisclosure: parsedSettings.data.affiliateDisclosure,
			language: parsedRules.data.language,
		},
		outputRules: parsedRules.data,
	};
	const prompt = renderFactLockPrompt(snapshot);
	return {
		snapshot,
		scriptRecord,
		productFacts,
		inputHash: sha256Hex(snapshot),
		promptHash: sha256Hex(prompt),
	};
}

function requestHash(input: {
	projectId: string;
	scriptVersionId: string;
	sourceScriptRevision: number;
}) {
	return sha256Hex({
		operation: "fact-lock",
		projectId: input.projectId,
		scriptVersionId: input.scriptVersionId,
		sourceScriptRevision: input.sourceScriptRevision,
	});
}

export async function resolveServerFactLockConfig(
	actor: WorkspaceActor,
): Promise<FactLockProviderConfig> {
	const config = await resolveServerGenerationConfig(actor);
	return {
		provider: config.provider,
		model: config.model,
		promptVersion: FACT_LOCK_PROMPT_VERSION,
		outputSchemaVersion: FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	};
}

export async function prepareFactLockRun(
	actor: WorkspaceActor,
	rawInput: FactLockIntent,
	config: FactLockProviderConfig,
) {
	const input = normalizeIntent(rawInput);
	return db.transaction(async (transaction) => {
		const built = await buildSnapshotInTransaction(transaction, actor, input);
		const hash = requestHash({
			projectId: input.projectId,
			scriptVersionId: built.scriptRecord.id,
			sourceScriptRevision: built.scriptRecord.revision,
		});
		const [existing] = await transaction
			.select()
			.from(factLockRun)
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.idempotencyKey, input.idempotencyKey),
				),
			)
			.limit(1);
		if (existing) {
			if (existing.requestHash !== hash)
				throw new FactLockError(
					"FACT_LOCK_IDEMPOTENCY_CONFLICT",
					"Idempotency key đã được dùng cho intent khác.",
				);
			return toArtifact(existing);
		}
		const [created] = await transaction
			.insert(factLockRun)
			.values({
				id: randomUUID(),
				workspaceId: actor.workspaceId,
				projectId: input.projectId,
				scriptVersionId: built.scriptRecord.id,
				sourceScriptRevision: built.scriptRecord.revision,
				idempotencyKey: input.idempotencyKey,
				requestHash: hash,
				inputSnapshotJson: built.snapshot,
				inputHash: built.inputHash,
				promptHash: built.promptHash,
				provider: config.provider,
				model: config.model,
				promptVersion: config.promptVersion,
				outputSchemaVersion: config.outputSchemaVersion,
				status: "pending",
				createdByUserId: actor.userId,
			})
			.onConflictDoNothing()
			.returning();
		if (!created) {
			const [retry] = await transaction
				.select()
				.from(factLockRun)
				.where(
					and(
						eq(factLockRun.workspaceId, actor.workspaceId),
						eq(factLockRun.idempotencyKey, input.idempotencyKey),
					),
				)
				.limit(1);
			if (retry) {
				if (retry.requestHash !== hash)
					throw new FactLockError(
						"FACT_LOCK_IDEMPOTENCY_CONFLICT",
						"Idempotency key đã được dùng cho intent khác.",
					);
				return toArtifact(retry);
			}
			const [pending] = await transaction
				.select({ id: factLockRun.id })
				.from(factLockRun)
				.where(
					and(
						eq(factLockRun.workspaceId, actor.workspaceId),
						eq(factLockRun.projectId, input.projectId),
						eq(factLockRun.scriptVersionId, built.scriptRecord.id),
						eq(factLockRun.sourceScriptRevision, built.scriptRecord.revision),
						eq(factLockRun.status, "pending"),
					),
				)
				.limit(1);
			if (pending)
				throw new FactLockError(
					"FACT_LOCK_ALREADY_PENDING",
					"Fact Lock đang được xử lý cho ScriptVersion này.",
				);
			throw new FactLockError(
				"FACT_LOCK_ALREADY_PENDING",
				"Fact Lock chưa thể tạo request.",
			);
		}
		await registerFactDependenciesInTransaction(transaction, actor, {
			dependentType: "fact_lock",
			dependentId: created.id,
			facts: built.productFacts.map((fact) => ({
				id: fact.id,
				revision: fact.revision,
			})),
		});
		return toArtifact(created);
	});
}

function providerRequest(run: FactLockRunArtifact) {
	const prompt = renderFactLockPrompt(run.inputSnapshot);
	return {
		messages: [
			{ role: "system" as const, content: prompt.trustedInstructions },
			{ role: "developer" as const, content: prompt.outputSchema },
			{ role: "user" as const, content: prompt.untrustedInputData },
		],
		model: run.model,
		mode: "full" as const,
		sections: ["claims"],
		idempotencyKey: run.idempotencyKey,
		operation: "fact-lock" as const,
	};
}

export async function estimateFactLockRun(
	run: FactLockRunArtifact,
	provider: TextProvider,
) {
	const estimate = await provider.estimateCost({
		...providerRequest(run),
		operation: "fact-lock",
	});
	if (estimate.estimatedCostMicros === null || !estimate.currency)
		throw new FactLockError(
			"FACT_LOCK_COST_ESTIMATE_UNAVAILABLE",
			"Provider không trả về cost estimate.",
		);
	return estimate;
}

export async function recordFactLockEstimate(
	actor: WorkspaceActor,
	runId: string,
	estimate: TextProviderEstimate,
) {
	const [row] = await db
		.update(factLockRun)
		.set({
			estimatedCostMicros: estimate.estimatedCostMicros,
			currency: estimate.currency,
			inputTokens: estimate.inputTokens,
		})
		.where(
			and(
				eq(factLockRun.workspaceId, actor.workspaceId),
				eq(factLockRun.id, runId),
				eq(factLockRun.status, "pending"),
			),
		)
		.returning();
	if (!row)
		throw new FactLockError(
			"FACT_LOCK_NOT_FOUND",
			"Fact Lock run không tồn tại.",
		);
	return toArtifact(row);
}

export type FactLockFinalizeOutcome =
	| { kind: "success"; result: TextProviderResult }
	| { kind: "failure"; code: string };

const truncatedFactLockFinishReasons = new Set([
	"max_tokens",
	"max_output_tokens",
	"length",
]);

export function isTruncatedFactLockFinishReason(
	finishReason: string | null | undefined,
) {
	return Boolean(
		finishReason &&
			truncatedFactLockFinishReasons.has(finishReason.trim().toLowerCase()),
	);
}

export function persistedFactLockValidationErrorCode(validation: {
	code: "INVALID_FACT_LOCK_OUTPUT";
	issueCodes: string[];
}) {
	const diagnostic = validation.issueCodes.join(",");
	return diagnostic
		? `INVALID_FACT_LOCK_OUTPUT:${diagnostic}`
		: validation.code;
}

async function dependenciesAreCurrent(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	actor: WorkspaceActor,
	run: typeof factLockRun.$inferSelect,
) {
	const dependencies = await transaction
		.select()
		.from(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				eq(factDependency.dependentType, "fact_lock"),
				eq(factDependency.dependentId, run.id),
			),
		);
	if (
		dependencies.some(
			(dependency) =>
				dependency.detachedAt !== null || dependency.invalidatedAt !== null,
		)
	)
		return false;
	const snapshot = run.inputSnapshotJson as FactLockInputSnapshot;
	if (dependencies.length !== snapshot.productFacts.length) return false;
	const currentFacts =
		snapshot.productFacts.length === 0
			? []
			: await transaction
					.select({ id: productFact.id, revision: productFact.revision })
					.from(productFact)
					.where(
						and(
							eq(productFact.workspaceId, actor.workspaceId),
							inArray(
								productFact.id,
								snapshot.productFacts.map((fact) => fact.id),
							),
						),
					);
	return snapshot.productFacts.every((fact) =>
		currentFacts.some(
			(current) => current.id === fact.id && current.revision === fact.revision,
		),
	);
}

async function loadClaims(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	actor: WorkspaceActor,
	runId: string,
): Promise<FactLockStoredClaim[]> {
	const claims = await transaction
		.select()
		.from(factLockClaim)
		.where(
			and(
				eq(factLockClaim.workspaceId, actor.workspaceId),
				eq(factLockClaim.runId, runId),
			),
		)
		.orderBy(factLockClaim.claimKey);
	if (claims.length === 0) return [];
	const mappings = await transaction
		.select()
		.from(factLockClaimFact)
		.where(
			inArray(
				factLockClaimFact.claimId,
				claims.map((claim) => claim.id),
			),
		);
	const byClaim = new Map<
		string,
		Array<{
			factId: string;
			factRevision: number;
			relation: "supports" | "related" | "contradicts";
		}>
	>();
	for (const mapping of mappings) {
		const list = byClaim.get(mapping.claimId) ?? [];
		list.push({
			factId: mapping.factId,
			factRevision: mapping.factRevision,
			relation: mapping.relation as "supports" | "related" | "contradicts",
		});
		byClaim.set(mapping.claimId, list);
	}
	return claims.map((claim) => ({
		id: claim.id,
		claimKey: claim.claimKey,
		claimText: claim.claimText,
		occurrence: claim.occurrenceJson as FactLockStoredClaim["occurrence"],
		classificationStatus:
			claim.classificationStatus as FactLockStoredClaim["classificationStatus"],
		reason: claim.reason,
		confidence: claim.confidence,
		suggestionText: claim.suggestionText,
		factMappings: byClaim.get(claim.id) ?? [],
		reviewStatus: claim.reviewStatus as FactLockStoredClaim["reviewStatus"],
		checkedAt: claim.checkedAt,
		reviewedByUserId: claim.reviewedByUserId,
		reviewedAt: claim.reviewedAt,
		reviewNote: claim.reviewNote,
	}));
}

const FACT_LOCK_EXECUTION_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

type FactLockExecutionClaim =
	| { owner: true; run: FactLockRunArtifact }
	| {
			owner: false;
			run: FactLockRunArtifact;
			claims: FactLockStoredClaim[];
			stale: boolean;
	  };

async function claimFactLockExecution(
	actor: WorkspaceActor,
	runId: string,
): Promise<FactLockExecutionClaim> {
	return db.transaction(async (transaction) => {
		const now = new Date();
		const [claimed] = await transaction
			.update(factLockRun)
			.set({ executionClaimedAt: now })
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.id, runId),
					eq(factLockRun.status, "pending"),
					isNull(factLockRun.executionClaimedAt),
				),
			)
			.returning();
		if (claimed) return { owner: true as const, run: toArtifact(claimed) };

		const [current] = await transaction
			.select()
			.from(factLockRun)
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.id, runId),
				),
			)
			.limit(1);
		if (!current)
			throw new FactLockError(
				"FACT_LOCK_NOT_FOUND",
				"Fact Lock run không tồn tại.",
			);
		const stale =
			current.status === "pending" &&
			current.executionClaimedAt !== null &&
			now.getTime() - current.executionClaimedAt.getTime() >
				FACT_LOCK_EXECUTION_CLAIM_TIMEOUT_MS;
		return {
			owner: false as const,
			run: toArtifact(current),
			claims: await loadClaims(transaction, actor, current.id),
			stale,
		};
	});
}

export async function finalizeFactLockRun(
	actor: WorkspaceActor,
	input: { runId: string; outcome: FactLockFinalizeOutcome },
) {
	return db.transaction(async (transaction) => {
		const [run] = await transaction
			.select()
			.from(factLockRun)
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.id, input.runId),
				),
			)
			.limit(1)
			.for("update", { of: factLockRun });
		if (!run)
			throw new FactLockError(
				"FACT_LOCK_NOT_FOUND",
				"Fact Lock run không tồn tại.",
			);
		if (run.status !== "pending")
			return {
				...toArtifact(run),
				claims: await loadClaims(transaction, actor, run.id),
			};
		const finishedAt = new Date();
		let status: FactLockRunStatus = "failed";
		let errorCode: string | null = null;
		let claims: FactLockStoredClaim[] = [];
		let providerRequestId: string | null = null;
		let inputTokens: number | null = null;
		let outputTokens: number | null = null;
		let actualCostMicros: bigint | null = null;
		let currency: string | null = null;
		let acceptedOutput = false;
		if (input.outcome.kind === "failure") {
			errorCode = input.outcome.code;
			status =
				input.outcome.code.includes("UNCERTAIN") ||
				input.outcome.code === "AI_TIMEOUT_UNCERTAIN"
					? "indeterminate"
					: "failed";
		} else {
			if (isTruncatedFactLockFinishReason(input.outcome.result.finishReason))
				errorCode = "AI_OUTPUT_TRUNCATED";
			else {
				const validation = validateFactLockProviderOutput(
					input.outcome.result.content,
					run.inputSnapshotJson as FactLockInputSnapshot,
				);
				if (!validation.success)
					errorCode = persistedFactLockValidationErrorCode(validation);
				else {
					acceptedOutput = true;
					claims = validation.claims;
					status = deriveFactLockRunStatus(claims);
				}
			}
			providerRequestId = input.outcome.result.providerRequestId;
			inputTokens = input.outcome.result.inputTokens;
			outputTokens = input.outcome.result.outputTokens;
			actualCostMicros = input.outcome.result.actualCostMicros;
			currency = input.outcome.result.currency;
		}
		await transaction
			.update(factLockRun)
			.set({
				status,
				providerRequestId,
				inputTokens,
				outputTokens,
				actualCostMicros,
				currency,
				errorCode,
				finishedAt,
			})
			.where(
				and(
					eq(factLockRun.id, run.id),
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.status, "pending"),
				),
			);
		if (claims.length > 0) {
			for (const claim of claims) {
				const [stored] = await transaction
					.insert(factLockClaim)
					.values({
						id: randomUUID(),
						workspaceId: actor.workspaceId,
						runId: run.id,
						claimKey: claim.claimKey,
						claimText: claim.claimText,
						occurrenceJson: claim.occurrence,
						classificationStatus: claim.classificationStatus,
						reviewStatus: claim.reviewStatus,
						reason: claim.reason,
						confidence: claim.confidence,
						suggestionText: claim.suggestionText,
						checkedAt: claim.checkedAt,
						reviewedByUserId: null,
						reviewedAt: null,
						reviewNote: null,
					})
					.returning({ id: factLockClaim.id });
				if (!stored) throw new Error("Fact Lock claim insert returned no row.");
				if (claim.factMappings.length > 0)
					await transaction.insert(factLockClaimFact).values(
						claim.factMappings.map((mapping) => ({
							claimId: stored.id,
							factId: mapping.factId,
							factRevision: mapping.factRevision,
							relation: mapping.relation,
						})),
					);
			}
		}
		if (status === "failed")
			await detachFactDependenciesInTransaction(transaction, actor, {
				dependentType: "fact_lock",
				dependentId: run.id,
			});
		if (
			acceptedOutput &&
			(status === "passed" || status === "review_required")
		) {
			const [currentScript] = await transaction
				.select()
				.from(scriptVersion)
				.where(
					and(
						eq(scriptVersion.workspaceId, actor.workspaceId),
						eq(scriptVersion.id, run.scriptVersionId),
						eq(scriptVersion.status, "draft"),
					),
				)
				.limit(1)
				.for("update", { of: scriptVersion });
			const currentDependencies = await dependenciesAreCurrent(
				transaction,
				actor,
				run,
			);
			if (
				currentScript &&
				currentScript.revision === run.sourceScriptRevision &&
				currentDependencies
			) {
				const currentSnapshot =
					currentScript.editableSnapshotJson as ScriptVersionEditableSnapshot;
				await transaction
					.update(scriptVersion)
					.set({
						editableSnapshotJson: {
							...currentSnapshot,
							claims: claims.map((claim) => ({
								text: claim.claimText,
								occurrence: claim.occurrence,
							})),
							claimsStatus: "current",
							claimsSourceRevision: run.sourceScriptRevision,
						},
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(scriptVersion.id, currentScript.id),
							eq(scriptVersion.workspaceId, actor.workspaceId),
							eq(scriptVersion.status, "draft"),
							eq(scriptVersion.revision, run.sourceScriptRevision),
						),
					);
			}
		}
		const [final] = await transaction
			.select()
			.from(factLockRun)
			.where(
				and(
					eq(factLockRun.workspaceId, actor.workspaceId),
					eq(factLockRun.id, run.id),
				),
			)
			.limit(1);
		if (!final) throw new Error("Could not reload Fact Lock run.");
		return {
			...toArtifact(final),
			claims: await loadClaims(transaction, actor, final.id),
		};
	});
}

async function runClaimedFactLock(
	actor: WorkspaceActor,
	run: FactLockRunArtifact,
	provider: TextProvider,
	finalize: typeof finalizeFactLockRun = finalizeFactLockRun,
) {
	let result: TextProviderResult;
	try {
		result = await provider.generate(providerRequest(run));
	} catch (error) {
		const code =
			error instanceof TextProviderError ? error.code : "AI_PROVIDER_ERROR";
		return finalize(actor, {
			runId: run.id,
			outcome: { kind: "failure", code },
		});
	}
	return finalize(actor, {
		runId: run.id,
		outcome: { kind: "success", result },
	});
}

export async function runPreparedFactLock(
	actor: WorkspaceActor,
	run: FactLockRunArtifact,
	provider: TextProvider,
	finalize: typeof finalizeFactLockRun = finalizeFactLockRun,
) {
	const claim = await claimFactLockExecution(actor, run.id);
	if (!claim.owner) {
		if (claim.stale) {
			return finalize(actor, {
				runId: run.id,
				outcome: {
					kind: "failure",
					code: "FACT_LOCK_EXECUTION_CLAIM_STALE_UNCERTAIN",
				},
			});
		}
		return { ...claim.run, claims: claim.claims };
	}
	return runClaimedFactLock(actor, claim.run, provider, finalize);
}

async function dependencyStateForRun(
	actor: WorkspaceActor,
	run: typeof factLockRun.$inferSelect,
) {
	return db.transaction((transaction) =>
		dependenciesAreCurrent(transaction, actor, run),
	);
}

export async function getFactLockState(
	actor: WorkspaceActor,
	projectId: string,
): Promise<FactLockReadModel> {
	const [currentScript] = await db
		.select({
			id: scriptVersion.id,
			revision: scriptVersion.revision,
			editableSnapshotJson: scriptVersion.editableSnapshotJson,
		})
		.from(scriptVersion)
		.innerJoin(project, eq(project.id, scriptVersion.projectId))
		.where(
			and(
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.projectId, projectId),
				eq(project.workspaceId, actor.workspaceId),
				eq(scriptVersion.status, "draft"),
			),
		)
		.limit(1);
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
	if (!currentScript && runs.length === 0)
		throw new FactLockError(
			"FACT_LOCK_NOT_FOUND",
			"Project không tồn tại trong workspace.",
		);
	const claimsByRun = new Map<string, FactLockStoredClaim[]>();
	for (const run of runs) {
		const claims = await db.transaction((transaction) =>
			loadClaims(transaction, actor, run.id),
		);
		claimsByRun.set(run.id, claims);
	}
	const decorated = [] as Array<{
		run: typeof factLockRun.$inferSelect;
		effectiveStatus: FactLockEffectiveStatus;
		claims: FactLockStoredClaim[];
	}>;
	for (const run of runs) {
		const current = currentScript?.revision ?? null;
		const effectiveStatus = deriveFactLockEffectiveStatus(
			run.status as FactLockRunStatus,
			run.sourceScriptRevision,
			current,
			await dependencyStateForRun(actor, run),
		);
		decorated.push({
			run,
			effectiveStatus,
			claims: claimsByRun.get(run.id) ?? [],
		});
	}
	const mapRun = (item: (typeof decorated)[number] | undefined) =>
		item
			? {
					id: item.run.id,
					status: item.run.status as FactLockRunStatus,
					effectiveStatus: item.effectiveStatus,
					sourceScriptRevision: item.run.sourceScriptRevision,
					createdAt: item.run.createdAt,
					finishedAt: item.run.finishedAt,
					errorCode: item.run.errorCode,
					facts: (item.run.inputSnapshotJson as FactLockInputSnapshot)
						.productFacts,
					claims: item.claims,
				}
			: null;
	const latestRequest = mapRun(decorated[0]);
	const latestApplicableRun = mapRun(
		decorated.find(
			(item) =>
				item.effectiveStatus === "passed" ||
				item.effectiveStatus === "review_required",
		),
	);
	return {
		currentScriptVersion: currentScript
			? {
					id: currentScript.id,
					revision: currentScript.revision,
					claimsSourceRevision: (
						currentScript.editableSnapshotJson as ScriptVersionEditableSnapshot
					).claimsSourceRevision,
					claimsStatus: (
						currentScript.editableSnapshotJson as ScriptVersionEditableSnapshot
					).claimsStatus,
				}
			: null,
		latestRequest,
		latestApplicableRun,
		effectiveStatus: latestRequest?.effectiveStatus ?? null,
	};
}

type FactLockTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type FactLockResolutionInput = {
	projectId: string;
	factLockRunId: string;
	claimId: string;
	scriptVersionId: string;
	baseRevision: number;
};

async function lockResolutionProject(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	projectId: string,
) {
	const [record] = await transaction
		.select({ id: project.id })
		.from(project)
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: project });
	if (!record)
		throw new FactLockError(
			"FACT_LOCK_NOT_FOUND",
			"Project không tồn tại trong workspace.",
		);
}

async function lockResolutionRun(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	input: FactLockResolutionInput,
) {
	const [run] = await transaction
		.select()
		.from(factLockRun)
		.where(
			and(
				eq(factLockRun.id, input.factLockRunId),
				eq(factLockRun.projectId, input.projectId),
				eq(factLockRun.workspaceId, actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: factLockRun });
	if (!run)
		throw new FactLockError(
			"FACT_LOCK_NOT_FOUND",
			"Fact Lock run không tồn tại trong project.",
		);
	return run;
}

async function lockResolutionDraft(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	input: FactLockResolutionInput,
) {
	const [draft] = await transaction
		.select()
		.from(scriptVersion)
		.where(
			and(
				eq(scriptVersion.id, input.scriptVersionId),
				eq(scriptVersion.projectId, input.projectId),
				eq(scriptVersion.workspaceId, actor.workspaceId),
				eq(scriptVersion.status, "draft"),
			),
		)
		.limit(1)
		.for("update", { of: scriptVersion });
	if (!draft)
		throw new FactLockError(
			"FACT_LOCK_SCRIPT_VERSION_NOT_FOUND",
			"Không tìm thấy ScriptVersion draft hiện tại.",
		);
	return draft;
}

async function lockResolutionClaim(
	transaction: FactLockTransaction,
	actor: WorkspaceActor,
	input: FactLockResolutionInput,
) {
	const [claim] = await transaction
		.select()
		.from(factLockClaim)
		.where(
			and(
				eq(factLockClaim.id, input.claimId),
				eq(factLockClaim.runId, input.factLockRunId),
				eq(factLockClaim.workspaceId, actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: factLockClaim });
	if (!claim)
		throw new FactLockError(
			"FACT_LOCK_CLAIM_NOT_FOUND",
			"Không tìm thấy claim trong Fact Lock run.",
		);
	return claim;
}

function assertResolutionRunIsCurrent(
	run: typeof factLockRun.$inferSelect,
	draft: typeof scriptVersion.$inferSelect,
	input: FactLockResolutionInput,
	dependenciesCurrent: boolean,
) {
	if (run.scriptVersionId !== input.scriptVersionId)
		throw new FactLockError(
			"FACT_LOCK_CLAIM_SOURCE_MISMATCH",
			"Claim không thuộc ScriptVersion hiện tại.",
		);
	if (run.status !== "review_required" && run.status !== "passed")
		throw new FactLockError(
			"FACT_LOCK_CLAIM_NOT_REVIEWABLE",
			"Fact Lock run hiện tại chưa có kết quả để xử lý.",
		);
	if (!dependenciesCurrent || draft.revision !== run.sourceScriptRevision)
		throw new FactLockError(
			"FACT_LOCK_STALE",
			"Fact Lock đã lỗi thời. Hãy chạy lại Fact Lock trước khi xử lý claim.",
		);
	if (draft.revision !== input.baseRevision)
		throw new FactLockError(
			"FACT_LOCK_CONFLICT",
			"Script đã thay đổi. Hãy tải lại trước khi xử lý claim.",
			{ latestRevision: draft.revision },
		);
}

export async function manualApproveFactLockClaim(
	actor: WorkspaceActor,
	input: FactLockResolutionInput & { reviewNote?: string | null },
) {
	await db.transaction(async (transaction) => {
		await lockResolutionProject(transaction, actor, input.projectId);
		const run = await lockResolutionRun(transaction, actor, input);
		const draft = await lockResolutionDraft(transaction, actor, input);
		const dependenciesCurrent = await dependenciesAreCurrent(
			transaction,
			actor,
			run,
		);
		assertResolutionRunIsCurrent(run, draft, input, dependenciesCurrent);
		const claim = await lockResolutionClaim(transaction, actor, input);
		if (
			claim.classificationStatus !== "NEEDS_REVIEW" ||
			claim.reviewStatus !== "UNRESOLVED"
		)
			throw new FactLockError(
				"FACT_LOCK_CLAIM_NOT_REVIEWABLE",
				"Claim này không còn cần duyệt thủ công.",
			);
		const reviewedAt = new Date();
		const reviewNote = input.reviewNote?.trim() || null;
		const [updated] = await transaction
			.update(factLockClaim)
			.set({
				reviewStatus: "MANUAL_APPROVED",
				reviewedByUserId: actor.userId,
				reviewedAt,
				reviewNote,
			})
			.where(
				and(
					eq(factLockClaim.id, input.claimId),
					eq(factLockClaim.workspaceId, actor.workspaceId),
					eq(factLockClaim.reviewStatus, "UNRESOLVED"),
					eq(factLockClaim.classificationStatus, "NEEDS_REVIEW"),
				),
			)
			.returning({ id: factLockClaim.id });
		if (!updated)
			throw new FactLockError(
				"FACT_LOCK_CONFLICT",
				"Claim vừa được xử lý bởi một thao tác khác.",
			);
		const claims = await loadClaims(transaction, actor, run.id);
		if (deriveFactLockRunStatus(claims) === "passed")
			await transaction
				.update(factLockRun)
				.set({ status: "passed" })
				.where(
					and(
						eq(factLockRun.id, run.id),
						eq(factLockRun.workspaceId, actor.workspaceId),
						eq(factLockRun.status, "review_required"),
					),
				);
	});
	return getFactLockState(actor, input.projectId);
}

export async function mutateFactLockClaimSourceAndRefresh(
	actor: WorkspaceActor,
	input: FactLockResolutionInput,
	mutation: FactLockSourceMutation,
) {
	await db.transaction(async (transaction) => {
		await lockResolutionProject(transaction, actor, input.projectId);
		const run = await lockResolutionRun(transaction, actor, input);
		const draft = await lockResolutionDraft(transaction, actor, input);
		const dependenciesCurrent = await dependenciesAreCurrent(
			transaction,
			actor,
			run,
		);
		assertResolutionRunIsCurrent(run, draft, input, dependenciesCurrent);
		const claim = await lockResolutionClaim(transaction, actor, input);
		if (mutation.action === "suggestion" && !claim.suggestionText?.trim())
			throw new FactLockError(
				"FACT_LOCK_CLAIM_SUGGESTION_UNAVAILABLE",
				"Claim này chưa có đề xuất để áp dụng.",
			);
		const result = mutateFactLockClaimSource(
			draft.editableSnapshotJson as ScriptVersionEditableSnapshot,
			{
				claimText: claim.claimText,
				occurrence: claim.occurrenceJson as FactLockStoredClaim["occurrence"],
			},
			mutation.action === "suggestion"
				? { action: "suggestion", newText: claim.suggestionText as string }
				: mutation,
		);
		if (!result.success) throw new FactLockError(result.code, result.message);
		const [updated] = await transaction
			.update(scriptVersion)
			.set({
				editableSnapshotJson: result.snapshot,
				revision: sql`${scriptVersion.revision} + 1`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(scriptVersion.id, draft.id),
					eq(scriptVersion.workspaceId, actor.workspaceId),
					eq(scriptVersion.status, "draft"),
					eq(scriptVersion.revision, input.baseRevision),
				),
			)
			.returning({ revision: scriptVersion.revision });
		if (!updated)
			throw new FactLockError(
				"FACT_LOCK_CONFLICT",
				"Script đã thay đổi. Hãy tải lại trước khi xử lý claim.",
			);
	});
	return getFactLockState(actor, input.projectId);
}

export async function executeFactLockRun(
	actor: WorkspaceActor,
	run: FactLockRunArtifact,
	providerOrFactory: TextProvider | (() => TextProvider),
) {
	const claim = await claimFactLockExecution(actor, run.id);
	if (!claim.owner) {
		if (claim.stale) {
			return finalizeFactLockRun(actor, {
				runId: run.id,
				outcome: {
					kind: "failure",
					code: "FACT_LOCK_EXECUTION_CLAIM_STALE_UNCERTAIN",
				},
			});
		}
		return { ...claim.run, claims: claim.claims };
	}

	let provider: TextProvider;
	try {
		provider =
			typeof providerOrFactory === "function"
				? providerOrFactory()
				: providerOrFactory;
	} catch (error) {
		const code =
			error instanceof FactLockError
				? error.code
				: "FACT_LOCK_PROVIDER_UNAVAILABLE";
		await finalizeFactLockRun(actor, {
			runId: claim.run.id,
			outcome: { kind: "failure", code },
		});
		throw error;
	}

	let estimate: TextProviderEstimate;
	try {
		estimate = await estimateFactLockRun(claim.run, provider);
	} catch (error) {
		const code =
			error instanceof FactLockError
				? error.code
				: "FACT_LOCK_COST_ESTIMATE_UNAVAILABLE";
		await finalizeFactLockRun(actor, {
			runId: claim.run.id,
			outcome: { kind: "failure", code },
		});
		throw error;
	}
	const estimated = await recordFactLockEstimate(actor, claim.run.id, estimate);
	return runClaimedFactLock(actor, estimated, provider);
}

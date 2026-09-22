import { randomUUID } from "node:crypto";

import {
	type AiGovernanceSettingsInput,
	type AiRecoveryAction,
	aiGovernanceSettingsInputSchema,
	aiOperationFilterSchema,
	aiPricingRegistry,
	aiRecoveryActionSchema,
	canonicalizePaidRequest,
	findModel,
	findPricing,
	findProvider,
	type GovernedOperationInput,
	governedOperationInputSchema,
} from "@affichannel/core";
import {
	aiBudgetReservation,
	aiGovernanceSettings,
	aiOperation,
	aiOperationAudit,
	aiPricingVersion,
	aiReconciliation,
	db,
	project,
} from "@affichannel/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { sha256Hex } from "./script-generation-hashing";
import type { WorkspaceActor } from "./workspace";

const DEFAULT_BUDGET_CURRENCY = "VND";
const LEASE_TTL_MS = 5 * 60 * 1000;

function findPricingForProviderModel(
	providerId: string,
	modelId: string,
	pricingVersion: string,
) {
	return aiPricingRegistry.find(
		(pricing) =>
			pricing.providerId === providerId &&
			pricing.modelId === modelId &&
			pricing.pricingVersion === pricingVersion,
	);
}

export const deterministicTestScenarios = [
	"success",
	"definitive_failure",
	"timeout_before_send",
	"timeout_after_possible_send",
	"network_uncertain",
	"orphan_artifact",
	"db_failure",
	"storage_failure",
] as const;

export type DeterministicTestScenario =
	(typeof deterministicTestScenarios)[number];

export class AiGovernanceError extends Error {
	readonly code: string;
	readonly metadata: Record<string, unknown> | undefined;

	constructor(
		code: string,
		message: string,
		metadata?: Record<string, unknown>,
	) {
		super(message);
		this.name = "AiGovernanceError";
		this.code = code;
		this.metadata = metadata;
	}
}

const sensitiveKey =
	/(authorization|api[-_]?key|access[-_]?token|secret|password|cookie|set-cookie|credential)/i;

export function redactSensitive(value: unknown, depth = 0): unknown {
	if (depth > 6) return "[REDACTED_DEPTH]";
	if (Array.isArray(value)) {
		return value.slice(0, 50).map((item) => redactSensitive(item, depth + 1));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.slice(0, 100)
				.map(([key, item]) => [
					key,
					sensitiveKey.test(key)
						? "[REDACTED]"
						: redactSensitive(item, depth + 1),
				]),
		);
	}
	if (typeof value === "string" && value.length > 2_000) {
		return `${value.slice(0, 2_000)}…`;
	}
	return value;
}

function safeObject(value: unknown): Record<string, unknown> {
	const redacted = redactSensitive(value);
	return redacted && typeof redacted === "object" && !Array.isArray(redacted)
		? (redacted as Record<string, unknown>)
		: {};
}

function nowMonthStart(date = new Date()) {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function safeNumber(value: bigint | null | undefined) {
	if (value === null || value === undefined) return null;
	const number = Number(value);
	return Number.isSafeInteger(number) ? number : Number.MAX_SAFE_INTEGER;
}

function ceilTokenCost(tokens: number, microsPerMillion: bigint) {
	if (!Number.isSafeInteger(tokens) || tokens < 0) return BigInt(0);
	return (
		(BigInt(tokens) * microsPerMillion + BigInt(999_999)) / BigInt(1_000_000)
	);
}

function semanticInputFor(input: GovernedOperationInput) {
	if (input.operationKind === "TEXT_GENERATION") {
		const prompt =
			typeof input.semanticInput.prompt === "string"
				? input.semanticInput.prompt.trim().slice(0, 20_000)
				: null;
		const inputTokens =
			typeof input.semanticInput.inputTokens &&
			Number.isSafeInteger(input.semanticInput.inputTokens) &&
			(input.semanticInput.inputTokens as number) >= 0
				? (input.semanticInput.inputTokens as number)
				: 0;
		const outputTokens =
			typeof input.semanticInput.outputTokens &&
			Number.isSafeInteger(input.semanticInput.outputTokens) &&
			(input.semanticInput.outputTokens as number) >= 0
				? (input.semanticInput.outputTokens as number)
				: 0;
		return {
			prompt,
			inputTokens,
			outputTokens,
			requestOptions: safeObject(input.semanticInput.requestOptions),
		};
	}

	return {
		sourceFingerprint:
			typeof input.semanticInput.sourceFingerprint === "string"
				? input.semanticInput.sourceFingerprint.trim().slice(0, 256)
				: null,
		motionPlanFingerprint:
			typeof input.semanticInput.motionPlanFingerprint === "string"
				? input.semanticInput.motionPlanFingerprint.trim().slice(0, 256)
				: null,
		durationSeconds:
			typeof input.semanticInput.durationSeconds &&
			Number.isSafeInteger(input.semanticInput.durationSeconds) &&
			(input.semanticInput.durationSeconds as number) >= 0
				? input.semanticInput.durationSeconds
				: null,
		prompt:
			typeof input.semanticInput.prompt === "string"
				? input.semanticInput.prompt.trim().slice(0, 2_000)
				: null,
		aspectRatio:
			typeof input.semanticInput.aspectRatio === "string"
				? input.semanticInput.aspectRatio.trim().slice(0, 32)
				: null,
		outputMimeType:
			typeof input.semanticInput.outputMimeType === "string"
				? input.semanticInput.outputMimeType.trim().slice(0, 64)
				: null,
	};
}

function estimateCost(
	pricing: NonNullable<ReturnType<typeof findPricing>>,
	semanticInput: Record<string, unknown>,
) {
	const inputTokens =
		typeof semanticInput.inputTokens === "number"
			? semanticInput.inputTokens
			: 0;
	const outputTokens =
		typeof semanticInput.outputTokens === "number"
			? semanticInput.outputTokens
			: 0;
	if (pricing.unit === "REQUEST") return pricing.fixedMicros;
	return (
		pricing.fixedMicros +
		ceilTokenCost(inputTokens, pricing.inputMicrosPerMillionTokens) +
		ceilTokenCost(outputTokens, pricing.outputMicrosPerMillionTokens)
	);
}

function providerSafe(
	provider: typeof import("@affichannel/core")["aiProviderRegistry"][number],
) {
	return {
		providerId: provider.providerId,
		displayName: provider.displayName,
		paid: provider.paid,
		productionRelease: provider.productionRelease,
		models: provider.models.map((model) => ({
			providerId: model.providerId,
			modelId: model.modelId,
			capabilities: [...model.capabilities],
			paid: model.paid,
			productionRelease: model.productionRelease,
			pricingVersions: [...model.pricingVersions],
		})),
	};
}

function operationRead(row: typeof aiOperation.$inferSelect) {
	return {
		id: row.id,
		projectId: row.projectId,
		operationKind: row.operationKind,
		capability: row.capability,
		providerId: row.providerId,
		modelId: row.modelId,
		requestHash: row.requestHash,
		hashVersion: row.hashVersion,
		idempotencyKey: row.idempotencyKey,
		correlationId: row.correlationId,
		status: row.status,
		callStage: row.callStage,
		providerRequestId: row.providerRequestId,
		pricingVersion: row.pricingVersion,
		currency: row.currency,
		estimatedCostMicros: safeNumber(row.estimatedCostMicros),
		reservedCostMicros: safeNumber(row.reservedCostMicros),
		actualCostMicros: safeNumber(row.actualCostMicros),
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		usage: row.usageJson,
		safeError: row.safeErrorJson,
		artifactEvidence: row.artifactEvidenceJson,
		errorCategory: row.errorCategory,
		latencyMs: row.latencyMs,
		createdAt: row.createdAt,
		startedAt: row.startedAt,
		finishedAt: row.finishedAt,
	};
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function audit(
	tx: Tx,
	actor: WorkspaceActor,
	input: {
		operationId: string;
		eventType: string;
		status: string;
		correlationId: string;
		providerRequestId?: string | null;
		metadata?: unknown;
	},
) {
	await tx.insert(aiOperationAudit).values({
		id: randomUUID(),
		workspaceId: actor.workspaceId,
		operationId: input.operationId,
		eventType: input.eventType,
		status: input.status,
		correlationId: input.correlationId,
		providerRequestId: input.providerRequestId ?? null,
		safeMetadataJson: safeObject(input.metadata),
	});
}

async function findSettings(actor: WorkspaceActor, tx?: Tx) {
	const query = (tx ?? db)
		.select()
		.from(aiGovernanceSettings)
		.where(eq(aiGovernanceSettings.workspaceId, actor.workspaceId))
		.limit(1);
	return (await query)[0];
}

export async function resolveAiOperationGovernance(
	actor: WorkspaceActor,
	operationKind: GovernedOperationInput["operationKind"],
	capability: GovernedOperationInput["capability"],
) {
	const settings = await findSettings(actor);
	if (!settings)
		throw new AiGovernanceError(
			"AI_GOVERNANCE_NOT_CONFIGURED",
			"AI governance settings are not configured.",
		);
	const { provider, model } = assertProviderModel(
		settings.providerId,
		settings.modelId,
		operationKind,
		capability,
	);
	const pricing = findPricing(
		settings.providerId,
		settings.modelId,
		operationKind,
		settings.pricingVersion ?? "",
	);
	if (!pricing)
		throw new AiGovernanceError(
			"AI_PRICING_UNAVAILABLE",
			"No server-owned pricing is available for this operation.",
		);
	return { settings, provider, model, pricing };
}

function assertProviderModel(
	providerId: string,
	modelId: string,
	operationKind?: string,
	capability?: string,
) {
	const provider = findProvider(providerId);
	if (!provider)
		throw new AiGovernanceError(
			"AI_PROVIDER_NOT_FOUND",
			"Provider is not in the server registry.",
		);
	const model = findModel(providerId, modelId);
	if (!model)
		throw new AiGovernanceError(
			"AI_MODEL_NOT_FOUND",
			"Model is not in the server registry.",
		);
	if (
		operationKind &&
		capability &&
		(!model.capabilities.includes(capability as never) ||
			operationKind !== capability)
	) {
		throw new AiGovernanceError(
			"AI_CAPABILITY_NOT_ALLOWED",
			"The model does not support this operation capability.",
		);
	}
	return { provider, model };
}

function assertReady(
	settings: typeof aiGovernanceSettings.$inferSelect,
	pricing: NonNullable<ReturnType<typeof findPricing>>,
	providerPaid: boolean,
) {
	if (settings.killSwitch)
		throw new AiGovernanceError(
			"AI_KILL_SWITCH_ACTIVE",
			"AI provider kill switch is active.",
		);
	if (!settings.providerEnabled)
		throw new AiGovernanceError(
			"AI_PROVIDER_DISABLED",
			"AI provider is disabled.",
		);
	if (!settings.modelEnabled)
		throw new AiGovernanceError("AI_MODEL_DISABLED", "AI model is disabled.");
	if (settings.budgetCurrency !== pricing.currency) {
		throw new AiGovernanceError(
			"AI_PRICING_UNAVAILABLE",
			"Budget currency does not match the selected pricing version.",
		);
	}
	if (providerPaid && !pricing) {
		throw new AiGovernanceError(
			"AI_PRICING_UNAVAILABLE",
			"Pricing is required before a paid operation.",
		);
	}
}

function safeSettings(row: typeof aiGovernanceSettings.$inferSelect | null) {
	return {
		version: row?.version ?? 0,
		providerId: row?.providerId ?? "deterministic",
		modelId: row?.modelId ?? "deterministic-text-v1",
		providerEnabled: row?.providerEnabled ?? false,
		modelEnabled: row?.modelEnabled ?? false,
		killSwitch: row?.killSwitch ?? true,
		pricingVersion: row?.pricingVersion ?? "deterministic-text.v1",
		budgetPeriod: row?.budgetPeriod ?? "MONTHLY",
		budgetLimitMicros: safeNumber(row?.budgetLimitMicros) ?? 0,
		budgetCurrency: row?.budgetCurrency ?? DEFAULT_BUDGET_CURRENCY,
		reservedMicros: safeNumber(row?.reservedMicros) ?? 0,
		settledMicros: safeNumber(row?.settledMicros) ?? 0,
		uncertainMicros: 0,
		remainingMicros: Math.max(
			0,
			(safeNumber(row?.budgetLimitMicros) ?? 0) -
				(safeNumber(row?.reservedMicros) ?? 0) -
				(safeNumber(row?.settledMicros) ?? 0),
		),
	};
}

export function listAiProviderRegistry() {
	return import("@affichannel/core").then(
		({ aiPricingRegistry, aiProviderRegistry }) => ({
			providers: aiProviderRegistry.map(providerSafe),
			pricing: aiPricingRegistry.map((pricing) => ({
				...pricing,
				inputMicrosPerMillionTokens:
					pricing.inputMicrosPerMillionTokens.toString(),
				outputMicrosPerMillionTokens:
					pricing.outputMicrosPerMillionTokens.toString(),
				fixedMicros: pricing.fixedMicros.toString(),
			})),
		}),
	);
}

export async function getAiGovernanceSettings(actor: WorkspaceActor) {
	return safeSettings((await findSettings(actor)) ?? null);
}

export async function updateAiGovernanceSettings(
	actor: WorkspaceActor,
	input: AiGovernanceSettingsInput,
) {
	const parsed = aiGovernanceSettingsInputSchema.parse(input);
	const { provider, model } = assertProviderModel(
		parsed.providerId,
		parsed.modelId,
	);
	const pricing = findPricingForProviderModel(
		parsed.providerId,
		parsed.modelId,
		parsed.pricingVersion,
	);
	if (
		!pricing ||
		!model.pricingVersions.some((version) => version === parsed.pricingVersion)
	) {
		throw new AiGovernanceError(
			"AI_PRICING_UNAVAILABLE",
			"Pricing version is not in the server registry.",
		);
	}
	if (parsed.budgetCurrency !== pricing.currency) {
		throw new AiGovernanceError(
			"AI_PRICING_UNAVAILABLE",
			"Budget currency must match the server pricing currency.",
		);
	}
	return db.transaction(async (tx) => {
		const existing = await findSettings(actor, tx);
		if (existing && parsed.expectedVersion !== existing.version) {
			throw new AiGovernanceError(
				"AI_VERSION_CONFLICT",
				"Governance settings changed; reload before saving.",
			);
		}
		const common = {
			providerId: provider.providerId,
			modelId: model.modelId,
			providerEnabled: parsed.providerEnabled,
			modelEnabled: parsed.modelEnabled,
			killSwitch: parsed.killSwitch,
			pricingVersion: parsed.pricingVersion,
			budgetPeriod: parsed.budgetPeriod,
			budgetLimitMicros: BigInt(parsed.budgetLimitMicros),
			budgetCurrency: parsed.budgetCurrency,
			updatedByUserId: actor.userId,
			updatedAt: new Date(),
		};
		const [saved] = existing
			? await tx
					.update(aiGovernanceSettings)
					.set({ ...common, version: existing.version + 1 })
					.where(eq(aiGovernanceSettings.id, existing.id))
					.returning()
			: await tx
					.insert(aiGovernanceSettings)
					.values({
						id: randomUUID(),
						workspaceId: actor.workspaceId,
						budgetPeriodStart: nowMonthStart(),
						reservedMicros: BigInt(0),
						settledMicros: BigInt(0),
						version: 1,
						createdByUserId: actor.userId,
						...common,
					})
					.returning();
		if (!saved)
			throw new Error("AI governance settings upsert returned no row.");
		await tx
			.insert(aiPricingVersion)
			.values({
				id: `${actor.workspaceId}:${pricing.providerId}:${pricing.modelId}:${pricing.operationKind}:${pricing.pricingVersion}`,
				workspaceId: actor.workspaceId,
				providerId: pricing.providerId,
				modelId: pricing.modelId,
				operationKind: pricing.operationKind,
				pricingVersion: pricing.pricingVersion,
				currency: pricing.currency,
				unit: pricing.unit,
				inputMicrosPerMillionTokens: pricing.inputMicrosPerMillionTokens,
				outputMicrosPerMillionTokens: pricing.outputMicrosPerMillionTokens,
				fixedMicros: pricing.fixedMicros,
				createdByUserId: actor.userId,
			})
			.onConflictDoNothing();
		return safeSettings(saved);
	});
}

export async function getAiBudgetState(actor: WorkspaceActor) {
	const settings = await findSettings(actor);
	if (!settings) return safeSettings(null);
	const [uncertain] = await db
		.select({
			total: sql<bigint>`coalesce(sum(${aiBudgetReservation.amountMicros}), 0)`,
		})
		.from(aiBudgetReservation)
		.where(
			and(
				eq(aiBudgetReservation.workspaceId, actor.workspaceId),
				eq(aiBudgetReservation.status, "UNCERTAIN"),
			),
		);
	const read = safeSettings(settings);
	return {
		...read,
		uncertainMicros: safeNumber(uncertain?.total) ?? 0,
	};
}

export async function prepareAiOperation(
	actor: WorkspaceActor,
	input: GovernedOperationInput,
) {
	const parsed = governedOperationInputSchema.parse(input);
	const settings = await findSettings(actor);
	if (!settings)
		throw new AiGovernanceError(
			"AI_GOVERNANCE_NOT_CONFIGURED",
			"AI governance settings are not configured.",
		);
	const { provider, model } = assertProviderModel(
		settings.providerId,
		settings.modelId,
		parsed.operationKind,
		parsed.capability,
	);
	const pricing = findPricing(
		settings.providerId,
		settings.modelId,
		parsed.operationKind,
		settings.pricingVersion ?? "",
	);
	if (!pricing)
		throw new AiGovernanceError(
			"AI_PRICING_UNAVAILABLE",
			"No server-owned pricing is available for this operation.",
		);
	assertReady(settings, pricing, provider.paid);
	if (
		provider.paid &&
		(!provider.productionRelease || !model.productionRelease)
	) {
		throw new AiGovernanceError(
			"AI_PRODUCTION_RELEASE_BLOCKED",
			"The paid provider is registered but not released for production execution.",
		);
	}
	const semanticInput = semanticInputFor(parsed);
	const canonical = canonicalizePaidRequest({
		operationKind: parsed.operationKind,
		capability: parsed.capability,
		providerId: provider.providerId,
		modelId: model.modelId,
		semanticInput,
	});
	const requestHash = sha256Hex(canonical.canonicalInput);
	const estimatedCost = estimateCost(pricing, semanticInput);
	if (parsed.projectId) {
		const [ownedProject] = await db
			.select({ id: project.id })
			.from(project)
			.where(
				and(
					eq(project.id, parsed.projectId),
					eq(project.workspaceId, actor.workspaceId),
				),
			)
			.limit(1);
		if (!ownedProject)
			throw new AiGovernanceError(
				"AI_OPERATION_NOT_FOUND",
				"Project is outside the current workspace.",
			);
	}

	return db.transaction(async (tx) => {
		const existingByKey = await tx
			.select()
			.from(aiOperation)
			.where(
				and(
					eq(aiOperation.workspaceId, actor.workspaceId),
					eq(aiOperation.idempotencyKey, parsed.idempotencyKey),
				),
			)
			.limit(1);
		if (existingByKey[0]) {
			if (existingByKey[0].requestHash !== requestHash) {
				throw new AiGovernanceError(
					"AI_REQUEST_DUPLICATE",
					"Idempotency key is already bound to different immutable request semantics.",
				);
			}
			return operationRead(existingByKey[0]);
		}
		const existingByHash = await tx
			.select()
			.from(aiOperation)
			.where(
				and(
					eq(aiOperation.workspaceId, actor.workspaceId),
					eq(aiOperation.requestHash, requestHash),
				),
			)
			.limit(1);
		if (existingByHash[0]) return operationRead(existingByHash[0]);

		const lockedSettings = await tx
			.select()
			.from(aiGovernanceSettings)
			.where(eq(aiGovernanceSettings.workspaceId, actor.workspaceId))
			.limit(1)
			.for("update", { of: aiGovernanceSettings });
		const current = lockedSettings[0];
		if (!current)
			throw new AiGovernanceError(
				"AI_GOVERNANCE_NOT_CONFIGURED",
				"AI governance settings are not configured.",
			);
		assertReady(current, pricing, provider.paid);
		const available =
			current.budgetLimitMicros -
			current.reservedMicros -
			current.settledMicros;
		if (available < estimatedCost) {
			throw new AiGovernanceError(
				"AI_BUDGET_EXCEEDED",
				"The operation exceeds the remaining workspace budget.",
				{
					availableMicros: available.toString(),
					estimatedMicros: estimatedCost.toString(),
				},
			);
		}
		const operationId = randomUUID();
		const correlationId = randomUUID();
		const [created] = await tx
			.insert(aiOperation)
			.values({
				id: operationId,
				workspaceId: actor.workspaceId,
				projectId: parsed.projectId ?? null,
				createdByUserId: actor.userId,
				operationKind: parsed.operationKind,
				capability: parsed.capability,
				providerId: provider.providerId,
				modelId: model.modelId,
				requestHash,
				hashVersion: canonical.hashVersion,
				idempotencyKey: parsed.idempotencyKey,
				correlationId,
				requestMetadataJson: redactSensitive({
					inputTokens: semanticInput.inputTokens ?? null,
					outputTokens: semanticInput.outputTokens ?? null,
					requestOptions: semanticInput.requestOptions ?? null,
				}),
				estimatedCostMicros: estimatedCost,
				reservedCostMicros: estimatedCost,
				pricingVersion: pricing.pricingVersion,
				currency: pricing.currency,
				inputTokens:
					typeof semanticInput.inputTokens === "number"
						? semanticInput.inputTokens
						: null,
				outputTokens:
					typeof semanticInput.outputTokens === "number"
						? semanticInput.outputTokens
						: null,
			})
			.returning();
		if (!created) throw new Error("AI operation insert returned no row.");
		await tx
			.update(aiGovernanceSettings)
			.set({ reservedMicros: current.reservedMicros + estimatedCost })
			.where(eq(aiGovernanceSettings.id, current.id));
		await tx.insert(aiBudgetReservation).values({
			id: randomUUID(),
			workspaceId: actor.workspaceId,
			operationId,
			status: "ACTIVE",
			amountMicros: estimatedCost,
			currency: pricing.currency,
			periodStart: current.budgetPeriodStart,
		});
		await audit(tx, actor, {
			operationId,
			eventType: "PREPARED",
			status: "PENDING",
			correlationId,
			metadata: {
				estimatedCostMicros: estimatedCost.toString(),
				pricingVersion: pricing.pricingVersion,
			},
		});
		return operationRead(created);
	});
}

export type AiOperationFinishInput = {
	status: "COMPLETED" | "FAILED" | "INDETERMINATE";
	callStage:
		| "NOT_STARTED"
		| "POSSIBLY_SENT"
		| "REQUEST_IDENTIFIED"
		| "RESPONSE_RECEIVED"
		| "FINALIZED";
	providerRequestId?: string | null;
	actualCostMicros?: bigint | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	usage?: unknown;
	safeError?: unknown;
	artifactEvidence?: unknown;
	errorCategory?: string | null;
};

export async function finishAiOperationInTransaction(
	tx: Tx,
	actor: WorkspaceActor,
	current: typeof aiOperation.$inferSelect,
	input: AiOperationFinishInput,
	allowRecovery = false,
) {
	if (current.status !== "PENDING" && !allowRecovery) return current;
	const [reservation] = await tx
		.select()
		.from(aiBudgetReservation)
		.where(eq(aiBudgetReservation.operationId, current.id))
		.limit(1)
		.for("update", { of: aiBudgetReservation });
	const [settings] = await tx
		.select()
		.from(aiGovernanceSettings)
		.where(eq(aiGovernanceSettings.workspaceId, actor.workspaceId))
		.limit(1)
		.for("update", { of: aiGovernanceSettings });
	if (!reservation || !settings)
		throw new AiGovernanceError(
			"AI_GOVERNANCE_NOT_CONFIGURED",
			"Reservation or governance settings are missing.",
		);
	const actual =
		input.actualCostMicros ??
		(input.status === "COMPLETED" ? current.estimatedCostMicros : null);
	const finishedAt = new Date();
	if (input.status === "COMPLETED") {
		await tx
			.update(aiBudgetReservation)
			.set({ status: "SETTLED", settledAt: finishedAt })
			.where(eq(aiBudgetReservation.id, reservation.id));
		await tx
			.update(aiGovernanceSettings)
			.set({
				reservedMicros: settings.reservedMicros - reservation.amountMicros,
				settledMicros: settings.settledMicros + (actual ?? BigInt(0)),
			})
			.where(eq(aiGovernanceSettings.id, settings.id));
	} else if (input.status === "FAILED") {
		await tx
			.update(aiBudgetReservation)
			.set({ status: "RELEASED", releasedAt: finishedAt })
			.where(eq(aiBudgetReservation.id, reservation.id));
		await tx
			.update(aiGovernanceSettings)
			.set({
				reservedMicros: settings.reservedMicros - reservation.amountMicros,
			})
			.where(eq(aiGovernanceSettings.id, settings.id));
	} else {
		await tx
			.update(aiBudgetReservation)
			.set({ status: "UNCERTAIN" })
			.where(eq(aiBudgetReservation.id, reservation.id));
	}
	const [saved] = await tx
		.update(aiOperation)
		.set({
			status: input.status,
			callStage: input.callStage,
			providerRequestId: input.providerRequestId ?? current.providerRequestId,
			actualCostMicros: actual,
			inputTokens: input.inputTokens ?? current.inputTokens,
			outputTokens: input.outputTokens ?? current.outputTokens,
			usageJson:
				input.usage === undefined
					? current.usageJson
					: redactSensitive(input.usage),
			safeErrorJson:
				input.safeError === undefined
					? current.safeErrorJson
					: safeObject(input.safeError),
			artifactEvidenceJson:
				input.artifactEvidence === undefined
					? current.artifactEvidenceJson
					: safeObject(input.artifactEvidence),
			errorCategory: input.errorCategory ?? current.errorCategory,
			leaseOwner: null,
			leaseExpiresAt: null,
			finishedAt,
			updatedAt: finishedAt,
		})
		.where(eq(aiOperation.id, current.id))
		.returning();
	if (!saved) throw new Error("AI operation finalization returned no row.");
	await audit(tx, actor, {
		operationId: current.id,
		eventType: input.status,
		status: input.status,
		correlationId: current.correlationId,
		providerRequestId: input.providerRequestId ?? current.providerRequestId,
		metadata: {
			errorCategory: input.errorCategory ?? null,
			callStage: input.callStage,
		},
	});
	return saved;
}

export async function claimDeterministicAiOperation(
	actor: WorkspaceActor,
	operationId: string,
	input?: { operationKind?: GovernedOperationInput["operationKind"] },
) {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(aiOperation)
			.where(
				and(
					eq(aiOperation.id, operationId),
					eq(aiOperation.workspaceId, actor.workspaceId),
				),
			)
			.limit(1)
			.for("update", { of: aiOperation });
		if (!current)
			throw new AiGovernanceError(
				"AI_OPERATION_NOT_FOUND",
				"Operation was not found in this workspace.",
			);
		if (input?.operationKind && current.operationKind !== input.operationKind)
			throw new AiGovernanceError(
				"AI_OPERATION_NOT_FOUND",
				"Operation kind does not match the requested adapter.",
			);
		if (current.status !== "PENDING") return current;
		if (current.leaseExpiresAt && current.leaseExpiresAt > new Date())
			throw new AiGovernanceError(
				"AI_LEASE_CONFLICT",
				"Operation is leased by another worker.",
			);
		if (current.callStage !== "NOT_STARTED") {
			return finishAiOperationInTransaction(tx, actor, current, {
				status: "INDETERMINATE",
				callStage: "POSSIBLY_SENT",
				safeError: {
					code: "STALE_PENDING_POSSIBLE_SEND",
					message: "Stale pending operation requires explicit reconciliation.",
				},
				errorCategory: "STALE_PENDING",
			});
		}
		const [settings] = await tx
			.select()
			.from(aiGovernanceSettings)
			.where(eq(aiGovernanceSettings.workspaceId, actor.workspaceId))
			.limit(1);
		if (
			!settings ||
			settings.killSwitch ||
			!settings.providerEnabled ||
			!settings.modelEnabled ||
			current.providerId !== "deterministic"
		)
			throw new AiGovernanceError(
				"AI_PRODUCTION_RELEASE_BLOCKED",
				"Deterministic execution is not authorized by current governance settings.",
			);
		const leaseOwner = randomUUID();
		const [updated] = await tx
			.update(aiOperation)
			.set({
				leaseOwner,
				leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS),
				attemptCount: current.attemptCount + 1,
				startedAt: current.startedAt ?? new Date(),
				updatedAt: new Date(),
			})
			.where(eq(aiOperation.id, current.id))
			.returning();
		if (!updated) throw new Error("AI operation lease claim returned no row.");
		await audit(tx, actor, {
			operationId: current.id,
			eventType: "LEASE_CLAIMED",
			status: "PENDING",
			correlationId: current.correlationId,
			metadata: { attemptCount: updated.attemptCount },
		});
		return updated;
	});
}

const deterministicCallCounts = new Map<string, number>();

export function getDeterministicAdapterCallCount(operationId: string) {
	return deterministicCallCounts.get(operationId) ?? 0;
}

export async function executeDeterministicTestOperation(
	actor: WorkspaceActor,
	operationId: string,
	scenario: DeterministicTestScenario,
) {
	if (!deterministicTestScenarios.includes(scenario))
		throw new AiGovernanceError(
			"AI_TEST_PROVIDER_FORBIDDEN",
			"Unknown deterministic test scenario.",
		);
	if (
		process.env.NODE_ENV !== "test" &&
		process.env.AFFICHANNEL_AI_TEST_MODE !== "1"
	) {
		throw new AiGovernanceError(
			"AI_TEST_PROVIDER_FORBIDDEN",
			"The deterministic adapter is test-only.",
		);
	}
	const claimed = await db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(aiOperation)
			.where(
				and(
					eq(aiOperation.id, operationId),
					eq(aiOperation.workspaceId, actor.workspaceId),
				),
			)
			.limit(1)
			.for("update", { of: aiOperation });
		if (!current)
			throw new AiGovernanceError(
				"AI_OPERATION_NOT_FOUND",
				"Operation was not found in this workspace.",
			);
		if (current.status !== "PENDING") return current;
		if (current.leaseExpiresAt && current.leaseExpiresAt > new Date())
			throw new AiGovernanceError(
				"AI_LEASE_CONFLICT",
				"Operation is leased by another worker.",
			);
		if (current.callStage !== "NOT_STARTED") {
			return finishAiOperationInTransaction(tx, actor, current, {
				status: "INDETERMINATE",
				callStage: "POSSIBLY_SENT",
				safeError: {
					code: "STALE_PENDING_POSSIBLE_SEND",
					message: "Stale pending operation requires explicit reconciliation.",
				},
				errorCategory: "STALE_PENDING",
			});
		}
		const [settings] = await tx
			.select()
			.from(aiGovernanceSettings)
			.where(eq(aiGovernanceSettings.workspaceId, actor.workspaceId))
			.limit(1);
		if (
			!settings ||
			settings.killSwitch ||
			!settings.providerEnabled ||
			!settings.modelEnabled ||
			current.providerId !== "deterministic"
		) {
			throw new AiGovernanceError(
				"AI_PRODUCTION_RELEASE_BLOCKED",
				"Deterministic execution is not authorized by current governance settings.",
			);
		}
		const leaseOwner = randomUUID();
		const [updated] = await tx
			.update(aiOperation)
			.set({
				leaseOwner,
				leaseExpiresAt: new Date(Date.now() + LEASE_TTL_MS),
				attemptCount: current.attemptCount + 1,
				startedAt: current.startedAt ?? new Date(),
				updatedAt: new Date(),
			})
			.where(eq(aiOperation.id, current.id))
			.returning();
		if (!updated) throw new Error("AI operation lease claim returned no row.");
		await audit(tx, actor, {
			operationId: current.id,
			eventType: "LEASE_CLAIMED",
			status: "PENDING",
			correlationId: current.correlationId,
			metadata: { attemptCount: updated.attemptCount },
		});
		return updated;
	});
	if (claimed.status !== "PENDING" || !claimed.leaseOwner)
		return operationRead(claimed);

	const count = (deterministicCallCounts.get(operationId) ?? 0) + 1;
	deterministicCallCounts.set(operationId, count);
	const providerRequestId =
		scenario === "timeout_after_possible_send" ||
		scenario === "network_uncertain" ||
		scenario === "orphan_artifact" ||
		scenario === "db_failure" ||
		scenario === "storage_failure"
			? `det-${operationId}-${count}`
			: scenario === "success"
				? `det-${operationId}-${count}`
				: null;
	const currentRead = await db
		.select()
		.from(aiOperation)
		.where(
			and(
				eq(aiOperation.id, operationId),
				eq(aiOperation.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	const current = currentRead[0];
	if (!current)
		throw new AiGovernanceError(
			"AI_OPERATION_NOT_FOUND",
			"Operation was not found in this workspace.",
		);
	let finish: AiOperationFinishInput;
	if (scenario === "success")
		finish = {
			status: "COMPLETED",
			callStage: "RESPONSE_RECEIVED",
			providerRequestId,
			actualCostMicros: current.estimatedCostMicros,
			inputTokens: current.inputTokens,
			outputTokens: current.outputTokens,
			usage: { provider: "deterministic", simulated: true },
		};
	else if (
		scenario === "definitive_failure" ||
		scenario === "timeout_before_send"
	)
		finish = {
			status: "FAILED",
			callStage: "NOT_STARTED",
			safeError: {
				code:
					scenario === "timeout_before_send"
						? "TIMEOUT_BEFORE_SEND"
						: "DETERMINISTIC_FAILURE",
			},
			errorCategory:
				scenario === "timeout_before_send"
					? "TIMEOUT_BEFORE_SEND"
					: "DEFINITIVE_PROVIDER_ERROR",
		};
	else if (scenario === "orphan_artifact")
		finish = {
			status: "INDETERMINATE",
			callStage: "POSSIBLY_SENT",
			providerRequestId,
			artifactEvidence: {
				artifactId: `artifact-${operationId}`,
				integrityHash: sha256Hex(`artifact:${operationId}`),
				source: "deterministic-test-adapter",
			},
			safeError: {
				code: "DB_FINALIZE_UNAVAILABLE",
				message: "Artifact exists but finalization was interrupted.",
			},
			errorCategory: "ORPHAN_ARTIFACT",
		};
	else
		finish = {
			status: "INDETERMINATE",
			callStage: "POSSIBLY_SENT",
			providerRequestId,
			safeError: {
				code:
					scenario === "storage_failure"
						? "STORAGE_FINALIZE_UNAVAILABLE"
						: scenario === "db_failure"
							? "DB_FINALIZE_UNAVAILABLE"
							: "POSSIBLY_SENT_TIMEOUT",
			},
			errorCategory:
				scenario === "storage_failure"
					? "STORAGE_FAILURE"
					: scenario === "db_failure"
						? "DB_FAILURE"
						: "UNCERTAIN_PROVIDER_RESULT",
		};

	return operationRead(
		await db.transaction(async (tx) => {
			const [locked] = await tx
				.select()
				.from(aiOperation)
				.where(
					and(
						eq(aiOperation.id, operationId),
						eq(aiOperation.workspaceId, actor.workspaceId),
					),
				)
				.limit(1)
				.for("update", { of: aiOperation });
			if (!locked)
				throw new AiGovernanceError(
					"AI_OPERATION_NOT_FOUND",
					"Operation was not found in this workspace.",
				);
			return finishAiOperationInTransaction(tx, actor, locked, finish);
		}),
	);
}

export async function listAiOperations(actor: WorkspaceActor, input?: unknown) {
	const filter = aiOperationFilterSchema.parse(input ?? {});
	const where = [eq(aiOperation.workspaceId, actor.workspaceId)];
	if (filter.projectId) where.push(eq(aiOperation.projectId, filter.projectId));
	if (filter.providerId)
		where.push(eq(aiOperation.providerId, filter.providerId));
	if (filter.status) where.push(eq(aiOperation.status, filter.status));
	if (filter.startDate)
		where.push(
			gte(aiOperation.createdAt, new Date(`${filter.startDate}T00:00:00.000Z`)),
		);
	if (filter.endDate)
		where.push(
			lte(aiOperation.createdAt, new Date(`${filter.endDate}T23:59:59.999Z`)),
		);
	const rows = await db
		.select()
		.from(aiOperation)
		.where(and(...where))
		.orderBy(desc(aiOperation.createdAt))
		.limit(100);
	return rows.map(operationRead);
}

export async function getAiOperation(
	actor: WorkspaceActor,
	operationId: string,
) {
	const [row] = await db
		.select()
		.from(aiOperation)
		.where(
			and(
				eq(aiOperation.id, operationId),
				eq(aiOperation.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!row)
		throw new AiGovernanceError(
			"AI_OPERATION_NOT_FOUND",
			"Operation was not found in this workspace.",
		);
	return operationRead(row);
}

export async function getAllowedAiRecoveryActions(
	actor: WorkspaceActor,
	operationId: string,
) {
	const [row] = await db
		.select()
		.from(aiOperation)
		.where(
			and(
				eq(aiOperation.id, operationId),
				eq(aiOperation.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!row)
		throw new AiGovernanceError(
			"AI_OPERATION_NOT_FOUND",
			"Operation was not found in this workspace.",
		);
	if (row.status === "COMPLETED" || row.status === "FAILED")
		return [] as AiRecoveryAction[];
	const actions: AiRecoveryAction[] = ["RECONCILE", "ACKNOWLEDGE_UNRESOLVED"];
	if (row.artifactEvidenceJson) actions.push("ATTACH_ORPHAN_ARTIFACT");
	if (row.status === "PENDING" && row.callStage === "NOT_STARTED")
		actions.push("MARK_FAILED", "RELEASE_RESERVATION");
	return actions;
}

export async function reconcileAiOperation(
	actor: WorkspaceActor,
	operationId: string,
	action: AiRecoveryAction,
) {
	const parsedAction = aiRecoveryActionSchema.parse(action);
	return operationRead(
		await db.transaction(async (tx) => {
			const [row] = await tx
				.select()
				.from(aiOperation)
				.where(
					and(
						eq(aiOperation.id, operationId),
						eq(aiOperation.workspaceId, actor.workspaceId),
					),
				)
				.limit(1)
				.for("update", { of: aiOperation });
			if (!row)
				throw new AiGovernanceError(
					"AI_OPERATION_NOT_FOUND",
					"Operation was not found in this workspace.",
				);
			if (row.status === "COMPLETED" || row.status === "FAILED") return row;
			const hasArtifact = Boolean(row.artifactEvidenceJson);
			if (parsedAction === "ATTACH_ORPHAN_ARTIFACT" && !hasArtifact)
				throw new AiGovernanceError(
					"AI_RECOVERY_NOT_ALLOWED",
					"No server-recorded orphan artifact is available.",
				);
			if (
				(parsedAction === "MARK_FAILED" ||
					parsedAction === "RELEASE_RESERVATION") &&
				row.callStage !== "NOT_STARTED"
			)
				throw new AiGovernanceError(
					"AI_RECOVERY_NOT_ALLOWED",
					"Possible provider send cannot be released or marked failed blindly.",
				);
			if (
				parsedAction === "ATTACH_ORPHAN_ARTIFACT" ||
				(parsedAction === "RECONCILE" && hasArtifact)
			)
				return finishAiOperationInTransaction(
					tx,
					actor,
					row,
					{
						status: "COMPLETED",
						callStage: "FINALIZED",
						providerRequestId: row.providerRequestId,
						actualCostMicros: row.estimatedCostMicros,
						artifactEvidence: row.artifactEvidenceJson,
						usage: row.usageJson,
					},
					true,
				);
			if (
				parsedAction === "MARK_FAILED" ||
				parsedAction === "RELEASE_RESERVATION" ||
				(parsedAction === "RECONCILE" && row.callStage === "NOT_STARTED")
			)
				return finishAiOperationInTransaction(tx, actor, row, {
					status: "FAILED",
					callStage: "FINALIZED",
					safeError: row.safeErrorJson ?? {
						code: "EXPLICIT_RECOVERY_MARK_FAILED",
					},
					errorCategory: "EXPLICIT_RECOVERY",
				});
			await tx.insert(aiReconciliation).values({
				id: randomUUID(),
				workspaceId: actor.workspaceId,
				operationId: row.id,
				action: parsedAction,
				outcome: "UNRESOLVED",
				evidenceJson: safeObject({
					status: row.status,
					callStage: row.callStage,
				}),
				createdByUserId: actor.userId,
			});
			await audit(tx, actor, {
				operationId: row.id,
				eventType: "RECOVERY_UNRESOLVED",
				status: row.status,
				correlationId: row.correlationId,
				providerRequestId: row.providerRequestId,
				metadata: { action: parsedAction },
			});
			return row;
		}),
	);
}

export function getAiReleaseGateStatus() {
	return {
		registryServerOwned: true,
		capabilityMapping: true,
		pricingVersioned: true,
		preCallEstimate: true,
		atomicBudgetReservation: true,
		concurrencySafe: true,
		secretsRedacted: true,
		correlationAudit: true,
		canonicalHashIdempotency: true,
		pendingLease: true,
		uncertaintyAndRecovery: true,
		crossWorkspaceScoped: true,
		paidExecutionReleased: false,
		futureUs28ReleaseGate: "BLOCKED_UNTIL_EXPLICIT_PROVIDER_RELEASE" as const,
	};
}

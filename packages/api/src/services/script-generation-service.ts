import { randomUUID } from "node:crypto";
import {
	aiSettingsSchema,
	channelSettingsSchema,
	defaultOutputRules,
	evaluateFactGenerationUsability,
	isUsableMediaMetadata,
	mediaMetadataSchema,
	ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
	ORGANIC_SCRIPT_PROMPT_VERSION,
	ORGANIC_SCRIPT_SNAPSHOT_VERSION,
	outputRulesSchema,
	resolveBusinessToday,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
	SCRIPT_PROMPT_VERSION,
	SCRIPT_SNAPSHOT_VERSION,
	ScriptGenerationError,
	type ScriptOutputValidation,
	scriptGenerationSections,
	validateOrganicScriptDraftOutput,
	validateRepairOrganicScriptOutput,
	validateRepairScriptOutput,
	validateScriptDraftOutput,
} from "@affichannel/core";
import type {
	ProductFactSourceType,
	ProductFactStatus,
	ProductFactType,
} from "@affichannel/core/product-fact/types";
import { canonicalizeJson } from "@affichannel/core/script-generation/canonical-json";
import type {
	ChannelSettings,
	MediaMetadataSnapshot,
} from "@affichannel/core/script-generation/input-contract";
import type {
	PartialScriptDraft,
	ScriptGenerationArtifact,
	ScriptGenerationContext,
	ScriptGenerationFactSnapshot,
	ScriptGenerationInputSnapshot,
	ScriptGenerationMode,
	ScriptGenerationReadModel,
	ScriptGenerationSection,
} from "@affichannel/core/script-generation/types";
import {
	aiSettings,
	channelSettings,
	contentBrief,
	db,
	factDependency,
	mediaMetadata,
	outputRules,
	product,
	productFact,
	project,
	scriptGeneration,
} from "@affichannel/db";
import { env } from "@affichannel/env/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
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
import { sha256Hex } from "./script-generation-hashing";
import {
	findScriptGeneration,
	findScriptGenerationByIdempotencyKey,
	findScriptGenerationInTransaction,
	listScriptGenerationReadModel,
	toScriptGenerationArtifact,
} from "./script-generation-repository";
import { canonicalPrompt, renderScriptPrompt } from "./script-prompt";
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

export async function resolveServerGenerationConfig(
	actor: WorkspaceActor,
): Promise<Required<ServerGenerationConfig>> {
	const [settings] = await db
		.select({
			textProvider: aiSettings.textProvider,
			textModel: aiSettings.textModel,
		})
		.from(aiSettings)
		.where(eq(aiSettings.workspaceId, actor.workspaceId))
		.limit(1);
	const parsed = aiSettingsSchema.safeParse(settings);
	if (!settings) {
		return {
			provider: env.TEXT_AI_DEFAULT_PROVIDER,
			model: env.TEXT_AI_DEFAULT_MODEL,
			promptVersion: SCRIPT_PROMPT_VERSION,
			outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		};
	}
	if (!parsed.success) {
		throw new ScriptGenerationError(
			"TEXT_PROVIDER_NOT_CONFIGURED",
			"Text provider and model must be configured on the server.",
		);
	}
	return {
		provider: parsed.data.textProvider,
		model: parsed.data.textModel,
		promptVersion: SCRIPT_PROMPT_VERSION,
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
	};
}

function sortedSections(sections: ScriptGenerationSection[]) {
	return [...new Set(sections)].sort(
		(a, b) =>
			scriptGenerationSections.indexOf(a) - scriptGenerationSections.indexOf(b),
	);
}

function normalizeClientGenerationIntent(
	input: ClientGenerationIntent,
): ClientGenerationIntent {
	const projectId = input.projectId.trim();
	const idempotencyKey = input.idempotencyKey.trim();
	const parentGenerationId = input.parentGenerationId?.trim() || undefined;
	const repairSections = sortedSections(input.repairSections ?? []);
	return input.mode === "repair"
		? {
				projectId,
				idempotencyKey,
				mode: input.mode,
				parentGenerationId,
				repairSections,
			}
		: {
				projectId,
				idempotencyKey,
				mode: input.mode,
				parentGenerationId: undefined,
				repairSections: [],
			};
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
		throw new ScriptGenerationError(
			"IDEMPOTENCY_CONFLICT",
			"Idempotency key must be between 8 and 200 characters.",
		);
	}
	if (!normalized.projectId) {
		throw new ScriptGenerationError(
			"GENERATION_NOT_FOUND",
			"Project was not found in this workspace.",
		);
	}
	if (normalized.mode === "repair") {
		const requested = input.repairSections ?? [];
		if (!normalized.parentGenerationId || requested.length === 0) {
			throw new ScriptGenerationError(
				"INVALID_REPAIR_SECTIONS",
				"Repair requires a parent generation and at least one section.",
			);
		}
		if (
			requested.some(
				(section) => !scriptGenerationSections.includes(section),
			) ||
			new Set(requested).size !== requested.length
		) {
			throw new ScriptGenerationError(
				"INVALID_REPAIR_SECTIONS",
				"Repair sections must be known and unique.",
			);
		}
	} else if (
		input.parentGenerationId ||
		(input.repairSections && input.repairSections.length > 0)
	) {
		throw new ScriptGenerationError(
			"GENERATION_INVALID_TRANSITION",
			"Full generation cannot include repair parameters.",
		);
	}
	return { idempotencyKey, intent: normalized };
}

type ScriptGenerationSource =
	| {
			kind: "affiliate";
			productId: string;
			productName: string;
			productCategory: string | null;
	  }
	| { kind: "organic" };

function createSnapshot(
	projectRecord: {
		id: string;
		name: string;
		platform: string;
		goal: string;
		durationSeconds: number;
		angle: string;
		description: string | null;
		contentType: string;
		creationPath: string;
		contentFormatKey: string;
		contentFormatVersion: number;
		projectProductId: string | null;
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
	}>,
	today: string,
	request: ScriptGenerationInputSnapshot["request"],
	channelSettings: ChannelSettings,
	mediaSnapshots: MediaMetadataSnapshot[],
	outputRulesValue: ScriptGenerationInputSnapshot["outputRules"],
	config: Required<ScriptGenerationProviderConfig>,
	source: ScriptGenerationSource,
): ScriptGenerationInputSnapshot {
	const usableFacts = facts.flatMap((fact) => {
		const evaluated = evaluateDbFact(fact, today);
		if (evaluated.usability === "blocked") return [];
		return [
			{
				id: fact.id,
				revision: fact.revision,
				content: fact.content,
				type: fact.type as ScriptGenerationFactSnapshot["type"],
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
	const common = {
		request,
		project: {
			id: projectRecord.id,
			name: projectRecord.name,
			...(source.kind === "organic"
				? {
						contentType: "ORGANIC" as const,
						creationPath: "SCRIPTED" as const,
						contentFormat: "SCRIPTED_STANDARD" as const,
						contentFormatVersion: 1 as const,
					}
				: {}),
		},
		contentBrief: {
			platform: projectRecord.platform as "tiktok",
			goal: projectRecord.goal,
			durationSeconds: projectRecord.durationSeconds,
			angle: projectRecord.angle,
			description: normalizeDescription(projectRecord.description),
		},
		channelSettings,
		mediaMetadata: mediaSnapshots,
		outputRules: outputRulesValue,
		generationConfig: {
			textProvider: config.provider,
			textModel: config.model,
			promptVersion: config.promptVersion,
			outputSchemaVersion: config.outputSchemaVersion,
		},
		facts: usableFacts,
	};
	if (source.kind === "organic") {
		const { facts: _facts, ...organic } = common;
		return {
			...organic,
			snapshotVersion: ORGANIC_SCRIPT_SNAPSHOT_VERSION,
			sourceMode: "ORGANIC_NO_PRODUCT" as const,
			generationConfig: {
				...common.generationConfig,
				promptVersion: ORGANIC_SCRIPT_PROMPT_VERSION,
				outputSchemaVersion: ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
			},
		} as ScriptGenerationInputSnapshot;
	}
	return {
		...common,
		snapshotVersion: SCRIPT_SNAPSHOT_VERSION,
		product: {
			id: source.productId,
			name: source.productName,
			category: source.productCategory,
		},
	} as ScriptGenerationInputSnapshot;
}

async function prepareInTransaction(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	actor: WorkspaceActor,
	input: PrepareScriptGenerationInput,
	config: Required<ScriptGenerationProviderConfig>,
	requestHash: string,
	idempotencyKey: string,
	options: { persist?: boolean } = {},
) {
	const [projectRecord] = await transaction
		.select({
			id: project.id,
			name: project.name,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			projectProductId: project.productId,
			platform: contentBrief.platform,
			goal: contentBrief.goal,
			durationSeconds: contentBrief.durationSeconds,
			angle: contentBrief.angle,
			description: contentBrief.description,
		})
		.from(project)
		.innerJoin(contentBrief, eq(contentBrief.projectId, project.id))
		.where(
			and(
				eq(project.id, input.projectId),
				eq(project.workspaceId, actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: project });
	if (!projectRecord)
		throw new ScriptGenerationError(
			"GENERATION_NOT_FOUND",
			"Project was not found in this workspace.",
		);
	if (
		projectRecord.contentType === "AFFILIATE" &&
		projectRecord.projectProductId === null
	)
		throw new ScriptGenerationError(
			"GENERATION_NOT_FOUND",
			"Project was not found in this workspace.",
		);
	let source: ScriptGenerationSource;
	if (
		projectRecord.contentType === "ORGANIC" &&
		projectRecord.creationPath === "SCRIPTED" &&
		projectRecord.contentFormatKey === "SCRIPTED_STANDARD" &&
		projectRecord.contentFormatVersion === 1 &&
		projectRecord.projectProductId === null
	) {
		source = { kind: "organic" };
	} else if (
		projectRecord.contentType === "AFFILIATE" &&
		projectRecord.creationPath === "SCRIPTED" &&
		projectRecord.contentFormatKey === "SCRIPTED_STANDARD" &&
		projectRecord.contentFormatVersion === 1 &&
		projectRecord.projectProductId !== null
	) {
		const [productRecord] = await transaction
			.select({
				id: product.id,
				name: product.name,
				category: product.category,
			})
			.from(product)
			.where(
				and(
					eq(product.id, projectRecord.projectProductId),
					eq(product.workspaceId, actor.workspaceId),
				),
			)
			.limit(1);
		if (!productRecord)
			throw new ScriptGenerationError(
				"GENERATION_NOT_FOUND",
				"Project was not found in this workspace.",
			);
		source = {
			kind: "affiliate",
			productId: productRecord.id,
			productName: productRecord.name,
			productCategory: productRecord.category,
		};
	} else {
		throw new ScriptGenerationError(
			"ORGANIC_SOURCE_NOT_SUPPORTED",
			"This project identity is not supported by the ScriptGeneration runtime.",
		);
	}
	const effectiveConfig =
		source.kind === "organic"
			? {
					...config,
					promptVersion: ORGANIC_SCRIPT_PROMPT_VERSION,
					outputSchemaVersion: ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
				}
			: config;
	const facts =
		source.kind === "affiliate"
			? await transaction
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
					.where(
						and(
							eq(productFact.workspaceId, actor.workspaceId),
							eq(productFact.productId, source.productId),
						),
					)
					.orderBy(productFact.id)
					.for("update", { of: productFact })
			: [];

	const [channelSettingsRecord] = await transaction
		.select()
		.from(channelSettings)
		.where(eq(channelSettings.workspaceId, actor.workspaceId))
		.limit(1);
	const parsedChannelSettings = channelSettingsSchema.safeParse(
		channelSettingsRecord
			? {
					niche: channelSettingsRecord.niche,
					targetAudience: channelSettingsRecord.targetAudience,
					tone: channelSettingsRecord.tone,
					contentPillar: channelSettingsRecord.contentPillar,
					defaultCta: channelSettingsRecord.defaultCta,
					affiliateDisclosure: channelSettingsRecord.affiliateDisclosure,
					avoidWords: channelSettingsRecord.avoidWords,
				}
			: undefined,
	);
	if (!parsedChannelSettings.success) {
		throw new ScriptGenerationError(
			"CHANNEL_SETTINGS_INCOMPLETE",
			"Channel Settings must be complete before generation.",
		);
	}

	const mediaRecords = await transaction
		.select()
		.from(mediaMetadata)
		.where(
			and(
				eq(mediaMetadata.workspaceId, actor.workspaceId),
				eq(mediaMetadata.projectId, input.projectId),
			),
		)
		.orderBy(mediaMetadata.id);
	const mediaSnapshots = mediaRecords.flatMap((record) => {
		const parsed = mediaMetadataSchema.safeParse({
			id: record.id,
			mediaType: record.mediaType,
			aspectRatio: record.aspectRatio,
			durationSeconds: record.durationSeconds,
			usageRights: record.usageRights,
			status: record.status,
			sceneSuitability: record.sceneSuitability,
			tags: record.tags,
			reference: {
				displayName: record.displayName,
				referenceUrl: record.referenceUrl,
			},
		});
		return parsed.success && isUsableMediaMetadata(parsed.data)
			? [parsed.data]
			: [];
	});
	const [outputRulesRecord] = await transaction
		.select()
		.from(outputRules)
		.where(eq(outputRules.workspaceId, actor.workspaceId))
		.limit(1);
	const parsedOutputRules = outputRulesSchema.safeParse(
		outputRulesRecord
			? {
					language: outputRulesRecord.language,
					aspectRatio: outputRulesRecord.aspectRatio,
					subtitleSafeArea: outputRulesRecord.subtitleSafeArea,
					claimLimit: outputRulesRecord.claimLimit,
					requireFinalCta: outputRulesRecord.requireFinalCta,
				}
			: defaultOutputRules,
	);
	if (!parsedOutputRules.success) {
		throw new ScriptGenerationError(
			"CHANNEL_SETTINGS_INCOMPLETE",
			"Output Rules are invalid or incomplete.",
		);
	}

	const today = resolveBusinessToday();
	let parentOutput: PartialScriptDraft | null = null;
	let parentValidSections: ScriptGenerationSection[] = [];
	let parentInvalidSections: ScriptGenerationSection[] = [];
	if (input.mode === "repair" && input.parentGenerationId) {
		const parent = await findScriptGenerationInTransaction(
			transaction,
			actor,
			input.parentGenerationId,
		);
		if (
			!parent ||
			parent.projectId !== input.projectId ||
			parent.status !== "partial" ||
			!parent.outputJson
		) {
			throw new ScriptGenerationError(
				"GENERATION_INVALID_TRANSITION",
				"Repair parent must be a usable partial generation.",
			);
		}
		const parentSnapshot =
			parent.inputSnapshotJson as ScriptGenerationInputSnapshot;
		const parentIsOrganic =
			parentSnapshot.snapshotVersion === ORGANIC_SCRIPT_SNAPSHOT_VERSION &&
			parentSnapshot.sourceMode === "ORGANIC_NO_PRODUCT";
		if ((source.kind === "organic") !== parentIsOrganic) {
			throw new ScriptGenerationError(
				"GENERATION_INVALID_TRANSITION",
				"Repair cannot switch between Organic and Affiliate source modes.",
			);
		}
		const requestedSections = input.repairSections ?? [];
		const invalidSections = parent.invalidSections as ScriptGenerationSection[];
		if (
			requestedSections.length === 0 ||
			new Set(requestedSections).size !== requestedSections.length ||
			requestedSections.some((section) => !invalidSections.includes(section))
		) {
			throw new ScriptGenerationError(
				"INVALID_REPAIR_SECTIONS",
				"Repair sections must be a unique subset of the parent invalid sections.",
			);
		}
		const invalidated = await transaction
			.select({ id: factDependency.id })
			.from(factDependency)
			.where(
				and(
					eq(factDependency.workspaceId, actor.workspaceId),
					eq(factDependency.dependentType, "script_generation"),
					eq(factDependency.dependentId, input.parentGenerationId),
					isNotNull(factDependency.invalidatedAt),
				),
			)
			.limit(1);
		if (invalidated.length > 0)
			throw new ScriptGenerationError(
				"BASE_GENERATION_INVALIDATED",
				"Repair parent depends on invalidated Product Facts.",
			);
		parentOutput = parent.outputJson as PartialScriptDraft;
		parentValidSections = parent.validSections as ScriptGenerationSection[];
		parentInvalidSections = invalidSections;
	}

	const snapshot = createSnapshot(
		projectRecord,
		facts,
		today,
		{
			mode: input.mode,
			repair:
				input.mode === "repair"
					? {
							parentGenerationId: input.parentGenerationId as string,
							sections: sortedSections(input.repairSections ?? []),
							baseOutput: parentOutput as PartialScriptDraft,
							baseValidSections: parentValidSections,
							baseInvalidSections: parentInvalidSections,
						}
					: null,
		},
		parsedChannelSettings.data,
		mediaSnapshots,
		parsedOutputRules.data,
		effectiveConfig,
		source,
	);
	if (
		new TextEncoder().encode(canonicalizeJson(snapshot)).byteLength >
		128 * 1024
	) {
		throw new ScriptGenerationError(
			"INVALID_GENERATION_OUTPUT",
			"Generation input snapshot is too large.",
		);
	}
	if (
		source.kind === "affiliate" &&
		snapshot.snapshotVersion === SCRIPT_SNAPSHOT_VERSION &&
		(snapshot.facts ?? []).length === 0
	)
		throw new ScriptGenerationError(
			"NO_USABLE_PRODUCT_FACTS",
			"No verified, eligible Product Facts are available for generation.",
		);

	const prompt = renderScriptPrompt(snapshot);
	const inputHash = sha256Hex(snapshot);
	const promptHash = sha256Hex(canonicalPrompt(prompt));
	if (options.persist === false) return { snapshot, inputHash, promptHash };
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
			provider: effectiveConfig.provider,
			model: effectiveConfig.model,
			promptVersion: effectiveConfig.promptVersion,
			outputSchemaVersion: effectiveConfig.outputSchemaVersion,
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
			return evaluated.usability === "blocked"
				? []
				: [{ id: fact.id, revision: fact.revision }];
		}),
	});
	return created;
}

export async function buildScriptGenerationPreview(
	actor: WorkspaceActor,
	input: PrepareScriptGenerationInput,
	serverConfig: ServerGenerationConfig,
) {
	const { idempotencyKey, intent } = assertPreparationInput(input);
	const requestHash = hashClientGenerationIntent(intent);
	const preview = await db.transaction((transaction) =>
		prepareInTransaction(
			transaction,
			actor,
			intent,
			serverConfig,
			requestHash,
			idempotencyKey,
			{ persist: false },
		),
	);
	if (!preview || !("snapshot" in preview))
		throw new ScriptGenerationError(
			"GENERATION_INVALID_TRANSITION",
			"Generation preview could not be built.",
		);
	return preview;
}

export async function prepareScriptGeneration(
	actor: WorkspaceActor,
	input: PrepareScriptGenerationInput,
	serverConfig: ServerGenerationConfig,
) {
	const { idempotencyKey, intent } = assertPreparationInput(input);
	const config: ScriptGenerationProviderConfig = serverConfig;
	const requestHash = hashClientGenerationIntent(intent);
	const existing = await findScriptGenerationByIdempotencyKey(
		actor,
		idempotencyKey,
	);
	if (existing) {
		if (existing.requestHash !== requestHash)
			throw new ScriptGenerationError(
				"IDEMPOTENCY_CONFLICT",
				"Idempotency key was already used for a different request.",
			);
		return existing;
	}

	const created = await db.transaction(
		(transaction) =>
			prepareInTransaction(
				transaction,
				actor,
				intent,
				config,
				requestHash,
				idempotencyKey,
				{ persist: true },
			) as Promise<typeof scriptGeneration.$inferSelect | undefined>,
	);
	if (created) return toScriptGenerationArtifact(created);

	const retry = await findScriptGenerationByIdempotencyKey(
		actor,
		idempotencyKey,
	);
	if (retry) {
		if (retry.requestHash !== requestHash)
			throw new ScriptGenerationError(
				"IDEMPOTENCY_CONFLICT",
				"Idempotency key was already used for a different request.",
			);
		return retry;
	}
	const pending = await import("./script-generation-repository").then(
		({ findPendingScriptGeneration }) =>
			findPendingScriptGeneration(actor, intent.projectId),
	);
	if (pending)
		throw new ScriptGenerationError(
			"GENERATION_ALREADY_IN_PROGRESS",
			"A generation is already pending for this project.",
		);
	throw new ScriptGenerationError(
		"GENERATION_INVALID_TRANSITION",
		"Generation could not be created.",
	);
}

type FinalizeSuccess = { kind: "success"; result: TextProviderResult };
type FinalizeFailure = {
	kind: "failure";
	code:
		| "TEXT_PROVIDER_NOT_CONFIGURED"
		| "AI_TIMEOUT"
		| "AI_TIMEOUT_UNCERTAIN"
		| "AI_PROVIDER_UNCERTAIN"
		| "AI_REQUEST_STATE_UNCERTAIN"
		| "AI_PROVIDER_ERROR"
		| "AI_INVALID_OUTPUT"
		| "TEXT_PROVIDER_UNAVAILABLE"
		| "COST_ESTIMATE_UNAVAILABLE"
		| "GENERATION_INDETERMINATE";
};

const truncatedFinishReasons = new Set([
	"max_tokens",
	"max_output_tokens",
	"length",
]);

export function isTruncatedTextProviderFinishReason(
	finishReason: string | null | undefined,
) {
	return Boolean(
		finishReason &&
			truncatedFinishReasons.has(finishReason.trim().toLowerCase()),
	);
}

export function persistedScriptValidationErrorCode(
	validation: ScriptOutputValidation,
) {
	if (validation.errorCode !== "INVALID_GENERATION_OUTPUT")
		return validation.errorCode;
	const diagnostic = validation.issueCodes.join(",");
	return diagnostic ? `AI_INVALID_OUTPUT:${diagnostic}` : "AI_INVALID_OUTPUT";
}

export function evaluateFullScriptGenerationResult(
	result: TextProviderResult,
	snapshot: ScriptGenerationInputSnapshot,
) {
	if (isTruncatedTextProviderFinishReason(result.finishReason)) {
		return {
			status: "failed" as const,
			output: null,
			validSections: [] as ScriptGenerationSection[],
			invalidSections: [...scriptGenerationSections],
			errorCode: "AI_OUTPUT_TRUNCATED",
		};
	}
	const validation =
		snapshot.snapshotVersion === ORGANIC_SCRIPT_SNAPSHOT_VERSION
			? validateOrganicScriptDraftOutput(
					result.content,
					snapshot.contentBrief.durationSeconds,
					snapshot.outputRules.claimLimit,
					{
						expectedLanguage: snapshot.outputRules.language,
						requiredDisclosure: null,
						avoidWords: snapshot.channelSettings.avoidWords,
					},
				)
			: validateScriptDraftOutput(
					result.content,
					snapshot.contentBrief.durationSeconds,
					snapshot.outputRules.claimLimit,
					{
						expectedLanguage: snapshot.outputRules.language,
						requiredDisclosure: snapshot.channelSettings.affiliateDisclosure,
						avoidWords: snapshot.channelSettings.avoidWords,
					},
				);
	return {
		status: validation.status,
		output: validation.output,
		validSections: validation.validSections,
		invalidSections: validation.invalidSections,
		errorCode: persistedScriptValidationErrorCode(validation),
	};
}

function scriptSectionOutputKey(section: ScriptGenerationSection) {
	return section === "hook"
		? "hookVariants"
		: section === "voiceover"
			? "voiceoverSegments"
			: section;
}

function getScriptSectionValue(
	output: PartialScriptDraft,
	section: ScriptGenerationSection,
) {
	return (output as Record<string, unknown>)[scriptSectionOutputKey(section)];
}

export function mergeRepairScriptOutput(
	parentOutput: PartialScriptDraft,
	parentValidSections: ScriptGenerationSection[],
	repairSections: ScriptGenerationSection[],
	repairOutput: PartialScriptDraft,
) {
	if (
		repairOutput.schemaVersion !== parentOutput.schemaVersion ||
		repairOutput.language !== parentOutput.language
	)
		return null;

	const merged: PartialScriptDraft = {
		schemaVersion: parentOutput.schemaVersion,
		language: parentOutput.language,
	};
	for (const section of scriptGenerationSections) {
		const value = getScriptSectionValue(parentOutput, section);
		if (value !== undefined)
			(merged as Record<string, unknown>)[scriptSectionOutputKey(section)] =
				value;
	}
	for (const section of repairSections) {
		const value = getScriptSectionValue(repairOutput, section);
		if (value === undefined) return null;
		(merged as Record<string, unknown>)[scriptSectionOutputKey(section)] =
			value;
	}
	return {
		output: merged,
		preservedSections: parentValidSections.filter(
			(section) => !repairSections.includes(section),
		),
	};
}

function buildProviderRequest(generation: ScriptGenerationArtifact) {
	const prompt = renderScriptPrompt(generation.inputSnapshot);
	return {
		messages: [
			{ role: "system" as const, content: prompt.trustedInstructions },
			{ role: "developer" as const, content: prompt.outputSchema },
			{ role: "user" as const, content: prompt.untrustedInputData },
		],
		model: generation.model,
		mode: generation.mode,
		sections: generation.inputSnapshot.request.repair?.sections ?? [
			...scriptGenerationSections,
		],
		idempotencyKey: generation.idempotencyKey,
	};
}

export async function estimateScriptGenerationInput(
	snapshot: ScriptGenerationInputSnapshot,
	config: Required<ServerGenerationConfig>,
	provider: TextProvider,
) {
	const prompt = renderScriptPrompt(snapshot);
	const estimate = await provider.estimateCost({
		messages: [
			{ role: "system", content: prompt.trustedInstructions },
			{ role: "developer", content: prompt.outputSchema },
			{ role: "user", content: prompt.untrustedInputData },
		],
		model: config.model,
		mode: snapshot.request.mode,
		sections: snapshot.request.repair?.sections ?? [
			...scriptGenerationSections,
		],
	});
	if (estimate.estimatedCostMicros === null || !estimate.currency) {
		throw new ScriptGenerationError(
			"COST_ESTIMATE_UNAVAILABLE",
			"Provider did not return a cost estimate.",
		);
	}
	return estimate;
}

export async function estimatePreparedScriptGeneration(
	generation: ScriptGenerationArtifact,
	provider: TextProvider,
): Promise<TextProviderEstimate> {
	try {
		const estimate = await provider.estimateCost(
			buildProviderRequest(generation),
		);
		if (estimate.estimatedCostMicros === null || !estimate.currency) {
			throw new ScriptGenerationError(
				"COST_ESTIMATE_UNAVAILABLE",
				"Provider did not return a cost estimate.",
			);
		}
		return estimate;
	} catch (error) {
		if (error instanceof ScriptGenerationError) throw error;
		throw new ScriptGenerationError(
			"COST_ESTIMATE_UNAVAILABLE",
			"Cost estimate is unavailable.",
		);
	}
}

export async function recordScriptGenerationEstimate(
	actor: WorkspaceActor,
	generationId: string,
	estimate: TextProviderEstimate,
) {
	const [row] = await db
		.update(scriptGeneration)
		.set({
			estimatedCostMicros: estimate.estimatedCostMicros,
			currency: estimate.currency,
		})
		.where(
			and(
				eq(scriptGeneration.id, generationId),
				eq(scriptGeneration.workspaceId, actor.workspaceId),
				eq(scriptGeneration.status, "pending"),
			),
		)
		.returning();
	if (!row)
		throw new ScriptGenerationError(
			"GENERATION_NOT_FOUND",
			"Generation was not found in this workspace.",
		);
	return toScriptGenerationArtifact(row);
}

export async function finalizeScriptGeneration(
	actor: WorkspaceActor,
	input: { generationId: string; outcome: FinalizeSuccess | FinalizeFailure },
) {
	return db.transaction(async (transaction) => {
		const row = await findScriptGenerationInTransaction(
			transaction,
			actor,
			input.generationId,
			{ lock: true },
		);
		if (!row)
			throw new ScriptGenerationError(
				"GENERATION_NOT_FOUND",
				"Generation was not found in this workspace.",
			);
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
			if (
				input.outcome.code === "GENERATION_INDETERMINATE" ||
				input.outcome.code === "AI_TIMEOUT_UNCERTAIN" ||
				input.outcome.code === "AI_REQUEST_STATE_UNCERTAIN"
			)
				status = "indeterminate";
			errorCode = input.outcome.code;
			invalidSections = [...scriptGenerationSections];
		} else {
			const result = input.outcome.result;
			const snapshot = row.inputSnapshotJson as ScriptGenerationInputSnapshot;
			let organicIdentityStillCurrent = true;
			if (snapshot.snapshotVersion === ORGANIC_SCRIPT_SNAPSHOT_VERSION) {
				const [currentOrganicProject] = await transaction
					.select({
						contentType: project.contentType,
						creationPath: project.creationPath,
						contentFormatKey: project.contentFormatKey,
						contentFormatVersion: project.contentFormatVersion,
						productId: project.productId,
					})
					.from(project)
					.where(
						and(
							eq(project.id, row.projectId),
							eq(project.workspaceId, actor.workspaceId),
							eq(project.contentType, "ORGANIC"),
							eq(project.creationPath, "SCRIPTED"),
							eq(project.contentFormatKey, "SCRIPTED_STANDARD"),
							eq(project.contentFormatVersion, 1),
							isNull(project.productId),
						),
					)
					.limit(1);
				organicIdentityStillCurrent = Boolean(currentOrganicProject);
			}
			const validationOptions = {
				expectedLanguage: snapshot.outputRules.language,
				requiredDisclosure:
					snapshot.snapshotVersion === ORGANIC_SCRIPT_SNAPSHOT_VERSION
						? null
						: snapshot.channelSettings.affiliateDisclosure,
				avoidWords: snapshot.channelSettings.avoidWords,
			};
			if (!organicIdentityStillCurrent) {
				status = "failed";
				invalidSections = [...scriptGenerationSections];
				errorCode = "ORGANIC_SOURCE_NOT_SUPPORTED";
			} else if (row.mode === "full") {
				const decision = evaluateFullScriptGenerationResult(result, snapshot);
				status = decision.status;
				outputJson = decision.output;
				validSections = decision.validSections;
				invalidSections = decision.invalidSections;
				errorCode = decision.errorCode;
			} else if (snapshot.request.repair) {
				let validation =
					snapshot.snapshotVersion === ORGANIC_SCRIPT_SNAPSHOT_VERSION
						? validateOrganicScriptDraftOutput(
								result.content,
								snapshot.contentBrief.durationSeconds,
								snapshot.outputRules.claimLimit,
								validationOptions,
							)
						: validateScriptDraftOutput(
								result.content,
								snapshot.contentBrief.durationSeconds,
								snapshot.outputRules.claimLimit,
								validationOptions,
							);
				if (isTruncatedTextProviderFinishReason(result.finishReason)) {
					validation = {
						status: "failed",
						output: null,
						validSections: [],
						invalidSections: [...scriptGenerationSections],
						errorCode: "INVALID_GENERATION_OUTPUT",
						issueCodes: ["REPAIR_OUTPUT_INVALID"],
					};
					errorCode = "AI_OUTPUT_TRUNCATED";
				} else {
					const repairValidation =
						snapshot.snapshotVersion === ORGANIC_SCRIPT_SNAPSHOT_VERSION
							? validateRepairOrganicScriptOutput(
									result.content,
									snapshot.request.repair.sections,
									snapshot.outputRules.claimLimit,
									validationOptions,
								)
							: validateRepairScriptOutput(
									result.content,
									snapshot.request.repair.sections,
									snapshot.outputRules.claimLimit,
									validationOptions,
								);
					if (repairValidation.success && repairValidation.output) {
						const parentValidSections =
							snapshot.request.repair.baseValidSections ??
							scriptGenerationSections.filter(
								(section) =>
									getScriptSectionValue(
										snapshot.request.repair?.baseOutput as PartialScriptDraft,
										section,
									) !== undefined,
							);
						const mergedRepair = mergeRepairScriptOutput(
							snapshot.request.repair.baseOutput,
							parentValidSections,
							snapshot.request.repair.sections,
							repairValidation.output,
						);
						if (!mergedRepair) {
							validation = {
								status: "failed",
								output: null,
								validSections: [],
								invalidSections: [...scriptGenerationSections],
								errorCode: "INVALID_GENERATION_OUTPUT",
								issueCodes: ["REPAIR_MERGE_INVALID"],
							};
						} else {
							const mergedValidation =
								snapshot.snapshotVersion === ORGANIC_SCRIPT_SNAPSHOT_VERSION
									? validateOrganicScriptDraftOutput(
											mergedRepair.output,
											snapshot.contentBrief.durationSeconds,
											snapshot.outputRules.claimLimit,
											validationOptions,
										)
									: validateScriptDraftOutput(
											mergedRepair.output,
											snapshot.contentBrief.durationSeconds,
											snapshot.outputRules.claimLimit,
											validationOptions,
										);
							const preservedContent = mergedRepair.preservedSections.every(
								(section) => {
									const mergedValue = getScriptSectionValue(
										mergedRepair.output,
										section,
									);
									const parentValue = getScriptSectionValue(
										snapshot.request.repair?.baseOutput as PartialScriptDraft,
										section,
									);
									return (
										mergedValidation.validSections.includes(section) &&
										mergedValue !== undefined &&
										parentValue !== undefined &&
										canonicalizeJson(mergedValue) ===
											canonicalizeJson(parentValue)
									);
								},
							);
							const repairedSectionsValid =
								snapshot.request.repair.sections.every((section) =>
									mergedValidation.validSections.includes(section),
								);
							validation =
								preservedContent &&
								repairedSectionsValid &&
								mergedValidation.status !== "failed"
									? mergedValidation
									: {
											status: "failed",
											output: null,
											validSections: [],
											invalidSections: [...scriptGenerationSections],
											errorCode: "INVALID_GENERATION_OUTPUT",
											issueCodes: ["REPAIR_RESULT_INVALID"],
										};
						}
					} else {
						validation = {
							status: "failed",
							output: null,
							validSections: [],
							invalidSections: [...scriptGenerationSections],
							errorCode: "INVALID_GENERATION_OUTPUT",
							issueCodes: ["REPAIR_OUTPUT_INVALID"],
						};
					}
				}
				status = validation.status;
				outputJson = validation.output;
				validSections = validation.validSections;
				invalidSections = validation.invalidSections;
				if (!errorCode)
					errorCode = persistedScriptValidationErrorCode(validation);
			} else {
				status = "failed";
				invalidSections = [...scriptGenerationSections];
				errorCode = "AI_INVALID_OUTPUT:REPAIR_OUTPUT_INVALID";
			}
			providerRequestId = result.providerRequestId;
			inputTokens = result.inputTokens;
			outputTokens = result.outputTokens;
			estimatedCostMicros = result.estimatedCostMicros;
			actualCostMicros = result.actualCostMicros;
			currency = result.currency;
		}
		await transaction
			.update(scriptGeneration)
			.set({
				status,
				outputJson,
				validSections,
				invalidSections,
				providerRequestId,
				inputTokens,
				outputTokens,
				estimatedCostMicros,
				actualCostMicros,
				currency,
				errorCode,
				finishedAt,
			})
			.where(
				and(
					eq(scriptGeneration.id, row.id),
					eq(scriptGeneration.workspaceId, actor.workspaceId),
					eq(scriptGeneration.status, "pending"),
				),
			);
		if (status === "failed") {
			await detachFactDependenciesInTransaction(transaction, actor, {
				dependentType: "script_generation",
				dependentId: row.id,
			});
		}
		const finalRow = await findScriptGenerationInTransaction(
			transaction,
			actor,
			row.id,
		);
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
		result = await provider.generate(buildProviderRequest(generation));
	} catch (error) {
		const code: FinalizeFailure["code"] =
			error instanceof TextProviderError
				? error.code === "AI_TIMEOUT_UNCERTAIN" ||
					error.code === "AI_PROVIDER_UNCERTAIN"
					? "AI_REQUEST_STATE_UNCERTAIN"
					: error.code
				: "AI_PROVIDER_ERROR";
		return finalize(actor, {
			generationId: generation.id,
			outcome: { kind: "failure", code },
		});
	}
	return finalize(actor, {
		generationId: generation.id,
		outcome: { kind: "success", result },
	});
}

export async function markScriptGenerationIndeterminate(
	actor: WorkspaceActor,
	generationId: string,
	policy: { expectedCreatedAt: Date; staleBefore: Date },
) {
	return db.transaction(async (transaction) => {
		const row = await findScriptGenerationInTransaction(
			transaction,
			actor,
			generationId,
			{ lock: true },
		);
		if (!row)
			throw new ScriptGenerationError(
				"GENERATION_NOT_FOUND",
				"Generation was not found in this workspace.",
			);
		if (row.status !== "pending") return toScriptGenerationArtifact(row);
		if (
			row.createdAt.getTime() !== policy.expectedCreatedAt.getTime() ||
			row.createdAt > policy.staleBefore
		) {
			throw new ScriptGenerationError(
				"GENERATION_NOT_STALE",
				"Pending generation is not stale under the supplied server policy.",
			);
		}
		await transaction
			.update(scriptGeneration)
			.set({
				status: "indeterminate",
				outputJson: null,
				validSections: [],
				invalidSections: [...scriptGenerationSections],
				errorCode: "GENERATION_INDETERMINATE",
				finishedAt: new Date(),
			})
			.where(
				and(
					eq(scriptGeneration.id, row.id),
					eq(scriptGeneration.workspaceId, actor.workspaceId),
					eq(scriptGeneration.status, "pending"),
				),
			);
		const finalRow = await findScriptGenerationInTransaction(
			transaction,
			actor,
			row.id,
		);
		if (!finalRow)
			throw new Error("Could not reload indeterminate generation.");
		return toScriptGenerationArtifact(finalRow);
	});
}

export async function getScriptGenerationReadModel(
	actor: WorkspaceActor,
	projectId: string,
): Promise<ScriptGenerationReadModel> {
	const context = await getScriptGenerationContext(actor, projectId);
	const readModel = await listScriptGenerationReadModel(actor, projectId);
	return { context, ...readModel };
}

export async function getScriptGenerationContext(
	actor: WorkspaceActor,
	projectId: string,
): Promise<ScriptGenerationContext> {
	const [projectRecord] = await db
		.select({
			id: project.id,
			name: project.name,
			contentType: project.contentType,
			creationPath: project.creationPath,
			contentFormatKey: project.contentFormatKey,
			contentFormatVersion: project.contentFormatVersion,
			projectProductId: project.productId,
			platform: contentBrief.platform,
			goal: contentBrief.goal,
			durationSeconds: contentBrief.durationSeconds,
			angle: contentBrief.angle,
			description: contentBrief.description,
		})
		.from(project)
		.innerJoin(contentBrief, eq(contentBrief.projectId, project.id))
		.where(
			and(
				eq(project.id, projectId),
				eq(project.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!projectRecord)
		throw new ScriptGenerationError(
			"GENERATION_NOT_FOUND",
			"Project was not found in this workspace.",
		);
	if (
		projectRecord.contentType === "AFFILIATE" &&
		projectRecord.projectProductId === null
	)
		throw new ScriptGenerationError(
			"GENERATION_NOT_FOUND",
			"Project was not found in this workspace.",
		);
	let source: ScriptGenerationSource;
	if (
		projectRecord.contentType === "ORGANIC" &&
		projectRecord.creationPath === "SCRIPTED" &&
		projectRecord.contentFormatKey === "SCRIPTED_STANDARD" &&
		projectRecord.contentFormatVersion === 1
	) {
		source = { kind: "organic" };
	} else if (
		projectRecord.contentType === "AFFILIATE" &&
		projectRecord.creationPath === "SCRIPTED" &&
		projectRecord.contentFormatKey === "SCRIPTED_STANDARD" &&
		projectRecord.contentFormatVersion === 1 &&
		projectRecord.projectProductId !== null
	) {
		const [productRecord] = await db
			.select({
				id: product.id,
				name: product.name,
				category: product.category,
			})
			.from(product)
			.where(
				and(
					eq(product.id, projectRecord.projectProductId),
					eq(product.workspaceId, actor.workspaceId),
				),
			)
			.limit(1);
		if (!productRecord)
			throw new ScriptGenerationError(
				"GENERATION_NOT_FOUND",
				"Project was not found in this workspace.",
			);
		source = {
			kind: "affiliate",
			productId: productRecord.id,
			productName: productRecord.name,
			productCategory: productRecord.category,
		};
	} else {
		throw new ScriptGenerationError(
			"ORGANIC_SOURCE_NOT_SUPPORTED",
			"This project identity is not supported by the ScriptGeneration runtime.",
		);
	}

	const [
		facts,
		channelSettingsRows,
		mediaRecords,
		outputRulesRows,
		aiSettingsRows,
	] = await Promise.all([
		source.kind === "affiliate"
			? db
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
					.where(
						and(
							eq(productFact.workspaceId, actor.workspaceId),
							eq(productFact.productId, source.productId),
						),
					)
					.orderBy(productFact.id)
			: Promise.resolve([]),
		db
			.select()
			.from(channelSettings)
			.where(eq(channelSettings.workspaceId, actor.workspaceId))
			.limit(1),
		db
			.select()
			.from(mediaMetadata)
			.where(
				and(
					eq(mediaMetadata.workspaceId, actor.workspaceId),
					eq(mediaMetadata.projectId, projectId),
				),
			)
			.orderBy(mediaMetadata.id),
		db
			.select()
			.from(outputRules)
			.where(eq(outputRules.workspaceId, actor.workspaceId))
			.limit(1),
		db
			.select({
				textProvider: aiSettings.textProvider,
				textModel: aiSettings.textModel,
			})
			.from(aiSettings)
			.where(eq(aiSettings.workspaceId, actor.workspaceId))
			.limit(1),
	]);

	const today = resolveBusinessToday();
	const contextFacts = facts.map((fact) => {
		const evaluated = evaluateDbFact(fact, today);
		return {
			id: fact.id,
			revision: fact.revision,
			content: fact.content,
			type: fact.type as ScriptGenerationFactSnapshot["type"],
			assessment: evaluated.assessment,
			generationUsability: evaluated.usability,
			source: {
				type: fact.sourceType,
				label: fact.sourceLabel,
				url: fact.sourceUrl,
				confirmedAt: fact.confirmedAt,
				expiresAt: fact.expiresAt,
			},
		};
	});

	const channelSettingsRecord = channelSettingsRows[0];
	const parsedChannelSettings = channelSettingsSchema.safeParse(
		channelSettingsRecord
			? {
					niche: channelSettingsRecord.niche,
					targetAudience: channelSettingsRecord.targetAudience,
					tone: channelSettingsRecord.tone,
					contentPillar: channelSettingsRecord.contentPillar,
					defaultCta: channelSettingsRecord.defaultCta,
					affiliateDisclosure: channelSettingsRecord.affiliateDisclosure,
					avoidWords: channelSettingsRecord.avoidWords,
				}
			: undefined,
	);

	const mediaSnapshots = mediaRecords.flatMap((record) => {
		const parsed = mediaMetadataSchema.safeParse({
			id: record.id,
			mediaType: record.mediaType,
			aspectRatio: record.aspectRatio,
			durationSeconds: record.durationSeconds,
			usageRights: record.usageRights,
			status: record.status,
			sceneSuitability: record.sceneSuitability,
			tags: record.tags,
			reference: {
				displayName: record.displayName,
				referenceUrl: record.referenceUrl,
			},
		});
		return parsed.success && isUsableMediaMetadata(parsed.data)
			? [parsed.data]
			: [];
	});

	const outputRulesRecord = outputRulesRows[0];
	const parsedOutputRules = outputRulesSchema.safeParse(
		outputRulesRecord
			? {
					language: outputRulesRecord.language,
					aspectRatio: outputRulesRecord.aspectRatio,
					subtitleSafeArea: outputRulesRecord.subtitleSafeArea,
					claimLimit: outputRulesRecord.claimLimit,
					requireFinalCta: outputRulesRecord.requireFinalCta,
				}
			: defaultOutputRules,
	);
	const aiSettingsRecord = aiSettingsRows[0];
	const promptVersion =
		source.kind === "organic"
			? ORGANIC_SCRIPT_PROMPT_VERSION
			: SCRIPT_PROMPT_VERSION;
	const outputSchemaVersion =
		source.kind === "organic"
			? ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION
			: SCRIPT_OUTPUT_SCHEMA_VERSION;

	let generationConfig: ScriptGenerationContext["generationConfig"];
	const parsedAiSettings = aiSettingsSchema.safeParse(aiSettingsRecord);
	if (parsedAiSettings.success) {
		generationConfig = {
			textProvider: parsedAiSettings.data.textProvider,
			textModel: parsedAiSettings.data.textModel,
			promptVersion,
			outputSchemaVersion,
		};
	} else if (!aiSettingsRecord) {
		generationConfig = {
			textProvider: env.TEXT_AI_DEFAULT_PROVIDER,
			textModel: env.TEXT_AI_DEFAULT_MODEL,
			promptVersion,
			outputSchemaVersion,
		};
	} else {
		generationConfig = {
			textProvider: aiSettingsRecord.textProvider?.trim() || "Chưa cấu hình",
			textModel: aiSettingsRecord.textModel?.trim() || "Chưa cấu hình",
			promptVersion,
			outputSchemaVersion,
		};
	}

	const contextBase = {
		project: { id: projectRecord.id, name: projectRecord.name },
		contentBrief: {
			platform: projectRecord.platform as "tiktok",
			goal: projectRecord.goal,
			durationSeconds: projectRecord.durationSeconds,
			angle: projectRecord.angle,
			description: normalizeDescription(projectRecord.description),
		},
		channelSettings: parsedChannelSettings.success
			? parsedChannelSettings.data
			: null,
		mediaMetadata: mediaSnapshots,
		outputRules: parsedOutputRules.success
			? parsedOutputRules.data
			: defaultOutputRules,
		generationConfig,
	};
	if (source.kind === "organic") {
		return {
			...contextBase,
			project: {
				...contextBase.project,
				contentType: "ORGANIC" as const,
				creationPath: "SCRIPTED" as const,
				contentFormat: "SCRIPTED_STANDARD" as const,
				contentFormatVersion: 1 as const,
			},
			sourceMode: "ORGANIC_NO_PRODUCT" as const,
			product: null,
			facts: [],
		} as ScriptGenerationContext;
	}
	return {
		...contextBase,
		product: {
			id: source.productId,
			name: source.productName,
			category: source.productCategory,
		},
		facts: contextFacts,
	} as ScriptGenerationContext;
}

export { findScriptGeneration };

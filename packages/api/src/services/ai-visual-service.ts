import { createHmac, randomUUID } from "node:crypto";
import {
	type AiVisualEstimate,
	type AiVisualGenerationInput,
	type AiVisualTestScenario,
	aiVisualConfirmInputSchema,
	aiVisualGenerationInputSchema,
	aiVisualHistoryInputSchema,
	aiVisualReconcileInputSchema,
	aiVisualTestScenarioSchema,
	canonicalizeJson,
	canonicalPaidRequestText,
	createMediaAssetStorageKey,
	findProvider,
	MediaAssetError,
} from "@affichannel/core";
import {
	aiOperation,
	aiVisualArtifact,
	aiVisualGeneration,
	db,
	mediaAsset,
	mediaAssetLink,
	project,
} from "@affichannel/db";
import { env } from "@affichannel/env/server";
import { and, desc, eq } from "drizzle-orm";
import { sha256Bytes } from "../media/media-asset-checksum";
import { getMediaAssetSizeLimits } from "../media/media-asset-config";
import { createMediaAssetStorage } from "../media/media-asset-storage-factory";
import { validateMediaAssetBytes } from "../media/media-asset-validation";
import { createDeterministicAiVisualProvider } from "../providers/ai-visual";
import {
	AiGovernanceError,
	claimDeterministicAiOperation,
	finishAiOperationInTransaction,
	prepareAiOperation,
	reconcileAiOperation,
	resolveAiOperationGovernance,
} from "./ai-governance-service";
import { sha256Hex } from "./script-generation-hashing";
import type { WorkspaceActor } from "./workspace";

const ESTIMATE_TTL_MS = 10 * 60 * 1_000;
const OUTPUT_MIME_TYPE = "video/mp4" as const;
const OUTPUT_EXTENSION = "mp4";

type SourceProof = Readonly<{
	mediaAssetId: string;
	workspaceId: string;
	projectId: string;
	storageProvider: string;
	storageKey: string;
	mimeType: string;
	byteSize: number;
	checksumSha256: string;
	width: number | null;
	height: number | null;
}>;

function sourceFingerprint(proof: SourceProof) {
	return sha256Hex(proof);
}

function motionFingerprint(input: AiVisualGenerationInput) {
	return sha256Hex({
		motion: input.motion,
		aspectRatio: input.aspectRatio,
		outputMimeType: OUTPUT_MIME_TYPE,
	});
}

function safeSourceProof(
	asset: typeof mediaAsset.$inferSelect,
	projectId: string,
) {
	if (
		asset.status !== "ready" ||
		asset.mediaType !== "image" ||
		!asset.mimeType ||
		!asset.checksumSha256 ||
		!asset.byteSize ||
		!asset.width ||
		!asset.height
	) {
		throw new AiGovernanceError(
			"AI_VISUAL_SOURCE_NOT_ELIGIBLE",
			"Source must be a READY raster MediaAsset with integrity proof.",
		);
	}
	if (
		!(
			"image/jpeg" === asset.mimeType ||
			"image/png" === asset.mimeType ||
			"image/webp" === asset.mimeType
		)
	) {
		throw new AiGovernanceError(
			"AI_VISUAL_SOURCE_NOT_ELIGIBLE",
			"Source MIME is not eligible for image-to-video.",
		);
	}
	return {
		mediaAssetId: asset.id,
		workspaceId: asset.workspaceId,
		projectId,
		storageProvider: asset.storageProvider,
		storageKey: asset.storageKey,
		mimeType: asset.mimeType,
		byteSize: asset.byteSize,
		checksumSha256: asset.checksumSha256,
		width: asset.width,
		height: asset.height,
	} satisfies SourceProof;
}

async function readEligibleSource(
	actor: WorkspaceActor,
	input: AiVisualGenerationInput,
) {
	const [row] = await db
		.select({ asset: mediaAsset, projectId: project.id })
		.from(mediaAssetLink)
		.innerJoin(mediaAsset, eq(mediaAsset.id, mediaAssetLink.mediaAssetId))
		.innerJoin(project, eq(project.id, mediaAssetLink.projectId))
		.where(
			and(
				eq(mediaAsset.id, input.sourceMediaAssetId),
				eq(mediaAsset.workspaceId, actor.workspaceId),
				eq(mediaAssetLink.workspaceId, actor.workspaceId),
				eq(mediaAssetLink.projectId, input.projectId),
				eq(project.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!row) {
		throw new AiGovernanceError(
			"AI_VISUAL_SOURCE_NOT_ELIGIBLE",
			"Source MediaAsset is missing, cross-workspace, or not linked to the project.",
		);
	}
	return safeSourceProof(row.asset, row.projectId);
}

function semanticInput(input: AiVisualGenerationInput, proof: SourceProof) {
	return {
		sourceFingerprint: sourceFingerprint(proof),
		motionPlanFingerprint: motionFingerprint(input),
		durationSeconds: input.durationSeconds,
		prompt: input.prompt,
		aspectRatio: input.aspectRatio,
		outputMimeType: OUTPUT_MIME_TYPE,
	};
}

function estimateId() {
	return `ai-visual-estimate-${randomUUID()}`;
}

function estimateSignature(
	actor: WorkspaceActor,
	estimate: Omit<AiVisualEstimate, "signature">,
) {
	return createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(
			canonicalizeJson({
				workspaceId: actor.workspaceId,
				estimateId: estimate.estimateId,
				requestHash: estimate.requestHash,
				hashVersion: estimate.hashVersion,
				providerId: estimate.providerId,
				modelId: estimate.modelId,
				pricingVersion: estimate.pricingVersion,
				governanceVersion: estimate.governanceVersion,
				currency: estimate.currency,
				estimatedCostMicros: estimate.estimatedCostMicros,
				expiresAt: estimate.expiresAt.toISOString(),
			}),
		)
		.digest("hex");
}

function bigintToSafeNumber(value: bigint) {
	const result = Number(value);
	return Number.isSafeInteger(result) ? result : Number.MAX_SAFE_INTEGER;
}

function compareEstimate(actual: AiVisualEstimate, expected: AiVisualEstimate) {
	return (
		actual.requestHash === expected.requestHash &&
		actual.hashVersion === expected.hashVersion &&
		actual.providerId === expected.providerId &&
		actual.modelId === expected.modelId &&
		actual.pricingVersion === expected.pricingVersion &&
		actual.governanceVersion === expected.governanceVersion &&
		actual.currency === expected.currency &&
		actual.estimatedCostMicros === expected.estimatedCostMicros
	);
}

export async function estimateAiVisualGeneration(
	actor: WorkspaceActor,
	input: AiVisualGenerationInput,
) {
	const parsed = aiVisualGenerationInputSchema.parse(input);
	const [proof, governance] = await Promise.all([
		readEligibleSource(actor, parsed),
		resolveAiOperationGovernance(actor, "IMAGE_TO_VIDEO", "IMAGE_TO_VIDEO"),
	]);
	if (!governance.provider || !findProvider(governance.provider.providerId)) {
		throw new AiGovernanceError(
			"AI_PROVIDER_NOT_FOUND",
			"Provider resolution failed on the server.",
		);
	}
	const semantic = semanticInput(parsed, proof);
	const canonicalInput = canonicalPaidRequestText({
		operationKind: "IMAGE_TO_VIDEO",
		capability: "IMAGE_TO_VIDEO",
		providerId: governance.provider.providerId,
		modelId: governance.model.modelId,
		semanticInput: semantic,
	});
	const requestHash = sha256Hex(canonicalInput);
	const expiresAt = new Date(Date.now() + ESTIMATE_TTL_MS);
	const estimatedCostMicros = bigintToSafeNumber(
		governance.pricing.fixedMicros,
	);
	const estimate = {
		estimateId: estimateId(),
		requestHash,
		hashVersion: "paid-request.image-to-video.v1" as const,
		providerId: governance.provider.providerId,
		modelId: governance.model.modelId,
		pricingVersion: governance.pricing.pricingVersion,
		governanceVersion: governance.settings.version,
		currency: governance.pricing.currency,
		estimatedCostMicros,
		expiresAt,
		signature: "" as string,
		source: {
			mediaAssetId: proof.mediaAssetId,
			mimeType: proof.mimeType,
			byteSize: proof.byteSize,
			width: proof.width,
			height: proof.height,
			checksumSha256: proof.checksumSha256,
		},
		contract: {
			operationKind: "IMAGE_TO_VIDEO" as const,
			outputMimeType: OUTPUT_MIME_TYPE,
			aspectRatio: parsed.aspectRatio,
			durationSeconds: parsed.durationSeconds,
		},
	};
	estimate.signature = estimateSignature(actor, estimate);
	return estimate;
}

function generationRead(
	generation: typeof aiVisualGeneration.$inferSelect,
	operation: typeof aiOperation.$inferSelect,
	artifact: typeof aiVisualArtifact.$inferSelect | undefined,
) {
	return {
		id: generation.id,
		projectId: generation.projectId,
		sourceMediaAssetId: generation.sourceMediaAssetId,
		operationId: generation.operationId,
		providerId: generation.providerId,
		modelId: generation.modelId,
		requestHash: generation.requestHash,
		status: generation.status,
		failureCode: generation.failureCode,
		completedMediaAssetId: generation.completedMediaAssetId,
		providerRequestId: operation.providerRequestId,
		callStage: operation.callStage,
		artifact: artifact
			? {
					id: artifact.id,
					status: artifact.status,
					mediaAssetId: artifact.mediaAssetId,
					mimeType: artifact.mimeType,
					byteSize: artifact.byteSize,
					checksumSha256: artifact.checksumSha256,
					durationMs: artifact.durationMs,
				}
			: null,
		createdAt: generation.createdAt,
		updatedAt: generation.updatedAt,
	};
}

async function readGeneration(actor: WorkspaceActor, generationId: string) {
	const [generation] = await db
		.select()
		.from(aiVisualGeneration)
		.where(
			and(
				eq(aiVisualGeneration.id, generationId),
				eq(aiVisualGeneration.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!generation)
		throw new AiGovernanceError(
			"AI_OPERATION_NOT_FOUND",
			"AI Visual generation was not found in this workspace.",
		);
	const [operation] = await db
		.select()
		.from(aiOperation)
		.where(
			and(
				eq(aiOperation.id, generation.operationId),
				eq(aiOperation.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!operation)
		throw new AiGovernanceError(
			"AI_OPERATION_NOT_FOUND",
			"AI operation was not found.",
		);
	const [artifact] = await db
		.select()
		.from(aiVisualArtifact)
		.where(
			and(
				eq(aiVisualArtifact.generationId, generation.id),
				eq(aiVisualArtifact.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return generationRead(generation, operation, artifact);
}

export async function confirmAiVisualGeneration(
	actor: WorkspaceActor,
	input: unknown,
) {
	const parsed = aiVisualConfirmInputSchema.parse(input);
	if (parsed.estimate.expiresAt.getTime() <= Date.now()) {
		throw new AiGovernanceError(
			"AI_ESTIMATE_STALE",
			"Estimate has expired; re-estimate before confirmation.",
		);
	}
	const unsignedEstimate = { ...parsed.estimate };
	delete (unsignedEstimate as { signature?: string }).signature;
	if (
		estimateSignature(actor, unsignedEstimate) !== parsed.estimate.signature
	) {
		throw new AiGovernanceError(
			"AI_ESTIMATE_STALE",
			"Estimate signature is invalid; re-estimate before confirmation.",
		);
	}
	const actual = await estimateAiVisualGeneration(actor, parsed.generation);
	if (!compareEstimate(actual, parsed.estimate)) {
		throw new AiGovernanceError(
			"AI_ESTIMATE_STALE",
			"Estimate no longer matches server governance, pricing, source, or request semantics.",
		);
	}
	const proof = await readEligibleSource(actor, parsed.generation);
	const operation = await prepareAiOperation(actor, {
		operationKind: "IMAGE_TO_VIDEO",
		capability: "IMAGE_TO_VIDEO",
		projectId: parsed.generation.projectId,
		idempotencyKey: parsed.generation.idempotencyKey,
		semanticInput: semanticInput(parsed.generation, proof),
	});
	const generationId = `ai-visual-${operation.id}`;
	const [existingGeneration] = await db
		.select()
		.from(aiVisualGeneration)
		.where(
			and(
				eq(aiVisualGeneration.operationId, operation.id),
				eq(aiVisualGeneration.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (existingGeneration) return readGeneration(actor, existingGeneration.id);
	if (operation.status !== "PENDING") {
		throw new AiGovernanceError(
			"AI_REQUEST_DUPLICATE",
			"The immutable request already belongs to a terminal non-visual operation.",
		);
	}
	await db
		.insert(aiVisualGeneration)
		.values({
			id: generationId,
			workspaceId: actor.workspaceId,
			projectId: parsed.generation.projectId,
			sourceMediaAssetId: parsed.generation.sourceMediaAssetId,
			operationId: operation.id,
			createdByUserId: actor.userId,
			providerId: operation.providerId,
			modelId: operation.modelId,
			requestHash: operation.requestHash,
			hashVersion: operation.hashVersion,
			requestJson: {
				prompt: parsed.generation.prompt,
				motion: parsed.generation.motion,
				durationSeconds: parsed.generation.durationSeconds,
				aspectRatio: parsed.generation.aspectRatio,
			},
			sourceProofJson: proof,
			status: operation.status,
			confirmedAt: new Date(),
		})
		.onConflictDoNothing();
	return readGeneration(actor, generationId);
}

function readRequestJson(value: unknown) {
	const record =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	return {
		prompt: typeof record.prompt === "string" ? record.prompt : "",
		motion: typeof record.motion === "string" ? record.motion : "",
		durationSeconds:
			typeof record.durationSeconds === "number" ? record.durationSeconds : 0,
		aspectRatio:
			record.aspectRatio === "9:16" ? ("9:16" as const) : ("9:16" as const),
	};
}

function outputValidationError(
	message: string,
	metadata?: Record<string, unknown>,
) {
	return new AiGovernanceError("AI_VISUAL_OUTPUT_INVALID", message, metadata);
}

export async function validateAiVisualOutput(input: {
	bytes: Uint8Array;
	mimeType: string;
	durationMs: number;
	expectedDurationMs: number;
}) {
	const maxBytes = getMediaAssetSizeLimits().video;
	if (input.bytes.byteLength > maxBytes) {
		throw outputValidationError(
			"Generated video exceeds the configured byte limit.",
			{ maxBytes },
		);
	}
	if (
		input.mimeType !== OUTPUT_MIME_TYPE ||
		input.durationMs !== input.expectedDurationMs
	) {
		throw outputValidationError(
			"Generated video MIME or duration does not match the contract.",
		);
	}
	try {
		await validateMediaAssetBytes({
			mediaType: "video",
			bytes: input.bytes,
			originalFilename: "generated.mp4",
			declaredMimeType: OUTPUT_MIME_TYPE,
			maxBytes,
		});
	} catch (error) {
		if (error instanceof MediaAssetError) {
			throw outputValidationError(
				"Generated bytes failed the MP4 integrity proof.",
				{
					code: error.code,
				},
			);
		}
		throw error;
	}
	return {
		mimeType: OUTPUT_MIME_TYPE,
		byteSize: input.bytes.byteLength,
		checksumSha256: sha256Bytes(input.bytes),
		durationMs: input.durationMs,
	};
}

async function updateGenerationStatus(
	actor: WorkspaceActor,
	generationId: string,
	status: "FAILED" | "INDETERMINATE",
	failureCode: string,
) {
	await db
		.update(aiVisualGeneration)
		.set({ status, failureCode, updatedAt: new Date() })
		.where(
			and(
				eq(aiVisualGeneration.id, generationId),
				eq(aiVisualGeneration.workspaceId, actor.workspaceId),
			),
		);
}

async function finalizeCompletedGeneration(input: {
	actor: WorkspaceActor;
	generation: typeof aiVisualGeneration.$inferSelect;
	operation: typeof aiOperation.$inferSelect;
	bytes: Uint8Array;
	providerRequestId: string | null;
	durationMs: number;
	usage: unknown;
	actualCostMicros: bigint | null;
	storageKey: string;
	artifactId: string;
	mediaAssetId: string;
}) {
	const { actor, generation, operation } = input;
	const metadata = await validateAiVisualOutput({
		bytes: input.bytes,
		mimeType: OUTPUT_MIME_TYPE,
		durationMs: input.durationMs,
		expectedDurationMs:
			readRequestJson(generation.requestJson).durationSeconds * 1_000,
	});
	const assetId = input.mediaAssetId;
	const storageProvider = env.MEDIA_STORAGE_PROVIDER;
	const now = new Date();
	const result = await db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(aiVisualArtifact)
			.where(eq(aiVisualArtifact.generationId, generation.id))
			.limit(1);
		if (existing[0]?.status === "FINAL" && existing[0].mediaAssetId)
			return existing[0].mediaAssetId;
		await tx.insert(mediaAsset).values({
			id: assetId,
			workspaceId: actor.workspaceId,
			createdByUserId: actor.userId,
			origin: "ai_generated",
			mediaType: "video",
			status: "ready",
			storageProvider,
			storageKey: input.storageKey,
			uploadSessionId: `ai-visual-${generation.id}`,
			prepareIdempotencyKey: `ai-visual-${generation.id}`,
			uploadExpiresAt: now,
			originalFilename: `ai-visual-${generation.id}.${OUTPUT_EXTENSION}`,
			displayName: `AI Visual ${generation.id.slice(-8)}`,
			declaredMimeType: OUTPUT_MIME_TYPE,
			mimeType: metadata.mimeType,
			byteSize: metadata.byteSize,
			checksumSha256: metadata.checksumSha256,
			durationMs: metadata.durationMs,
			usageRights: "owned",
			tags: ["ai-generated", "image-to-video"],
			finalizedAt: now,
			createdAt: now,
			updatedAt: now,
		});
		await tx
			.insert(mediaAssetLink)
			.values({
				id: randomUUID(),
				workspaceId: actor.workspaceId,
				projectId: generation.projectId,
				mediaAssetId: assetId,
				usageType: "project_resource",
				createdByUserId: actor.userId,
			})
			.onConflictDoNothing();
		await tx
			.insert(aiVisualArtifact)
			.values({
				id: input.artifactId,
				workspaceId: actor.workspaceId,
				generationId: generation.id,
				mediaAssetId: assetId,
				storageProvider,
				storageKey: input.storageKey,
				status: "FINAL",
				providerRequestId: input.providerRequestId,
				mimeType: metadata.mimeType,
				byteSize: metadata.byteSize,
				checksumSha256: metadata.checksumSha256,
				durationMs: metadata.durationMs,
				createdAt: now,
				finalizedAt: now,
			})
			.onConflictDoNothing();
		await tx
			.update(aiVisualGeneration)
			.set({
				completedMediaAssetId: assetId,
				status: "COMPLETED",
				failureCode: null,
				updatedAt: now,
			})
			.where(eq(aiVisualGeneration.id, generation.id));
		const [locked] = await tx
			.select()
			.from(aiOperation)
			.where(eq(aiOperation.id, operation.id))
			.limit(1)
			.for("update", { of: aiOperation });
		if (!locked)
			throw new AiGovernanceError(
				"AI_OPERATION_NOT_FOUND",
				"AI operation was not found.",
			);
		await finishAiOperationInTransaction(tx, actor, locked, {
			status: "COMPLETED",
			callStage: "FINALIZED",
			providerRequestId: input.providerRequestId,
			actualCostMicros: input.actualCostMicros ?? locked.estimatedCostMicros,
			usage: input.usage,
			artifactEvidence: {
				artifactId: input.artifactId,
				mediaAssetId: assetId,
				checksumSha256: metadata.checksumSha256,
			},
		});
		return assetId;
	});
	return result;
}

export async function executeAiVisualDeterministicTestOperation(
	actor: WorkspaceActor,
	generationId: string,
	scenario: AiVisualTestScenario,
) {
	const parsedScenario = aiVisualTestScenarioSchema.parse(scenario);
	if (
		process.env.NODE_ENV !== "test" &&
		process.env.AFFICHANNEL_AI_TEST_MODE !== "1"
	) {
		throw new AiGovernanceError(
			"AI_TEST_PROVIDER_FORBIDDEN",
			"The deterministic adapter is test-only.",
		);
	}
	const [generation] = await db
		.select()
		.from(aiVisualGeneration)
		.where(
			and(
				eq(aiVisualGeneration.id, generationId),
				eq(aiVisualGeneration.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!generation)
		throw new AiGovernanceError(
			"AI_OPERATION_NOT_FOUND",
			"AI Visual generation was not found.",
		);
	const [operation] = await db
		.select()
		.from(aiOperation)
		.where(
			and(
				eq(aiOperation.id, generation.operationId),
				eq(aiOperation.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!operation)
		throw new AiGovernanceError(
			"AI_OPERATION_NOT_FOUND",
			"AI operation was not found.",
		);
	if (operation.status !== "PENDING")
		return readGeneration(actor, generationId);
	const claimed = await claimDeterministicAiOperation(actor, operation.id, {
		operationKind: "IMAGE_TO_VIDEO",
	});
	if (claimed.status !== "PENDING" || !claimed.leaseOwner)
		return readGeneration(actor, generationId);
	const request = readRequestJson(generation.requestJson);
	const provider = createDeterministicAiVisualProvider();
	const providerResult = provider.generate({
		requestId: generation.id,
		sourceMediaAssetId: generation.sourceMediaAssetId,
		prompt: request.prompt,
		motion: request.motion,
		durationSeconds: request.durationSeconds,
		aspectRatio: request.aspectRatio,
		scenario: parsedScenario,
	});
	if (
		parsedScenario === "DEFINITIVE_FAILURE" ||
		parsedScenario === "TIMEOUT_BEFORE_SEND"
	) {
		await db.transaction(async (tx) => {
			const [locked] = await tx
				.select()
				.from(aiOperation)
				.where(eq(aiOperation.id, operation.id))
				.limit(1)
				.for("update", { of: aiOperation });
			if (!locked)
				throw new AiGovernanceError(
					"AI_OPERATION_NOT_FOUND",
					"AI operation was not found.",
				);
			await finishAiOperationInTransaction(tx, actor, locked, {
				status: "FAILED",
				callStage: "NOT_STARTED",
				safeError: providerResult.safeError,
				errorCategory: parsedScenario,
			});
			await tx
				.update(aiVisualGeneration)
				.set({
					status: "FAILED",
					failureCode: parsedScenario,
					updatedAt: new Date(),
				})
				.where(eq(aiVisualGeneration.id, generation.id));
		});
		return readGeneration(actor, generation.id);
	}
	if (
		parsedScenario === "TIMEOUT_AFTER_POSSIBLE_SEND" ||
		parsedScenario === "NETWORK_UNCERTAINTY" ||
		parsedScenario === "STORAGE_FAILURE"
	) {
		await updateGenerationStatus(
			actor,
			generation.id,
			"INDETERMINATE",
			parsedScenario,
		);
		await db.transaction(async (tx) => {
			const [locked] = await tx
				.select()
				.from(aiOperation)
				.where(eq(aiOperation.id, operation.id))
				.limit(1)
				.for("update", { of: aiOperation });
			if (!locked)
				throw new AiGovernanceError(
					"AI_OPERATION_NOT_FOUND",
					"AI operation was not found.",
				);
			await finishAiOperationInTransaction(tx, actor, locked, {
				status: "INDETERMINATE",
				callStage: providerResult.callStage,
				providerRequestId: providerResult.providerRequestId,
				safeError: providerResult.safeError ?? { code: parsedScenario },
				errorCategory: parsedScenario,
				usage: providerResult.usage,
			});
		});
		return readGeneration(actor, generation.id);
	}
	if (
		!providerResult.bytes ||
		!providerResult.mimeType ||
		!providerResult.durationMs
	)
		throw new AiGovernanceError(
			"AI_VISUAL_OUTPUT_INVALID",
			"Provider returned no output.",
		);
	let metadata: Awaited<ReturnType<typeof validateAiVisualOutput>>;
	try {
		metadata = await validateAiVisualOutput({
			bytes: providerResult.bytes,
			mimeType: providerResult.mimeType,
			durationMs: providerResult.durationMs,
			expectedDurationMs: request.durationSeconds * 1_000,
		});
	} catch (error) {
		await updateGenerationStatus(
			actor,
			generation.id,
			"FAILED",
			error instanceof AiGovernanceError ? error.code : "INVALID_OUTPUT",
		);
		await db.transaction(async (tx) => {
			const [locked] = await tx
				.select()
				.from(aiOperation)
				.where(eq(aiOperation.id, operation.id))
				.limit(1)
				.for("update", { of: aiOperation });
			if (!locked)
				throw new AiGovernanceError(
					"AI_OPERATION_NOT_FOUND",
					"AI operation was not found.",
				);
			await finishAiOperationInTransaction(tx, actor, locked, {
				status: "FAILED",
				callStage: "RESPONSE_RECEIVED",
				providerRequestId: providerResult.providerRequestId,
				safeError: { code: "INVALID_OUTPUT" },
				errorCategory: "INVALID_OUTPUT",
				usage: providerResult.usage,
			});
		});
		return readGeneration(actor, generation.id);
	}
	const storageProvider = env.MEDIA_STORAGE_PROVIDER;
	const mediaAssetId = randomUUID();
	const storageKey = createMediaAssetStorageKey({
		workspaceId: actor.workspaceId,
		assetId: mediaAssetId,
		objectName: `ai-visual-${generation.id}.${OUTPUT_EXTENSION}`,
	});
	try {
		await createMediaAssetStorage(storageProvider).put({
			storageKey,
			body: providerResult.bytes,
			contentType: metadata.mimeType,
			checksumSha256: metadata.checksumSha256,
		});
	} catch (_error) {
		await updateGenerationStatus(
			actor,
			generation.id,
			"INDETERMINATE",
			"STORAGE_FAILURE",
		);
		await db.transaction(async (tx) => {
			const [locked] = await tx
				.select()
				.from(aiOperation)
				.where(eq(aiOperation.id, operation.id))
				.limit(1)
				.for("update", { of: aiOperation });
			if (!locked)
				throw new AiGovernanceError(
					"AI_OPERATION_NOT_FOUND",
					"AI operation was not found.",
				);
			await finishAiOperationInTransaction(tx, actor, locked, {
				status: "INDETERMINATE",
				callStage: "RESPONSE_RECEIVED",
				providerRequestId: providerResult.providerRequestId,
				safeError: { code: "STORAGE_FAILURE" },
				errorCategory: "STORAGE_FAILURE",
				usage: providerResult.usage,
				artifactEvidence: {
					storageKey,
					checksumSha256: metadata.checksumSha256,
				},
			});
		});
		return readGeneration(actor, generation.id);
	}
	if (
		parsedScenario === "ORPHAN_ARTIFACT" ||
		parsedScenario === "DB_FINALIZE_FAILURE"
	) {
		const artifactId = `ai-visual-artifact-${generation.id}`;
		await db.transaction(async (tx) => {
			await tx.insert(aiVisualArtifact).values({
				id: artifactId,
				workspaceId: actor.workspaceId,
				generationId: generation.id,
				mediaAssetId: null,
				storageProvider,
				storageKey,
				status: "ORPHAN",
				providerRequestId: providerResult.providerRequestId,
				mimeType: metadata.mimeType,
				byteSize: metadata.byteSize,
				checksumSha256: metadata.checksumSha256,
				durationMs: metadata.durationMs,
			});
			const [locked] = await tx
				.select()
				.from(aiOperation)
				.where(eq(aiOperation.id, operation.id))
				.limit(1)
				.for("update", { of: aiOperation });
			if (!locked)
				throw new AiGovernanceError(
					"AI_OPERATION_NOT_FOUND",
					"AI operation was not found.",
				);
			await finishAiOperationInTransaction(tx, actor, locked, {
				status: "INDETERMINATE",
				callStage: "RESPONSE_RECEIVED",
				providerRequestId: providerResult.providerRequestId,
				safeError: { code: "DB_FINALIZE_UNAVAILABLE" },
				errorCategory: "ORPHAN_ARTIFACT",
				usage: providerResult.usage,
				artifactEvidence: {
					artifactId,
					storageKey,
					checksumSha256: metadata.checksumSha256,
				},
			});
			await tx
				.update(aiVisualGeneration)
				.set({
					status: "INDETERMINATE",
					failureCode: "ORPHAN_ARTIFACT",
					updatedAt: new Date(),
				})
				.where(eq(aiVisualGeneration.id, generation.id));
		});
		return readGeneration(actor, generation.id);
	}
	const artifactId = `ai-visual-artifact-${generation.id}`;
	await finalizeCompletedGeneration({
		actor,
		generation,
		operation,
		bytes: providerResult.bytes,
		providerRequestId: providerResult.providerRequestId,
		durationMs: providerResult.durationMs,
		usage: providerResult.usage,
		actualCostMicros: providerResult.actualCostMicros,
		storageKey,
		artifactId,
		mediaAssetId,
	});
	return readGeneration(actor, generation.id);
}

export async function reconcileAiVisualGeneration(
	actor: WorkspaceActor,
	input: unknown,
) {
	const parsed = aiVisualReconcileInputSchema.parse(input);
	const [generation] = await db
		.select()
		.from(aiVisualGeneration)
		.where(
			and(
				eq(aiVisualGeneration.id, parsed.generationId),
				eq(aiVisualGeneration.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (!generation)
		throw new AiGovernanceError(
			"AI_OPERATION_NOT_FOUND",
			"AI Visual generation was not found.",
		);
	const [artifact] = await db
		.select()
		.from(aiVisualArtifact)
		.where(
			and(
				eq(aiVisualArtifact.generationId, generation.id),
				eq(aiVisualArtifact.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	if (
		(parsed.action === "RECONCILE" ||
			parsed.action === "ATTACH_ORPHAN_ARTIFACT") &&
		artifact?.status === "ORPHAN" &&
		!artifact.mediaAssetId
	) {
		const bytes = await createMediaAssetStorage(
			artifact.storageProvider as "local" | "r2",
		).get(artifact.storageKey);
		await validateAiVisualOutput({
			bytes,
			mimeType: artifact.mimeType,
			durationMs: artifact.durationMs,
			expectedDurationMs:
				readRequestJson(generation.requestJson).durationSeconds * 1_000,
		});
		const assetId = artifact.storageKey.split("/")[3] ?? randomUUID();
		const now = new Date();
		await db.transaction(async (tx) => {
			await tx.insert(mediaAsset).values({
				id: assetId,
				workspaceId: actor.workspaceId,
				createdByUserId: actor.userId,
				origin: "ai_generated",
				mediaType: "video",
				status: "ready",
				storageProvider: artifact.storageProvider as "local" | "r2",
				storageKey: artifact.storageKey,
				uploadSessionId: `ai-visual-${generation.id}`,
				prepareIdempotencyKey: `ai-visual-${generation.id}`,
				uploadExpiresAt: now,
				originalFilename: `ai-visual-${generation.id}.mp4`,
				displayName: `AI Visual ${generation.id.slice(-8)}`,
				declaredMimeType: "video/mp4",
				mimeType: artifact.mimeType,
				byteSize: artifact.byteSize,
				checksumSha256: artifact.checksumSha256,
				durationMs: artifact.durationMs,
				usageRights: "owned",
				tags: ["ai-generated", "image-to-video"],
				finalizedAt: now,
				createdAt: now,
				updatedAt: now,
			});
			await tx
				.insert(mediaAssetLink)
				.values({
					id: randomUUID(),
					workspaceId: actor.workspaceId,
					projectId: generation.projectId,
					mediaAssetId: assetId,
					usageType: "project_resource",
					createdByUserId: actor.userId,
				})
				.onConflictDoNothing();
			await tx
				.update(aiVisualArtifact)
				.set({ mediaAssetId: assetId, status: "FINAL", finalizedAt: now })
				.where(eq(aiVisualArtifact.id, artifact.id));
			await tx
				.update(aiVisualGeneration)
				.set({
					completedMediaAssetId: assetId,
					status: "COMPLETED",
					failureCode: null,
					updatedAt: now,
				})
				.where(eq(aiVisualGeneration.id, generation.id));
		});
		await reconcileAiOperation(
			actor,
			generation.operationId,
			"ATTACH_ORPHAN_ARTIFACT",
		);
	} else {
		await reconcileAiOperation(
			actor,
			generation.operationId,
			parsed.action === "ACKNOWLEDGE_UNRESOLVED"
				? "ACKNOWLEDGE_UNRESOLVED"
				: "RECONCILE",
		);
	}
	return readGeneration(actor, generation.id);
}

export async function getAiVisualGeneration(
	actor: WorkspaceActor,
	generationId: string,
) {
	return readGeneration(actor, generationId);
}

export async function listAiVisualGenerations(
	actor: WorkspaceActor,
	input: unknown,
) {
	const parsed = aiVisualHistoryInputSchema.parse(input);
	const rows = await db
		.select()
		.from(aiVisualGeneration)
		.where(
			and(
				eq(aiVisualGeneration.workspaceId, actor.workspaceId),
				eq(aiVisualGeneration.projectId, parsed.projectId),
			),
		)
		.orderBy(desc(aiVisualGeneration.createdAt))
		.limit(100);
	return Promise.all(rows.map((row) => readGeneration(actor, row.id)));
}

export async function getAllowedAiVisualRecoveryActions(
	actor: WorkspaceActor,
	generationId: string,
) {
	const state = await readGeneration(actor, generationId);
	if (state.status === "COMPLETED" || state.status === "FAILED") return [];
	const actions: Array<
		"RECONCILE" | "ATTACH_ORPHAN_ARTIFACT" | "ACKNOWLEDGE_UNRESOLVED"
	> = ["RECONCILE", "ACKNOWLEDGE_UNRESOLVED"];
	if (state.artifact?.status === "ORPHAN")
		actions.push("ATTACH_ORPHAN_ARTIFACT");
	return actions;
}

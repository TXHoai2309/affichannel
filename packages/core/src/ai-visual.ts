import { z } from "zod";

const idText = z.string().trim().min(1).max(200);

export const aiVisualDurationSchema = z.union([
	z.literal(5),
	z.literal(10),
	z.literal(15),
]);

export const aiVisualAspectRatioSchema = z.literal("9:16");

export const aiVisualGenerationInputSchema = z
	.object({
		projectId: idText,
		sourceMediaAssetId: idText,
		prompt: z.string().trim().min(1).max(2_000),
		motion: z.string().trim().min(1).max(500).default("subtle natural motion"),
		durationSeconds: aiVisualDurationSchema,
		aspectRatio: aiVisualAspectRatioSchema.default("9:16"),
		idempotencyKey: z.string().trim().min(8).max(200),
	})
	.strict();

export type AiVisualGenerationInput = z.infer<
	typeof aiVisualGenerationInputSchema
>;

export const aiVisualEstimateSchema = z
	.object({
		estimateId: idText,
		requestHash: z.string().regex(/^[a-f0-9]{64}$/),
		hashVersion: z.literal("paid-request.image-to-video.v1"),
		providerId: idText,
		modelId: idText,
		pricingVersion: idText,
		governanceVersion: z.number().int().positive(),
		currency: z.string().regex(/^[A-Z]{3}$/),
		estimatedCostMicros: z.number().int().nonnegative(),
		expiresAt: z.coerce.date(),
		signature: z.string().regex(/^[a-f0-9]{64}$/),
		source: z
			.object({
				mediaAssetId: idText,
				mimeType: z.string().min(1).max(64),
				byteSize: z.number().int().positive(),
				width: z.number().int().positive().nullable(),
				height: z.number().int().positive().nullable(),
				checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
			})
			.optional(),
		contract: z
			.object({
				operationKind: z.literal("IMAGE_TO_VIDEO"),
				outputMimeType: z.literal("video/mp4"),
				aspectRatio: aiVisualAspectRatioSchema,
				durationSeconds: aiVisualDurationSchema,
			})
			.optional(),
	})
	.strict();

export type AiVisualEstimate = z.infer<typeof aiVisualEstimateSchema>;

export const aiVisualConfirmInputSchema = z
	.object({
		generation: aiVisualGenerationInputSchema,
		estimate: aiVisualEstimateSchema,
		confirmed: z.literal(true),
	})
	.strict();

export const aiVisualGenerationIdSchema = z.object({ generationId: idText });

export const aiVisualHistoryInputSchema = z
	.object({ projectId: idText })
	.strict();

export const aiVisualRecoveryActionSchema = z.enum([
	"RECONCILE",
	"ATTACH_ORPHAN_ARTIFACT",
	"ACKNOWLEDGE_UNRESOLVED",
]);

export const aiVisualReconcileInputSchema = z
	.object({
		generationId: idText,
		action: aiVisualRecoveryActionSchema,
	})
	.strict();

export const aiVisualTestScenarioSchema = z.enum([
	"SUCCESS",
	"DEFINITIVE_FAILURE",
	"TIMEOUT_BEFORE_SEND",
	"TIMEOUT_AFTER_POSSIBLE_SEND",
	"NETWORK_UNCERTAINTY",
	"INVALID_OUTPUT",
	"STORAGE_FAILURE",
	"DB_FINALIZE_FAILURE",
	"ORPHAN_ARTIFACT",
]);

export type AiVisualTestScenario = z.infer<typeof aiVisualTestScenarioSchema>;

export type AiVisualLifecycleState =
	| "PENDING"
	| "COMPLETED"
	| "FAILED"
	| "INDETERMINATE";

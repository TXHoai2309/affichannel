import { z } from "zod";
import type { T09MaterializedTextLine } from "./text-layout";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nonEmpty = z.string().trim().min(1);

export const t09FrameIntervalSchema = z
	.object({
		startFrame: z.number().int().nonnegative(),
		endFrame: z.number().int().positive(),
	})
	.strict()
	.refine(
		(value) => value.endFrame > value.startFrame,
		"Frame interval must be increasing.",
	);

export type T09FrameInterval = z.infer<typeof t09FrameIntervalSchema>;

const t09PlanAssetSchema = z
	.object({
		assetKey: nonEmpty,
		path: nonEmpty,
		sha256,
		byteSize: z.number().int().positive(),
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		interval: t09FrameIntervalSchema,
	})
	.strict();

export type T09PlanAsset = z.infer<typeof t09PlanAssetSchema>;

const t09PlanTextLineSchema = z
	.object({
		...t09FrameIntervalSchema.shape,
		fontFilePath: nonEmpty,
		textFilePath: nonEmpty,
		line: z.object({
			lineIndex: z.number().int().nonnegative(),
			text: z.string(),
			xPx: z.number().int(),
			baselineYPx: z.number().int(),
			measuredWidthPx: z.number().int().nonnegative(),
			fontStableId: nonEmpty,
			fontSizePx: z.number().int().positive(),
			lineHeightPx: z.number().int().positive(),
		}),
	})
	.strict();

export type T09PlanTextLine = z.infer<typeof t09PlanTextLineSchema>;

export const t09RenderPlanSchema = z
	.object({
		schemaVersion: z.literal("t09-render-plan.v1"),
		exactToolManifestIdentity: nonEmpty,
		executionGate: z.enum(["BLOCKED_PENDING_BINARY_APPROVAL", "READY"]),
		compositionVersionId: nonEmpty,
		compositionFingerprint: sha256,
		outputProfileFingerprint: sha256,
		width: z.literal(1080),
		height: z.literal(1920),
		fps: z
			.object({ numerator: z.literal(30), denominator: z.literal(1) })
			.strict(),
		totalFrames: z.number().int().positive(),
		inputAssets: z.array(t09PlanAssetSchema).min(1),
		materializedTextLines: z.array(t09PlanTextLineSchema).min(1),
		outputReservation: z
			.object({
				jobId: nonEmpty,
				attemptId: nonEmpty,
				attemptNumber: z.number().int().positive(),
				outputReservationId: nonEmpty,
			})
			.strict(),
		expectedOutput: z
			.object({
				mimeType: z.literal("video/mp4"),
				videoCodec: z.literal("H.264/AVC"),
				pixelFormat: z.literal("yuv420p"),
				width: z.literal(1080),
				height: z.literal(1920),
				fps: z
					.object({ numerator: z.literal(30), denominator: z.literal(1) })
					.strict(),
				totalFrames: z.number().int().positive(),
				audio: z.literal(null),
			})
			.strict(),
	})
	.strict()
	.superRefine((plan, context) => {
		if (plan.expectedOutput.totalFrames !== plan.totalFrames)
			context.addIssue({
				code: "custom",
				path: ["expectedOutput", "totalFrames"],
				message: "Expected output frame count must match the render plan.",
			});
		for (const [index, line] of plan.materializedTextLines.entries()) {
			if (line.endFrame > plan.totalFrames)
				context.addIssue({
					code: "custom",
					path: ["materializedTextLines", index, "endFrame"],
					message: "Text frame intervals must fit inside the render plan.",
				});
		}
	});

export type T09RenderPlan = z.infer<typeof t09RenderPlanSchema>;

export type T09MaterializedTextLineInput = T09MaterializedTextLine;

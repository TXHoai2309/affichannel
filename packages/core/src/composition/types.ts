import { z } from "zod";
import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import { compositionProfileSchema, fontBundleManifestSchema } from "./profile";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const decimal = z.string().regex(/^0$|^[1-9][0-9]*$/);
const finiteNumber = z.number().finite();

export const compositionSceneTimingSchema = z
	.object({
		order: z.number().int().positive(),
		startFrame: decimal,
		durationFrames: decimal,
	})
	.strict();

export const compositionAudioTimingSchema = z
	.object({
		sourceSampleRate: z.number().int().positive(),
		trimStartSample: decimal,
		trimEndSample: decimal,
		videoStartFrame: decimal,
		videoDurationFrames: decimal,
	})
	.strict()
	.refine(
		(value) => BigInt(value.trimEndSample) > BigInt(value.trimStartSample),
		"Audio trim boundary must be increasing.",
	);

export const voiceSemanticSegmentSchema = z
	.object({
		segmentKey: z.string().trim().min(1).max(120),
		textSnapshot: z.string().trim().min(1),
		textHash: sha256,
		checksum: sha256,
		mimeType: z.literal("audio/mpeg"),
		byteSize: z.number().int().positive(),
		durationMs: z.number().int().positive(),
		timing: compositionAudioTimingSchema,
	})
	.strict();

export const voiceCompositionDependencySchema = z
	.object({
		semantic: z
			.object({
				config: z
					.object({
						provider: z.string().min(1),
						voiceId: z.string().min(1),
						language: z.string().min(2),
						speed: finiteNumber,
					})
					.strict(),
				segments: z.array(voiceSemanticSegmentSchema).min(1),
			})
			.strict(),
		provenance: z
			.object({
				configId: z.string().min(1),
				configRevision: z.number().int().positive(),
				segments: z
					.array(
						z
							.object({
								artifactId: z.string().min(1),
								sourceScriptVersionId: z.string().min(1),
								sourceScriptRevision: z.number().int().positive(),
								segmentKey: z.string().min(1),
								provider: z.string().min(1),
								storageProvider: z.enum(["local", "r2"]),
							})
							.strict(),
					)
					.min(1),
			})
			.strict(),
	})
	.strict();

export const mediaCompositionDependencySchema = z
	.object({
		role: z.string().trim().min(1).max(80),
		semantic: z
			.object({
				mediaType: z.enum(["image", "video", "audio"]),
				mimeType: z.enum([
					"image/jpeg",
					"image/png",
					"image/webp",
					"video/mp4",
					"audio/mpeg",
				]),
				checksumSha256: sha256,
				byteSize: z.number().int().positive(),
				width: z.number().int().positive().nullable(),
				height: z.number().int().positive().nullable(),
				durationMs: z.number().int().positive().nullable(),
			})
			.strict(),
		provenance: z
			.object({
				mediaAssetId: z.string().min(1),
				workspaceId: z.string().min(1),
				projectId: z.string().min(1),
			})
			.strict(),
	})
	.strict();

export const compositionInputV1Schema = z
	.object({
		schemaVersion: z.literal("composition-input.v1"),
		workspaceId: z.string().min(1),
		projectId: z.string().min(1),
		profile: compositionProfileSchema,
		script: z
			.object({
				semantic: scriptVersionEditableSnapshotSchema,
				provenance: z
					.object({
						scriptVersionId: z.string().min(1),
						revision: z.number().int().positive(),
						status: z.enum(["draft", "saved"]),
						versionNumber: z.number().int().positive().nullable(),
					})
					.strict(),
			})
			.strict(),
		voice: voiceCompositionDependencySchema,
		media: z.array(mediaCompositionDependencySchema),
		fonts: fontBundleManifestSchema,
		config: z
			.object({
				semantic: z
					.object({
						compositionProfileId: z.literal("vertical-standard-v1"),
						outputRules: z
							.object({
								language: z.literal("vi-VN"),
								aspectRatio: z.literal("9:16"),
								subtitleSafeArea: z.literal("standard"),
								claimLimit: z.number().int().nonnegative(),
								requireFinalCta: z.literal(true),
							})
							.strict(),
					})
					.strict(),
				provenance: z
					.object({
						outputRulesRevision: z.number().int().positive().nullable(),
					})
					.strict(),
			})
			.strict(),
		timeline: z
			.object({
				fps: z
					.object({
						numerator: z.number().int().positive(),
						denominator: z.number().int().positive(),
					})
					.strict(),
				totalFrames: decimal,
				scenes: z.array(compositionSceneTimingSchema).min(1),
			})
			.strict(),
	})
	.strict()
	.superRefine((input, context) => {
		if (
			input.timeline.fps.numerator !== input.profile.fps.numerator ||
			input.timeline.fps.denominator !== input.profile.fps.denominator
		) {
			context.addIssue({
				code: "custom",
				path: ["timeline", "fps"],
				message: "Timeline FPS must match the frozen composition profile.",
			});
		}
		const sceneOrders = input.script.semantic.scenes.map(
			(scene) => scene.order,
		);
		if (
			input.timeline.scenes.length !== sceneOrders.length ||
			input.timeline.scenes.some(
				(scene, index) => scene.order !== sceneOrders[index],
			)
		) {
			context.addIssue({
				code: "custom",
				path: ["timeline", "scenes"],
				message: "Timeline scenes must match script scene order.",
			});
		}
		const scriptKeys = input.script.semantic.voiceoverSegments.map(
			(segment) => segment.key,
		);
		const voiceKeys = input.voice.semantic.segments.map(
			(segment) => segment.segmentKey,
		);
		if (
			scriptKeys.length !== voiceKeys.length ||
			scriptKeys.some((key) => !voiceKeys.includes(key))
		) {
			context.addIssue({
				code: "custom",
				path: ["voice", "semantic", "segments"],
				message:
					"Every script voiceover segment needs one exact voice artifact.",
			});
		}
	});

export type CompositionInputV1 = z.infer<typeof compositionInputV1Schema>;
export type CompositionInputV1Result =
	| { ok: true; input: CompositionInputV1; fingerprint: string }
	| {
			ok: false;
			code: "COMPOSITION_INPUT_INCOMPLETE" | "COMPOSITION_INPUT_INVALID";
			issues?: string[];
	  };

export type CompositionCurrentness =
	| { state: "CURRENT" }
	| {
			state: "STALE";
			reason:
				| "SCRIPT_REVISION_CHANGED"
				| "VOICE_SOURCE_CHANGED"
				| "MEDIA_BINARY_CHANGED"
				| "CONFIG_CHANGED"
				| "PROFILE_MISMATCH";
	  }
	| { state: "UNKNOWN"; reason: string };

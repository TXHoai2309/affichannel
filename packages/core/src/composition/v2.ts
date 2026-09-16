import { z } from "zod";

import { sha256Hex } from "../claim-manifest/canonicalization";
import {
	CENTER_ZOOM_IN_V1,
	QUICK_IMAGE_DURATION_SECONDS,
	QUICK_IMAGE_FPS,
	type QuickImageDurationSeconds,
	type QuickImageSourceAuthority,
	resolveQuickImageDuration,
} from "../quick-image";
import { canonicalizeCompositionJson } from "./canonicalization";
import { compositionProfileSchema, VERTICAL_STANDARD_PROFILE } from "./profile";
import type { CompositionInputV1 } from "./types";
import {
	compositionInputV1Schema,
	mediaCompositionDependencySchema,
} from "./types";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const positiveSafeInteger = z.number().int().positive().safe();
const decimal = z.string().regex(/^[1-9][0-9]*$/);

export const QUICK_IMAGE_MEDIA_DEPENDENCY_KEY = "quick-image-source" as const;
export const QUICK_IMAGE_MEDIA_DEPENDENCY_ROLE = "QUICK_IMAGE_SOURCE" as const;

export const quickImageFrozenMediaProvenanceSchema = z
	.object({
		workspaceId: z.string().min(1),
		mediaAssetId: z.string().min(1),
		checksumSha256: sha256Schema,
		storageProvider: z.enum(["local", "r2"]),
		storageKey: z.string().refine((value) => value.trim().length > 0),
		mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
		byteSize: positiveSafeInteger,
		width: positiveSafeInteger,
		height: positiveSafeInteger,
	})
	.strict();

export const quickImageMotionSchema = z
	.object({
		kind: z.literal(CENTER_ZOOM_IN_V1.kind),
		anchor: z.literal(CENTER_ZOOM_IN_V1.anchor),
		startScale: z.literal(CENTER_ZOOM_IN_V1.startScale),
		endScale: z.literal(CENTER_ZOOM_IN_V1.endScale),
		interpolation: z.literal(CENTER_ZOOM_IN_V1.interpolation),
		timing: z.literal(CENTER_ZOOM_IN_V1.timing),
		randomness: z.literal(CENTER_ZOOM_IN_V1.randomness),
		pan: z.literal(CENTER_ZOOM_IN_V1.pan),
		customization: z.literal(CENTER_ZOOM_IN_V1.customization),
	})
	.strict();

export const quickImageCompositionSourceSchema = z
	.object({
		kind: z.literal("QUICK_IMAGE"),
		...quickImageFrozenMediaProvenanceSchema.shape,
		durationSeconds: z.union(
			QUICK_IMAGE_DURATION_SECONDS.map((value) => z.literal(value)) as [
				z.ZodLiteral<5>,
				z.ZodLiteral<10>,
				z.ZodLiteral<15>,
			],
		),
	})
	.strict();

export const compositionInputV2Schema = z
	.object({
		schemaVersion: z.literal("composition-input.v2"),
		workspaceId: z.string().min(1),
		projectId: z.string().min(1),
		profile: compositionProfileSchema,
		source: quickImageCompositionSourceSchema,
		media: z.array(mediaCompositionDependencySchema).length(1),
		timeline: z
			.object({
				fps: z
					.object({
						numerator: z.literal(QUICK_IMAGE_FPS.numerator),
						denominator: z.literal(QUICK_IMAGE_FPS.denominator),
					})
					.strict(),
				totalFrames: decimal,
			})
			.strict(),
		motion: quickImageMotionSchema,
	})
	.strict()
	.superRefine((input, context) => {
		if (
			input.workspaceId !== input.source.workspaceId ||
			input.workspaceId !== input.media[0]?.provenance.workspaceId ||
			input.projectId !== input.media[0]?.provenance.projectId
		) {
			context.addIssue({
				code: "custom",
				path: ["source"],
				message:
					"Quick Image provenance must resolve to the composition scope.",
			});
		}

		const duration = resolveQuickImageDuration(input.source.durationSeconds);
		if (
			!duration ||
			input.timeline.totalFrames !== String(duration.totalFrames)
		) {
			context.addIssue({
				code: "custom",
				path: ["timeline", "totalFrames"],
				message: "Quick Image totalFrames must match its canonical duration.",
			});
		}
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

		const dependency = input.media[0];
		if (!dependency) return;
		if (
			dependency.dependencyKey !== QUICK_IMAGE_MEDIA_DEPENDENCY_KEY ||
			dependency.role !== QUICK_IMAGE_MEDIA_DEPENDENCY_ROLE ||
			dependency.semantic.mediaType !== "image" ||
			dependency.semantic.mimeType !== input.source.mimeType ||
			dependency.semantic.checksumSha256 !== input.source.checksumSha256 ||
			dependency.semantic.byteSize !== input.source.byteSize ||
			dependency.semantic.width !== input.source.width ||
			dependency.semantic.height !== input.source.height ||
			dependency.semantic.durationMs !== null ||
			dependency.provenance.mediaAssetId !== input.source.mediaAssetId ||
			dependency.provenance.workspaceId !== input.source.workspaceId
		) {
			context.addIssue({
				code: "custom",
				path: ["media", 0],
				message:
					"Quick Image dependency must exactly match frozen source provenance.",
			});
		}
	});

export const compositionInputV2QuickImageSchema = compositionInputV2Schema;
export const compositionInputV2SourceSchema = quickImageCompositionSourceSchema;

export const compositionInputSchema = z.discriminatedUnion("schemaVersion", [
	compositionInputV1Schema,
	compositionInputV2Schema,
]);

export type CompositionInputV2 = z.infer<typeof compositionInputV2Schema>;
export type CompositionInput = CompositionInputV1 | CompositionInputV2;

export type CompositionInputV2Result =
	| { ok: true; input: CompositionInputV2; fingerprint: string }
	| {
			ok: false;
			code: "COMPOSITION_INPUT_INCOMPLETE" | "COMPOSITION_INPUT_INVALID";
			issues?: string[];
	  };

export type CompositionInputV2QuickImageBuilderSource = Readonly<{
	workspaceId: string;
	projectId: string;
	source: QuickImageSourceAuthority;
	durationSeconds: unknown;
}>;

export function compositionSemanticProjectionV2(input: CompositionInputV2) {
	return {
		profile: input.profile,
		source: input.source,
		timeline: input.timeline,
		motion: input.motion,
		media: [...input.media]
			.sort((left, right) =>
				left.dependencyKey.localeCompare(right.dependencyKey),
			)
			.map((dependency) => ({
				dependencyKey: dependency.dependencyKey,
				role: dependency.role,
				semantic: dependency.semantic,
				provenance: dependency.provenance,
			})),
	};
}

export function canonicalCompositionSemanticJsonV2(input: CompositionInputV2) {
	return canonicalizeCompositionJson(compositionSemanticProjectionV2(input));
}

export async function buildCompositionInputV2QuickImage(
	input: CompositionInputV2QuickImageBuilderSource,
): Promise<CompositionInputV2Result> {
	const duration = resolveQuickImageDuration(input.durationSeconds);
	if (!duration) {
		return {
			ok: false,
			code: "COMPOSITION_INPUT_INVALID",
			issues: ["source.durationSeconds"],
		};
	}
	const candidate = {
		schemaVersion: "composition-input.v2" as const,
		workspaceId: input.workspaceId,
		projectId: input.projectId,
		profile: VERTICAL_STANDARD_PROFILE,
		source: {
			kind: "QUICK_IMAGE" as const,
			workspaceId: input.source.workspaceId,
			mediaAssetId: input.source.id,
			checksumSha256: input.source.checksumSha256,
			storageProvider: input.source.storageProvider,
			storageKey: input.source.storageKey,
			mimeType: input.source.mimeType,
			byteSize: input.source.byteSize,
			width: input.source.width,
			height: input.source.height,
			durationSeconds: duration.seconds,
		},
		media: [
			{
				dependencyKey: QUICK_IMAGE_MEDIA_DEPENDENCY_KEY,
				role: QUICK_IMAGE_MEDIA_DEPENDENCY_ROLE,
				semantic: {
					mediaType: "image" as const,
					mimeType: input.source.mimeType,
					checksumSha256: input.source.checksumSha256,
					byteSize: input.source.byteSize,
					width: input.source.width,
					height: input.source.height,
					durationMs: null,
				},
				provenance: {
					mediaAssetId: input.source.id,
					workspaceId: input.source.workspaceId,
					projectId: input.projectId,
				},
			},
		],
		timeline: {
			fps: QUICK_IMAGE_FPS,
			totalFrames: String(duration.totalFrames),
		},
		motion: CENTER_ZOOM_IN_V1,
	};
	const parsed = compositionInputV2Schema.safeParse(candidate);
	if (!parsed.success) {
		return {
			ok: false,
			code: "COMPOSITION_INPUT_INVALID",
			issues: parsed.error.issues.map((issue) => issue.path.join(".")),
		};
	}
	return {
		ok: true,
		input: parsed.data,
		fingerprint: await sha256Hex(
			canonicalCompositionSemanticJsonV2(parsed.data),
		),
	};
}

export const buildCompositionInputV2 = buildCompositionInputV2QuickImage;

export function isCompositionInputV2(
	input: CompositionInputV1 | CompositionInputV2,
): input is CompositionInputV2 {
	return input.schemaVersion === "composition-input.v2";
}

export type QuickImageCompositionDuration = QuickImageDurationSeconds;

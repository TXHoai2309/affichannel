import { z } from "zod";

export const compositionProfileId = "vertical-standard-v1" as const;

export const compositionProfileSchema = z
	.object({
		id: z.literal(compositionProfileId),
		logicalWidth: z.literal(1080),
		logicalHeight: z.literal(1920),
		aspectRatio: z.literal("9:16"),
		fps: z
			.object({ numerator: z.literal(30), denominator: z.literal(1) })
			.strict(),
		safeArea: z
			.object({
				left: z.literal(90),
				right: z.literal(90),
				top: z.literal(120),
				bottom: z.literal(240),
			})
			.strict(),
		workingColorSpace: z.literal("BT.709"),
		workingPixelModel: z.literal("RGBA"),
	})
	.strict();

export type CompositionProfile = z.infer<typeof compositionProfileSchema>;

export const VERTICAL_STANDARD_PROFILE: CompositionProfile = {
	id: compositionProfileId,
	logicalWidth: 1080,
	logicalHeight: 1920,
	aspectRatio: "9:16",
	fps: { numerator: 30, denominator: 1 },
	safeArea: { left: 90, right: 90, top: 120, bottom: 240 },
	workingColorSpace: "BT.709",
	workingPixelModel: "RGBA",
};

export const fontBundleId = "affichannel-fonts-v1" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const fontFacePinSchema = z
	.object({
		family: z.literal("Noto Sans"),
		weight: z.union([z.literal(400), z.literal(600), z.literal(700)]),
		style: z.literal("normal"),
		fontId: z.string().trim().min(1).max(200),
		contentSha256: sha256Schema,
	})
	.strict();

export const fontBundleManifestSchema = z
	.object({
		bundleId: z.literal(fontBundleId),
		faces: z.array(fontFacePinSchema).length(3),
	})
	.strict()
	.superRefine((manifest, context) => {
		const weights = manifest.faces.map((face) => face.weight);
		if (new Set(weights).size !== 3) {
			context.addIssue({
				code: "custom",
				path: ["faces"],
				message: "Font weights must be unique.",
			});
		}
	});

export type FontBundleManifest = z.infer<typeof fontBundleManifestSchema>;

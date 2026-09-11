import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const prototypeToolManifestSchema = z
	.object({
		schemaVersion: z.literal("affichannel-render-tool-manifest.v1"),
		tool: z.literal("ffmpeg"),
		approvalStatus: z.enum(["PENDING_BINARY_APPROVAL", "APPROVED"]),
		version: z.string().trim().min(1).nullable(),
		platform: z.literal("windows"),
		architecture: z.literal("x64"),
		binarySha256: sha256.nullable(),
		buildIdentity: z.string().trim().min(1).nullable(),
		buildFlags: z.array(z.string().trim().min(1)),
		sourceOrDistributionReference: z.string().trim().min(1).nullable(),
		licenseMetadata: z
			.object({
				ffmpegLicense: z.string().trim().min(1),
				encoderLicenses: z.array(z.string().trim().min(1)).min(1),
				noticeSha256: sha256,
			})
			.strict()
			.nullable(),
		licenseNotice: z.string().trim().min(1),
		rendererAdapterVersion: z.literal("affichannel-ffmpeg-adapter-v1"),
	})
	.strict()
	.superRefine((manifest, context) => {
		if (manifest.approvalStatus === "APPROVED") {
			if (!manifest.version)
				context.addIssue({
					code: "custom",
					path: ["version"],
					message: "An approved tool must pin its exact version.",
				});
			if (!manifest.binarySha256)
				context.addIssue({
					code: "custom",
					path: ["binarySha256"],
					message: "An approved tool must pin its exact binary SHA-256.",
				});
			if (!manifest.buildIdentity)
				context.addIssue({
					code: "custom",
					path: ["buildIdentity"],
					message: "An approved tool must pin its build identity.",
				});
			if (!manifest.sourceOrDistributionReference)
				context.addIssue({
					code: "custom",
					path: ["sourceOrDistributionReference"],
					message: "An approved tool must pin its distribution reference.",
				});
			if (!manifest.licenseMetadata)
				context.addIssue({
					code: "custom",
					path: ["licenseMetadata"],
					message:
						"An approved tool must pin license metadata and notice hash.",
				});
		}
	});

export type PrototypeToolManifest = z.infer<typeof prototypeToolManifestSchema>;

export const T09_FFMPEG_TOOL_MANIFEST: PrototypeToolManifest = {
	schemaVersion: "affichannel-render-tool-manifest.v1",
	tool: "ffmpeg",
	approvalStatus: "PENDING_BINARY_APPROVAL",
	version: null,
	platform: "windows",
	architecture: "x64",
	binarySha256: null,
	buildIdentity: null,
	buildFlags: [],
	sourceOrDistributionReference: null,
	licenseMetadata: null,
	licenseNotice:
		"FFmpeg and encoder license review is required before execution; this manifest is not legal approval.",
	rendererAdapterVersion: "affichannel-ffmpeg-adapter-v1",
};

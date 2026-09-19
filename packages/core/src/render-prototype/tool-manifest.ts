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

/**
 * US22 owns a separate approval record. T09 remains pending so its historical
 * authority and identity cannot be changed by production Quick Image work.
 */
export const US22_QUICK_IMAGE_FFMPEG_TOOL_PATH =
	"C:\\Program Files\\Affichannel\\ffmpeg\\9.0.1-essentials_build\\bin\\ffmpeg.exe" as const;

export const US22_QUICK_IMAGE_FFMPEG_TOOL_MANIFEST: PrototypeToolManifest = {
	schemaVersion: "affichannel-render-tool-manifest.v1",
	tool: "ffmpeg",
	approvalStatus: "APPROVED",
	version: "9.0.1-essentials_build-www.gyan.dev",
	platform: "windows",
	architecture: "x64",
	binarySha256:
		"72a489eccd008c2ec2c0a5856c5c75bc3d8bbfa90166c4566865c246445e6aa3",
	buildIdentity: "9.0.1-essentials_build-www.gyan.dev",
	buildFlags: [],
	sourceOrDistributionReference:
		"https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.1-essentials_build.zip",
	licenseMetadata: {
		ffmpegLicense: "GPLv3",
		encoderLicenses: ["GNU General Public License v2.0 or later"],
		noticeSha256:
			"8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
	},
	licenseNotice: "ffmpeg-9.0.1-essentials_build/LICENSE",
	rendererAdapterVersion: "affichannel-ffmpeg-adapter-v1",
};

export const quickImageFfmpegToolApprovalSchema = z
	.object({
		schemaVersion: z.literal("affichannel-quick-image-tool-approval.v1"),
		toolManifest: prototypeToolManifestSchema,
		executablePath: z.string().trim().min(1),
		profileId: z.literal("mp4-h264-video-only-v1"),
		profileFingerprint: sha256,
		commandPlanVersion: z.literal("quick-image-command-plan.v1"),
		approvedSourceMimeTypes: z
			.array(z.enum(["image/png", "image/jpeg"]))
			.min(1),
		approvedFrameCounts: z
			.array(z.union([z.literal(150), z.literal(300), z.literal(450)]))
			.min(1),
		shell: z.literal(false),
		pathFallback: z.literal(false),
	})
	.strict();

export const US22_QUICK_IMAGE_FFMPEG_TOOL_APPROVAL =
	quickImageFfmpegToolApprovalSchema.parse({
		schemaVersion: "affichannel-quick-image-tool-approval.v1",
		toolManifest: US22_QUICK_IMAGE_FFMPEG_TOOL_MANIFEST,
		executablePath: US22_QUICK_IMAGE_FFMPEG_TOOL_PATH,
		profileId: "mp4-h264-video-only-v1",
		profileFingerprint:
			"6e72408da1c49c0f869ecb286bb89644fc6142a3a684a9f168f85f30384efb26",
		commandPlanVersion: "quick-image-command-plan.v1",
		approvedSourceMimeTypes: ["image/png", "image/jpeg"],
		approvedFrameCounts: [150, 300, 450],
		shell: false,
		pathFallback: false,
	});

export type QuickImageFfmpegToolApproval = z.infer<
	typeof quickImageFfmpegToolApprovalSchema
>;

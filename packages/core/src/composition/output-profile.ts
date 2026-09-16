import { z } from "zod";
import { sha256Hex } from "../claim-manifest/canonicalization";
import { canonicalizeCompositionJson } from "./canonicalization";

export const outputEncodingProfileId = "mp4-h264-aac-v1" as const;

export const videoOnlyOutputProfileId = "mp4-h264-video-only-v1" as const;

export const outputEncodingProfileSchema = z
	.object({
		id: z.literal(outputEncodingProfileId),
		container: z.literal("MP4"),
		videoCodec: z.literal("H.264/AVC"),
		pixelFormat: z.literal("yuv420p"),
		audioCodec: z.literal("AAC-LC"),
		audioSampleRate: z.literal(48000),
		audioChannels: z.literal(2),
		colorDelivery: z.literal("BT.709"),
		videoBitrateKbps: z.number().int().positive().nullable(),
		videoCrf: z.number().int().min(0).max(51).nullable(),
		audioBitrateKbps: z.number().int().positive().nullable(),
		keyframeIntervalFrames: z.number().int().positive().nullable(),
	})
	.strict();

export type OutputEncodingProfile = z.infer<typeof outputEncodingProfileSchema>;

/**
 * Production profile for frozen Quick Image renders. This is deliberately
 * separate from the historical T09 prototype profile: the profile identity is
 * part of the render contract and must not inherit T09 ownership.
 */
export const videoOnlyOutputProfileSchema = z
	.object({
		id: z.literal(videoOnlyOutputProfileId),
		container: z.literal("MP4"),
		videoCodec: z.literal("H.264/AVC"),
		pixelFormat: z.literal("yuv420p"),
		width: z.literal(1080),
		height: z.literal(1920),
		fps: z
			.object({ numerator: z.literal(30), denominator: z.literal(1) })
			.strict(),
		videoBitrateKbps: z.literal(2000),
		gop: z.literal(30),
		keyint: z.literal(30),
		minKeyint: z.literal(30),
		scenecut: z.literal(false),
		bFrames: z.literal(0),
		closedGop: z.literal(true),
		threads: z.literal(1),
		colorPrimaries: z.literal("BT.709"),
		colorTransfer: z.literal("BT.709"),
		colorSpace: z.literal("BT.709"),
		colorRange: z.literal("LIMITED_TV"),
		audio: z.literal("NONE"),
	})
	.strict();

export type VideoOnlyOutputProfile = z.infer<
	typeof videoOnlyOutputProfileSchema
>;

export const MP4_H264_VIDEO_ONLY_V1: VideoOnlyOutputProfile = {
	id: videoOnlyOutputProfileId,
	container: "MP4",
	videoCodec: "H.264/AVC",
	pixelFormat: "yuv420p",
	width: 1080,
	height: 1920,
	fps: { numerator: 30, denominator: 1 },
	videoBitrateKbps: 2000,
	gop: 30,
	keyint: 30,
	minKeyint: 30,
	scenecut: false,
	bFrames: 0,
	closedGop: true,
	threads: 1,
	colorPrimaries: "BT.709",
	colorTransfer: "BT.709",
	colorSpace: "BT.709",
	colorRange: "LIMITED_TV",
	audio: "NONE",
};

/** Owner-frozen fields are present; unresolved encoder choices stay null. */
export const MP4_H264_AAC_V1: OutputEncodingProfile = {
	id: outputEncodingProfileId,
	container: "MP4",
	videoCodec: "H.264/AVC",
	pixelFormat: "yuv420p",
	audioCodec: "AAC-LC",
	audioSampleRate: 48000,
	audioChannels: 2,
	colorDelivery: "BT.709",
	videoBitrateKbps: null,
	videoCrf: null,
	audioBitrateKbps: null,
	keyframeIntervalFrames: null,
};

export function parseOutputEncodingProfile(value: unknown) {
	return outputEncodingProfileSchema.safeParse(value);
}

export function isOutputEncodingProfileComplete(
	profile: OutputEncodingProfile,
): boolean {
	return (
		profile.videoBitrateKbps !== null &&
		profile.videoCrf !== null &&
		profile.audioBitrateKbps !== null &&
		profile.keyframeIntervalFrames !== null
	);
}

export async function fingerprintVideoOnlyOutputProfile(
	profile: VideoOnlyOutputProfile = MP4_H264_VIDEO_ONLY_V1,
): Promise<string> {
	const parsed = videoOnlyOutputProfileSchema.parse(profile);
	return sha256Hex(canonicalizeCompositionJson(parsed));
}

export async function fingerprintOutputEncodingProfile(
	profile: OutputEncodingProfile,
): Promise<string> {
	if (!isOutputEncodingProfileComplete(profile)) {
		throw new Error("OUTPUT_ENCODING_PROFILE_INCOMPLETE");
	}
	return sha256Hex(canonicalizeCompositionJson(profile));
}

export type RenderRequestSpecV1 = {
	schemaVersion: "render-request.v1";
	compositionVersionId: string;
	compositionFingerprint: string;
	outputEncodingProfile: OutputEncodingProfile;
	outputEncodingProfileFingerprint: string;
	outputContractVersion: string;
};

export const renderRequestSpecV1Schema = z
	.object({
		schemaVersion: z.literal("render-request.v1"),
		compositionVersionId: z.string().min(1),
		compositionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
		outputEncodingProfile: outputEncodingProfileSchema,
		outputEncodingProfileFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
		outputContractVersion: z.string().min(1),
	})
	.strict();

export async function canonicalRequestHash(
	spec: RenderRequestSpecV1,
): Promise<string> {
	const parsed = renderRequestSpecV1Schema.safeParse(spec);
	if (!parsed.success) throw new Error("RENDER_REQUEST_PROFILE_INVALID");
	const validatedSpec = parsed.data;
	if (!isOutputEncodingProfileComplete(validatedSpec.outputEncodingProfile)) {
		throw new Error("OUTPUT_ENCODING_PROFILE_INCOMPLETE");
	}
	const expectedProfileFingerprint = await fingerprintOutputEncodingProfile(
		validatedSpec.outputEncodingProfile,
	);
	if (
		expectedProfileFingerprint !==
		validatedSpec.outputEncodingProfileFingerprint
	) {
		throw new Error("RENDER_REQUEST_PROFILE_INVALID");
	}
	return sha256Hex(
		canonicalizeCompositionJson({
			inputVersion: "render-request.v1",
			compositionFingerprint: validatedSpec.compositionFingerprint,
			outputEncodingProfileFingerprint:
				validatedSpec.outputEncodingProfileFingerprint,
			outputContractVersion: validatedSpec.outputContractVersion,
		}),
	);
}

import { z } from "zod";
import { sha256Hex } from "../claim-manifest/canonicalization";
import { canonicalizeCompositionJson } from "./canonicalization";

export const outputEncodingProfileId = "mp4-h264-aac-v1" as const;

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
	if (!isOutputEncodingProfileComplete(spec.outputEncodingProfile)) {
		throw new Error("OUTPUT_ENCODING_PROFILE_INCOMPLETE");
	}
	const expectedProfileFingerprint = await fingerprintOutputEncodingProfile(
		spec.outputEncodingProfile,
	);
	if (expectedProfileFingerprint !== spec.outputEncodingProfileFingerprint) {
		throw new Error("RENDER_REQUEST_PROFILE_INVALID");
	}
	return sha256Hex(
		canonicalizeCompositionJson({
			inputVersion: "composition-input.v1",
			compositionFingerprint: spec.compositionFingerprint,
			outputEncodingProfileFingerprint: spec.outputEncodingProfileFingerprint,
			outputContractVersion: spec.outputContractVersion,
		}),
	);
}

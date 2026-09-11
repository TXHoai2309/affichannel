import { z } from "zod";
import { sha256Hex } from "../claim-manifest/canonicalization";
import { canonicalizeCompositionJson } from "../composition/canonicalization";

export const t09PrototypeProfileId = "mp4-h264-video-only-t09-v1" as const;

export const t09PrototypeOutputProfileSchema = z
	.object({
		id: z.literal(t09PrototypeProfileId),
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
		color: z.literal("BT.709"),
		audio: z.literal("NONE"),
	})
	.strict();

export type T09PrototypeOutputProfile = z.infer<
	typeof t09PrototypeOutputProfileSchema
>;

export const T09_VIDEO_ONLY_PROFILE: T09PrototypeOutputProfile = {
	id: t09PrototypeProfileId,
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
	color: "BT.709",
	audio: "NONE",
};

export async function fingerprintT09PrototypeProfile(
	profile: T09PrototypeOutputProfile = T09_VIDEO_ONLY_PROFILE,
): Promise<string> {
	const parsed = t09PrototypeOutputProfileSchema.parse(profile);
	return sha256Hex(canonicalizeCompositionJson(parsed));
}

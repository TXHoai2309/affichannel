import { VoiceSegmentError } from "@affichannel/core";
import { parseBuffer } from "music-metadata";

export async function parseMp3DurationMs(audio: Uint8Array) {
	if (audio.byteLength === 0) {
		throw new VoiceSegmentError(
			"TTS_AUDIO_METADATA_INVALID",
			"Audio bytes are empty.",
		);
	}

	try {
		const metadata = await parseBuffer(
			Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength),
			{ mimeType: "audio/mpeg", size: audio.byteLength },
		);
		const durationSeconds = metadata.format.duration;
		if (
			durationSeconds === undefined ||
			!Number.isFinite(durationSeconds) ||
			durationSeconds <= 0
		) {
			throw new Error("MP3 duration is missing or not positive.");
		}
		const durationMs = Math.round(durationSeconds * 1_000);
		if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
			throw new Error("MP3 duration is outside the supported range.");
		}
		return durationMs;
	} catch (error) {
		if (error instanceof VoiceSegmentError) throw error;
		throw new VoiceSegmentError(
			"TTS_AUDIO_METADATA_INVALID",
			"Could not parse valid MP3 duration metadata.",
		);
	}
}

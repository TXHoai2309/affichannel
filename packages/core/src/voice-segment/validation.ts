import { VoiceSegmentError } from "./errors";

export const DEFAULT_VOICE_SEGMENT_MAX_CHARS = 4_000;
export const DEFAULT_VOICE_SEGMENT_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const DEFAULT_VOICE_SEGMENT_TIMEOUT_MS = 60_000;
export const DEFAULT_VOICE_SEGMENT_PENDING_LEASE_MS = 5 * 60_000;

export function countVoiceSegmentCodePoints(value: string) {
	return Array.from(value).length;
}

/**
 * The returned text is byte-for-byte unchanged. Validation intentionally does
 * not trim, collapse whitespace, or apply Unicode normalization because the
 * exact snapshot is the TTS input and the source of its hash.
 */
export function validateVoiceSegmentText(
	text: unknown,
	maxChars = DEFAULT_VOICE_SEGMENT_MAX_CHARS,
) {
	if (typeof text !== "string" || text.trim().length === 0) {
		throw new VoiceSegmentError(
			"VOICE_SEGMENT_INPUT_INVALID",
			"Voice segment text must not be empty.",
		);
	}
	if (!Number.isInteger(maxChars) || maxChars < 1) {
		throw new VoiceSegmentError(
			"VOICE_SEGMENT_INPUT_INVALID",
			"Voice segment maximum length is invalid.",
		);
	}
	const codePointLength = countVoiceSegmentCodePoints(text);
	if (codePointLength > maxChars) {
		throw new VoiceSegmentError(
			"VOICE_SEGMENT_INPUT_TOO_LONG",
			"Voice segment text exceeds the configured maximum length.",
			{ maxChars, codePointLength },
		);
	}
	return text;
}

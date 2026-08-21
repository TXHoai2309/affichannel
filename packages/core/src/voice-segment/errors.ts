export const voiceSegmentErrorCodes = [
	"VOICE_SEGMENT_NOT_FOUND",
	"VOICE_SEGMENT_IDEMPOTENCY_CONFLICT",
	"VOICE_SEGMENT_ALREADY_PENDING",
	"VOICE_SEGMENT_CONTEXT_STALE",
	"VOICE_SEGMENT_INPUT_INVALID",
	"VOICE_SEGMENT_INPUT_TOO_LONG",
	"VOICE_SEGMENT_STORAGE_KEY_INVALID",
	"TTS_INVALID_AUDIO",
	"TTS_AUDIO_METADATA_INVALID",
	"TTS_PROVIDER_FAILED",
	"TTS_PROVIDER_UNAVAILABLE",
	"TTS_REQUEST_STATE_UNCERTAIN",
	"TTS_TIMEOUT_UNCERTAIN",
	"TTS_STORAGE_CONFIGURATION_INVALID",
	"TTS_STORAGE_FAILED",
	"TTS_PERSISTENCE_FAILED",
] as const;

export type VoiceSegmentErrorCode = (typeof voiceSegmentErrorCodes)[number];

export class VoiceSegmentError extends Error {
	readonly code: VoiceSegmentErrorCode;
	readonly metadata: Record<string, unknown> | undefined;

	constructor(
		code: VoiceSegmentErrorCode,
		message: string = code,
		metadata?: Record<string, unknown>,
	) {
		super(message);
		this.name = "VoiceSegmentError";
		this.code = code;
		this.metadata = metadata;
	}
}

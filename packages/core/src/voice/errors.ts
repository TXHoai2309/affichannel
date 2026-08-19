export const voiceConfigErrorCodes = [
	"VOICE_CONFIG_NOT_FOUND",
	"VOICE_CONFIG_CONFLICT",
	"VOICE_CONFIG_INPUT_INVALID",
	"TTS_VOICE_NOT_FOUND",
	"TTS_LANGUAGE_NOT_SUPPORTED",
	"TTS_SPEED_OUT_OF_RANGE",
	"TTS_PREVIEW_TIMEOUT",
	"TTS_PROVIDER_UNAVAILABLE",
	"TTS_PREVIEW_FAILED",
] as const;

export type VoiceConfigErrorCode = (typeof voiceConfigErrorCodes)[number];

export class VoiceConfigError extends Error {
	readonly code: VoiceConfigErrorCode;
	readonly metadata: Record<string, unknown> | undefined;

	constructor(
		code: VoiceConfigErrorCode,
		message: string = code,
		metadata?: Record<string, unknown>,
	) {
		super(message);
		this.name = "VoiceConfigError";
		this.code = code;
		this.metadata = metadata;
	}
}

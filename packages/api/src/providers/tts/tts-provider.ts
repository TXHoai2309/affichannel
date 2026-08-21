import type { VoicePreset } from "@affichannel/core";

export type TtsPreviewInput = {
	text: string;
	voiceId: string;
	language: string;
	speed: number;
};

export type TtsPreviewResult = {
	audio: Uint8Array;
	contentType: "audio/mpeg";
	providerRequestId: string | null;
	latencyMs: number | null;
};

export type TtsGenerateSegmentResult = {
	audio: Uint8Array;
	contentType: "audio/mpeg";
	providerRequestId: string | null;
	providerDurationMs?: number | null;
};

export const ttsProviderErrorCodes = [
	"TTS_PROVIDER_FAILED",
	"TTS_PROVIDER_UNAVAILABLE",
	"TTS_REQUEST_STATE_UNCERTAIN",
	"TTS_TIMEOUT_UNCERTAIN",
] as const;

export type TtsProviderErrorCode = (typeof ttsProviderErrorCodes)[number];

export class TtsProviderError extends Error {
	readonly code: TtsProviderErrorCode;
	readonly uncertain: boolean;
	readonly providerRequestId: string | null;

	constructor(
		code: TtsProviderErrorCode,
		message: string,
		options: {
			uncertain?: boolean;
			providerRequestId?: string | null;
		} = {},
	) {
		super(message);
		this.name = "TtsProviderError";
		this.code = code;
		this.uncertain = options.uncertain ?? code.includes("UNCERTAIN");
		this.providerRequestId = options.providerRequestId ?? null;
	}
}

export interface TtsProvider {
	readonly providerId: string;
	listVoices(): VoicePreset[];
	preview(input: TtsPreviewInput): Promise<TtsPreviewResult>;
	generateSegment(input: TtsPreviewInput): Promise<TtsGenerateSegmentResult>;
}

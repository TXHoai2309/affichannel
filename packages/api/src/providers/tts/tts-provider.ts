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

export interface TtsProvider {
	readonly providerId: string;
	listVoices(): VoicePreset[];
	preview(input: TtsPreviewInput): Promise<TtsPreviewResult>;
}

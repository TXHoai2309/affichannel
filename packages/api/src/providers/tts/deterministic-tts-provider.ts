import { listVoicePresets, TTS_PROVIDER } from "@affichannel/core";

import type {
	TtsPreviewInput,
	TtsPreviewResult,
	TtsProvider,
} from "./tts-provider";

// One small MPEG Layer III frame, sufficient for deterministic browser/test transport.
const DETERMINISTIC_MPEG_FRAME = Uint8Array.from({ length: 417 }, (_, index) =>
	index === 0
		? 0xff
		: index === 1
			? 0xfb
			: index === 2
				? 0x90
				: index === 3
					? 0x64
					: 0,
);

export class DeterministicTtsProvider implements TtsProvider {
	readonly providerId = TTS_PROVIDER;

	listVoices() {
		return listVoicePresets();
	}

	async preview(_input: TtsPreviewInput): Promise<TtsPreviewResult> {
		return {
			audio: new Uint8Array(DETERMINISTIC_MPEG_FRAME),
			contentType: "audio/mpeg",
			providerRequestId: "deterministic-tts-preview",
			latencyMs: 1,
		};
	}
}

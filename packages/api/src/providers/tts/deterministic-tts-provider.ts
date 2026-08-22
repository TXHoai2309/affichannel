import { listVoicePresets, TTS_PROVIDER } from "@affichannel/core";

import type {
	TtsGenerateSegmentResult,
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

function deterministicSegmentAudio() {
	const audio = new Uint8Array(DETERMINISTIC_MPEG_FRAME.byteLength * 40);
	for (let index = 0; index < 40; index += 1) {
		audio.set(
			DETERMINISTIC_MPEG_FRAME,
			index * DETERMINISTIC_MPEG_FRAME.byteLength,
		);
	}
	return audio;
}

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

	async generateSegment(
		_input: TtsPreviewInput,
	): Promise<TtsGenerateSegmentResult> {
		return {
			audio: deterministicSegmentAudio(),
			contentType: "audio/mpeg",
			providerRequestId: "deterministic-tts-segment",
			providerDurationMs: null,
		};
	}
}

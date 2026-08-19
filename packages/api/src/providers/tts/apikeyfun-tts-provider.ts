import {
	listVoicePresets,
	TTS_PROVIDER,
	VoiceConfigError,
} from "@affichannel/core";

import type {
	TtsPreviewInput,
	TtsPreviewResult,
	TtsProvider,
} from "./tts-provider";

/**
 * Phase 1 only exposes the verified server-owned catalog. The live preview
 * adapter is intentionally deferred to AFF-US-011 Phase 2.
 */
export class ApiKeyFunTtsProvider implements TtsProvider {
	readonly providerId = TTS_PROVIDER;

	listVoices() {
		return listVoicePresets();
	}

	preview(_input: TtsPreviewInput): Promise<TtsPreviewResult> {
		return Promise.reject(
			new VoiceConfigError(
				"TTS_PROVIDER_UNAVAILABLE",
				"TTS preview runtime chưa được bật trong Phase 1.",
			),
		);
	}
}

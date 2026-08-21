import { env } from "@affichannel/env/server";

import {
	ApiKeyFunTtsProvider,
	type ApiKeyFunTtsProviderOptions,
} from "./apikeyfun-tts-provider";
import { DeterministicTtsProvider } from "./deterministic-tts-provider";
import type { TtsProvider } from "./tts-provider";

export type TtsProviderResolutionOptions = {
	apikeyfun?: ApiKeyFunTtsProviderOptions;
};

function resolveApikeyFunOptions(
	options: TtsProviderResolutionOptions,
): ApiKeyFunTtsProviderOptions | null {
	if (options.apikeyfun) return options.apikeyfun;
	if (!env.TTS_APIKEY_FUN_API_KEY) return null;
	return {
		apiKey: env.TTS_APIKEY_FUN_API_KEY,
		baseUrl: env.TTS_APIKEY_FUN_BASE_URL,
		timeoutMs: env.TTS_PREVIEW_TIMEOUT_MS,
		segmentTimeoutMs: env.VOICE_SEGMENT_TIMEOUT_MS,
		segmentMaxBytes: env.VOICE_SEGMENT_MAX_AUDIO_BYTES,
	};
}

export function resolveTtsProvider(
	providerName = env.TTS_DEFAULT_PROVIDER,
	options: TtsProviderResolutionOptions = {},
): TtsProvider | undefined {
	if (providerName !== "apikeyfun") return undefined;
	if (env.AFFICHANNEL_E2E_TTS_DETERMINISTIC === "1") {
		if (env.NODE_ENV === "production") return undefined;
		return new DeterministicTtsProvider();
	}
	const providerOptions = resolveApikeyFunOptions(options);
	return providerOptions
		? new ApiKeyFunTtsProvider(providerOptions)
		: undefined;
}

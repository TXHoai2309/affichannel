import type { ScriptGenerationInputSnapshot } from "@affichannel/core/script-generation/types";
import { env } from "@affichannel/env/server";

import {
	type ApikeyFunPricing,
	ApikeyFunTextProvider,
	type ApikeyFunTextProviderOptions,
	DEFAULT_APIKEY_FUN_BASE_URL,
} from "./apikeyfun-text-provider";
import { DeterministicTextProvider } from "./deterministic-text-provider";
import type { TextProvider } from "./text-provider";

export type TextProviderResolutionOptions = {
	allowDeterministic: boolean;
	apikeyfun?: ApikeyFunTextProviderOptions;
};

function resolveApikeyFunPricing(): ApikeyFunPricing | null {
	const {
		APIKEY_FUN_PRICING_VERSION: version,
		APIKEY_FUN_PRICING_CURRENCY: currency,
		APIKEY_FUN_INPUT_PRICE_MICROS_PER_MILLION: inputPrice,
		APIKEY_FUN_OUTPUT_PRICE_MICROS_PER_MILLION: outputPrice,
		APIKEY_FUN_ESTIMATED_OUTPUT_TOKENS: estimatedOutputTokens,
	} = env;
	if (
		!version ||
		!currency ||
		!inputPrice ||
		!outputPrice ||
		estimatedOutputTokens === undefined
	)
		return null;
	return {
		version,
		currency,
		inputMicrosPerMillionTokens: BigInt(inputPrice),
		outputMicrosPerMillionTokens: BigInt(outputPrice),
		estimatedOutputTokens,
	};
}

function resolveApikeyFunOptions(
	options: TextProviderResolutionOptions,
): ApikeyFunTextProviderOptions | null {
	if (options.apikeyfun) return options.apikeyfun;
	if (!env.APIKEY_FUN_API_KEY) return null;
	return {
		apiKey: env.APIKEY_FUN_API_KEY,
		baseUrl: env.APIKEY_FUN_BASE_URL ?? DEFAULT_APIKEY_FUN_BASE_URL,
		timeoutMs: env.TEXT_AI_TIMEOUT_MS,
		maxOutputTokens: env.TEXT_AI_MAX_OUTPUT_TOKENS,
		pricing: resolveApikeyFunPricing(),
	};
}

export function resolveTextProvider(
	providerName: string,
	snapshot: ScriptGenerationInputSnapshot,
	options: TextProviderResolutionOptions,
): TextProvider | undefined {
	if (providerName === "deterministic" && options.allowDeterministic) {
		return new DeterministicTextProvider({ snapshot });
	}
	if (providerName === "apikeyfun") {
		const providerOptions = resolveApikeyFunOptions(options);
		return providerOptions
			? new ApikeyFunTextProvider(providerOptions)
			: undefined;
	}
	return undefined;
}

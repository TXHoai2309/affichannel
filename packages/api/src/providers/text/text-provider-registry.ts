import type { ScriptGenerationInputSnapshot } from "@affichannel/core/script-generation/types";

import { DeterministicTextProvider } from "./deterministic-text-provider";
import type { TextProvider } from "./text-provider";

export type TextProviderResolutionOptions = {
	allowDeterministic: boolean;
};

export function resolveTextProvider(
	providerName: string,
	snapshot: ScriptGenerationInputSnapshot,
	options: TextProviderResolutionOptions,
): TextProvider | undefined {
	if (providerName === "deterministic" && options.allowDeterministic) {
		return new DeterministicTextProvider({ snapshot });
	}
	return undefined;
}

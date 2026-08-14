import { canonicalizeJson } from "@affichannel/core/script-generation/canonical-json";
import type { ScriptGenerationInputSnapshot } from "@affichannel/core/script-generation/types";

export function renderScriptPrompt(snapshot: ScriptGenerationInputSnapshot) {
	return [
		"You are a structured content drafting provider.",
		"Use only the supplied Product Facts. Do not invent claims, prices, guarantees, or secrets.",
		"Return JSON conforming to the requested output schema.",
		canonicalizeJson(snapshot),
	].join("\n");
}

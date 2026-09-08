import { canonicalizeJson } from "../script-generation/canonical-json";

const decimalInteger = /^0$|^[1-9][0-9]*$/;

function normalizeTiming(value: unknown, path: string): unknown {
	if (typeof value === "bigint") return value.toString(10);
	if (
		typeof value === "string" &&
		/Frame$|Sample$|Frames$|Samples$/.test(path)
	) {
		if (!decimalInteger.test(value))
			throw new Error(`Invalid integer timing at ${path}`);
		return value;
	}
	if (Array.isArray(value))
		return value.map((item, index) =>
			normalizeTiming(item, `${path}[${index}]`),
		);
	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value))
			output[key] = normalizeTiming(item, `${path}.${key}`);
		return output;
	}
	return value;
}

/** Narrow composition-only extension: bigint timing is represented as decimal text. */
export function canonicalizeCompositionJson(value: unknown): string {
	return canonicalizeJson(normalizeTiming(value, "$"));
}

export function compositionSemanticProjection<
	T extends {
		script: { provenance: unknown };
		voice: { provenance: unknown };
		media: unknown[];
		fonts: unknown;
		config: { provenance?: unknown };
	},
>(input: T) {
	const { provenance: _scriptProvenance, ...script } = input.script;
	const { provenance: _voiceProvenance, ...voice } = input.voice;
	const { provenance: _configProvenance, ...config } = input.config;
	return {
		script,
		voice,
		media: input.media.map((item) => {
			if (!item || typeof item !== "object") return item;
			const { provenance: _provenance, ...semantic } = item as Record<
				string,
				unknown
			>;
			return semantic;
		}),
		fonts: input.fonts,
		config,
		timeline: (input as unknown as { timeline: unknown }).timeline,
		profile: (input as unknown as { profile: unknown }).profile,
	};
}

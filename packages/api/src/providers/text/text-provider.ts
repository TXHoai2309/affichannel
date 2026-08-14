export type TextProviderScenario = "valid" | "partial" | "malformed" | "timeout" | "provider_error";

export type TextProviderRequest = {
	prompt: string;
	model: string;
	mode: "full" | "repair";
	sections: string[];
	idempotencyKey: string;
};

export type TextProviderResult = {
	content: unknown;
	providerRequestId: string;
	inputTokens: number | null;
	outputTokens: number | null;
	estimatedCostMicros: bigint | null;
	actualCostMicros: bigint | null;
	currency: string | null;
};

export class TextProviderError extends Error {
	readonly code: "AI_TIMEOUT" | "AI_PROVIDER_ERROR";

	constructor(code: "AI_TIMEOUT" | "AI_PROVIDER_ERROR", message: string = code) {
		super(message);
		this.name = "TextProviderError";
		this.code = code;
	}
}

export interface TextProvider {
	readonly name: string;
	generate(request: TextProviderRequest): Promise<TextProviderResult>;
}

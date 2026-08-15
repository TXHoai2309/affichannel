export type TextProviderScenario =
	| "valid"
	| "partial"
	| "malformed"
	| "timeout"
	| "timeout_uncertain"
	| "provider_uncertain"
	| "provider_error";

export type TextProviderMessage = {
	role: "system" | "developer" | "user";
	content: string;
};

export type TextProviderRequest = {
	messages: TextProviderMessage[];
	model: string;
	mode: "full" | "repair";
	sections: string[];
	idempotencyKey: string;
};

export type TextProviderResult = {
	content: unknown;
	providerRequestId: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	estimatedCostMicros: bigint | null;
	actualCostMicros: bigint | null;
	currency: string | null;
	provider?: string;
	model?: string;
	finishReason?: string | null;
};

export type TextProviderEstimateRequest = {
	messages: TextProviderMessage[];
	model: string;
	mode: "full" | "repair";
	sections: string[];
};

export type TextProviderEstimate = {
	estimatedCostMicros: bigint | null;
	currency: string | null;
	inputTokens: number | null;
	pricingBasis: string | null;
};

export class TextProviderError extends Error {
	readonly code:
		| "AI_TIMEOUT"
		| "AI_TIMEOUT_UNCERTAIN"
		| "AI_PROVIDER_UNCERTAIN"
		| "AI_PROVIDER_ERROR";

	constructor(
		code:
			| "AI_TIMEOUT"
			| "AI_TIMEOUT_UNCERTAIN"
			| "AI_PROVIDER_UNCERTAIN"
			| "AI_PROVIDER_ERROR",
		message: string = code,
	) {
		super(message);
		this.name = "TextProviderError";
		this.code = code;
	}
}

export interface TextProvider {
	readonly name: string;
	estimateCost(
		request: TextProviderEstimateRequest,
	): Promise<TextProviderEstimate>;
	generate(request: TextProviderRequest): Promise<TextProviderResult>;
}

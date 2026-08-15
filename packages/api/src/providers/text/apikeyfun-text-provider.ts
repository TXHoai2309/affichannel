import { ScriptGenerationError } from "@affichannel/core";

import {
	type TextProvider,
	TextProviderError,
	type TextProviderEstimate,
	type TextProviderEstimateRequest,
	type TextProviderMessage,
	type TextProviderRequest,
	type TextProviderResult,
} from "./text-provider";

export const DEFAULT_APIKEY_FUN_BASE_URL = "https://api.apikey.fun";

const MICROS_PER_MILLION_TOKENS = BigInt(1_000_000);
const ONE_MICRO = BigInt(1);

export type ApikeyFunPricing = {
	version: string;
	currency: string;
	inputMicrosPerMillionTokens: bigint;
	outputMicrosPerMillionTokens: bigint;
	estimatedOutputTokens: number;
};

export type ApikeyFunTextProviderOptions = {
	apiKey: string;
	baseUrl?: string;
	timeoutMs: number;
	maxOutputTokens: number;
	pricing?: ApikeyFunPricing | null;
	fetchImplementation?: typeof fetch;
};

type Usage = {
	inputTokens: number | null;
	outputTokens: number | null;
};

type ParsedProviderResponse = {
	contentText: string;
	providerRequestId: string | null;
	usage: Usage;
	finishReason: string | null;
	reportedCost: { micros: bigint; currency: string } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

function firstPositiveInteger(...values: unknown[]) {
	for (const value of values) {
		const parsed = positiveInteger(value);
		if (parsed !== null) return parsed;
	}
	return null;
}

function normalizeCurrency(value: unknown) {
	return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

function normalizeEndpoint(baseUrl: string) {
	const normalized = baseUrl.replace(/\/+$/, "");
	return normalized.endsWith("/v1")
		? `${normalized}/messages`
		: `${normalized}/v1/messages`;
}

function estimateTokens(messages: TextProviderMessage[]) {
	const bytes = new TextEncoder().encode(
		messages.map((message) => `${message.role}: ${message.content}`).join("\n"),
	).byteLength;
	return Math.max(1, Math.ceil(bytes / 4));
}

function ceilDivide(value: bigint, divisor: bigint) {
	return (value + divisor - ONE_MICRO) / divisor;
}

function calculateCost(
	inputTokens: number,
	outputTokens: number,
	pricing: ApikeyFunPricing,
) {
	const inputCost = BigInt(inputTokens) * pricing.inputMicrosPerMillionTokens;
	const outputCost =
		BigInt(outputTokens) * pricing.outputMicrosPerMillionTokens;
	return ceilDivide(inputCost + outputCost, MICROS_PER_MILLION_TOKENS);
}

function decimalToMicros(value: unknown) {
	const text = typeof value === "number" ? String(value) : value;
	if (typeof text !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(text)) {
		return null;
	}
	const [whole = "0", fraction = ""] = text.split(".");
	return (
		BigInt(whole) * MICROS_PER_MILLION_TOKENS + BigInt(fraction.padEnd(6, "0"))
	);
}

function reportedCost(root: Record<string, unknown>) {
	const usage = isRecord(root.usage) ? root.usage : null;
	if (!usage) return null;
	const micros = decimalToMicros(usage.cost ?? usage.total_cost);
	const currency = normalizeCurrency(usage.currency ?? root.currency);
	return micros !== null && currency ? { micros, currency } : null;
}

function usageFrom(root: Record<string, unknown>): Usage {
	const usage = isRecord(root.usage) ? root.usage : {};
	return {
		inputTokens: firstPositiveInteger(
			usage.input_tokens,
			usage.inputTokens,
			usage.prompt_tokens,
		),
		outputTokens: firstPositiveInteger(
			usage.output_tokens,
			usage.outputTokens,
			usage.completion_tokens,
		),
	};
}

function mergeUsage(current: Usage, next: Usage): Usage {
	return {
		inputTokens: next.inputTokens ?? current.inputTokens,
		outputTokens: next.outputTokens ?? current.outputTokens,
	};
}

function contentTextFrom(root: Record<string, unknown>) {
	if (typeof root.output_text === "string") return root.output_text;
	const content = root.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.flatMap((block) =>
				isRecord(block) && typeof block.text === "string" ? [block.text] : [],
			)
			.join("");
	}
	const choices = root.choices;
	if (Array.isArray(choices)) {
		const message = choices[0];
		if (isRecord(message)) {
			const nested = isRecord(message.message) ? message.message.content : null;
			if (typeof nested === "string") return nested;
		}
	}
	return "";
}

function parseJsonContent(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

function parseSse(raw: string): ParsedProviderResponse | null {
	const hasSseMarker = /^(?:event|data|id|retry):/m.test(raw);
	if (!hasSseMarker) return null;
	const frames = raw.split(/\r?\n\r?\n/);
	let contentText = "";
	let providerRequestId: string | null = null;
	let usage: Usage = { inputTokens: null, outputTokens: null };
	let finishReason: string | null = null;
	let reported: { micros: bigint; currency: string } | null = null;
	let sawEvent = false;
	let sawCompletion = false;

	for (const frame of frames) {
		const lines = frame.split(/\r?\n/);
		const eventName = lines
			.find((line) => line.startsWith("event:"))
			?.slice(6)
			.trim();
		const dataLines = lines
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).replace(/^ /, ""));
		if (eventName === "error" && dataLines.length === 0) {
			throw new TextProviderError(
				"AI_PROVIDER_UNCERTAIN",
				"Text provider reported a stream error; delivery state is uncertain.",
			);
		}
		if (dataLines.length === 0) continue;
		const data = dataLines.join("\n").trim();
		if (!data) continue;
		if (data === "[DONE]") {
			sawCompletion = true;
			continue;
		}
		let event: unknown;
		try {
			event = JSON.parse(data) as unknown;
		} catch {
			throw new TextProviderError(
				"AI_PROVIDER_UNCERTAIN",
				"Text provider returned malformed stream data; delivery state is uncertain.",
			);
		}
		if (!isRecord(event)) {
			throw new TextProviderError(
				"AI_PROVIDER_UNCERTAIN",
				"Text provider returned an invalid stream event; delivery state is uncertain.",
			);
		}
		sawEvent = true;
		const type = typeof event.type === "string" ? event.type : "";
		if (
			eventName === "error" ||
			type === "error" ||
			(type === "error_event" && isRecord(event.error))
		) {
			throw new TextProviderError(
				"AI_PROVIDER_UNCERTAIN",
				"Text provider reported a stream error; delivery state is uncertain.",
			);
		}
		if (type === "message_start") {
			const message = isRecord(event.message) ? event.message : event;
			if (typeof message.id === "string") providerRequestId = message.id;
			if (isRecord(message.usage)) {
				usage = mergeUsage(usage, usageFrom({ usage: message.usage }));
			}
		}
		if (type === "content_block_delta" && isRecord(event.delta)) {
			if (typeof event.delta.text === "string") contentText += event.delta.text;
		}
		if (type === "message_delta") {
			const delta = isRecord(event.delta) ? event.delta : event;
			if (typeof delta.stop_reason === "string")
				finishReason = delta.stop_reason;
			if (isRecord(event.usage))
				usage = mergeUsage(usage, usageFrom({ usage: event.usage }));
		}
		if (typeof event.id === "string" && !providerRequestId)
			providerRequestId = event.id;
		if (type === "message_stop") {
			sawCompletion = true;
			if (isRecord(event.usage)) {
				usage = mergeUsage(usage, usageFrom({ usage: event.usage }));
			}
		}
		const cost = reportedCost(event);
		if (cost) reported = cost;
	}

	if (!sawEvent) {
		throw new TextProviderError(
			"AI_PROVIDER_UNCERTAIN",
			"Text provider stream did not contain a valid event; delivery state is uncertain.",
		);
	}
	if (!sawCompletion) {
		throw new TextProviderError(
			"AI_PROVIDER_UNCERTAIN",
			"Text provider stream closed before completion; delivery state is uncertain.",
		);
	}
	return {
		contentText,
		providerRequestId,
		usage,
		finishReason,
		reportedCost: reported,
	};
}

function parseResponseBody(raw: string): ParsedProviderResponse {
	const sse = parseSse(raw);
	if (sse) return sse;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return {
			contentText: raw,
			providerRequestId: null,
			usage: { inputTokens: null, outputTokens: null },
			finishReason: null,
			reportedCost: null,
		};
	}
	if (!isRecord(parsed)) {
		return {
			contentText: raw,
			providerRequestId: null,
			usage: { inputTokens: null, outputTokens: null },
			finishReason: null,
			reportedCost: null,
		};
	}
	if (
		parsed.type === "error" ||
		(parsed.type === "error_event" && isRecord(parsed.error))
	) {
		throw new TextProviderError(
			"AI_PROVIDER_UNCERTAIN",
			"Text provider reported an error after accepting the request; delivery state is uncertain.",
		);
	}
	const choices = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
	const finishReason =
		isRecord(choices) && typeof choices.finish_reason === "string"
			? choices.finish_reason
			: typeof parsed.stop_reason === "string"
				? parsed.stop_reason
				: null;
	return {
		contentText: contentTextFrom(parsed),
		providerRequestId: typeof parsed.id === "string" ? parsed.id : null,
		usage: usageFrom(parsed),
		finishReason,
		reportedCost: reportedCost(parsed),
	};
}

function headerRequestId(response: Response) {
	return (
		response.headers.get("request-id") ??
		response.headers.get("x-request-id") ??
		null
	);
}

function isAbortError(error: unknown) {
	return (
		error instanceof Error &&
		(error.name === "AbortError" || /aborted|timeout/i.test(error.message))
	);
}

function safeProviderError(status: number) {
	if (status === 408)
		return new TextProviderError(
			"AI_TIMEOUT_UNCERTAIN",
			"Text provider returned a timeout; delivery state is uncertain.",
		);
	if (status === 401 || status === 403)
		return new TextProviderError(
			"AI_PROVIDER_ERROR",
			"Text provider authentication or configuration failed.",
		);
	if (status === 400)
		return new TextProviderError(
			"AI_PROVIDER_ERROR",
			"Text provider rejected the generation request.",
		);
	if (status === 404)
		return new TextProviderError(
			"AI_PROVIDER_ERROR",
			"Configured text model was not found by the provider.",
		);
	if (status === 429)
		return new TextProviderError(
			"AI_PROVIDER_ERROR",
			"Text provider rate limit was reached.",
		);
	if (status >= 500 && status <= 599)
		return new TextProviderError(
			"AI_PROVIDER_UNCERTAIN",
			"Text provider returned a server error; delivery state is uncertain.",
		);
	return new TextProviderError(
		"AI_PROVIDER_ERROR",
		"Text provider request failed.",
	);
}

function toAnthropicMessages(messages: TextProviderMessage[]) {
	const systemBlocks = messages
		.filter(
			(message) => message.role === "system" || message.role === "developer",
		)
		.map((message) => `[${message.role}]\n${message.content}`);
	const userMessages = messages
		.filter((message) => message.role === "user")
		.map((message) => ({ role: "user" as const, content: message.content }));
	return {
		system: systemBlocks.length > 0 ? systemBlocks.join("\n\n") : undefined,
		messages:
			userMessages.length > 0
				? userMessages
				: [{ role: "user" as const, content: "Return the requested JSON." }],
	};
}

export class ApikeyFunTextProvider implements TextProvider {
	readonly name = "apikeyfun";
	private readonly options: ApikeyFunTextProviderOptions;
	private readonly fetchImplementation: typeof fetch;

	constructor(options: ApikeyFunTextProviderOptions) {
		this.options = options;
		this.fetchImplementation = options.fetchImplementation ?? fetch;
	}

	private requirePricing(): ApikeyFunPricing {
		const pricing = this.options.pricing;
		if (
			!pricing ||
			pricing.inputMicrosPerMillionTokens < BigInt(0) ||
			pricing.outputMicrosPerMillionTokens < BigInt(0) ||
			pricing.estimatedOutputTokens < 1 ||
			(pricing.inputMicrosPerMillionTokens === BigInt(0) &&
				pricing.outputMicrosPerMillionTokens === BigInt(0))
		) {
			throw new ScriptGenerationError(
				"COST_ESTIMATE_UNAVAILABLE",
				"A versioned provider pricing configuration is required before generation.",
			);
		}
		return pricing;
	}

	private calculateEstimate(
		request: TextProviderEstimateRequest | TextProviderRequest,
	) {
		const pricing = this.requirePricing();
		const inputTokens = estimateTokens(request.messages);
		return {
			pricing,
			inputTokens,
			estimatedCostMicros: calculateCost(
				inputTokens,
				pricing.estimatedOutputTokens,
				pricing,
			),
		};
	}

	async estimateCost(
		request: TextProviderEstimateRequest,
	): Promise<TextProviderEstimate> {
		const estimate = this.calculateEstimate(request);
		return {
			estimatedCostMicros: estimate.estimatedCostMicros,
			currency: estimate.pricing.currency,
			inputTokens: estimate.inputTokens,
			pricingBasis: `${estimate.pricing.version}; input-bytes/4; output-budget=${estimate.pricing.estimatedOutputTokens}`,
		};
	}

	async generate(request: TextProviderRequest): Promise<TextProviderResult> {
		if (!request.idempotencyKey.trim()) {
			throw new ScriptGenerationError(
				"IDEMPOTENCY_CONFLICT",
				"Provider request requires an idempotency key.",
			);
		}
		const estimate = this.calculateEstimate(request);
		const mapped = toAnthropicMessages(request.messages);
		const body = {
			model: request.model,
			max_tokens: this.options.maxOutputTokens,
			stream: true,
			...(mapped.system ? { system: mapped.system } : {}),
			messages: mapped.messages,
		};
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			this.options.timeoutMs,
		);
		let response: Response;
		try {
			response = await this.fetchImplementation(
				normalizeEndpoint(this.options.baseUrl ?? DEFAULT_APIKEY_FUN_BASE_URL),
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.options.apiKey}`,
						"Content-Type": "application/json",
						Accept: "text/event-stream",
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				},
			);
			if (!response.ok) throw safeProviderError(response.status);
			const parsed = parseResponseBody(await response.text());
			return {
				content: parseJsonContent(parsed.contentText),
				providerRequestId:
					parsed.providerRequestId ?? headerRequestId(response),
				inputTokens: parsed.usage.inputTokens,
				outputTokens: parsed.usage.outputTokens,
				estimatedCostMicros: estimate.estimatedCostMicros,
				actualCostMicros: parsed.reportedCost?.micros ?? null,
				currency: parsed.reportedCost?.currency ?? estimate.pricing.currency,
				provider: this.name,
				model: request.model,
				finishReason: parsed.finishReason,
			};
		} catch (error) {
			if (error instanceof TextProviderError) throw error;
			if (error instanceof ScriptGenerationError) throw error;
			if (isAbortError(error)) {
				throw new TextProviderError(
					"AI_TIMEOUT_UNCERTAIN",
					"Text provider request timed out; delivery state is uncertain.",
				);
			}
			throw new TextProviderError(
				"AI_TIMEOUT_UNCERTAIN",
				"Text provider network state is uncertain; no automatic retry was attempted.",
			);
		} finally {
			clearTimeout(timeout);
		}
	}
}

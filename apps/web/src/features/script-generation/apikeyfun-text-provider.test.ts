import {
	type ApikeyFunPricing,
	ApikeyFunTextProvider,
} from "@affichannel/api/providers/text/apikeyfun-text-provider";
import type { TextProviderRequest } from "@affichannel/api/providers/text/text-provider";
import { resolveTextProvider } from "@affichannel/api/providers/text/text-provider-registry";
import { validateScriptDraftOutput } from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

const pricing: ApikeyFunPricing = {
	version: "test-pricing-2026-08",
	currency: "CNY",
	inputMicrosPerMillionTokens: BigInt(1_000_000),
	outputMicrosPerMillionTokens: BigInt(2_000_000),
	estimatedOutputTokens: 100,
};

const request: TextProviderRequest = {
	messages: [
		{ role: "system", content: "Trusted instruction." },
		{ role: "developer", content: "Return only JSON." },
		{ role: "user", content: "Product fact: battery lasts 20 hours." },
	],
	model: "claude-sonnet-4-6",
	mode: "full",
	sections: ["hook", "voiceover", "scenes"],
	idempotencyKey: "apikeyfun-unit-test",
};

function sseResponse(
	content: string,
	options?: { id?: string; usage?: boolean; requestIdHeader?: string },
) {
	const events = [
		`event: message_start\ndata: ${JSON.stringify({
			type: "message_start",
			message: {
				id: options?.id,
				usage: options?.usage ? { input_tokens: 12 } : undefined,
			},
		})}`,
		`event: content_block_delta\ndata: ${JSON.stringify({
			type: "content_block_delta",
			delta: { type: "text_delta", text: content },
		})}`,
		`event: message_delta\ndata: ${JSON.stringify({
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: options?.usage ? { output_tokens: 34 } : undefined,
		})}`,
		'event: message_stop\ndata: {"type":"message_stop"}',
	].join("\n\n");
	return new Response(`${events}\n\n`, {
		status: 200,
		headers: {
			"content-type": "text/event-stream",
			...(options?.requestIdHeader
				? { "x-request-id": options.requestIdHeader }
				: {}),
		},
	});
}

function makeProvider(
	fetchImplementation: typeof fetch,
	options: Partial<ConstructorParameters<typeof ApikeyFunTextProvider>[0]> = {},
) {
	return new ApikeyFunTextProvider({
		apiKey: "test-api-key",
		baseUrl: "https://api.example.test",
		timeoutMs: 100,
		maxOutputTokens: 8_192,
		pricing,
		fetchImplementation,
		...options,
	});
}

describe("APIKEY.FUN text provider adapter", () => {
	it("maps the documented Anthropic Messages SSE contract and preserves prompt boundaries", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			sseResponse('{"schemaVersion":"script-output.v2"}', {
				id: "msg_test_1",
				usage: true,
			}),
		);
		const provider = makeProvider(fetchMock);

		const result = await provider.generate(request);
		const [, init] = fetchMock.mock.calls[0] ?? [];
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.test/v1/messages",
			expect.objectContaining({ method: "POST" }),
		);
		expect(body.model).toBe("claude-sonnet-4-6");
		expect(body.stream).toBe(true);
		expect(body).not.toHaveProperty("response_format");
		expect(body.system).toContain("[system]");
		expect(body.system).toContain("[developer]");
		expect(body.messages).toEqual([
			{ role: "user", content: "Product fact: battery lasts 20 hours." },
		]);
		expect(result.content).toEqual({ schemaVersion: "script-output.v2" });
		expect(result.providerRequestId).toBe("msg_test_1");
		expect(result.inputTokens).toBe(12);
		expect(result.outputTokens).toBe(34);
		expect(result.finishReason).toBe("end_turn");
		expect(result.currency).toBe("CNY");
	});

	it("leaves malformed structured content for server-side domain validation", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			sseResponse("not-json", { id: "msg_malformed", usage: false }),
		);
		const result = await makeProvider(fetchMock).generate(request);

		expect(result.content).toBe("not-json");
		expect(validateScriptDraftOutput(result.content, 30).status).toBe("failed");
	});

	it("preserves null usage and request ID when the provider omits them", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			sseResponse('{"draft":"ok"}', { usage: false }),
		);
		const result = await makeProvider(fetchMock).generate(request);

		expect(result.providerRequestId).toBeNull();
		expect(result.inputTokens).toBeNull();
		expect(result.outputTokens).toBeNull();
		expect(result.actualCostMicros).toBeNull();
	});

	it("uses a provider request ID header when the body has no ID", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			sseResponse('{"draft":"ok"}', {
				usage: false,
				requestIdHeader: "header-request-1",
			}),
		);
		const result = await makeProvider(fetchMock).generate(request);

		expect(result.providerRequestId).toBe("header-request-1");
	});

	it("normalizes provider HTTP errors without exposing provider payloads", async () => {
		for (const status of [401, 403, 400, 404, 429, 500]) {
			const fetchMock = vi.fn<typeof fetch>(
				async () =>
					new Response('{"message":"secret provider detail"}', { status }),
			);
			await expect(
				makeProvider(fetchMock).generate(request),
			).rejects.toMatchObject({
				code: "AI_PROVIDER_ERROR",
			});
			await expect(
				makeProvider(fetchMock).generate(request),
			).rejects.not.toThrow("secret provider detail");
		}
		const timeoutResponse = vi.fn<typeof fetch>(
			async () => new Response("timeout", { status: 408 }),
		);
		await expect(
			makeProvider(timeoutResponse).generate(request),
		).rejects.toMatchObject({ code: "AI_TIMEOUT" });
	});

	it("classifies abort and network failures as uncertain without retrying", async () => {
		const abortFetch = vi.fn<typeof fetch>(
			async (_input, init) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						const error = new Error("request aborted");
						error.name = "AbortError";
						reject(error);
					});
				}),
		);
		await expect(
			makeProvider(abortFetch, { timeoutMs: 1 }).generate(request),
		).rejects.toMatchObject({ code: "AI_TIMEOUT_UNCERTAIN" });
		expect(abortFetch).toHaveBeenCalledTimes(1);

		const networkFetch = vi.fn<typeof fetch>(async () => {
			throw new Error("socket closed");
		});
		await expect(
			makeProvider(networkFetch).generate(request),
		).rejects.toMatchObject({
			code: "AI_TIMEOUT_UNCERTAIN",
		});
	});

	it("calculates configured non-zero cost without calling generate", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		const provider = makeProvider(fetchMock);
		const estimate = await provider.estimateCost(request);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(estimate.estimatedCostMicros).not.toBeNull();
		expect(estimate.estimatedCostMicros).toBeGreaterThan(BigInt(0));
		expect(estimate.currency).toBe("CNY");
		expect(estimate.pricingBasis).toContain("test-pricing-2026-08");

		await expect(
			makeProvider(fetchMock, { pricing: null }).estimateCost(request),
		).rejects.toMatchObject({ code: "COST_ESTIMATE_UNAVAILABLE" });
	});

	it("resolves APIKEY.FUN through the registry and never enables deterministic implicitly", () => {
		const provider = resolveTextProvider("apikeyfun", {} as never, {
			allowDeterministic: false,
			apikeyfun: {
				apiKey: "test-api-key",
				timeoutMs: 100,
				maxOutputTokens: 8_192,
				pricing,
			},
		});
		expect(provider?.name).toBe("apikeyfun");
		expect(
			resolveTextProvider("deterministic", {} as never, {
				allowDeterministic: false,
			}),
		).toBeUndefined();
	});
});

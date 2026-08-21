import { ApiKeyFunTtsProvider } from "@affichannel/api/providers/tts/apikeyfun-tts-provider";
import { TtsProviderError } from "@affichannel/api/providers/tts/tts-provider";
import { VoiceConfigError } from "@affichannel/core";
import { describe, expect, it, vi } from "vitest";

const previewInput = {
	text: "Xin chào.",
	voiceId: "eve",
	language: "vi",
	speed: 1,
};

function audioResponse(
	bytes: Uint8Array = new Uint8Array([0xff, 0xfb, 0x90]),
	contentType = "audio/mpeg",
) {
	return new Response(bytes.buffer as ArrayBuffer, {
		status: 200,
		headers: {
			"content-type": contentType,
			"x-request-id": "tts-request-1",
		},
	});
}

function makeProvider(
	fetchImplementation: typeof fetch,
	options: Partial<ConstructorParameters<typeof ApiKeyFunTtsProvider>[0]> = {},
) {
	return new ApiKeyFunTtsProvider({
		apiKey: "test-tts-key",
		baseUrl: "https://api.example.test/",
		timeoutMs: 100,
		fetchImplementation,
		...options,
	});
}

describe("ApiKeyFun TTS preview adapter", () => {
	it("sends the server-owned preview contract and returns audio metadata", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => audioResponse());
		const result = await makeProvider(fetchMock).preview(previewInput);
		const [url, init] = fetchMock.mock.calls[0] ?? [];

		expect(url).toBe("https://api.example.test/v1/tts");
		expect(init?.method).toBe("POST");
		expect(init?.headers).toEqual({
			Authorization: "Bearer test-tts-key",
			"Content-Type": "application/json",
			Accept: "audio/mpeg",
		});
		expect(JSON.parse(String(init?.body))).toEqual({
			text: "Xin chào.",
			voice_id: "eve",
			language: "vi",
			speed: 1,
		});
		expect(result.contentType).toBe("audio/mpeg");
		expect(result.audio.byteLength).toBe(3);
		expect(result.providerRequestId).toBe("tts-request-1");
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("fails closed before fetch for invalid input or missing server key", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => audioResponse());
		await expect(
			makeProvider(fetchMock).preview({ ...previewInput, text: "  " }),
		).rejects.toMatchObject({ code: "VOICE_CONFIG_INPUT_INVALID" });
		await expect(
			makeProvider(fetchMock).preview({ ...previewInput, voiceId: "unknown" }),
		).rejects.toMatchObject({ code: "TTS_VOICE_NOT_FOUND" });
		expect(fetchMock).not.toHaveBeenCalled();

		await expect(
			new ApiKeyFunTtsProvider({ fetchImplementation: fetchMock }).preview(
				previewInput,
			),
		).rejects.toMatchObject({ code: "TTS_PROVIDER_UNAVAILABLE" });
	});

	it.each([
		["application/json", "TTS_PREVIEW_FAILED"],
		["text/html", "TTS_PROVIDER_UNAVAILABLE"],
		["", "TTS_PREVIEW_FAILED"],
	] as const)("maps unsafe MIME %s to %s", async (mime, code) => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			mime
				? audioResponse(new Uint8Array([1]), mime)
				: new Response(new Uint8Array([1]).buffer as ArrayBuffer),
		);
		await expect(
			makeProvider(fetchMock).preview(previewInput),
		).rejects.toMatchObject({
			code,
		});
	});

	it("rejects empty and oversized audio without exposing upstream payloads", async () => {
		const emptyFetch = vi.fn<typeof fetch>(async () =>
			audioResponse(new Uint8Array()),
		);
		await expect(
			makeProvider(emptyFetch).preview(previewInput),
		).rejects.toMatchObject({
			code: "TTS_PREVIEW_FAILED",
		});

		const oversizedFetch = vi.fn<typeof fetch>(async () =>
			audioResponse(new Uint8Array([1, 2, 3, 4]), "audio/mpeg"),
		);
		await expect(
			makeProvider(oversizedFetch, { maxBytes: 3 }).preview(previewInput),
		).rejects.toMatchObject({ code: "TTS_PREVIEW_FAILED" });
	});

	it("maps provider availability and timeout deterministically, with no retry", async () => {
		const unavailableFetch = vi.fn<typeof fetch>(
			async () => new Response("provider detail", { status: 503 }),
		);
		await expect(
			makeProvider(unavailableFetch).preview(previewInput),
		).rejects.toMatchObject({
			code: "TTS_PROVIDER_UNAVAILABLE",
		});
		expect(unavailableFetch).toHaveBeenCalledTimes(1);

		const timeoutFetch = vi.fn<typeof fetch>(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						const error = new Error("aborted");
						error.name = "AbortError";
						reject(error);
					});
				}),
		);
		await expect(
			makeProvider(timeoutFetch, { timeoutMs: 10 }).preview(previewInput),
		).rejects.toMatchObject({ code: "TTS_PREVIEW_TIMEOUT" });
		expect(timeoutFetch).toHaveBeenCalledTimes(1);

		const networkFetch = vi.fn<typeof fetch>(async () => {
			throw new Error("ECONNRESET");
		});
		await expect(
			makeProvider(networkFetch).preview(previewInput),
		).rejects.toMatchObject({
			code: "TTS_PROVIDER_UNAVAILABLE",
		});
	});

	it("uses the canonical catalog for provider voice listing", () => {
		const provider = makeProvider(vi.fn<typeof fetch>());
		expect(provider.listVoices().map((voice) => voice.id)).toEqual([
			"ara",
			"eve",
			"leo",
			"rex",
			"sal",
		]);
	});

	it("supports segment generation with the same canonical request and a 60s-class policy", async () => {
		const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
			expect(init?.signal).toBeDefined();
			return audioResponse(new Uint8Array([0xff, 0xfb, 0x90]));
		});
		const provider = makeProvider(fetchMock, {
			segmentTimeoutMs: 60_000,
			segmentMaxBytes: 10 * 1024 * 1024,
		});
		const result = await provider.generateSegment({
			text: "Giá 150.000 ₫ — AffiChannel 🎙️",
			voiceId: "eve",
			language: "vi",
			speed: 1,
		});
		const [, init] = fetchMock.mock.calls[0] ?? [];

		expect(JSON.parse(String(init?.body))).toEqual({
			text: "Giá 150.000 ₫ — AffiChannel 🎙️",
			voice_id: "eve",
			language: "vi",
			speed: 1,
		});
		expect(result.providerDurationMs).toBeNull();
		expect(result.providerRequestId).toBe("tts-request-1");
	});

	it.each([
		[408, "TTS_REQUEST_STATE_UNCERTAIN"],
		[500, "TTS_REQUEST_STATE_UNCERTAIN"],
	] as const)(
		"classifies HTTP %s generation as uncertain without retry",
		async (status, code) => {
			const fetchMock = vi.fn<typeof fetch>(
				async () =>
					new Response("upstream detail", {
						status,
						headers: { "x-request-id": "uncertain-1" },
					}),
			);
			await expect(
				makeProvider(fetchMock).generateSegment(previewInput),
			).rejects.toMatchObject({
				code,
				providerRequestId: "uncertain-1",
				uncertain: true,
			});
			expect(fetchMock).toHaveBeenCalledTimes(1);
		},
	);

	it("classifies malformed successful segment responses as known provider failure", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () =>
			audioResponse(new Uint8Array([1]), "application/json"),
		);
		await expect(
			makeProvider(fetchMock).generateSegment(previewInput),
		).rejects.toMatchObject({
			code: "TTS_PROVIDER_FAILED",
		});

		const timeoutFetch = vi.fn<typeof fetch>(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						const error = new Error("timeout");
						error.name = "AbortError";
						reject(error);
					});
				}),
		);
		await expect(
			makeProvider(timeoutFetch, { segmentTimeoutMs: 10 }).generateSegment(
				previewInput,
			),
		).rejects.toBeInstanceOf(TtsProviderError);
		await expect(
			makeProvider(timeoutFetch, { segmentTimeoutMs: 10 }).generateSegment(
				previewInput,
			),
		).rejects.toMatchObject({
			code: "TTS_TIMEOUT_UNCERTAIN",
			uncertain: true,
		});
	});

	it("keeps adapter errors typed without retaining provider response text", async () => {
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response("sensitive provider response", { status: 429 }),
		);
		try {
			await makeProvider(fetchMock).preview(previewInput);
		} catch (error) {
			expect(error).toBeInstanceOf(VoiceConfigError);
			expect(
				error instanceof Error ? error.message : String(error),
			).not.toContain("sensitive provider response");
		}
	});
});

import {
	listVoicePresets,
	TTS_PROVIDER,
	VoiceConfigError,
	validateVoiceConfigFields,
} from "@affichannel/core";

import type {
	TtsPreviewInput,
	TtsPreviewResult,
	TtsProvider,
} from "./tts-provider";

export const DEFAULT_APIKEY_FUN_TTS_BASE_URL = "https://api.apikey.fun";
export const DEFAULT_TTS_PREVIEW_TIMEOUT_MS = 30_000;
export const TTS_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

export type ApiKeyFunTtsProviderOptions = {
	apiKey?: string;
	baseUrl?: string;
	timeoutMs?: number;
	maxBytes?: number;
	fetchImplementation?: typeof fetch;
};

function normalizeEndpoint(baseUrl: string) {
	const normalized = baseUrl.replace(/\/+$/, "");
	return normalized.endsWith("/v1")
		? `${normalized}/tts`
		: `${normalized}/v1/tts`;
}

function normalizeContentType(value: string | null) {
	return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function requestId(response: Response) {
	return (
		response.headers.get("x-request-id") ?? response.headers.get("request-id")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function invalidInput(message: string, metadata?: Record<string, unknown>) {
	return new VoiceConfigError("VOICE_CONFIG_INPUT_INVALID", message, metadata);
}

function providerUnavailable(message: string) {
	return new VoiceConfigError("TTS_PROVIDER_UNAVAILABLE", message);
}

function previewFailed(message: string) {
	return new VoiceConfigError("TTS_PREVIEW_FAILED", message);
}

function isTimeoutError(error: unknown, timedOut: boolean) {
	return (
		timedOut ||
		(error instanceof Error &&
			(error.name === "TimeoutError" ||
				(error.name === "AbortError" && /timeout/i.test(error.message))))
	);
}

/** Thin server-only adapter. It performs one request and never retries or persists audio. */
export class ApiKeyFunTtsProvider implements TtsProvider {
	readonly providerId = TTS_PROVIDER;
	private readonly options: Required<
		Pick<ApiKeyFunTtsProviderOptions, "timeoutMs" | "maxBytes">
	> &
		Omit<ApiKeyFunTtsProviderOptions, "timeoutMs" | "maxBytes">;
	private readonly fetchImplementation: typeof fetch;

	constructor(options: ApiKeyFunTtsProviderOptions = {}) {
		this.options = {
			...options,
			timeoutMs: options.timeoutMs ?? DEFAULT_TTS_PREVIEW_TIMEOUT_MS,
			maxBytes: options.maxBytes ?? TTS_PREVIEW_MAX_BYTES,
		};
		this.fetchImplementation = options.fetchImplementation ?? fetch;
	}

	listVoices() {
		return listVoicePresets();
	}

	async preview(input: TtsPreviewInput): Promise<TtsPreviewResult> {
		if (
			!isRecord(input) ||
			typeof input.text !== "string" ||
			input.text.trim().length === 0
		) {
			throw invalidInput("Preview text không được để trống.");
		}

		const fields = validateVoiceConfigFields({
			voiceId: input.voiceId,
			language: input.language,
			speed: input.speed,
		});
		const apiKey = this.options.apiKey?.trim();
		if (!apiKey) {
			throw providerUnavailable("TTS provider chưa được cấu hình trên server.");
		}

		const startedAt = Date.now();
		const controller = new AbortController();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, this.options.timeoutMs);

		try {
			const response = await this.fetchImplementation(
				normalizeEndpoint(
					this.options.baseUrl ?? DEFAULT_APIKEY_FUN_TTS_BASE_URL,
				),
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
						Accept: "audio/mpeg",
					},
					body: JSON.stringify({
						text: input.text,
						voice_id: fields.voiceId,
						language: fields.language,
						speed: fields.speed,
					}),
					signal: controller.signal,
				},
			);

			const contentType = normalizeContentType(
				response.headers.get("content-type"),
			);
			if (!response.ok) {
				if (
					response.status === 429 ||
					(response.status >= 500 && response.status <= 599) ||
					(response.status === 403 && contentType === "text/html")
				) {
					throw providerUnavailable("TTS provider hiện không khả dụng.");
				}
				throw previewFailed("TTS provider từ chối yêu cầu preview.");
			}

			if (contentType === "text/html") {
				throw providerUnavailable("TTS provider trả về trang không khả dụng.");
			}
			if (contentType !== "audio/mpeg") {
				throw previewFailed("TTS provider trả về MIME type không hợp lệ.");
			}

			const contentLength = response.headers.get("content-length");
			if (contentLength && Number(contentLength) > this.options.maxBytes) {
				throw previewFailed("Audio preview vượt quá kích thước cho phép.");
			}

			let audio: Uint8Array;
			try {
				audio = new Uint8Array(await response.arrayBuffer());
			} catch {
				if (timedOut) {
					throw new VoiceConfigError(
						"TTS_PREVIEW_TIMEOUT",
						"TTS preview vượt quá thời gian chờ.",
					);
				}
				throw providerUnavailable(
					"Không thể đọc audio preview từ TTS provider.",
				);
			}
			if (audio.byteLength === 0) {
				throw previewFailed("TTS provider trả về audio rỗng.");
			}
			if (audio.byteLength > this.options.maxBytes) {
				throw previewFailed("Audio preview vượt quá kích thước cho phép.");
			}

			return {
				audio,
				contentType: "audio/mpeg",
				providerRequestId: requestId(response),
				latencyMs: Date.now() - startedAt,
			};
		} catch (error) {
			if (error instanceof VoiceConfigError) throw error;
			if (isTimeoutError(error, timedOut)) {
				throw new VoiceConfigError(
					"TTS_PREVIEW_TIMEOUT",
					"TTS preview vượt quá thời gian chờ.",
				);
			}
			throw providerUnavailable(
				"Không thể kết nối tới TTS provider; không tự động thử lại.",
			);
		} finally {
			clearTimeout(timeout);
		}
	}
}

import {
	DEFAULT_VOICE_SEGMENT_MAX_AUDIO_BYTES,
	DEFAULT_VOICE_SEGMENT_TIMEOUT_MS,
	listVoicePresets,
	TTS_PROVIDER,
	VoiceConfigError,
	VoiceSegmentError,
	validateVoiceConfigFields,
} from "@affichannel/core";

import {
	type TtsGenerateSegmentResult,
	type TtsPreviewInput,
	type TtsPreviewResult,
	type TtsProvider,
	TtsProviderError,
} from "./tts-provider";

export const DEFAULT_APIKEY_FUN_TTS_BASE_URL = "https://api.apikey.fun";
export const DEFAULT_TTS_PREVIEW_TIMEOUT_MS = 30_000;
export const TTS_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

export type ApiKeyFunTtsProviderOptions = {
	apiKey?: string;
	baseUrl?: string;
	timeoutMs?: number;
	maxBytes?: number;
	segmentTimeoutMs?: number;
	segmentMaxBytes?: number;
	fetchImplementation?: typeof fetch;
};

type RequestMode = "preview" | "segment";

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

function validateSynthesisInput(input: TtsPreviewInput) {
	if (
		!isRecord(input) ||
		typeof input.text !== "string" ||
		input.text.trim().length === 0
	) {
		throw invalidInput("TTS text không được để trống.");
	}

	return validateVoiceConfigFields({
		voiceId: input.voiceId,
		language: input.language,
		speed: input.speed,
	});
}

function providerSegmentFailure(
	message: string,
	providerRequestId: string | null,
) {
	return new TtsProviderError("TTS_PROVIDER_FAILED", message, {
		providerRequestId,
	});
}

function invalidSegmentAudio(message: string) {
	return new VoiceSegmentError("TTS_INVALID_AUDIO", message);
}

/** Thin server-only adapter. It performs one request and never retries. */
export class ApiKeyFunTtsProvider implements TtsProvider {
	readonly providerId = TTS_PROVIDER;
	private readonly options: {
		apiKey?: string;
		baseUrl?: string;
		timeoutMs: number;
		maxBytes: number;
		segmentTimeoutMs: number;
		segmentMaxBytes: number;
		fetchImplementation?: typeof fetch;
	};
	private readonly fetchImplementation: typeof fetch;

	constructor(options: ApiKeyFunTtsProviderOptions = {}) {
		this.options = {
			...options,
			timeoutMs: options.timeoutMs ?? DEFAULT_TTS_PREVIEW_TIMEOUT_MS,
			maxBytes: options.maxBytes ?? TTS_PREVIEW_MAX_BYTES,
			segmentTimeoutMs:
				options.segmentTimeoutMs ?? DEFAULT_VOICE_SEGMENT_TIMEOUT_MS,
			segmentMaxBytes:
				options.segmentMaxBytes ?? DEFAULT_VOICE_SEGMENT_MAX_AUDIO_BYTES,
		};
		this.fetchImplementation = options.fetchImplementation ?? fetch;
	}

	listVoices() {
		return listVoicePresets();
	}

	private async requestAudio(input: TtsPreviewInput, mode: RequestMode) {
		const fields = validateSynthesisInput(input);
		const apiKey = this.options.apiKey?.trim();
		if (!apiKey) {
			if (mode === "preview") {
				throw providerUnavailable(
					"TTS provider chưa được cấu hình trên server.",
				);
			}
			throw new TtsProviderError(
				"TTS_PROVIDER_UNAVAILABLE",
				"TTS provider chưa được cấu hình trên server.",
			);
		}

		const timeoutMs =
			mode === "preview"
				? this.options.timeoutMs
				: this.options.segmentTimeoutMs;
		const maxBytes =
			mode === "preview" ? this.options.maxBytes : this.options.segmentMaxBytes;
		const startedAt = Date.now();
		const controller = new AbortController();
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);

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
			const providerRequestId = requestId(response);
			const contentType = normalizeContentType(
				response.headers.get("content-type"),
			);

			if (!response.ok) {
				if (mode === "preview") {
					if (
						response.status === 429 ||
						(response.status >= 500 && response.status <= 599) ||
						(response.status === 403 && contentType === "text/html")
					) {
						throw providerUnavailable("TTS provider hiện không khả dụng.");
					}
					throw previewFailed("TTS provider từ chối yêu cầu preview.");
				}
				if (response.status === 408 || response.status >= 500) {
					throw new TtsProviderError(
						"TTS_REQUEST_STATE_UNCERTAIN",
						"TTS provider trả về trạng thái không xác định; không tự động thử lại.",
						{ uncertain: true, providerRequestId },
					);
				}
				throw providerSegmentFailure(
					"TTS provider từ chối yêu cầu tạo segment.",
					providerRequestId,
				);
			}

			if (contentType !== "audio/mpeg") {
				if (mode === "preview") {
					if (contentType === "text/html") {
						throw providerUnavailable(
							"TTS provider trả về trang không khả dụng.",
						);
					}
					throw previewFailed("TTS provider trả về MIME type không hợp lệ.");
				}
				throw invalidSegmentAudio(
					"TTS provider trả về MIME type không hợp lệ.",
				);
			}

			const contentLength = response.headers.get("content-length");
			if (contentLength && Number(contentLength) > maxBytes) {
				if (mode === "preview") {
					throw previewFailed("Audio preview vượt quá kích thước cho phép.");
				}
				throw invalidSegmentAudio(
					"Audio segment vượt quá kích thước cho phép.",
				);
			}

			let audio: Uint8Array;
			try {
				audio = new Uint8Array(await response.arrayBuffer());
			} catch {
				if (mode === "preview") {
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
				throw new TtsProviderError(
					timedOut ? "TTS_TIMEOUT_UNCERTAIN" : "TTS_REQUEST_STATE_UNCERTAIN",
					timedOut
						? "TTS provider timeout sau khi yêu cầu đã được gửi."
						: "Không thể đọc audio từ TTS provider; trạng thái yêu cầu không xác định.",
					{ uncertain: true, providerRequestId },
				);
			}

			if (audio.byteLength === 0 || audio.byteLength > maxBytes) {
				if (mode === "preview") {
					throw previewFailed(
						"TTS provider trả về audio preview không hợp lệ.",
					);
				}
				throw invalidSegmentAudio(
					"TTS provider trả về audio segment không hợp lệ.",
				);
			}

			return {
				audio,
				contentType: "audio/mpeg" as const,
				providerRequestId,
				latencyMs: Date.now() - startedAt,
			};
		} catch (error) {
			if (
				error instanceof VoiceConfigError ||
				error instanceof VoiceSegmentError ||
				error instanceof TtsProviderError
			) {
				throw error;
			}
			if (isTimeoutError(error, timedOut)) {
				if (mode === "preview") {
					throw new VoiceConfigError(
						"TTS_PREVIEW_TIMEOUT",
						"TTS preview vượt quá thời gian chờ.",
					);
				}
				throw new TtsProviderError(
					"TTS_TIMEOUT_UNCERTAIN",
					"TTS provider timeout sau khi yêu cầu đã được gửi.",
					{ uncertain: true },
				);
			}
			if (mode === "preview") {
				throw providerUnavailable(
					"Không thể kết nối tới TTS provider; không tự động thử lại.",
				);
			}
			throw new TtsProviderError(
				"TTS_REQUEST_STATE_UNCERTAIN",
				"Không thể kết nối tới TTS provider; trạng thái yêu cầu không xác định.",
				{ uncertain: true },
			);
		} finally {
			clearTimeout(timeout);
		}
	}

	async preview(input: TtsPreviewInput): Promise<TtsPreviewResult> {
		const result = await this.requestAudio(input, "preview");
		return {
			audio: result.audio,
			contentType: result.contentType,
			providerRequestId: result.providerRequestId,
			latencyMs: result.latencyMs,
		};
	}

	async generateSegment(
		input: TtsPreviewInput,
	): Promise<TtsGenerateSegmentResult> {
		const result = await this.requestAudio(input, "segment");
		return {
			audio: result.audio,
			contentType: result.contentType,
			providerRequestId: result.providerRequestId,
			providerDurationMs: null,
		};
	}
}

import type { VoiceConfig, VoicePreset } from "@affichannel/core";

export type VoiceStudioDraft = {
	voiceId: string;
	language: string;
	speed: number;
};

export function createVoiceStudioDraft(
	presets: VoicePreset[],
	config: VoiceConfig | null,
): VoiceStudioDraft | null {
	const recommended = presets[0];
	if (!config && !recommended) return null;
	return {
		voiceId: config?.voiceId ?? recommended?.id ?? "",
		language: config?.language ?? recommended?.supportedLanguages[0] ?? "",
		speed: config?.speed ?? recommended?.defaultSpeed ?? 1,
	};
}

export function voiceStudioDraftEquals(
	draft: VoiceStudioDraft | null,
	config: VoiceConfig | null,
) {
	return Boolean(
		draft &&
			config &&
			draft.voiceId === config.voiceId &&
			draft.language === config.language &&
			draft.speed === config.speed,
	);
}

export function isVoiceStudioFactLockError(error: unknown) {
	const code = getVoiceStudioErrorCode(error);
	return Boolean(code?.startsWith("FACT_LOCK_"));
}

export function getVoiceStudioErrorCode(error: unknown) {
	if (!error || typeof error !== "object") return undefined;
	const record = error as Record<string, unknown>;
	if (typeof record.code === "string") return record.code;
	const data = record.data;
	if (data && typeof data === "object") {
		const code = (data as Record<string, unknown>).code;
		if (typeof code === "string") return code;
	}
	return typeof record.message === "string" ? record.message : undefined;
}

const VOICE_STUDIO_ERROR_MESSAGES: Record<string, string> = {
	TTS_VOICE_NOT_FOUND: "Giọng đọc này không còn khả dụng.",
	TTS_LANGUAGE_NOT_SUPPORTED: "Ngôn ngữ không được hỗ trợ.",
	TTS_SPEED_OUT_OF_RANGE: "Tốc độ không hợp lệ.",
	VOICE_CONFIG_INPUT_INVALID: "Cấu hình giọng đọc chưa hợp lệ.",
	VOICE_CONFIG_CONFLICT:
		"Cấu hình giọng đọc đã thay đổi ở nơi khác. Hãy tải lại cấu hình mới nhất.",
	VOICE_CONFIG_NOT_FOUND: "Không tìm thấy cấu hình giọng đọc.",
	TTS_PREVIEW_TIMEOUT: "Tạo bản nghe thử mất quá nhiều thời gian. Hãy thử lại.",
	TTS_PROVIDER_UNAVAILABLE:
		"Dịch vụ giọng đọc hiện chưa khả dụng. Hãy thử lại sau.",
	TTS_PREVIEW_FAILED: "Không thể tạo bản nghe thử. Hãy thử lại.",
	FACT_LOCK_REQUIRED:
		"Script hoặc Product Facts đã thay đổi. Hãy chạy Fact Lock lại.",
	FACT_LOCK_STALE_SCRIPT:
		"Script đã thay đổi. Hãy chạy lại Fact Lock trước khi tiếp tục.",
	FACT_LOCK_STALE_FACTS:
		"Product Facts đã thay đổi. Hãy chạy lại Fact Lock trước khi tiếp tục.",
	FACT_LOCK_NOT_FOUND: "Không tìm thấy Fact Lock hoặc project hiện tại.",
};

export function getVoiceStudioErrorMessage(
	error: unknown,
	fallback = "Không thể hoàn tất thao tác Voice Studio. Hãy thử lại.",
) {
	const code = getVoiceStudioErrorCode(error);
	return (code && VOICE_STUDIO_ERROR_MESSAGES[code]) ?? fallback;
}

export function releaseVoicePreviewUrl(
	url: string | null,
	revokeObjectUrl: (value: string) => void,
) {
	if (url) revokeObjectUrl(url);
}

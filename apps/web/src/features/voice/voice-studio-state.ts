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
	if (!code?.startsWith("FACT_LOCK_")) return false;
	const reason = getVoiceStudioErrorReason(error);
	return !(
		code === "FACT_LOCK_REQUIRED" &&
		reason !== undefined &&
		NON_FACT_LOCK_AUTHORIZATION_REASONS.has(reason)
	);
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

export function getVoiceStudioErrorReason(error: unknown) {
	if (!error || typeof error !== "object") return undefined;
	const record = error as Record<string, unknown>;
	for (const candidate of [record.reason, record.reasonCode]) {
		if (typeof candidate === "string") return candidate;
	}
	const data = record.data;
	if (data && typeof data === "object") {
		const dataRecord = data as Record<string, unknown>;
		for (const candidate of [dataRecord.reason, dataRecord.reasonCode]) {
			if (typeof candidate === "string") return candidate;
		}
	}
	return undefined;
}

const NON_FACT_LOCK_AUTHORIZATION_REASONS = new Set([
	"SCRIPT_CLAIMS_NOT_CURRENT",
	"CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
	"CLAIM_SUBJECT_INVALID",
	"PRODUCT_REQUIRED_FOR_PRODUCT_CLAIMS",
	"PRODUCT_NOT_ACCESSIBLE",
	"FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
]);

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
	SCRIPT_CLAIMS_NOT_CURRENT:
		"Claim hiện tại chưa được xác nhận; hãy cập nhật nội dung trước khi tạo giọng đọc.",
	CLAIM_SUBJECT_CONFIRMATION_REQUIRED:
		"Cần xác nhận phạm vi claim trong Nội dung trước khi tạo giọng đọc.",
	CLAIM_SUBJECT_INVALID:
		"Phạm vi claim không hợp lệ; hãy kiểm tra lại Nội dung.",
	PRODUCT_REQUIRED_FOR_PRODUCT_CLAIMS:
		"Cần liên kết sản phẩm cho các claim Product trước khi tạo giọng đọc.",
	PRODUCT_NOT_ACCESSIBLE:
		"Sản phẩm hiện tại không tồn tại hoặc bạn không có quyền truy cập.",
};

export function getVoiceStudioErrorMessage(
	error: unknown,
	fallback = "Không thể hoàn tất thao tác Voice Studio. Hãy thử lại.",
) {
	const code = getVoiceStudioErrorCode(error);
	const reason = getVoiceStudioErrorReason(error);
	return (
		(reason && VOICE_STUDIO_ERROR_MESSAGES[reason]) ??
		(code && VOICE_STUDIO_ERROR_MESSAGES[code]) ??
		fallback
	);
}

export function releaseVoicePreviewUrl(
	url: string | null,
	revokeObjectUrl: (value: string) => void,
) {
	if (url) revokeObjectUrl(url);
}

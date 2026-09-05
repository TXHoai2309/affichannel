import type {
	VoiceSegmentArtifactStatus,
	VoiceSegmentEffectiveStatus,
} from "@affichannel/core";

import {
	getVoiceStudioErrorCode,
	getVoiceStudioErrorMessage,
} from "./voice-studio-state";

export const VOICE_SEGMENT_WAVEFORM_BAR_COUNT = 48;

export async function settleVoiceSegmentMutation<
	T extends { artifact: { status: VoiceSegmentArtifactStatus } },
>(
	mutation: Promise<T>,
	refetchVoiceState: () => Promise<unknown>,
	refreshWorkflow: () => void | Promise<void>,
): Promise<T> {
	const result = await mutation;
	await refetchVoiceState();
	if (result.artifact.status === "completed") await refreshWorkflow();
	return result;
}

const VOICE_SEGMENT_STATUS_LABELS: Record<VoiceSegmentEffectiveStatus, string> =
	{
		not_generated: "Chưa tạo",
		pending: "Đang tạo",
		completed: "Đã tạo",
		failed: "Tạo thất bại",
		indeterminate: "Chưa xác định",
		stale: "Audio đã cũ",
	};

const VOICE_SEGMENT_ERROR_MESSAGES: Record<string, string> = {
	VOICE_SEGMENT_ALREADY_PENDING:
		"Đoạn này đang được tạo. Hệ thống không tự động gửi lại để tránh phát sinh chi phí trùng.",
	VOICE_SEGMENT_IDEMPOTENCY_CONFLICT:
		"Yêu cầu này đã dùng cho một nội dung khác. Hãy thử lại từ thao tác mới.",
	VOICE_SEGMENT_CONTEXT_STALE:
		"Script hoặc cấu hình voice đã thay đổi. Hãy tải lại trước khi thử lại.",
	VOICE_SEGMENT_NOT_FOUND: "Không tìm thấy đoạn voice hiện tại.",
	TTS_PROVIDER_FAILED: "Nhà cung cấp TTS từ chối tạo audio. Hãy thử lại sau.",
	TTS_PROVIDER_UNAVAILABLE:
		"Dịch vụ giọng đọc hiện chưa khả dụng. Hãy thử lại sau.",
	TTS_INVALID_AUDIO: "Audio trả về không hợp lệ. Hãy thử lại sau.",
	TTS_AUDIO_METADATA_INVALID: "Không đọc được metadata audio. Hãy thử lại sau.",
	TTS_STORAGE_FAILED: "Không thể lưu audio. Hãy thử lại sau.",
	TTS_PERSISTENCE_FAILED:
		"Không thể ghi nhận kết quả audio. Hãy kiểm tra trạng thái trước khi thử lại.",
	TTS_REQUEST_STATE_UNCERTAIN:
		"Trạng thái yêu cầu chưa xác định. Hệ thống không tự động gửi lại để tránh phát sinh chi phí trùng.",
	TTS_TIMEOUT_UNCERTAIN:
		"Yêu cầu mất quá nhiều thời gian và chưa xác định kết quả. Hệ thống không tự động gửi lại để tránh phát sinh chi phí trùng.",
	TTS_STORAGE_CONFIGURATION_INVALID:
		"Kho lưu trữ audio hiện chưa được cấu hình đầy đủ.",
	VOICE_CONFIG_NOT_FOUND: "Hãy lưu VoiceConfig trước khi tạo audio.",
};

export function getVoiceSegmentStatusLabel(
	status: VoiceSegmentEffectiveStatus,
) {
	return VOICE_SEGMENT_STATUS_LABELS[status];
}

export function getVoiceSegmentStatusVariant(
	status: VoiceSegmentEffectiveStatus,
) {
	if (status === "completed") return "success" as const;
	if (status === "failed") return "destructive" as const;
	if (status === "pending" || status === "indeterminate")
		return "warning" as const;
	if (status === "stale") return "secondary" as const;
	return "outline" as const;
}

export function formatVoiceSegmentDuration(
	durationMs: number | null | undefined,
) {
	if (!Number.isFinite(durationMs) || !durationMs || durationMs <= 0) {
		return null;
	}
	return `${(durationMs / 1_000).toFixed(1)} giây`;
}

export function createVoiceSegmentIdempotencyKey(
	randomUuid: () => string = () => crypto.randomUUID(),
) {
	return `voice-segment-${randomUuid()}`;
}

export function createVoiceSegmentGenerateInput(
	projectId: string,
	segmentKey: string,
	idempotencyKey: string,
) {
	return { projectId, segmentKey, idempotencyKey };
}

export function getVoiceSegmentErrorMessage(
	error: unknown,
	fallback = "Không thể tạo voiceover cho đoạn này. Hãy thử lại.",
) {
	const code = getVoiceStudioErrorCode(error);
	if (code?.startsWith("FACT_LOCK_"))
		return getVoiceStudioErrorMessage(error, fallback);
	return (code && VOICE_SEGMENT_ERROR_MESSAGES[code]) ?? fallback;
}

export function buildVoiceSegmentAudioUrl(
	projectId: string,
	artifactId: string,
) {
	return `/api/projects/${encodeURIComponent(projectId)}/voice/segments/${encodeURIComponent(artifactId)}/audio`;
}

export function waveformCacheKey(artifactId: string, checksum: string | null) {
	return `${artifactId}/${checksum ?? "unknown"}`;
}

export function calculateWaveformPeaks(
	samples: ArrayLike<number>,
	barCount = VOICE_SEGMENT_WAVEFORM_BAR_COUNT,
) {
	if (!Number.isInteger(barCount) || barCount < 1 || samples.length === 0) {
		return [];
	}

	const rawPeaks = new Array<number>(barCount).fill(0);
	let highestPeak = 0;
	for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
		const start = Math.floor((barIndex * samples.length) / barCount);
		const end = Math.max(
			start + 1,
			Math.floor(((barIndex + 1) * samples.length) / barCount),
		);
		let peak = 0;
		for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
			const sample = Math.abs(Number(samples[sampleIndex]) || 0);
			if (sample > peak) peak = sample;
		}
		rawPeaks[barIndex] = peak;
		if (peak > highestPeak) highestPeak = peak;
	}

	if (highestPeak === 0) return rawPeaks;
	return rawPeaks.map((peak) => peak / highestPeak);
}

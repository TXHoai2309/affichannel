import type {
	PartialScriptDraft,
	ScriptGenerationArtifact,
	ScriptGenerationDependencyState,
	ScriptGenerationReadModel,
	ScriptGenerationSection,
	ScriptGenerationStatus,
} from "@affichannel/core/script-generation/types";

export const SCRIPT_SECTION_LABELS: Record<ScriptGenerationSection, string> = {
	hook: "Hook variants",
	voiceover: "Voiceover",
	scenes: "Scenes",
	cta: "CTA",
	caption: "Caption",
	hashtags: "Hashtags",
	disclosure: "Disclosure affiliate",
	claims: "Candidate claims",
};

export const SCRIPT_STATUS_LABELS: Record<
	ScriptGenerationStatus | "empty",
	string
> = {
	empty: "Chưa tạo",
	pending: "Đang tạo",
	completed: "Hoàn thành",
	partial: "Hoàn thành một phần",
	failed: "Không thành công",
	indeterminate: "Không xác định",
};

export type StudioStatus = ScriptGenerationStatus | "empty";

export function getStudioStatus(
	model: ScriptGenerationReadModel,
): StudioStatus {
	return model.latestRequest?.status ?? "empty";
}

export function getLatestUsableArtifact(
	model: ScriptGenerationReadModel,
): ScriptGenerationArtifact | null {
	return model.latestUsableArtifact;
}

export function getSectionOutputKey(section: ScriptGenerationSection) {
	return section === "hook"
		? "hookVariants"
		: section === "voiceover"
			? "voiceoverSegments"
			: section;
}

export function getSectionOutput(
	output: PartialScriptDraft | null,
	section: ScriptGenerationSection,
) {
	if (!output) return undefined;
	return (output as Record<string, unknown>)[getSectionOutputKey(section)];
}

export function hasUsableFacts(model: ScriptGenerationReadModel) {
	return model.context.facts.some(
		(fact) =>
			fact.generationUsability === "allowed" ||
			fact.generationUsability === "allowed_with_warning",
	);
}

export function hasWarningFacts(model: ScriptGenerationReadModel) {
	return model.context.facts.some(
		(fact) => fact.generationUsability === "allowed_with_warning",
	);
}

export function isGenerationContextReady(model: ScriptGenerationReadModel) {
	return hasUsableFacts(model) && model.context.channelSettings !== null;
}

export function isLatestUsableArtifactInvalidated(
	model: ScriptGenerationReadModel,
) {
	return model.dependencyState?.state === "invalidated";
}

export function isRepairableDependencyState(
	dependencyState: ScriptGenerationDependencyState | null,
) {
	return dependencyState?.state === "current";
}

export function canRepairSection(
	model: ScriptGenerationReadModel,
	section: ScriptGenerationSection,
) {
	const artifact = model.latestUsableArtifact;
	return Boolean(
		artifact?.status === "partial" &&
			isRepairableDependencyState(model.dependencyState) &&
			artifact.invalidSections.includes(section),
	);
}

export type EstimateViewState = "blocked" | "loading" | "success" | "error";

export function getEstimateViewState(input: {
	enabled: boolean;
	isFetching: boolean;
	isError: boolean;
	hasData: boolean;
}): EstimateViewState {
	if (!input.enabled) return "blocked";
	if (input.isFetching) return "loading";
	if (input.isError) return "error";
	return input.hasData ? "success" : "loading";
}

export function isSectionValid(
	artifact: ScriptGenerationArtifact,
	section: ScriptGenerationSection,
) {
	return artifact.validSections.includes(section);
}

export function getErrorCode(error: unknown) {
	if (!error || typeof error !== "object") return undefined;
	const record = error as Record<string, unknown>;
	const data = record.data;
	if (data && typeof data === "object") {
		const code = (data as Record<string, unknown>).code;
		if (typeof code === "string") return code;
	}
	const message = record.message;
	return typeof message === "string" && message.length < 100
		? message
		: undefined;
}

const ERROR_MESSAGES: Record<string, string> = {
	CHANNEL_SETTINGS_INCOMPLETE:
		"Channel Settings chưa đầy đủ. Hãy hoàn thiện cấu hình nội dung trước khi tạo.",
	NO_USABLE_PRODUCT_FACTS:
		"Chưa có Product Facts đủ điều kiện để tạo kịch bản.",
	TEXT_PROVIDER_NOT_CONFIGURED: "Chưa cấu hình Text AI cho workspace.",
	TEXT_PROVIDER_UNAVAILABLE: "Text AI hiện không khả dụng.",
	COST_ESTIMATE_UNAVAILABLE:
		"Chưa thể ước tính chi phí cho cấu hình AI hiện tại.",
	GENERATION_ALREADY_IN_PROGRESS: "Một yêu cầu tạo kịch bản đang được xử lý.",
	IDEMPOTENCY_CONFLICT: "Yêu cầu này đã được sử dụng cho một thao tác khác.",
	GENERATION_NOT_FOUND: "Không tìm thấy project hoặc yêu cầu tạo kịch bản.",
	GENERATION_INVALID_TRANSITION:
		"Thao tác tạo kịch bản không hợp lệ ở trạng thái này.",
	INVALID_REPAIR_SECTIONS: "Không thể tạo lại các phần đã chọn.",
	BASE_GENERATION_INVALIDATED:
		"Bản nháp cũ đã mất hiệu lực vì Product Facts thay đổi.",
	AI_TIMEOUT: "AI xử lý quá lâu và chưa hoàn tất yêu cầu.",
	AI_TIMEOUT_UNCERTAIN:
		"Trạng thái yêu cầu chưa xác định. Hệ thống không tự động gửi lại để tránh phát sinh chi phí trùng.",
	AI_PROVIDER_UNCERTAIN:
		"Trạng thái yêu cầu chưa xác định. Hệ thống không tự động gửi lại để tránh phát sinh chi phí trùng.",
	AI_REQUEST_STATE_UNCERTAIN:
		"Trạng thái yêu cầu chưa xác định. Hệ thống không tự động gửi lại để tránh phát sinh chi phí trùng.",
	AI_PROVIDER_ERROR: "Nhà cung cấp AI chưa hoàn tất yêu cầu.",
	AI_INVALID_OUTPUT: "AI trả về nội dung chưa đạt cấu trúc kịch bản.",
	GENERATION_INDETERMINATE:
		"Trạng thái yêu cầu chưa xác định. Hệ thống không tự động gửi lại để tránh phát sinh chi phí trùng.",
};

export function getScriptGenerationErrorMessage(error: unknown) {
	const code = getErrorCode(error);
	return (
		(code && ERROR_MESSAGES[code]) ??
		"Không thể hoàn tất yêu cầu tạo kịch bản. Hãy kiểm tra cấu hình và thử lại bằng một yêu cầu mới."
	);
}

export function createIdempotencyKey(prefix: "generate" | "repair") {
	const randomPart =
		typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `script-studio-${prefix}-${randomPart}`;
}

export function formatEstimatedCost(
	estimatedCostMicros: bigint | number | string | null | undefined,
	currency: string | null | undefined,
) {
	if (estimatedCostMicros === null || estimatedCostMicros === undefined) {
		return null;
	}
	if (!currency) return null;
	const micros = Number(estimatedCostMicros);
	if (!Number.isFinite(micros)) return null;
	const amount = micros / 1_000_000;
	try {
		return new Intl.NumberFormat("vi-VN", {
			style: "currency",
			currency,
			maximumFractionDigits: 6,
		}).format(amount);
	} catch {
		return `${amount.toLocaleString("vi-VN", {
			maximumFractionDigits: 6,
		})} ${currency}`;
	}
}

export function formatDate(value: Date | string | null | undefined) {
	if (!value) return "—";
	return new Intl.DateTimeFormat("vi-VN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

export function formatOccurrence(occurrence: {
	section: "hook" | "voiceover" | "scene" | "cta" | "caption";
	hookKey?: string;
	segmentKey?: string;
	sceneOrder?: number;
}) {
	if (occurrence.section === "hook") return `Hook · ${occurrence.hookKey}`;
	if (occurrence.section === "voiceover")
		return `Voiceover · ${occurrence.segmentKey}`;
	if (occurrence.section === "scene") return `Cảnh · ${occurrence.sceneOrder}`;
	if (occurrence.section === "cta") return "CTA";
	return "Caption";
}

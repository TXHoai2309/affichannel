import type {
	PartialScriptDraft,
	ScriptGenerationArtifact,
	ScriptGenerationDependencyState,
	ScriptGenerationReadModel,
	ScriptGenerationSection,
	ScriptGenerationStatus,
} from "@affichannel/core/script-generation/types";
import type { ScriptVersionReadModel } from "@affichannel/core/script-version/types";

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

export function getScriptStudioCtaState(input: {
	hasUsableArtifact: boolean;
	canEdit: boolean;
	generationPending: boolean;
}) {
	return {
		editLabel: input.hasUsableArtifact && input.canEdit ? "Chỉnh sửa" : null,
		generationLabel: input.generationPending
			? input.hasUsableArtifact
				? "Đang tạo lại kịch bản..."
				: "Đang tạo kịch bản..."
			: input.hasUsableArtifact
				? "Tạo lại kịch bản"
				: "Tạo kịch bản",
	};
}

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

export function hasNewerScriptGeneration(
	draft: ScriptVersionReadModel | null,
	latestUsableArtifact: ScriptGenerationArtifact | null,
) {
	return Boolean(
		draft &&
			latestUsableArtifact &&
			draft.sourceGenerationId !== latestUsableArtifact.id,
	);
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
	AI_OUTPUT_TRUNCATED:
		"AI đã dừng vì chạm giới hạn độ dài trước khi hoàn tất kịch bản.",
	GENERATION_INDETERMINATE:
		"Trạng thái yêu cầu chưa xác định. Hệ thống không tự động gửi lại để tránh phát sinh chi phí trùng.",
};

export function getScriptGenerationErrorMessage(error: unknown) {
	const code = getErrorCode(error);
	const baseCode = code?.split(":", 1)[0];
	return (
		(baseCode && ERROR_MESSAGES[baseCode]) ??
		"Không thể hoàn tất yêu cầu tạo kịch bản. Hãy kiểm tra cấu hình và thử lại bằng một yêu cầu mới."
	);
}

export function getPersistedScriptGenerationErrorMessage(
	request: ScriptGenerationArtifact | null,
) {
	if (request?.status !== "failed" || !request.errorCode) return null;
	return getScriptGenerationErrorMessage({
		data: { code: request.errorCode },
	});
}

export function createIdempotencyKey(
	prefix: "generate" | "repair" | "claim-refresh",
) {
	const randomPart =
		typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	return `script-studio-${prefix}-${randomPart}`;
}

function readErrorCode(error: unknown) {
	if (!error || typeof error !== "object") return undefined;
	const record = error as Record<string, unknown>;
	const data = record.data;
	if (data && typeof data === "object") {
		const code = (data as Record<string, unknown>).code;
		if (typeof code === "string") return code;
	}
	return typeof record.message === "string" && record.message.length < 160
		? record.message
		: undefined;
}

const SCRIPT_CLAIM_REFRESH_ERROR_MESSAGES: Record<string, string> = {
	SCRIPT_CLAIM_REFRESH_NOT_FOUND:
		"Không tìm thấy bản nháp Claims trong project hiện tại.",
	SCRIPT_CLAIM_REFRESH_SOURCE_REVISION_CONFLICT:
		"Script đã thay đổi. Hãy tải bản mới nhất rồi thử lại.",
	SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED:
		"Script đã thay đổi trong lúc cập nhật Claims. Hãy tải bản mới nhất và thử lại.",
	SCRIPT_CLAIM_REFRESH_IDEMPOTENCY_CONFLICT:
		"Yêu cầu cập nhật Claims này đã được dùng cho một thao tác khác.",
	SCRIPT_CLAIM_REFRESH_PROVIDER_RESULT_MISMATCH:
		"AI trả về danh sách Claims không hợp lệ. Không có thay đổi nào được áp dụng.",
	SCRIPT_CLAIM_REFRESH_PROVIDER_FAILED:
		"Không thể cập nhật Claims. Nội dung Script chưa bị thay đổi.",
	SCRIPT_CLAIM_REFRESH_PROVIDER_INDETERMINATE:
		"Không xác định được kết quả cập nhật Claims. Hệ thống không tự chạy lại để tránh phát sinh thêm chi phí.",
	SCRIPT_CLAIM_REFRESH_EXECUTION_CLAIM_STALE_UNCERTAIN:
		"Không xác định được kết quả cập nhật Claims. Hệ thống không tự chạy lại để tránh phát sinh thêm chi phí.",
	SCRIPT_CLAIM_REFRESH_INPUT_INVALID:
		"Bản nháp hiện tại chưa đủ điều kiện để cập nhật Claims.",
	SCRIPT_CLAIM_REFRESH_NOT_ELIGIBLE:
		"Project hiện tại chưa hỗ trợ cập nhật Claims.",
	SCRIPT_CLAIM_REFRESH_SOURCE_NOT_USABLE:
		"Bản nháp hiện tại chưa đủ điều kiện để cập nhật Claims.",
	SCRIPT_CLAIM_REFRESH_CLAIMS_STATE_INVALID:
		"Trạng thái Claims hiện tại chưa thể cập nhật.",
};

export function getScriptClaimRefreshErrorCode(error: unknown) {
	return readErrorCode(error);
}

export function getScriptClaimRefreshErrorMessage(error: unknown) {
	const code = readErrorCode(error);
	return (
		(code && SCRIPT_CLAIM_REFRESH_ERROR_MESSAGES[code]) ??
		"Không thể cập nhật Claims. Hãy kiểm tra bản nháp và thử lại bằng một yêu cầu mới."
	);
}

export function getCurrentScriptPrimarySnapshot(
	scriptVersion: ScriptVersionReadModel,
) {
	return scriptVersion.editableSnapshot;
}

export function getScriptClaimRefreshResultMessage(result: {
	kind: "not_required" | "completed" | "pending" | "failed" | "indeterminate";
	errorCode?: string;
}) {
	if (result.kind === "not_required") return "Claims hiện đã được cập nhật.";
	if (result.kind === "completed")
		return "Đã cập nhật Claims cho bản nháp hiện tại.";
	if (result.kind === "pending")
		return "Claims đang được cập nhật ở một yêu cầu khác.";
	return (
		(result.errorCode &&
			SCRIPT_CLAIM_REFRESH_ERROR_MESSAGES[result.errorCode]) ??
		(result.kind === "indeterminate"
			? SCRIPT_CLAIM_REFRESH_ERROR_MESSAGES.SCRIPT_CLAIM_REFRESH_PROVIDER_INDETERMINATE
			: SCRIPT_CLAIM_REFRESH_ERROR_MESSAGES.SCRIPT_CLAIM_REFRESH_PROVIDER_FAILED)
	);
}

export type ClaimRefreshAutosaveState = Readonly<{
	status: "saved" | "dirty" | "saving" | "error" | "conflict";
	dirty: boolean;
	baseRevision: number;
}>;

export async function runClaimRefreshAfterAutosaveFlush<T>(
	flush: () => Promise<ClaimRefreshAutosaveState>,
	run: (revision: number) => Promise<T>,
) {
	const flushed = await flush();
	if (flushed.status !== "saved" || flushed.dirty) {
		return {
			kind: "blocked" as const,
			status: flushed.status,
			dirty: flushed.dirty,
		};
	}
	return {
		kind: "started" as const,
		result: await run(flushed.baseRevision),
	};
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

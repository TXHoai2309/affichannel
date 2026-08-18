import type {
	FactLockClassification,
	FactLockReadModel,
	FactLockStoredClaim,
} from "@affichannel/core/fact-lock/types";

export const FACT_LOCK_CLASSIFICATION_LABELS: Record<
	FactLockClassification,
	string
> = {
	SUPPORTED: "Được hỗ trợ",
	NEEDS_REVIEW: "Cần xem xét",
	UNSUPPORTED: "Chưa được hỗ trợ",
	PROHIBITED: "Không được phép",
};

export const FACT_LOCK_STATUS_LABELS = {
	pending: "Đang đối chiếu",
	review_required: "Cần xử lý",
	passed: "Đã kiểm tra",
	stale: "Đã lỗi thời",
	failed: "Không thành công",
	indeterminate: "Chưa xác định",
} as const;

export type FactLockFilter = "ALL" | FactLockClassification;

export function getFactLockSummary(claims: FactLockStoredClaim[]) {
	return {
		total: claims.length,
		SUPPORTED: claims.filter(
			(claim) => claim.classificationStatus === "SUPPORTED",
		).length,
		NEEDS_REVIEW: claims.filter(
			(claim) => claim.classificationStatus === "NEEDS_REVIEW",
		).length,
		UNSUPPORTED: claims.filter(
			(claim) => claim.classificationStatus === "UNSUPPORTED",
		).length,
		PROHIBITED: claims.filter(
			(claim) => claim.classificationStatus === "PROHIBITED",
		).length,
		unresolved: claims.filter((claim) => claim.reviewStatus === "UNRESOLVED")
			.length,
	};
}

export function filterFactLockClaims(
	claims: FactLockStoredClaim[],
	filter: FactLockFilter,
) {
	return filter === "ALL"
		? claims
		: claims.filter((claim) => claim.classificationStatus === filter);
}

export function getFactLockOccurrenceLabel(
	occurrence: FactLockStoredClaim["occurrence"],
) {
	if (occurrence.section === "hook") return `Hook · ${occurrence.hookKey}`;
	if (occurrence.section === "voiceover")
		return `Voiceover · ${occurrence.segmentKey}`;
	if (occurrence.section === "scene") return `Cảnh · ${occurrence.sceneOrder}`;
	if (occurrence.section === "cta") return "CTA";
	return "Caption";
}

export function getFactLockReviewRun(model: FactLockReadModel) {
	return model.latestApplicableRun ?? model.latestRequest;
}

export function getFactLockActionState(
	claim: FactLockStoredClaim,
	stale: boolean,
) {
	const canResolve = Boolean(claim.id) && !stale;
	return {
		canApprove:
			canResolve &&
			claim.classificationStatus === "NEEDS_REVIEW" &&
			claim.reviewStatus === "UNRESOLVED",
		canEdit: canResolve,
		canDelete: canResolve,
		canApplySuggestion: canResolve && Boolean(claim.suggestionText?.trim()),
	};
}

export function getFactLockErrorCode(error: unknown) {
	if (!error || typeof error !== "object") return undefined;
	const record = error as Record<string, unknown>;
	const data = record.data;
	if (data && typeof data === "object") {
		const code = (data as Record<string, unknown>).code;
		if (typeof code === "string") return code;
	}
	return typeof record.message === "string" ? record.message : undefined;
}

const FACT_LOCK_ERROR_MESSAGES: Record<string, string> = {
	FACT_LOCK_NO_USABLE_FACTS:
		"Chưa có Product Fact đủ điều kiện. Hãy bổ sung hoặc cập nhật Product Facts trước.",
	FACT_LOCK_STALE:
		"Review đã lỗi thời vì Script hoặc Product Facts thay đổi. Hãy chạy lại Fact Lock.",
	FACT_LOCK_CONFLICT:
		"Nội dung vừa thay đổi ở nơi khác. Hãy tải lại màn hình rồi thử lại.",
	FACT_LOCK_CLAIM_NOT_REVIEWABLE:
		"Claim này vừa được xử lý hoặc không còn cần duyệt.",
	FACT_LOCK_CLAIM_DELETE_REQUIRES_EDIT:
		"Không thể xoá an toàn claim này. Hãy sửa trực tiếp trong Script Editor.",
	FACT_LOCK_CLAIM_SOURCE_MISMATCH:
		"Claim không còn khớp với script hiện tại. Hãy mở Script Editor để kiểm tra.",
	FACT_LOCK_CLAIM_SUGGESTION_UNAVAILABLE:
		"Claim này chưa có đề xuất để áp dụng.",
	FACT_LOCK_EDIT_INVALID: "Nội dung mới làm script không hợp lệ.",
	FACT_LOCK_PROVIDER_NOT_CONFIGURED:
		"Text AI chưa được cấu hình cho workspace.",
	FACT_LOCK_PROVIDER_UNAVAILABLE: "Text AI hiện không khả dụng.",
	FACT_LOCK_COST_ESTIMATE_UNAVAILABLE:
		"Chưa thể ước tính chi phí cho Fact Lock.",
	FACT_LOCK_SCRIPT_NOT_READY: "Script chưa sẵn sàng để chạy Fact Lock.",
	FACT_LOCK_ALREADY_PENDING: "Một Fact Lock đang được xử lý cho script này.",
	FACT_LOCK_INDETERMINATE:
		"Kết quả Fact Lock chưa xác định. Hệ thống không tự động gửi lại.",
};

export function getFactLockErrorMessage(error: unknown) {
	const code = getFactLockErrorCode(error);
	return (
		(code && FACT_LOCK_ERROR_MESSAGES[code]) ??
		"Không thể hoàn tất thao tác Fact Lock. Hãy tải lại và thử lại."
	);
}

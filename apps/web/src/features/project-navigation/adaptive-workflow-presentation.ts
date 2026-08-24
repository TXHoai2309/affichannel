import type {
	AdaptiveWorkflowReadModel,
	AdaptiveWorkflowRouteKey,
	AdaptiveWorkflowStep,
	AdaptiveWorkflowUnsupportedReason,
	ApplicabilityCapability,
	ApplicabilityReasonCode,
} from "@affichannel/core";
import { isCanonicalApplicabilityCapabilityResult } from "@affichannel/core";

export type AdaptiveWorkflowSemantic =
	| "waiting"
	| "progress"
	| "ready"
	| "complete"
	| "blocked"
	| "stale"
	| "coming_soon"
	| "attention";

export type AdaptiveWorkflowBadgeVariant =
	| "default"
	| "secondary"
	| "outline"
	| "success"
	| "warning"
	| "destructive";

type ReasonPresentation = {
	helperText: string;
	actionLabel?: string;
};

export const ADAPTIVE_CAPABILITY_LABELS = {
	PRODUCT: "Sản phẩm",
	SCRIPT: "Nội dung",
	FACT_LOCK: "Fact Lock",
	VOICE: "Giọng đọc",
	RENDER: "Dựng video",
} as const satisfies Record<ApplicabilityCapability, string>;

const REASON_PRESENTATION = {
	PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY: {
		helperText: "Project này không cần chọn sản phẩm.",
	},
	PROJECT_IDENTITY_UNSUPPORTED: {
		helperText: "Cấu hình Project chưa được hỗ trợ.",
	},
	AFFILIATE_PRODUCT_NOT_LINKED: {
		helperText: "Project Affiliate chưa liên kết sản phẩm.",
	},
	PRODUCT_NOT_ACCESSIBLE: {
		helperText: "Sản phẩm không tồn tại hoặc bạn không có quyền truy cập.",
	},
	PRODUCT_READY: {
		helperText: "Sản phẩm đã sẵn sàng.",
		actionLabel: "Xem sản phẩm",
	},
	SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH: {
		helperText: "Creation path này không cần Script.",
	},
	SCRIPT_REQUIRES_ACCESSIBLE_PRODUCT: {
		helperText: "Cần hoàn tất sản phẩm trước khi tạo nội dung.",
	},
	SCRIPT_CHANNEL_SETTINGS_INCOMPLETE: {
		helperText: "Cần hoàn tất thiết lập kênh trước.",
	},
	SCRIPT_PRODUCT_FACTS_UNUSABLE: {
		helperText: "Product Facts chưa đủ điều kiện để tạo nội dung.",
	},
	SCRIPT_SOURCE_DEPENDENCY_STALE: {
		helperText: "Nguồn của nội dung đã thay đổi và cần cập nhật.",
		actionLabel: "Cập nhật nội dung",
	},
	SCRIPT_GENERATION_PENDING: {
		helperText: "Nội dung đang được tạo.",
		actionLabel: "Xem tiến trình nội dung",
	},
	SCRIPT_GENERATION_FAILED: {
		helperText: "Lần tạo nội dung gần nhất không thành công.",
		actionLabel: "Mở nội dung",
	},
	SCRIPT_GENERATION_INDETERMINATE: {
		helperText: "Trạng thái lần tạo nội dung chưa xác định.",
		actionLabel: "Kiểm tra nội dung",
	},
	SCRIPT_GENERATION_REQUIRED: {
		helperText: "Nội dung chưa được tạo.",
		actionLabel: "Tạo nội dung",
	},
	CURRENT_SCRIPT_VERSION_REQUIRED: {
		helperText: "Cần chọn hoặc tạo ScriptVersion hiện tại.",
		actionLabel: "Tiếp tục nội dung",
	},
	SCRIPT_VERSION_NOT_FACT_LOCK_READY: {
		helperText: "ScriptVersion hiện tại chưa sẵn sàng cho Fact Lock.",
		actionLabel: "Kiểm tra nội dung",
	},
	SCRIPT_READY: {
		helperText: "Nội dung đã sẵn sàng.",
		actionLabel: "Xem nội dung",
	},
	FACT_LOCK_REQUIRES_CURRENT_SCRIPT: {
		helperText: "Cần hoàn tất ScriptVersion hiện tại trước.",
	},
	FACT_LOCK_SCRIPT_NOT_READY: {
		helperText: "Nội dung chưa đủ điều kiện để chạy Fact Lock.",
	},
	FACT_LOCK_STALE_FACTS: {
		helperText: "Product Facts đã thay đổi; cần chạy lại Fact Lock.",
		actionLabel: "Chạy lại Fact Lock",
	},
	FACT_LOCK_PASSED: {
		helperText: "Các claim đã vượt qua Fact Lock.",
		actionLabel: "Xem Fact Lock",
	},
	FACT_LOCK_REVIEW_REQUIRED: {
		helperText: "Một số claim cần được xem lại.",
		actionLabel: "Xem lại Fact Lock",
	},
	FACT_LOCK_PENDING: {
		helperText: "Fact Lock đang xử lý.",
		actionLabel: "Xem tiến trình Fact Lock",
	},
	FACT_LOCK_FAILED: {
		helperText: "Lần chạy Fact Lock gần nhất không thành công.",
		actionLabel: "Kiểm tra Fact Lock",
	},
	FACT_LOCK_INDETERMINATE: {
		helperText: "Trạng thái Fact Lock chưa xác định.",
		actionLabel: "Kiểm tra Fact Lock",
	},
	FACT_LOCK_STALE_SCRIPT: {
		helperText: "Script đã thay đổi; cần chạy lại Fact Lock.",
		actionLabel: "Chạy lại Fact Lock",
	},
	FACT_LOCK_RUN_REQUIRED: {
		helperText: "Fact Lock đã sẵn sàng để chạy.",
		actionLabel: "Chạy Fact Lock",
	},
	VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY: {
		helperText: "Project này không cần giọng đọc.",
	},
	VOICE_ARTIFACTS_STALE: {
		helperText: "Audio hiện tại không còn khớp với nguồn mới nhất.",
		actionLabel: "Cập nhật giọng đọc",
	},
	VOICE_REQUIRES_FACT_LOCK_PASS: {
		helperText: "Cần hoàn tất Fact Lock trước khi tạo giọng đọc.",
	},
	VOICE_BLOCKED_BY_FACT_LOCK: {
		helperText: "Giọng đọc đang bị chặn bởi Fact Lock.",
	},
	VOICE_CONFIG_REQUIRED: {
		helperText: "Cần thiết lập giọng đọc.",
		actionLabel: "Thiết lập giọng đọc",
	},
	VOICE_SEGMENTS_FAILED: {
		helperText: "Một hoặc nhiều đoạn giọng đọc không thành công.",
		actionLabel: "Kiểm tra giọng đọc",
	},
	VOICE_SEGMENTS_INDETERMINATE: {
		helperText: "Một yêu cầu giọng đọc có trạng thái chưa xác định.",
		actionLabel: "Kiểm tra giọng đọc",
	},
	VOICE_SEGMENTS_PENDING: {
		helperText: "Giọng đọc đang được xử lý.",
		actionLabel: "Xem tiến trình giọng đọc",
	},
	VOICE_SEGMENTS_REQUIRED: {
		helperText: "Cần tạo các đoạn giọng đọc.",
		actionLabel: "Hoàn tất giọng đọc",
	},
	VOICE_SEGMENTS_INCOMPLETE: {
		helperText: "Một số đoạn giọng đọc chưa hoàn tất.",
		actionLabel: "Tiếp tục giọng đọc",
	},
	VOICE_READY: {
		helperText: "Giọng đọc đã hoàn tất.",
		actionLabel: "Xem giọng đọc",
	},
	RENDER_NOT_REQUIRED_FOR_PROJECT_IDENTITY: {
		helperText: "Project này không cần render video.",
	},
	RENDER_REQUIRES_UPSTREAM_CAPABILITIES: {
		helperText: "Cần hoàn tất các bước trước khi dựng video.",
	},
	RENDER_INPUTS_STALE: {
		helperText: "Đầu vào dựng video đã thay đổi.",
	},
	RENDER_FEATURE_NOT_IMPLEMENTED: {
		helperText: "Tính năng dựng và render chưa được triển khai.",
	},
} as const satisfies Record<ApplicabilityReasonCode, ReasonPresentation>;

const UNSUPPORTED_REASON_TEXT = {
	LEGACY_PROJECT_WITHOUT_PRODUCT: "Project cũ không còn liên kết sản phẩm.",
	INVALID_CONTENT_TYPE: "ContentType của Project không hợp lệ.",
	INVALID_CREATION_PATH: "CreationPath của Project không hợp lệ.",
	PARTIAL_CHANNEL_FIRST_FIELDS:
		"Thông tin Channel-First của Project chưa đầy đủ.",
	INVALID_CONTENT_FORMAT_REF: "ContentFormat của Project không hợp lệ.",
	AFFILIATE_PRODUCT_MISSING: "Project Affiliate đang thiếu sản phẩm.",
	CONTENT_FORMAT_CREATION_PATH_MISMATCH:
		"ContentFormat không hỗ trợ CreationPath hiện tại.",
	CONFLICTING_CANONICAL_STATE: "Project có trạng thái canonical xung đột.",
	PROJECT_IDENTITY_UNSUPPORTED: "Cấu hình Project chưa được hỗ trợ.",
	AFFILIATE_PRODUCT_NOT_LINKED: "Project Affiliate chưa liên kết sản phẩm.",
} as const satisfies Record<AdaptiveWorkflowUnsupportedReason, string>;

function isValidPresentationStep(step: AdaptiveWorkflowStep) {
	const canonicalTuple = isCanonicalApplicabilityCapabilityResult({
		capability: step.capability,
		state: step.applicabilityState,
		completion: step.completion,
		reasonCode: step.reasonCode,
	});
	if (!canonicalTuple) return false;

	const comingSoon = step.primaryAction?.kind === "COMING_SOON";
	if (step.reasonCode === "RENDER_FEATURE_NOT_IMPLEMENTED") {
		return (
			comingSoon &&
			step.primaryAction?.targetCapability === null &&
			step.primaryAction.targetRouteKey === null
		);
	}
	return !comingSoon;
}

function statePresentation(step: AdaptiveWorkflowStep): {
	statusLabel: string;
	semantic: AdaptiveWorkflowSemantic;
	badgeVariant: AdaptiveWorkflowBadgeVariant;
} {
	if (!isValidPresentationStep(step)) {
		return {
			statusLabel: "Project cần được kiểm tra",
			semantic: "attention",
			badgeVariant: "destructive",
		};
	}
	if (step.reasonCode === "RENDER_FEATURE_NOT_IMPLEMENTED") {
		return {
			statusLabel: "Sắp có",
			semantic: "coming_soon",
			badgeVariant: "secondary",
		};
	}
	if (step.applicabilityState === "NOT_REQUIRED") {
		return {
			statusLabel: "Không áp dụng",
			semantic: "waiting",
			badgeVariant: "outline",
		};
	}
	if (step.applicabilityState === "OPTIONAL") {
		if (step.completion === "COMPLETE") {
			return {
				statusLabel: "Tùy chọn · Hoàn thành",
				semantic: "complete",
				badgeVariant: "success",
			};
		}
		if (step.completion === "IN_PROGRESS") {
			return {
				statusLabel: "Tùy chọn · Đang thực hiện",
				semantic: "progress",
				badgeVariant: "secondary",
			};
		}
		return {
			statusLabel: "Tùy chọn",
			semantic: "waiting",
			badgeVariant: "outline",
		};
	}
	if (step.applicabilityState === "REQUIRED") {
		return step.completion === "IN_PROGRESS"
			? {
					statusLabel: "Đang thực hiện",
					semantic: "progress",
					badgeVariant: "secondary",
				}
			: {
					statusLabel: "Cần hoàn tất bước trước",
					semantic: "waiting",
					badgeVariant: "outline",
				};
	}
	if (step.applicabilityState === "READY") {
		if (step.completion === "COMPLETE") {
			return {
				statusLabel: "Hoàn thành",
				semantic: "complete",
				badgeVariant: "success",
			};
		}
		return step.completion === "IN_PROGRESS"
			? {
					statusLabel: "Đang thực hiện",
					semantic: "progress",
					badgeVariant: "secondary",
				}
			: {
					statusLabel: "Sẵn sàng",
					semantic: "ready",
					badgeVariant: "default",
				};
	}
	if (step.applicabilityState === "BLOCKED") {
		return {
			statusLabel: "Đang bị chặn",
			semantic: "blocked",
			badgeVariant: "destructive",
		};
	}
	return {
		statusLabel: "Cần cập nhật",
		semantic: "stale",
		badgeVariant: "warning",
	};
}

function defaultActionLabel(capability: ApplicabilityCapability) {
	if (capability === "SCRIPT") return "Tiếp tục nội dung";
	if (capability === "FACT_LOCK") return "Mở Fact Lock";
	if (capability === "VOICE") return "Tiếp tục giọng đọc";
	if (capability === "RENDER") return "Mở dựng video";
	return "Mở sản phẩm";
}

export function adaptiveWorkflowHref(
	projectId: string,
	routeKey: AdaptiveWorkflowRouteKey,
) {
	return `/projects/${projectId}/${routeKey}` as const;
}

export function getAdaptiveStepPresentation(step: AdaptiveWorkflowStep) {
	const state = statePresentation(step);
	const valid = state.semantic !== "attention";
	const reason: ReasonPresentation = REASON_PRESENTATION[step.reasonCode];
	const actionAvailable =
		valid &&
		step.navigable &&
		step.primaryAction !== null &&
		step.primaryAction.kind !== "COMING_SOON";

	return {
		label: ADAPTIVE_CAPABILITY_LABELS[step.capability],
		statusLabel: state.statusLabel,
		helperText: valid
			? reason.helperText
			: "Trạng thái workflow không hợp lệ và cần được kiểm tra.",
		semantic: state.semantic,
		badgeVariant: state.badgeVariant,
		actionAvailable,
		actionLabel: actionAvailable
			? (reason.actionLabel ?? defaultActionLabel(step.capability))
			: null,
		valid,
	};
}

export function getActiveAdaptiveCapability(
	pathname: string,
	projectId: string,
	workflow: AdaptiveWorkflowReadModel,
): ApplicabilityCapability | null {
	const prefix = `/projects/${projectId}/`;
	if (!pathname.startsWith(prefix)) return null;
	const segment = pathname.slice(prefix.length).split("/")[0];
	for (const step of workflow.steps) {
		if (
			step.primaryRoute.segment === segment ||
			step.secondaryRoutes.some((route) => route.segment === segment)
		) {
			return step.capability;
		}
	}
	return null;
}

export function buildAdaptiveStepperItems(
	workflow: AdaptiveWorkflowReadModel,
	pathname: string,
	projectId: string,
) {
	const activeCapability = getActiveAdaptiveCapability(
		pathname,
		projectId,
		workflow,
	);
	return workflow.steps
		.filter((step) => step.visible)
		.map((step) => ({
			step,
			presentation: getAdaptiveStepPresentation(step),
			active: step.capability === activeCapability,
			next: step.capability === workflow.nextApplicableStep,
			href: adaptiveWorkflowHref(projectId, step.primaryRoute.key),
		}));
}

export function getAdaptiveWorkflowOverviewPresentation(
	workflow: AdaptiveWorkflowReadModel,
	projectId: string,
) {
	if (workflow.unsupportedState.isUnsupported) {
		const reason = workflow.unsupportedState.reasonCode;
		return {
			needsAttention: true,
			nextStepLabel: "Project cần được kiểm tra",
			statusLabel: "Cần kiểm tra",
			helperText: reason
				? UNSUPPORTED_REASON_TEXT[reason]
				: "Workflow của Project chưa thể được xác định an toàn.",
			action: null,
		};
	}

	const nextStep = workflow.nextApplicableStep
		? workflow.steps.find(
				(step) => step.capability === workflow.nextApplicableStep,
			)
		: undefined;
	if (!nextStep) {
		return {
			needsAttention: false,
			nextStepLabel: "Không còn bước bắt buộc",
			statusLabel: "Đã xử lý workflow hiện tại",
			helperText: "Completed route sẽ được xác nhận ở phase sau.",
			action: null,
		};
	}

	const presentation = getAdaptiveStepPresentation(nextStep);
	if (!presentation.valid) {
		return {
			needsAttention: true,
			nextStepLabel: "Project cần được kiểm tra",
			statusLabel: presentation.statusLabel,
			helperText: presentation.helperText,
			action: null,
		};
	}

	const action =
		presentation.actionAvailable && workflow.nextRouteKey
			? {
					label: presentation.actionLabel as string,
					href: adaptiveWorkflowHref(projectId, workflow.nextRouteKey),
				}
			: null;
	return {
		needsAttention: false,
		nextStepLabel: presentation.label,
		statusLabel: presentation.statusLabel,
		helperText: presentation.helperText,
		action,
	};
}

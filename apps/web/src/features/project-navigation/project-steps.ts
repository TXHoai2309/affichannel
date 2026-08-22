import type { FactLockGateResult } from "@affichannel/core";
import type {
	PersistedProjectStepStatus,
	ProjectStepKey,
} from "@affichannel/core/project/project-types";

export type { PersistedProjectStepStatus, ProjectStepKey };

export type ProjectStepStatus =
	| "completed"
	| "current"
	| "needs_review"
	| "blocked"
	| "not_started";

export type ProjectStep = {
	key: ProjectStepKey;
	label: string;
	description: string;
	order: number;
};

export const PROJECT_STEPS: ProjectStep[] = [
	{
		key: "product",
		label: "Sản phẩm",
		description: "Chọn sản phẩm và khóa thông tin đầu vào.",
		order: 1,
	},
	{
		key: "content",
		label: "Nội dung",
		description: "Chuẩn bị brief và cấu trúc nội dung.",
		order: 2,
	},
	{
		key: "fact-lock",
		label: "Fact Lock",
		description: "Kiểm tra claim và nguồn bằng chứng.",
		order: 3,
	},
	{
		key: "voice",
		label: "Giọng đọc",
		description: "Chọn giọng và chuẩn bị audio theo segment.",
		order: 4,
	},
	{
		key: "video",
		label: "Dựng video",
		description: "Ghép scene, media và subtitle.",
		order: 5,
	},
	{
		key: "preview",
		label: "Preview & Render",
		description: "Xem trước và chuẩn bị render.",
		order: 6,
	},
	{
		key: "completed",
		label: "Hoàn thành",
		description: "Kiểm tra output và hoàn tất project.",
		order: 7,
	},
];

export const DEMO_PROJECT_STEP_STATUSES: Record<
	ProjectStepKey,
	PersistedProjectStepStatus
> = {
	product: "completed",
	content: "completed",
	"fact-lock": "not_started",
	voice: "blocked",
	video: "not_started",
	preview: "not_started",
	completed: "not_started",
};

export function getProjectStep(key: string) {
	return PROJECT_STEPS.find((step) => step.key === key);
}

export function getActiveProjectStepKey(
	pathname: string,
	projectId: string,
): ProjectStepKey {
	const prefix = `/projects/${projectId}/`;
	const pathStep = pathname.startsWith(prefix)
		? pathname.slice(prefix.length).split("/")[0]
		: "product";

	return PROJECT_STEPS.some((step) => step.key === pathStep)
		? (pathStep as ProjectStepKey)
		: "product";
}

export function getProjectStepStatus(
	stepKey: ProjectStepKey,
	currentStepKey: ProjectStepKey,
	persistedStatus: PersistedProjectStepStatus,
): ProjectStepStatus {
	return stepKey === currentStepKey ? "current" : persistedStatus;
}

export const PROJECT_STEP_STATUS_LABELS: Record<ProjectStepStatus, string> = {
	completed: "Hoàn thành",
	current: "Đang làm",
	needs_review: "Cần xem lại",
	blocked: "Bị chặn",
	not_started: "Chưa làm",
};

export function getProjectStepStatusVariant(status: ProjectStepStatus) {
	if (status === "completed") return "success" as const;
	if (status === "needs_review") return "warning" as const;
	if (status === "blocked") return "destructive" as const;
	if (status === "current") return "default" as const;
	return "outline" as const;
}

export function getProjectStepDisplayStatus(
	stepKey: ProjectStepKey,
	workflowStatus: ProjectStepStatus,
	factLockGate: FactLockGateResult | null | undefined,
	voiceReady?: boolean,
): ProjectStepStatus {
	if (!factLockGate) return workflowStatus;
	if (stepKey === "fact-lock")
		return factLockGate.allowed ? "completed" : "blocked";
	if (
		(stepKey === "voice" || stepKey === "video" || stepKey === "preview") &&
		!factLockGate.allowed
	)
		return "blocked";
	if (stepKey === "video" && voiceReady === false) return "blocked";
	return workflowStatus;
}

export function getProjectStepReadinessLabel(
	stepKey: ProjectStepKey,
	factLockGate: FactLockGateResult | null | undefined,
	voiceReady?: boolean,
) {
	if (!factLockGate) return null;
	if (stepKey === "fact-lock") {
		if (factLockGate.allowed) return "Hoàn thành";
		if (
			factLockGate.reason === "FACT_LOCK_STALE_SCRIPT" ||
			factLockGate.reason === "FACT_LOCK_STALE_FACTS" ||
			factLockGate.reason === "FACT_LOCK_FAILED" ||
			factLockGate.reason === "FACT_LOCK_INDETERMINATE"
		)
			return "Cần chạy lại";
		if (factLockGate.reason === "FACT_LOCK_PENDING") return "Đang xử lý";
		if (factLockGate.reason === "FACT_LOCK_REVIEW_REQUIRED")
			return "Cần xem lại";
		return "Chưa hoàn tất";
	}
	if (stepKey === "voice" || stepKey === "video" || stepKey === "preview")
		if (stepKey === "video" && voiceReady === false)
			return "Hoàn tất Voice trước";
	if (stepKey === "voice" || stepKey === "video" || stepKey === "preview")
		return factLockGate.allowed ? "Có thể tiếp tục" : "Bị khóa";
	return null;
}

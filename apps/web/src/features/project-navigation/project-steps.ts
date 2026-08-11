export type ProjectStepKey =
	| "product"
	| "content"
	| "fact-lock"
	| "voice"
	| "video"
	| "preview"
	| "completed";

export type ProjectStepStatus =
	| "completed"
	| "current"
	| "needs_review"
	| "blocked"
	| "not_started";

export type PersistedProjectStepStatus = Exclude<ProjectStepStatus, "current">;

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
	activeStepKey: ProjectStepKey,
	persistedStatus: PersistedProjectStepStatus,
): ProjectStepStatus {
	return stepKey === activeStepKey ? "current" : persistedStatus;
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

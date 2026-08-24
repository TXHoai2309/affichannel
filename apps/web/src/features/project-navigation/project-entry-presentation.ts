import type { ProjectWorkflowEntrySummary } from "@affichannel/core";

import {
	ADAPTIVE_CAPABILITY_LABELS,
	adaptiveWorkflowHref,
} from "./adaptive-workflow-presentation";

export function getProjectEntryPresentation(
	projectId: string,
	entry: ProjectWorkflowEntrySummary,
) {
	const overviewHref = `/projects/${projectId}` as const;
	const comingSoon = entry.nextActionKind === "COMING_SOON";
	const needsAttention = entry.unsupported;
	const nextLabel = entry.nextCapability
		? ADAPTIVE_CAPABILITY_LABELS[entry.nextCapability]
		: "Workflow hiện tại";
	const continueHref =
		entry.canContinue && entry.nextRouteKey
			? adaptiveWorkflowHref(projectId, entry.nextRouteKey)
			: overviewHref;

	return {
		overviewHref,
		continueHref,
		nextLabel,
		statusLabel: needsAttention
			? "Cần kiểm tra"
			: comingSoon
				? "Sắp có"
				: entry.nextState === "STALE"
					? "Cần cập nhật"
					: entry.nextState === "BLOCKED"
						? "Đang bị chặn"
						: entry.nextCompletion === "COMPLETE"
							? "Hoàn thành"
							: "Bước tiếp theo",
		actionLabel: entry.canContinue ? "Tiếp tục" : "Mở dự án",
		comingSoon,
		needsAttention,
	};
}

export function getProductRelatedProjectHref(projectId: string) {
	return `/projects/${projectId}` as const;
}

export function getPostCreateProjectHref(project: {
	id: string;
	workflowEntry: ProjectWorkflowEntrySummary;
}) {
	return getProjectEntryPresentation(project.id, project.workflowEntry)
		.continueHref;
}

import {
	getProjectStepRoute,
	PROJECT_STEP_KEYS,
} from "../project/project-types";
import type {
	DashboardActivity,
	DashboardOverview,
	DashboardProjectRecord,
	DashboardProjectStatus,
	DashboardRecentProject,
	DashboardRepository,
} from "./dashboard-types";
import { DASHBOARD_RECENT_PROJECT_LIMIT } from "./dashboard-types";

export type DashboardActor = {
	workspaceId: string;
	userId: string;
};

export function calculateDashboardProgress(
	project: Pick<DashboardProjectRecord, "currentStepKey" | "stepStatuses">,
) {
	if (project.currentStepKey === "completed") {
		return 100;
	}

	const completedSteps = project.stepStatuses.filter(
		(step) => step.status === "completed",
	).length;

	return Math.round((completedSteps / PROJECT_STEP_KEYS.length) * 100);
}

export function getDashboardProjectStatus(
	project: Pick<DashboardProjectRecord, "currentStepKey" | "stepStatuses">,
): DashboardProjectStatus {
	if (project.currentStepKey === "completed") {
		return "completed";
	}

	if (project.stepStatuses.some((step) => step.status === "blocked")) {
		return "blocked";
	}

	if (project.stepStatuses.some((step) => step.status === "needs_review")) {
		return "needs_review";
	}

	return "in_progress";
}

export function toDashboardRecentProject(
	project: DashboardProjectRecord,
): DashboardRecentProject {
	return {
		id: project.id,
		name: project.name,
		productName: project.productName,
		currentStepKey: project.currentStepKey,
		status: getDashboardProjectStatus(project),
		progressPercent: calculateDashboardProgress(project),
		updatedAt: project.updatedAt.toISOString(),
		targetUrl: getProjectStepRoute(project.id, project.currentStepKey),
	};
}

export function toDashboardActivity(
	project: DashboardProjectRecord,
): DashboardActivity {
	const created = project.updatedAt.getTime() <= project.createdAt.getTime();

	return {
		id: `${project.id}:${created ? "created" : "updated"}`,
		type: created ? "project_created" : "project_updated",
		title: created
			? `Bạn đã tạo dự án “${project.name}”`
			: `Dự án “${project.name}” vừa được cập nhật`,
		occurredAt: (created ? project.createdAt : project.updatedAt).toISOString(),
		targetUrl: getProjectStepRoute(project.id, project.currentStepKey),
	};
}

export async function getDashboardOverview(
	repository: DashboardRepository,
	actor: DashboardActor,
): Promise<DashboardOverview> {
	const [activeProjects, recentProjectRecords] = await Promise.all([
		repository.countActiveProjects({ workspaceId: actor.workspaceId }),
		repository.listRecentProjects({
			workspaceId: actor.workspaceId,
			limit: DASHBOARD_RECENT_PROJECT_LIMIT,
		}),
	]);

	return {
		summary: {
			activeProjects,
			completedVideos: 0,
			processingJobs: 0,
		},
		cost: {
			currentMonth: 0,
			currency: "VND",
		},
		recentProjects: recentProjectRecords.map(toDashboardRecentProject),
		recentActivities: recentProjectRecords.map(toDashboardActivity),
		warnings: [],
	};
}

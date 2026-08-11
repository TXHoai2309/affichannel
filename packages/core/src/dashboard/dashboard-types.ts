import type {
	PersistedProjectStepStatus,
	ProjectStepKey,
} from "../project/project-types";

export type DashboardProjectStatus =
	| "in_progress"
	| "completed"
	| "needs_review"
	| "blocked";

export type DashboardWarningType = "fact_stale" | "fact_lock" | "job_failed";

export type DashboardWarning = {
	id: string;
	type: DashboardWarningType;
	severity: "warning" | "danger";
	title: string;
	description?: string;
	targetUrl: string;
};

export type DashboardRecentProject = {
	id: string;
	name: string;
	productName: string;
	currentStepKey: ProjectStepKey;
	status: DashboardProjectStatus;
	progressPercent: number;
	updatedAt: string;
	targetUrl: string;
};

export type DashboardActivity = {
	id: string;
	type: "project_created" | "project_updated";
	title: string;
	occurredAt: string;
	targetUrl: string;
};

export type DashboardOverview = {
	summary: {
		activeProjects: number;
		completedVideos: number;
		processingJobs: number;
	};
	cost: {
		currentMonth: number;
		currency: "VND";
	};
	recentProjects: DashboardRecentProject[];
	recentActivities: DashboardActivity[];
	warnings: DashboardWarning[];
};

export type DashboardProjectRecord = {
	id: string;
	name: string;
	productName: string;
	currentStepKey: ProjectStepKey;
	createdAt: Date;
	updatedAt: Date;
	stepStatuses: Array<{
		stepKey: ProjectStepKey;
		status: PersistedProjectStepStatus;
	}>;
};

export type DashboardRepository = {
	countActiveProjects(input: { workspaceId: string }): Promise<number>;
	listRecentProjects(input: {
		workspaceId: string;
		limit: number;
	}): Promise<DashboardProjectRecord[]>;
};

export const DASHBOARD_RECENT_PROJECT_LIMIT = 5;

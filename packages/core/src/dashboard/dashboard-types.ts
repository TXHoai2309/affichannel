import type { ProjectWorkflowEntrySummary } from "../adaptive-workflow/entry-summary";

export type DashboardProjectStatus =
	| "in_progress"
	| "completed"
	| "needs_review"
	| "blocked"
	| "coming_soon";

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
	workflowEntry: ProjectWorkflowEntrySummary;
	status: DashboardProjectStatus;
	progressPercent: number;
	completedVisibleSteps: number;
	totalVisibleSteps: number;
	updatedAt: string;
	targetUrl: string;
	continueUrl: string;
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
	createdAt: Date;
	updatedAt: Date;
	workflowEntry: ProjectWorkflowEntrySummary;
};

export type DashboardFactFreshnessRecord = {
	productId: string;
	productName: string;
	type: "price" | "promotion";
	status: "draft" | "verified" | "inactive";
	sourceType: "official" | "marketplace" | "document" | null;
	sourceLabel: string | null;
	sourceUrl: string | null;
	confirmedAt: string | null;
	expiresAt: string | null;
};

export type DashboardRepository = {
	countActiveProjects(input: { workspaceId: string }): Promise<number>;
	listRecentProjects(input: {
		workspaceId: string;
		userId: string;
		limit: number;
	}): Promise<DashboardProjectRecord[]>;
	listFactFreshnessRecords?(input: {
		workspaceId: string;
	}): Promise<DashboardFactFreshnessRecord[]>;
};

export const DASHBOARD_RECENT_PROJECT_LIMIT = 5;

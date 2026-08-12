import {
	evaluateFactFreshness,
	FACT_FRESHNESS_POLICY,
	resolveBusinessToday,
} from "../product-fact/freshness";
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

function toDashboardWarnings(
	records: Awaited<
		ReturnType<NonNullable<DashboardRepository["listFactFreshnessRecords"]>>
	>,
) {
	const today = resolveBusinessToday();
	const byProduct = new Map<
		string,
		{ productName: string; stale: number; expired: number }
	>();

	for (const record of records) {
		const freshness = evaluateFactFreshness(
			record,
			today,
			FACT_FRESHNESS_POLICY,
		);
		if (freshness.status !== "needs_update" && freshness.status !== "expired") {
			continue;
		}
		const current = byProduct.get(record.productId) ?? {
			productName: record.productName,
			stale: 0,
			expired: 0,
		};
		if (freshness.status === "expired") current.expired += 1;
		else current.stale += 1;
		byProduct.set(record.productId, current);
	}

	return [...byProduct.entries()]
		.sort(
			([, left], [, right]) =>
				right.expired - left.expired || right.stale - left.stale,
		)
		.map(([productId, summary]) => {
			const total = summary.expired + summary.stale;
			const expiredText =
				summary.expired > 0 ? `${summary.expired} đã hết hạn` : "";
			const staleText =
				summary.stale > 0 ? `${summary.stale} cần cập nhật` : "";
			return {
				id: `fact-stale:${productId}`,
				type: "fact_stale" as const,
				severity:
					summary.expired > 0 ? ("danger" as const) : ("warning" as const),
				title: `${summary.productName}: ${total} Product Fact cần xem lại`,
				description: [expiredText, staleText].filter(Boolean).join(" · "),
				targetUrl: `/products/${productId}?tab=facts`,
			};
		});
}

export async function getDashboardOverview(
	repository: DashboardRepository,
	actor: DashboardActor,
): Promise<DashboardOverview> {
	const [activeProjects, recentProjectRecords, factFreshnessRecords] =
		await Promise.all([
			repository.countActiveProjects({ workspaceId: actor.workspaceId }),
			repository.listRecentProjects({
				workspaceId: actor.workspaceId,
				limit: DASHBOARD_RECENT_PROJECT_LIMIT,
			}),
			repository.listFactFreshnessRecords
				? repository.listFactFreshnessRecords({
						workspaceId: actor.workspaceId,
					})
				: Promise.resolve([]),
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
		warnings: toDashboardWarnings(factFreshnessRecords),
	};
}

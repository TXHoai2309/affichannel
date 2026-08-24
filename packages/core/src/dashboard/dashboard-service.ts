import type { FactFreshnessPolicy } from "../product-fact/freshness";
import {
	evaluateFactFreshness,
	FACT_FRESHNESS_POLICY,
	resolveBusinessToday,
} from "../product-fact/freshness";
import type {
	DashboardActivity,
	DashboardFactFreshnessRecord,
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
	project: Pick<DashboardProjectRecord, "workflowEntry">,
) {
	const { completedVisibleSteps, totalVisibleSteps } = project.workflowEntry;
	return totalVisibleSteps === 0
		? 0
		: Math.round((completedVisibleSteps / totalVisibleSteps) * 100);
}

export function getDashboardProjectStatus(
	project: Pick<DashboardProjectRecord, "workflowEntry">,
): DashboardProjectStatus {
	const entry = project.workflowEntry;
	if (
		entry.totalVisibleSteps > 0 &&
		entry.completedVisibleSteps === entry.totalVisibleSteps
	) {
		return "completed";
	}
	if (entry.nextActionKind === "COMING_SOON") {
		return "coming_soon";
	}
	if (entry.unsupported || entry.nextState === "BLOCKED") {
		return "blocked";
	}
	if (entry.nextState === "STALE") {
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
		workflowEntry: project.workflowEntry,
		status: getDashboardProjectStatus(project),
		progressPercent: calculateDashboardProgress(project),
		completedVisibleSteps: project.workflowEntry.completedVisibleSteps,
		totalVisibleSteps: project.workflowEntry.totalVisibleSteps,
		updatedAt: project.updatedAt.toISOString(),
		targetUrl: `/projects/${project.id}`,
		continueUrl:
			project.workflowEntry.canContinue && project.workflowEntry.nextRouteKey
				? `/projects/${project.id}/${project.workflowEntry.nextRouteKey}`
				: `/projects/${project.id}`,
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
		targetUrl: `/projects/${project.id}`,
	};
}

export function buildDashboardFactWarnings(input: {
	records: DashboardFactFreshnessRecord[];
	today: string;
	policy?: FactFreshnessPolicy;
}) {
	const { records, today, policy = FACT_FRESHNESS_POLICY } = input;
	const byProduct = new Map<
		string,
		{ productName: string; stale: number; expired: number }
	>();

	for (const record of records) {
		const freshness = evaluateFactFreshness(record, today, policy);
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
				userId: actor.userId,
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
		warnings: buildDashboardFactWarnings({
			records: factFreshnessRecords,
			today: resolveBusinessToday(),
			policy: FACT_FRESHNESS_POLICY,
		}),
	};
}

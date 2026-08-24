import {
	buildDashboardFactWarnings,
	calculateDashboardProgress,
	getDashboardOverview,
	toDashboardActivity,
} from "@affichannel/core/dashboard/dashboard-service";
import type { DashboardProjectRecord } from "@affichannel/core/dashboard/dashboard-types";
import { describe, expect, it } from "vitest";

const baseProject: DashboardProjectRecord = {
	id: "project-1",
	name: "Review tai nghe",
	productName: "Tai nghe X1",
	createdAt: new Date("2026-08-11T08:00:00.000Z"),
	updatedAt: new Date("2026-08-11T08:30:00.000Z"),
	workflowEntry: {
		projectId: "project-1",
		nextCapability: "RENDER",
		nextRouteKey: "video",
		nextState: "BLOCKED",
		nextCompletion: "NOT_STARTED",
		nextReasonCode: "RENDER_FEATURE_NOT_IMPLEMENTED",
		nextActionKind: "COMING_SOON",
		completedVisibleSteps: 4,
		totalVisibleSteps: 5,
		unsupported: false,
		canContinue: false,
	},
};

const factRecords = [
	{
		productId: "product-1",
		productName: "Tai nghe X1",
		type: "price" as const,
		status: "verified" as const,
		sourceType: "official" as const,
		sourceLabel: "Official website",
		sourceUrl: "https://example.com",
		confirmedAt: "2026-08-01",
		expiresAt: null,
	},
	{
		productId: "product-1",
		productName: "Tai nghe X1",
		type: "promotion" as const,
		status: "verified" as const,
		sourceType: "official" as const,
		sourceLabel: "Official website",
		sourceUrl: "https://example.com",
		confirmedAt: "2026-08-11",
		expiresAt: "2026-08-11",
	},
];

describe("dashboard domain service", () => {
	it("calculates progress from visible Adaptive Workflow capabilities", () => {
		expect(calculateDashboardProgress(baseProject)).toBe(80);
		expect(
			calculateDashboardProgress({
				workflowEntry: {
					...baseProject.workflowEntry,
					completedVisibleSteps: 0,
				},
			}),
		).toBe(0);
		expect(
			calculateDashboardProgress({
				workflowEntry: {
					...baseProject.workflowEntry,
					completedVisibleSteps: 5,
				},
			}),
		).toBe(100);
	});

	it("maps activity links to the generic Project overview", () => {
		const created = toDashboardActivity({
			...baseProject,
			updatedAt: baseProject.createdAt,
		});
		const updated = toDashboardActivity(baseProject);

		expect(created.type).toBe("project_created");
		expect(created.targetUrl).toBe("/projects/project-1");
		expect(updated.type).toBe("project_updated");
		expect(updated.title).toContain("Review tai nghe");
	});

	it("returns real project data with honest MVP defaults", async () => {
		const calls: { workspaceId?: string; limit?: number } = {};
		const repository = {
			countActiveProjects: async ({ workspaceId }: { workspaceId: string }) => {
				calls.workspaceId = workspaceId;
				return 1;
			},
			listRecentProjects: async ({
				workspaceId,
				userId: _userId,
				limit,
			}: {
				workspaceId: string;
				userId: string;
				limit: number;
			}) => {
				calls.workspaceId = workspaceId;
				calls.limit = limit;
				return [baseProject];
			},
		};

		const overview = await getDashboardOverview(repository, {
			workspaceId: "internal",
			userId: "user-1",
		});

		expect(calls).toEqual({ workspaceId: "internal", limit: 5 });
		expect(overview.summary).toEqual({
			activeProjects: 1,
			completedVideos: 0,
			processingJobs: 0,
		});
		expect(overview.cost).toEqual({ currentMonth: 0, currency: "VND" });
		expect(overview.warnings).toEqual([]);
		expect(overview.recentProjects[0]).toMatchObject({
			id: "project-1",
			status: "coming_soon",
			progressPercent: 80,
			completedVisibleSteps: 4,
			totalVisibleSteps: 5,
			continueUrl: "/projects/project-1",
		});
	});

	it("groups stale and expired facts deterministically for an explicit date", () => {
		const warningsOnAugust12 = buildDashboardFactWarnings({
			records: factRecords,
			today: "2026-08-12",
		});
		expect(warningsOnAugust12).toHaveLength(1);
		expect(warningsOnAugust12[0]).toMatchObject({
			severity: "danger",
			targetUrl: "/products/product-1?tab=facts",
		});
		expect(warningsOnAugust12[0]?.description).toContain("1");

		const warningsOnAugust10 = buildDashboardFactWarnings({
			records: factRecords,
			today: "2026-08-10",
		});
		expect(warningsOnAugust10).toHaveLength(1);
		expect(warningsOnAugust10[0]).toMatchObject({
			severity: "warning",
			targetUrl: "/products/product-1?tab=facts",
		});
		expect(warningsOnAugust10[0]?.description).toContain("1");
	});
});

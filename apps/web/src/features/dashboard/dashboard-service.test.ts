import {
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
	currentStepKey: "fact-lock",
	createdAt: new Date("2026-08-11T08:00:00.000Z"),
	updatedAt: new Date("2026-08-11T08:30:00.000Z"),
	stepStatuses: [
		{ stepKey: "product", status: "completed" },
		{ stepKey: "content", status: "completed" },
		{ stepKey: "fact-lock", status: "not_started" },
		{ stepKey: "voice", status: "not_started" },
		{ stepKey: "video", status: "not_started" },
		{ stepKey: "preview", status: "not_started" },
		{ stepKey: "completed", status: "not_started" },
	],
};

describe("dashboard domain service", () => {
	it("calculates progress from completed persisted steps", () => {
		expect(calculateDashboardProgress(baseProject)).toBe(29);
		expect(
			calculateDashboardProgress({
				...baseProject,
				currentStepKey: "product",
				stepStatuses: baseProject.stepStatuses.map((step) => ({
					...step,
					status: "not_started" as const,
				})),
			}),
		).toBe(0);
		expect(
			calculateDashboardProgress({
				...baseProject,
				currentStepKey: "completed",
			}),
		).toBe(100);
	});

	it("maps creation and update activity to the current project step", () => {
		const created = toDashboardActivity({
			...baseProject,
			updatedAt: baseProject.createdAt,
		});
		const updated = toDashboardActivity(baseProject);

		expect(created.type).toBe("project_created");
		expect(created.targetUrl).toBe("/projects/project-1/fact-lock");
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
				limit,
			}: {
				workspaceId: string;
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
			progressPercent: 29,
		});
	});

	it("groups stale and expired facts into product warnings", async () => {
		const repository = {
			countActiveProjects: async () => 0,
			listRecentProjects: async () => [],
			listFactFreshnessRecords: async () => [
				{
					productId: "product-1",
					productName: "Tai nghe X1",
					type: "price" as const,
					status: "verified" as const,
					sourceType: "official" as const,
					sourceLabel: "Website hãng",
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
					sourceLabel: "Website hãng",
					sourceUrl: "https://example.com",
					confirmedAt: "2026-08-11",
					expiresAt: "2026-08-11",
				},
			],
		};

		const overview = await getDashboardOverview(repository, {
			workspaceId: "internal",
			userId: "user-1",
		});

		expect(overview.warnings).toEqual([
			expect.objectContaining({
				severity: "danger",
				title: "Tai nghe X1: 2 Product Fact cần xem lại",
				description: "1 đã hết hạn · 1 cần cập nhật",
				targetUrl: "/products/product-1?tab=facts",
			}),
		]);
	});
});

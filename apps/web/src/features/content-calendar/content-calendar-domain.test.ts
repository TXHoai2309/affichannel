import {
	type ChannelStrategyReadModel,
	calculateMixActualCounts,
	calculateMixTargetCounts,
	generateDeterministicPlan,
	getSevenDayWindow,
	getWorkspaceLocalDate,
	plannedContentItemSemanticSchema,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const strategy: ChannelStrategyReadModel = {
	id: "00000000-0000-4000-8000-000000000001",
	workspaceId: "00000000-0000-4000-8000-000000000002",
	version: 4,
	niche: "Home organization",
	targetAudience: "Busy renters",
	presenceMode: "FLEXIBLE",
	tone: "Practical",
	contentPillars: ["Small spaces", "Routines", "Product tests"],
	contentSeries: ["Seven minute reset", "Before and after"],
	preferredCreationPaths: ["SCRIPTED", "QUICK_IMAGE"],
	preferredContentFormats: [
		{ key: "SCRIPTED_STANDARD", version: 1 },
		{ key: "QUICK_IMAGE_STANDARD", version: 1 },
	],
	postingFrequency: { postsPerWeek: 5, preferredDays: [0, 2, 4, 6] },
	visualStyle: "Clean",
	organicAffiliateMixTarget: { organicPercentage: 60, affiliatePercentage: 40 },
	createdByUserId: "00000000-0000-4000-8000-000000000003",
	updatedByUserId: "00000000-0000-4000-8000-000000000003",
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("AFF-US-026 deterministic content calendar", () => {
	it("uses workspace-local dates at a positive UTC boundary", () => {
		const instant = new Date("2026-01-01T23:30:00.000Z");
		expect(getWorkspaceLocalDate(instant, "Asia/Ho_Chi_Minh")).toBe(
			"2026-01-02",
		);
		const window = getSevenDayWindow(instant, "Asia/Ho_Chi_Minh");
		expect(window).toMatchObject({
			startDate: "2026-01-02",
			endDate: "2026-01-08",
		});
	});

	it("generates a stable count, fair pillar/series distribution, and feasible mix", () => {
		const window = {
			startDate: "2026-01-05",
			endDate: "2026-01-11",
			timezone: "Asia/Ho_Chi_Minh",
		};
		const first = generateDeterministicPlan(strategy, window);
		const second = generateDeterministicPlan(strategy, window);
		expect(first).toEqual(second);
		expect(first).toHaveLength(5);
		expect(first.map((item) => item.scheduledDate)).toEqual([
			"2026-01-05",
			"2026-01-07",
			"2026-01-09",
			"2026-01-11",
			"2026-01-05",
		]);
		expect(calculateMixActualCounts(first)).toMatchObject({
			organic: 3,
			affiliate: 2,
		});
		expect(
			calculateMixTargetCounts(5, strategy.organicAffiliateMixTarget),
		).toMatchObject({
			organic: 3,
			affiliate: 2,
		});
		expect(new Set(first.map((item) => item.pillar)).size).toBe(3);
		expect(first.every((item) => item.contentFormat.version === 1)).toBe(true);
	});

	it("rejects invalid planned identity and unsupported timezone", () => {
		const result = plannedContentItemSemanticSchema.safeParse({
			scheduledDate: "2026-01-05",
			scheduledTime: "09:00",
			timezone: "not/a-timezone",
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 1 },
			pillar: "Pillar",
			series: null,
			title: "Title",
			brief: "Brief",
			productId: null,
		});
		expect(result.success).toBe(false);
	});
});

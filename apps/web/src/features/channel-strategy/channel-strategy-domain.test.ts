import {
	channelStrategyInputSchema,
	channelStrategySaveInputSchema,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const base = {
	niche: "Sức khỏe đời sống",
	targetAudience: "Người đi làm bận rộn",
	presenceMode: "FACELESS" as const,
	tone: "Thực tế, rõ ràng",
	contentPillars: ["Thói quen", "Dinh dưỡng", "Vận động"],
	contentSeries: ["Một phút khỏe hơn"],
	preferredCreationPaths: ["SCRIPTED" as const],
	preferredContentFormats: [{ key: "SCRIPTED_STANDARD", version: 1 }],
	postingFrequency: { postsPerWeek: 3, preferredDays: [1, 3, 5] },
	visualStyle: "Tối giản, sáng, dễ đọc",
	organicAffiliateMixTarget: {
		organicPercentage: 70,
		affiliatePercentage: 30,
	},
};

describe("AFF-US-025 Channel Strategy domain", () => {
	it("accepts a valid strategy with the 3-pillar minimum", () => {
		expect(channelStrategyInputSchema.safeParse(base).success).toBe(true);
	});

	it("accepts the 5-pillar maximum and rejects counts outside 3–5", () => {
		expect(
			channelStrategyInputSchema.safeParse({
				...base,
				contentPillars: ["A", "B", "C", "D", "E"],
			}).success,
		).toBe(true);
		expect(
			channelStrategyInputSchema.safeParse({
				...base,
				contentPillars: ["A", "B"],
			}).success,
		).toBe(false);
		expect(
			channelStrategyInputSchema.safeParse({
				...base,
				contentPillars: ["A", "B", "C", "D", "E", "F"],
			}).success,
		).toBe(false);
	});

	it("rejects blank and normalized duplicate pillars", () => {
		for (const pillars of [
			["A", "", "C"],
			["A", " a ", "C"],
		]) {
			expect(
				channelStrategyInputSchema.safeParse({
					...base,
					contentPillars: pillars,
				}).success,
			).toBe(false);
		}
	});

	it("rejects non-canonical formats and invalid mix targets", () => {
		expect(
			channelStrategyInputSchema.safeParse({
				...base,
				preferredContentFormats: [{ key: "UNKNOWN", version: 1 }],
			}).success,
		).toBe(false);
		expect(
			channelStrategyInputSchema.safeParse({
				...base,
				organicAffiliateMixTarget: {
					organicPercentage: 101,
					affiliatePercentage: -1,
				},
			}).success,
		).toBe(false);
		expect(
			channelStrategyInputSchema.safeParse({
				...base,
				organicAffiliateMixTarget: {
					organicPercentage: 60,
					affiliatePercentage: 60,
				},
			}).success,
		).toBe(false);
	});

	it("validates posting frequency, series, and optimistic version input", () => {
		expect(
			channelStrategyInputSchema.safeParse({
				...base,
				postingFrequency: { postsPerWeek: 2, preferredDays: [1, 1] },
			}).success,
		).toBe(false);
		expect(
			channelStrategyInputSchema.safeParse({
				...base,
				contentSeries: ["Series", " series "],
			}).success,
		).toBe(false);
		expect(
			channelStrategySaveInputSchema.safeParse({
				...base,
				expectedVersion: null,
			}).success,
		).toBe(true);
	});
});

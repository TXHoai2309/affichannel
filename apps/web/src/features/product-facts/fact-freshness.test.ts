import {
	evaluateFactAssessment,
	evaluateFactFreshness,
	evaluateFactGenerationUsability,
} from "@affichannel/core/product-fact/freshness";
import { describe, expect, it } from "vitest";

const today = "2026-08-12";
const verifiedPrice = {
	type: "price" as const,
	status: "verified" as const,
	sourceType: "official" as const,
	sourceLabel: "Website hãng",
	sourceUrl: "https://example.com/price",
	confirmedAt: "2026-08-11",
	expiresAt: null,
};

describe("Product Fact freshness policy", () => {
	it("uses inclusive age boundaries for price and promotion", () => {
		expect(
			evaluateFactFreshness(
				{ ...verifiedPrice, confirmedAt: "2026-08-05" },
				today,
			).status,
		).toBe("needs_update");
		expect(
			evaluateFactFreshness(
				{ ...verifiedPrice, confirmedAt: "2026-08-06" },
				today,
			).status,
		).toBe("fresh");
		expect(
			evaluateFactFreshness(
				{ ...verifiedPrice, type: "promotion", confirmedAt: "2026-08-09" },
				today,
			).status,
		).toBe("needs_update");
	});

	it("treats expiry today as needs_update, not expired", () => {
		expect(
			evaluateFactFreshness({ ...verifiedPrice, expiresAt: today }, today)
				.status,
		).toBe("needs_update");
		expect(
			evaluateFactFreshness(
				{ ...verifiedPrice, expiresAt: "2026-08-11" },
				today,
			).status,
		).toBe("expired");
	});

	it("returns unknown when verification or safe evidence is insufficient", () => {
		expect(
			evaluateFactFreshness({ ...verifiedPrice, status: "draft" }, today)
				.status,
		).toBe("unknown");
		expect(
			evaluateFactFreshness(
				{ ...verifiedPrice, sourceLabel: null, sourceUrl: null },
				today,
			).status,
		).toBe("unknown");
		expect(
			evaluateFactFreshness({ ...verifiedPrice, type: "feature" }, today)
				.status,
		).toBe("not_applicable");
	});

	it("separates assessment from generation usability", () => {
		const warning = evaluateFactGenerationUsability(
			{ ...verifiedPrice, confirmedAt: "2026-08-05" },
			today,
		);
		const blocked = evaluateFactGenerationUsability(
			{ ...verifiedPrice, status: "draft" },
			today,
		);
		const assessment = evaluateFactAssessment(verifiedPrice, today);

		expect(warning.usability).toBe("allowed_with_warning");
		expect(blocked.usability).toBe("blocked");
		expect(assessment).toMatchObject({
			verification: "verified",
			evidence: "complete",
			freshness: "fresh",
		});
	});
});

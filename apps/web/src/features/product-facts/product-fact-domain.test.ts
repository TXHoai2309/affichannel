import {
	factRequiresEvidence,
	hasFactEvidence,
	isFactEligibleForAi,
	isValidFactDateRange,
	resolveFactStatusAfterEdit,
} from "@affichannel/core/product-fact/eligibility";
import { productFactFieldsSchema } from "@affichannel/core/product-fact/validation";
import { describe, expect, it } from "vitest";

const baseFact = {
	content: "Pin có thời lượng 20 giờ",
	type: "price" as const,
	status: "verified" as const,
	sourceType: "official" as const,
	sourceLabel: "Website thương hiệu",
	sourceUrl: "https://example.com/fact",
	confirmedAt: "2026-08-12",
	expiresAt: "2026-08-20",
	notes: null,
};

describe("Product Facts domain contract", () => {
	it("requires evidence only for the evidence-sensitive types", () => {
		expect(factRequiresEvidence("price")).toBe(true);
		expect(factRequiresEvidence("promotion")).toBe(true);
		expect(factRequiresEvidence("claim")).toBe(true);
		expect(factRequiresEvidence("feature")).toBe(false);
	});

	it("validates verified evidence and AI eligibility", () => {
		expect(hasFactEvidence(baseFact)).toBe(true);
		expect(isFactEligibleForAi(baseFact)).toBe(true);
		expect(isFactEligibleForAi({ ...baseFact, status: "draft" })).toBe(false);
		expect(
			isFactEligibleForAi({
				...baseFact,
				sourceLabel: null,
				sourceUrl: null,
			}),
		).toBe(false);
	});

	it("allows non-sensitive verified types without evidence", () => {
		const feature = {
			...baseFact,
			type: "feature" as const,
			sourceType: null,
			sourceLabel: null,
			sourceUrl: null,
			confirmedAt: null,
		};
		expect(hasFactEvidence(feature)).toBe(false);
		expect(isFactEligibleForAi(feature)).toBe(true);
	});

	it("keeps dates as calendar dates and rejects an invalid range", () => {
		expect(productFactFieldsSchema.safeParse({ ...baseFact }).success).toBe(
			true,
		);
		expect(
			productFactFieldsSchema.safeParse({
				...baseFact,
				confirmedAt: "2026-08-21",
				expiresAt: "2026-08-20",
			}).success,
		).toBe(true);
		expect(isValidFactDateRange("2026-08-21", "2026-08-20")).toBe(false);
		expect(isValidFactDateRange("2026-08-20", "2026-08-21")).toBe(true);
	});

	it("requires explicit intent for sensitive verified edits", () => {
		expect(
			resolveFactStatusAfterEdit("verified", "verified", true, "preserve"),
		).toBe("draft");
		expect(
			resolveFactStatusAfterEdit("verified", "verified", true, "verify"),
		).toBe("verified");
	});

	it("preserves notes-only edits and protects draft/inactive verification", () => {
		expect(resolveFactStatusAfterEdit("verified", "verified", false)).toBe(
			"verified",
		);
		expect(resolveFactStatusAfterEdit("draft", "verified", false)).toBe(
			"draft",
		);
		expect(resolveFactStatusAfterEdit("inactive", "verified", false)).toBe(
			"draft",
		);
		expect(
			resolveFactStatusAfterEdit("draft", "verified", false, "verify"),
		).toBe("verified");
	});
});

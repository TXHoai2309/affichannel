import type { FactLockStoredClaim } from "@affichannel/core/fact-lock/types";
import { describe, expect, it } from "vitest";
import {
	filterFactLockClaims,
	getFactLockActionState,
	getFactLockOccurrenceLabel,
	getFactLockSummary,
} from "./fact-lock-review-state";

const claim = (
	classificationStatus: FactLockStoredClaim["classificationStatus"],
	reviewStatus: FactLockStoredClaim["reviewStatus"] = "UNRESOLVED",
) =>
	({
		id: `${classificationStatus}-${reviewStatus}`,
		claimKey: "claim-1",
		claimText: "Pin 30 giờ",
		occurrence: { section: "voiceover", segmentKey: "intro" },
		classificationStatus,
		reviewStatus,
		reason: "Đối chiếu Product Fact.",
		confidence: 0.9,
		suggestionText: "Thời lượng pin lên tới 30 giờ.",
		checkedAt: new Date(),
		reviewedByUserId: null,
		reviewedAt: null,
		reviewNote: null,
		factMappings: [],
	}) satisfies FactLockStoredClaim;

describe("Fact Lock Review state", () => {
	it("summarizes and filters server classifications without reclassifying", () => {
		const claims = [
			claim("SUPPORTED", "AUTO_PASSED"),
			claim("NEEDS_REVIEW"),
			claim("UNSUPPORTED"),
			claim("PROHIBITED"),
		];
		expect(getFactLockSummary(claims)).toMatchObject({
			total: 4,
			SUPPORTED: 1,
			NEEDS_REVIEW: 1,
			UNSUPPORTED: 1,
			PROHIBITED: 1,
			unresolved: 3,
		});
		expect(filterFactLockClaims(claims, "NEEDS_REVIEW")).toHaveLength(1);
	});

	it("exposes only valid resolution actions and blocks stale state", () => {
		const review = claim("NEEDS_REVIEW");
		expect(getFactLockActionState(review, false)).toMatchObject({
			canApprove: true,
			canEdit: true,
			canDelete: true,
			canApplySuggestion: true,
		});
		expect(getFactLockActionState(review, true)).toEqual({
			canApprove: false,
			canEdit: false,
			canDelete: false,
			canApplySuggestion: false,
		});
	});

	it("formats occurrence for a human-readable review list", () => {
		expect(
			getFactLockOccurrenceLabel({ section: "scene", sceneOrder: 2 }),
		).toBe("Cảnh · 2");
	});
});

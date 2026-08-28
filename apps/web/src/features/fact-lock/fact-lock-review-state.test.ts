import type { FactLockStoredClaim } from "@affichannel/core/fact-lock/types";
import { describe, expect, it } from "vitest";
import {
	filterFactLockClaims,
	getFactLockActionState,
	getFactLockErrorMessage,
	getFactLockOccurrenceLabel,
	getFactLockSummary,
	settleFactLockMutation,
	shouldRefreshFactLockWorkflow,
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
	it("refetches state before refreshing workflow after a terminal mutation", async () => {
		const events: string[] = [];
		const result = await settleFactLockMutation(
			Promise.resolve({ status: "passed" as const }),
			async () => {
				events.push("refetch");
			},
			() => {
				events.push("router.refresh");
			},
		);

		expect(result.status).toBe("passed");
		expect(events).toEqual(["refetch", "router.refresh"]);
	});

	it("refetches pending state without refreshing workflow until terminal", async () => {
		const events: string[] = [];
		await settleFactLockMutation(
			Promise.resolve({ status: "pending" as const }),
			async () => {
				events.push("refetch");
			},
			() => {
				events.push("router.refresh");
			},
		);

		expect(events).toEqual(["refetch"]);
	});

	it.each(["review_required", "failed", "indeterminate"] as const)(
		"refreshes workflow when pending polling reaches %s",
		(status) => {
			expect(shouldRefreshFactLockWorkflow("pending", status)).toBe(true);
		},
	);

	it("does not refresh workflow for initial or still-pending state", () => {
		expect(shouldRefreshFactLockWorkflow(null, "passed")).toBe(false);
		expect(shouldRefreshFactLockWorkflow("pending", "pending")).toBe(false);
	});

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

	it("allows only status approval for a current Manifest run", () => {
		const review = claim("NEEDS_REVIEW");
		expect(getFactLockActionState(review, false, "MANIFEST_V1")).toEqual({
			canApprove: true,
			canEdit: false,
			canDelete: false,
			canApplySuggestion: false,
		});
		expect(getFactLockActionState(review, true, "MANIFEST_V1").canApprove).toBe(
			false,
		);
	});

	it("formats occurrence for a human-readable review list", () => {
		expect(
			getFactLockOccurrenceLabel({ section: "scene", sceneOrder: 2 }),
		).toBe("Cảnh · 2");
	});

	it("maps persisted diagnostic suffixes to a safe user-facing message", () => {
		expect(
			getFactLockErrorMessage({
				message: "INVALID_FACT_LOCK_OUTPUT:CLAIM_OCCURRENCE_INVALID",
			}),
		).toContain("không đúng contract Fact Lock");
		expect(
			getFactLockErrorMessage({ message: "AI_OUTPUT_TRUNCATED" }),
		).toContain("bị cắt");
	});
});

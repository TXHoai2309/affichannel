import { describe, expect, it } from "vitest";

import {
	aiExecutionIsBlocked,
	aiOperationRecoveryLabel,
	aiOperationStatusLabel,
} from "./ai-governance-presentation";

describe("AI governance UI safety states", () => {
	it("keeps indeterminate operations in review/reconcile state", () => {
		expect(aiOperationStatusLabel("INDETERMINATE")).toBe(
			"Cần reconcile / review",
		);
		expect(aiOperationRecoveryLabel("INDETERMINATE")).toBe(
			"Review / reconcile",
		);
	});

	it("does not expose paid execution while the release gate is closed", () => {
		expect(aiExecutionIsBlocked({ paidExecutionReleased: false })).toBe(true);
		expect(aiExecutionIsBlocked(undefined)).toBe(true);
		expect(aiExecutionIsBlocked({ paidExecutionReleased: true })).toBe(false);
	});
});

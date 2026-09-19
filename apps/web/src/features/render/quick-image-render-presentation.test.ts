import { describe, expect, it } from "vitest";
import {
	resolveQuickImageRenderUiState,
	shouldPollQuickImageRender,
} from "./quick-image-render-presentation";

describe("Quick Image render lifecycle presentation", () => {
	it.each([
		[null, "READY"],
		["QUEUED", "QUEUED"],
		["RUNNING", "RUNNING"],
		["BLOCKED", "BLOCKED"],
		["FAILED", "FAILED"],
		["INDETERMINATE", "INDETERMINATE"],
		["COMPLETED", "COMPLETED"],
	] as const)("maps %s to the distinct UI state %s", (status, expected) => {
		expect(resolveQuickImageRenderUiState({ status })).toBe(expected);
	});

	it("polls only while work is queued or running", () => {
		expect(shouldPollQuickImageRender("QUEUED")).toBe(true);
		expect(shouldPollQuickImageRender("RUNNING")).toBe(true);
		for (const status of [
			"BLOCKED",
			"FAILED",
			"INDETERMINATE",
			"COMPLETED",
			null,
		] as const)
			expect(shouldPollQuickImageRender(status)).toBe(false);
	});
});

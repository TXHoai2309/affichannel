import { describe, expect, it } from "vitest";

import {
	getActiveProjectStepKey,
	getProjectStepStatus,
	PROJECT_STEP_STATUS_LABELS,
	PROJECT_STEPS,
} from "./project-steps";

describe("project step contract", () => {
	it("defines the seven MVP steps in order", () => {
		expect(PROJECT_STEPS.map((step) => step.key)).toEqual([
			"product",
			"content",
			"fact-lock",
			"voice",
			"video",
			"preview",
			"completed",
		]);
	});

	it("derives current from the route instead of persistence", () => {
		expect(getProjectStepStatus("product", "product", "completed")).toBe(
			"current",
		);
		expect(getProjectStepStatus("voice", "fact-lock", "blocked")).toBe(
			"blocked",
		);
	});

	it("maps a direct URL to a step and falls back safely", () => {
		expect(getActiveProjectStepKey("/projects/demo/fact-lock", "demo")).toBe(
			"fact-lock",
		);
		expect(getActiveProjectStepKey("/projects/demo/unknown", "demo")).toBe(
			"product",
		);
	});

	it("has accessible labels for all statuses", () => {
		expect(Object.keys(PROJECT_STEP_STATUS_LABELS)).toHaveLength(5);
		expect(PROJECT_STEP_STATUS_LABELS.needs_review).toBe("Cần xem lại");
	});
});

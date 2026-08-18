import { describe, expect, it } from "vitest";

import {
	getActiveProjectStepKey,
	getProjectStepDisplayStatus,
	getProjectStepReadinessLabel,
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

	it("derives Fact Lock readiness without changing persisted workflow state", () => {
		const blocked = {
			allowed: false,
			reason: "FACT_LOCK_STALE_SCRIPT" as const,
			currentScriptVersionId: "script-1",
			currentScriptRevision: 2,
			factLockRunId: "run-1",
			blockingRunStatus: "passed" as const,
		};
		const passed = {
			...blocked,
			allowed: true,
			reason: "FACT_LOCK_PASSED" as const,
		};

		expect(getProjectStepDisplayStatus("fact-lock", "current", blocked)).toBe(
			"blocked",
		);
		expect(getProjectStepReadinessLabel("fact-lock", blocked)).toBe(
			"Cần chạy lại",
		);
		expect(getProjectStepDisplayStatus("fact-lock", "current", passed)).toBe(
			"completed",
		);
		expect(getProjectStepReadinessLabel("fact-lock", passed)).toBe(
			"Hoàn thành",
		);
		expect(getProjectStepDisplayStatus("voice", "not_started", passed)).toBe(
			"not_started",
		);
		expect(getProjectStepReadinessLabel("voice", passed)).toBe(
			"Có thể tiếp tục",
		);
		expect(getProjectStepDisplayStatus("voice", "not_started", blocked)).toBe(
			"blocked",
		);
		expect(getProjectStepReadinessLabel("voice", blocked)).toBe("Bị khóa");
	});
});

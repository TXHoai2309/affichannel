import {
	type AdaptiveWorkflowReadModel,
	type AdaptiveWorkflowStep,
	mapAdaptiveWorkflowReadModel,
	type ProjectApplicabilityInput,
	resolveProjectApplicability,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

import {
	buildAdaptiveStepperItems,
	getActiveAdaptiveCapability,
	getAdaptiveStepPresentation,
	getAdaptiveWorkflowOverviewPresentation,
} from "./adaptive-workflow-presentation";

function step(patch: Partial<AdaptiveWorkflowStep> = {}): AdaptiveWorkflowStep {
	return {
		capability: "SCRIPT",
		applicabilityState: "READY",
		completion: "NOT_STARTED",
		reasonCode: "SCRIPT_GENERATION_REQUIRED",
		primaryRoute: { key: "content", segment: "content" },
		secondaryRoutes: [],
		visible: true,
		navigable: true,
		visibleOrdinal: 1,
		optionalSelection: "NOT_APPLICABLE",
		primaryAction: {
			kind: "OPEN_STEP",
			targetCapability: "SCRIPT",
			targetRouteKey: "content",
		},
		...patch,
	};
}

function workflow(
	steps: AdaptiveWorkflowStep[],
	patch: Partial<AdaptiveWorkflowReadModel> = {},
): AdaptiveWorkflowReadModel {
	return {
		steps,
		nextApplicableStep: steps[0]?.capability ?? null,
		nextRouteKey: steps[0]?.primaryRoute.key ?? null,
		terminalState: {
			routeKey: "completed",
			eligible: false,
			reason: "NEXT_APPLICABLE_STEP_REMAINS",
		},
		unsupportedState: { isUnsupported: false, reasonCode: null },
		...patch,
	};
}

function baseInput(): ProjectApplicabilityInput {
	return {
		projectIdentity: {
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			hasProduct: true,
		},
		product: { accessible: true },
		script: {
			generationStatus: "NONE",
			usableGenerationPresent: false,
			sourceDependencyCurrent: true,
			currentVersionPresent: false,
			currentVersionFactLockReady: false,
			channelSettingsComplete: true,
			productFactsUsable: true,
		},
		factLock: { gateReason: "NO_SCRIPT_VERSION" },
		voice: {
			configPresent: false,
			previewPresent: false,
			totalSegments: 0,
			attemptedSegments: 0,
			usableSegments: 0,
			pendingSegments: 0,
			failedSegments: 0,
			indeterminateSegments: 0,
			staleSegments: 0,
		},
		render: { featureImplemented: false, inputsStale: false },
	};
}

function currentScript(input: ProjectApplicabilityInput) {
	Object.assign(input.script, {
		generationStatus: "USABLE",
		usableGenerationPresent: true,
		currentVersionPresent: true,
		currentVersionFactLockReady: true,
	});
}

function factLockPassed(input: ProjectApplicabilityInput) {
	currentScript(input);
	input.factLock.gateReason = "FACT_LOCK_PASSED";
}

describe("AFF-US-015 adaptive presentation mapper", () => {
	it.each([
		[
			"READY + NOT_STARTED",
			"READY",
			"NOT_STARTED",
			"Sẵn sàng",
			"default",
			true,
		],
		[
			"READY + IN_PROGRESS",
			"READY",
			"IN_PROGRESS",
			"Đang thực hiện",
			"secondary",
			true,
		],
		["READY + COMPLETE", "READY", "COMPLETE", "Hoàn thành", "success", true],
		[
			"REQUIRED + NOT_STARTED",
			"REQUIRED",
			"NOT_STARTED",
			"Cần hoàn tất bước trước",
			"outline",
			true,
		],
		[
			"REQUIRED + IN_PROGRESS",
			"REQUIRED",
			"IN_PROGRESS",
			"Đang thực hiện",
			"secondary",
			true,
		],
		[
			"BLOCKED + NOT_STARTED",
			"BLOCKED",
			"NOT_STARTED",
			"Đang bị chặn",
			"destructive",
			true,
		],
		[
			"BLOCKED + IN_PROGRESS",
			"BLOCKED",
			"IN_PROGRESS",
			"Đang bị chặn",
			"destructive",
			true,
		],
		[
			"STALE + IN_PROGRESS",
			"STALE",
			"IN_PROGRESS",
			"Cần cập nhật",
			"warning",
			true,
		],
	] as const)(
		"maps %s without changing domain truth",
		(_name, applicabilityState, completion, label, variant, valid) => {
			const presentation = getAdaptiveStepPresentation(
				step({ applicabilityState, completion }),
			);
			expect(presentation).toMatchObject({
				statusLabel: label,
				badgeVariant: variant,
				valid,
			});
		},
	);

	it.each([
		["REQUIRED", "COMPLETE"],
		["BLOCKED", "COMPLETE"],
		["STALE", "NOT_STARTED"],
		["STALE", "COMPLETE"],
	] as const)("fails closed for invalid %s + %s", (state, completion) => {
		const presentation = getAdaptiveStepPresentation(
			step({ applicabilityState: state, completion }),
		);
		expect(presentation).toMatchObject({
			statusLabel: "Project cần được kiểm tra",
			semantic: "attention",
			actionAvailable: false,
			valid: false,
		});
	});

	it("fails closed when a reason is attached to the wrong capability", () => {
		const presentation = getAdaptiveStepPresentation(
			step({ reasonCode: "VOICE_CONFIG_REQUIRED" }),
		);
		expect(presentation).toMatchObject({
			statusLabel: "Project cần được kiểm tra",
			actionAvailable: false,
			valid: false,
		});
	});

	it("maps unimplemented Render to informational coming-soon without execution action", () => {
		const presentation = getAdaptiveStepPresentation(
			step({
				capability: "RENDER",
				applicabilityState: "BLOCKED",
				completion: "NOT_STARTED",
				reasonCode: "RENDER_FEATURE_NOT_IMPLEMENTED",
				primaryRoute: { key: "video", segment: "video" },
				secondaryRoutes: [{ key: "preview", segment: "preview" }],
				primaryAction: {
					kind: "COMING_SOON",
					targetCapability: null,
					targetRouteKey: null,
				},
			}),
		);
		expect(presentation).toMatchObject({
			label: "Dựng video",
			statusLabel: "Sắp có",
			semantic: "coming_soon",
			actionAvailable: false,
			actionLabel: null,
		});
	});

	it("renders a controlled unsupported Overview with no normal CTA", () => {
		const result = getAdaptiveWorkflowOverviewPresentation(
			workflow([], {
				unsupportedState: {
					isUnsupported: true,
					reasonCode: "PARTIAL_CHANNEL_FIRST_FIELDS",
				},
			}),
			"project-a",
		);
		expect(result).toMatchObject({
			needsAttention: true,
			nextStepLabel: "Project cần được kiểm tra",
			action: null,
		});
		expect(result.helperText).toContain("chưa đầy đủ");
	});
});

describe("AFF-US-015 Adaptive ProjectStepper contract", () => {
	it.each([
		["A", () => undefined, "SCRIPT", "Sẵn sàng"],
		[
			"B",
			(input: ProjectApplicabilityInput) => {
				input.script.generationStatus = "USABLE";
				input.script.usableGenerationPresent = true;
			},
			"SCRIPT",
			"Đang thực hiện",
		],
		[
			"C",
			(input: ProjectApplicabilityInput) => {
				currentScript(input);
				input.factLock.gateReason = "FACT_LOCK_NOT_RUN";
			},
			"FACT_LOCK",
			"Sẵn sàng",
		],
		[
			"D",
			(input: ProjectApplicabilityInput) => {
				currentScript(input);
				input.factLock.gateReason = "FACT_LOCK_REVIEW_REQUIRED";
			},
			"FACT_LOCK",
			"Đang bị chặn",
		],
		["E", factLockPassed, "VOICE", "Sẵn sàng"],
		[
			"F",
			(input: ProjectApplicabilityInput) => {
				factLockPassed(input);
				Object.assign(input.voice, { configPresent: true, totalSegments: 2 });
			},
			"VOICE",
			"Đang thực hiện",
		],
		[
			"G",
			(input: ProjectApplicabilityInput) => {
				factLockPassed(input);
				Object.assign(input.voice, {
					configPresent: true,
					totalSegments: 2,
					attemptedSegments: 1,
					usableSegments: 1,
				});
			},
			"VOICE",
			"Đang thực hiện",
		],
		[
			"H",
			(input: ProjectApplicabilityInput) => {
				factLockPassed(input);
				Object.assign(input.voice, {
					configPresent: true,
					totalSegments: 2,
					attemptedSegments: 2,
					usableSegments: 2,
				});
			},
			"RENDER",
			"Sắp có",
		],
		[
			"I",
			(input: ProjectApplicabilityInput) => {
				currentScript(input);
				input.factLock.gateReason = "FACT_LOCK_STALE_SCRIPT";
				input.voice.attemptedSegments = 1;
				input.voice.staleSegments = 1;
			},
			"FACT_LOCK",
			"Cần cập nhật",
		],
		[
			"J",
			(input: ProjectApplicabilityInput) => {
				currentScript(input);
				input.script.sourceDependencyCurrent = false;
				input.factLock.gateReason = "FACT_LOCK_STALE_FACTS";
			},
			"FACT_LOCK",
			"Cần cập nhật",
		],
	] as const)("maps Affiliate matrix %s", (_case, configure, next, status) => {
		const input = baseInput();
		configure(input);
		const model = mapAdaptiveWorkflowReadModel(
			resolveProjectApplicability(input),
		);
		const items = buildAdaptiveStepperItems(
			model,
			"/projects/project-a/product",
			"project-a",
		);
		const nextItem = items.find((item) => item.next);

		expect(items).toHaveLength(5);
		expect(items.map((item) => item.step.visibleOrdinal)).toEqual([
			1, 2, 3, 4, 5,
		]);
		expect(nextItem?.step.capability).toBe(next);
		expect(nextItem?.presentation.statusLabel).toBe(status);
	});

	it("keeps active viewed route separate from next progression", () => {
		const input = baseInput();
		factLockPassed(input);
		const model = mapAdaptiveWorkflowReadModel(
			resolveProjectApplicability(input),
		);
		const items = buildAdaptiveStepperItems(
			model,
			"/projects/project-a/fact-lock",
			"project-a",
		);

		expect(items.find((item) => item.active)?.step.capability).toBe(
			"FACT_LOCK",
		);
		expect(items.find((item) => item.next)?.step.capability).toBe("VOICE");
	});

	it("maps both Video and Preview paths to one Render capability", () => {
		const input = baseInput();
		factLockPassed(input);
		Object.assign(input.voice, {
			configPresent: true,
			totalSegments: 1,
			attemptedSegments: 1,
			usableSegments: 1,
		});
		const model = mapAdaptiveWorkflowReadModel(
			resolveProjectApplicability(input),
		);

		expect(
			getActiveAdaptiveCapability(
				"/projects/project-a/video",
				"project-a",
				model,
			),
		).toBe("RENDER");
		expect(
			getActiveAdaptiveCapability(
				"/projects/project-a/preview",
				"project-a",
				model,
			),
		).toBe("RENDER");
		expect(
			buildAdaptiveStepperItems(
				model,
				"/projects/project-a/preview",
				"project-a",
			).filter((item) => item.step.capability === "RENDER"),
		).toHaveLength(1);
	});

	it("uses server-owned visibility and ordinals without Preview or Completed cards", () => {
		const model = workflow([
			step({
				capability: "PRODUCT",
				visible: false,
				visibleOrdinal: null,
				applicabilityState: "NOT_REQUIRED",
				reasonCode: "PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
				primaryRoute: { key: "product", segment: "product" },
			}),
			step({ visibleOrdinal: 1 }),
			step({
				capability: "FACT_LOCK",
				visibleOrdinal: 2,
				primaryRoute: { key: "fact-lock", segment: "fact-lock" },
			}),
			step({
				capability: "RENDER",
				visibleOrdinal: 3,
				primaryRoute: { key: "video", segment: "video" },
				secondaryRoutes: [{ key: "preview", segment: "preview" }],
			}),
		]);
		const items = buildAdaptiveStepperItems(
			model,
			"/projects/project-a/content",
			"project-a",
		);

		expect(items.map((item) => item.step.visibleOrdinal)).toEqual([1, 2, 3]);
		expect(items.map((item) => item.href)).toEqual([
			"/projects/project-a/content",
			"/projects/project-a/fact-lock",
			"/projects/project-a/video",
		]);
	});

	it("derives Overview CTA only from Adaptive Workflow", () => {
		const input = baseInput();
		currentScript(input);
		input.factLock.gateReason = "FACT_LOCK_NOT_RUN";
		const model = mapAdaptiveWorkflowReadModel(
			resolveProjectApplicability(input),
		);
		const overview = getAdaptiveWorkflowOverviewPresentation(
			model,
			"project-a",
		);

		expect(overview).toMatchObject({
			nextStepLabel: "Fact Lock",
			statusLabel: "Sẵn sàng",
			action: {
				label: "Chạy Fact Lock",
				href: "/projects/project-a/fact-lock",
			},
		});
	});
});

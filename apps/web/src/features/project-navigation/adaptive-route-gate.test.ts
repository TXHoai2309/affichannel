import {
	mapAdaptiveWorkflowReadModel,
	type ProjectApplicabilityInput,
	resolveProjectApplicability,
} from "@affichannel/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
	type AdaptiveProjectRouteKey,
	getAdaptiveRouteGatePresentation,
} from "./adaptive-workflow-presentation";
import ProjectStepPage from "./project-step-page";

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

function model(input: ProjectApplicabilityInput) {
	return mapAdaptiveWorkflowReadModel(resolveProjectApplicability(input));
}

function decision(
	input: ProjectApplicabilityInput,
	route: AdaptiveProjectRouteKey,
) {
	return getAdaptiveRouteGatePresentation(model(input), route, "project-gate");
}

describe("AFF-US-015/15C shared Adaptive route gate", () => {
	it("renders controlled NOT_REQUIRED and OPTIONAL-unselected states", () => {
		const input = baseInput();
		const workflow = model(input);
		const script = workflow.steps.find((step) => step.capability === "SCRIPT");
		expect(script).toBeDefined();
		if (!script) return;

		const notRequired = getAdaptiveRouteGatePresentation(
			{
				...workflow,
				steps: [
					{
						...script,
						applicabilityState: "NOT_REQUIRED",
						completion: "NOT_STARTED",
						reasonCode: "SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH",
						visible: false,
						navigable: false,
						primaryAction: null,
					},
				],
			},
			"content",
			"project-gate",
		);
		const optional = getAdaptiveRouteGatePresentation(
			{
				...workflow,
				steps: [
					{
						...script,
						applicabilityState: "OPTIONAL",
						optionalSelection: "NOT_SELECTED",
						visible: false,
						navigable: false,
						primaryAction: null,
					},
				],
			},
			"content",
			"project-gate",
		);

		expect(notRequired).toMatchObject({
			mode: "gated",
			title: "Bước này không áp dụng cho Project hiện tại",
			action: { label: "Về tổng quan Project" },
		});
		expect(optional).toMatchObject({
			mode: "gated",
			title: "Bước tùy chọn chưa được bật",
			action: { label: "Về tổng quan Project" },
		});
	});

	it("distinguishes REQUIRED, READY, BLOCKED, and STALE presentation", () => {
		const requiredInput = baseInput();
		currentScript(requiredInput);
		requiredInput.factLock.gateReason = "FACT_LOCK_NOT_RUN";
		const required = decision(requiredInput, "voice");
		const readyInput = baseInput();
		factLockPassed(readyInput);
		const ready = decision(readyInput, "voice");
		const blockedInput = baseInput();
		currentScript(blockedInput);
		blockedInput.factLock.gateReason = "FACT_LOCK_REVIEW_REQUIRED";
		const blocked = decision(blockedInput, "fact-lock");
		const staleInput = baseInput();
		currentScript(staleInput);
		staleInput.factLock.gateReason = "FACT_LOCK_STALE_FACTS";
		const stale = decision(staleInput, "fact-lock");

		expect(required).toMatchObject({
			mode: "gated",
			title: "Hoàn tất Fact Lock trước",
			action: { href: "/projects/project-gate/fact-lock" },
		});
		expect(ready.mode).toBe("content");
		expect(blocked).toMatchObject({
			mode: "remediation",
			statusLabel: "Đang bị chặn",
		});
		expect(stale).toMatchObject({
			mode: "remediation",
			title: "Cần cập nhật",
			statusLabel: "Cần cập nhật",
		});
	});

	it("fails closed for unsupported identity and an invalid canonical tuple", () => {
		const input = baseInput();
		const workflow = model(input);
		const unsupported = getAdaptiveRouteGatePresentation(
			{
				...workflow,
				unsupportedState: {
					isUnsupported: true,
					reasonCode: "PARTIAL_CHANNEL_FIRST_FIELDS",
				},
			},
			"voice",
			"project-gate",
		);
		const voice = workflow.steps.find((step) => step.capability === "VOICE");
		expect(voice).toBeDefined();
		if (!voice) return;
		const invalid = getAdaptiveRouteGatePresentation(
			{
				...workflow,
				steps: [
					{
						...voice,
						applicabilityState: "READY",
						completion: "COMPLETE",
						reasonCode: "FACT_LOCK_PASSED",
					},
				],
			},
			"voice",
			"project-gate",
		);

		expect(unsupported).toMatchObject({
			mode: "gated",
			title: "Project cần được kiểm tra",
		});
		expect(invalid).toMatchObject({
			mode: "gated",
			title: "Project cần được kiểm tra",
		});
	});

	it("renders accessible gated copy without rendering hidden execution content", () => {
		const input = baseInput();
		currentScript(input);
		input.factLock.gateReason = "FACT_LOCK_NOT_RUN";
		const workflow = model(input);
		const gatedMarkup = renderToStaticMarkup(
			ProjectStepPage({
				content: createElement("button", { type: "button" }, "Generate voice"),
				projectId: "project-gate",
				stepKey: "voice",
				workflow,
			}),
		);
		expect(gatedMarkup).toContain("Hoàn tất Fact Lock trước");
		expect(gatedMarkup).toContain("Mở Fact Lock");
		expect(gatedMarkup).not.toContain("Generate voice");
		expect(gatedMarkup).toContain("<h1>");
	});
});

describe("AFF-US-015/15C Affiliate A-J direct-route matrix", () => {
	it.each([
		["A", () => undefined, "content", "content"],
		[
			"B",
			(input: ProjectApplicabilityInput) => {
				input.script.generationStatus = "USABLE";
				input.script.usableGenerationPresent = true;
			},
			"content",
			"content",
		],
		[
			"C",
			(input: ProjectApplicabilityInput) => {
				currentScript(input);
				input.factLock.gateReason = "FACT_LOCK_NOT_RUN";
			},
			"fact-lock",
			"content",
		],
		[
			"D",
			(input: ProjectApplicabilityInput) => {
				currentScript(input);
				input.factLock.gateReason = "FACT_LOCK_REVIEW_REQUIRED";
			},
			"fact-lock",
			"remediation",
		],
		["E", factLockPassed, "voice", "content"],
		[
			"F",
			(input: ProjectApplicabilityInput) => {
				factLockPassed(input);
				Object.assign(input.voice, { configPresent: true, totalSegments: 2 });
			},
			"voice",
			"content",
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
			"voice",
			"content",
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
			"video",
			"gated",
		],
		[
			"I",
			(input: ProjectApplicabilityInput) => {
				currentScript(input);
				input.factLock.gateReason = "FACT_LOCK_STALE_SCRIPT";
				input.voice.attemptedSegments = 1;
				input.voice.staleSegments = 1;
			},
			"fact-lock",
			"remediation",
		],
		[
			"J",
			(input: ProjectApplicabilityInput) => {
				currentScript(input);
				input.script.sourceDependencyCurrent = false;
				input.factLock.gateReason = "FACT_LOCK_STALE_FACTS";
			},
			"fact-lock",
			"remediation",
		],
	] as const)(
		"maps route matrix %s",
		(_case, configure, route, expectedMode) => {
			const input = baseInput();
			configure(input);
			expect(decision(input, route).mode).toBe(expectedMode);
		},
	);

	it("keeps downstream Voice gated for A/B/D/I/J", () => {
		const cases = [
			baseInput(),
			baseInput(),
			baseInput(),
			baseInput(),
			baseInput(),
		];
		cases[1].script.generationStatus = "USABLE";
		cases[1].script.usableGenerationPresent = true;
		currentScript(cases[2]);
		cases[2].factLock.gateReason = "FACT_LOCK_REVIEW_REQUIRED";
		currentScript(cases[3]);
		cases[3].factLock.gateReason = "FACT_LOCK_STALE_SCRIPT";
		currentScript(cases[4]);
		cases[4].script.sourceDependencyCurrent = false;
		cases[4].factLock.gateReason = "FACT_LOCK_STALE_FACTS";

		expect(cases.map((input) => decision(input, "voice").mode)).toEqual([
			"gated",
			"gated",
			"gated",
			"gated",
			"gated",
		]);
	});

	it("keeps /video and /preview on identical Render coming-soon truth", () => {
		const input = baseInput();
		factLockPassed(input);
		Object.assign(input.voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 2,
			usableSegments: 2,
		});
		const video = decision(input, "video");
		const preview = decision(input, "preview");

		expect(video).toEqual(preview);
		expect(video).toMatchObject({
			mode: "gated",
			title: "Sắp có",
			helperText: "Tính năng dựng và render chưa được triển khai.",
			action: null,
		});
	});

	it("does not consult a persisted currentStepKey for direct-route presentation", () => {
		const input = baseInput();
		factLockPassed(input);
		expect(decision(input, "voice").mode).toBe("content");
	});
});

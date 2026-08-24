import {
	type ApplicabilityCapability,
	type ApplicabilityCapabilityResult,
	classifyLegacyProject,
	mapAdaptiveWorkflowReadModel,
	type ProjectApplicabilityInput,
	type ProjectApplicabilityResult,
	resolveProjectApplicability,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

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

function passedFactLock(input: ProjectApplicabilityInput) {
	currentScript(input);
	input.factLock.gateReason = "FACT_LOCK_PASSED";
}

type Expected = readonly [
	ApplicabilityCapabilityResult["state"],
	ApplicabilityCapabilityResult["completion"],
	ApplicabilityCapabilityResult["reasonCode"],
];

const readyProduct = ["READY", "COMPLETE", "PRODUCT_READY"] as const;
const waitingRender = [
	"REQUIRED",
	"NOT_STARTED",
	"RENDER_REQUIRES_UPSTREAM_CAPABILITIES",
] as const;

const matrix: Array<{
	name: string;
	configure: (input: ProjectApplicabilityInput) => void;
	next: ApplicabilityCapability;
	expected: Record<ApplicabilityCapability, Expected>;
}> = [
	{
		name: "A no Script",
		configure: () => undefined,
		next: "SCRIPT",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "NOT_STARTED", "SCRIPT_GENERATION_REQUIRED"],
			FACT_LOCK: [
				"REQUIRED",
				"NOT_STARTED",
				"FACT_LOCK_REQUIRES_CURRENT_SCRIPT",
			],
			VOICE: ["REQUIRED", "NOT_STARTED", "VOICE_REQUIRES_FACT_LOCK_PASS"],
			RENDER: waitingRender,
		},
	},
	{
		name: "B generation exists",
		configure: (input) => {
			input.script.generationStatus = "USABLE";
			input.script.usableGenerationPresent = true;
		},
		next: "SCRIPT",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "IN_PROGRESS", "CURRENT_SCRIPT_VERSION_REQUIRED"],
			FACT_LOCK: [
				"REQUIRED",
				"NOT_STARTED",
				"FACT_LOCK_REQUIRES_CURRENT_SCRIPT",
			],
			VOICE: ["REQUIRED", "NOT_STARTED", "VOICE_REQUIRES_FACT_LOCK_PASS"],
			RENDER: waitingRender,
		},
	},
	{
		name: "C Fact Lock ready",
		configure: (input) => {
			currentScript(input);
			input.factLock.gateReason = "FACT_LOCK_NOT_RUN";
		},
		next: "FACT_LOCK",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "NOT_STARTED", "FACT_LOCK_RUN_REQUIRED"],
			VOICE: ["REQUIRED", "NOT_STARTED", "VOICE_REQUIRES_FACT_LOCK_PASS"],
			RENDER: waitingRender,
		},
	},
	{
		name: "D Fact Lock blocked",
		configure: (input) => {
			currentScript(input);
			input.factLock.gateReason = "FACT_LOCK_REVIEW_REQUIRED";
		},
		next: "FACT_LOCK",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["BLOCKED", "IN_PROGRESS", "FACT_LOCK_REVIEW_REQUIRED"],
			VOICE: ["BLOCKED", "NOT_STARTED", "VOICE_BLOCKED_BY_FACT_LOCK"],
			RENDER: waitingRender,
		},
	},
	{
		name: "E no VoiceConfig",
		configure: passedFactLock,
		next: "VOICE",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "COMPLETE", "FACT_LOCK_PASSED"],
			VOICE: ["READY", "NOT_STARTED", "VOICE_CONFIG_REQUIRED"],
			RENDER: waitingRender,
		},
	},
	{
		name: "F no Voice segments",
		configure: (input) => {
			passedFactLock(input);
			input.voice.configPresent = true;
			input.voice.totalSegments = 2;
		},
		next: "VOICE",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "COMPLETE", "FACT_LOCK_PASSED"],
			VOICE: ["READY", "IN_PROGRESS", "VOICE_SEGMENTS_REQUIRED"],
			RENDER: waitingRender,
		},
	},
	{
		name: "G partial Voice segments",
		configure: (input) => {
			passedFactLock(input);
			Object.assign(input.voice, {
				configPresent: true,
				totalSegments: 2,
				attemptedSegments: 1,
				usableSegments: 1,
			});
		},
		next: "VOICE",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "COMPLETE", "FACT_LOCK_PASSED"],
			VOICE: ["READY", "IN_PROGRESS", "VOICE_SEGMENTS_INCOMPLETE"],
			RENDER: waitingRender,
		},
	},
	{
		name: "H Render unimplemented",
		configure: (input) => {
			passedFactLock(input);
			Object.assign(input.voice, {
				configPresent: true,
				totalSegments: 2,
				attemptedSegments: 2,
				usableSegments: 2,
			});
		},
		next: "RENDER",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "COMPLETE", "FACT_LOCK_PASSED"],
			VOICE: ["READY", "COMPLETE", "VOICE_READY"],
			RENDER: ["BLOCKED", "NOT_STARTED", "RENDER_FEATURE_NOT_IMPLEMENTED"],
		},
	},
	{
		name: "I stale Script dependency",
		configure: (input) => {
			currentScript(input);
			input.factLock.gateReason = "FACT_LOCK_STALE_SCRIPT";
			input.voice.attemptedSegments = 1;
			input.voice.staleSegments = 1;
		},
		next: "FACT_LOCK",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["STALE", "IN_PROGRESS", "FACT_LOCK_STALE_SCRIPT"],
			VOICE: ["STALE", "IN_PROGRESS", "VOICE_ARTIFACTS_STALE"],
			RENDER: waitingRender,
		},
	},
	{
		name: "J stale Product Facts",
		configure: (input) => {
			currentScript(input);
			input.script.sourceDependencyCurrent = false;
			input.factLock.gateReason = "FACT_LOCK_STALE_FACTS";
			Object.assign(input.voice, {
				configPresent: true,
				totalSegments: 2,
				attemptedSegments: 2,
				usableSegments: 2,
			});
		},
		next: "FACT_LOCK",
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["STALE", "IN_PROGRESS", "FACT_LOCK_STALE_FACTS"],
			VOICE: ["BLOCKED", "IN_PROGRESS", "VOICE_BLOCKED_BY_FACT_LOCK"],
			RENDER: waitingRender,
		},
	},
];

function resultItem(
	capability: ApplicabilityCapability,
	state: ApplicabilityCapabilityResult["state"],
	completion: ApplicabilityCapabilityResult["completion"],
	reasonCode: ApplicabilityCapabilityResult["reasonCode"],
): ApplicabilityCapabilityResult {
	return { capability, state, completion, reasonCode, dependencies: [] };
}

describe("AFF-US-015 Adaptive Workflow mapper", () => {
	it.each(matrix)(
		"maps Affiliate matrix $name exactly",
		({ configure, expected, next }) => {
			const input = baseInput();
			configure(input);
			const resolver = resolveProjectApplicability(input);
			const model = mapAdaptiveWorkflowReadModel(resolver, {
				identityClassification: classifyLegacyProject(input.projectIdentity),
			});

			expect(model.nextApplicableStep).toBe(next);
			expect(model.nextRouteKey).toBe(
				{
					SCRIPT: "content",
					FACT_LOCK: "fact-lock",
					VOICE: "voice",
					RENDER: "video",
					PRODUCT: "product",
				}[next],
			);
			expect(model.steps.map((step) => step.visibleOrdinal)).toEqual([
				1, 2, 3, 4, 5,
			]);
			for (const step of model.steps) {
				expect([
					step.applicabilityState,
					step.completion,
					step.reasonCode,
				]).toEqual(expected[step.capability]);
			}
		},
	);

	it("locks capability routes and Render informational action", () => {
		const input = baseInput();
		passedFactLock(input);
		Object.assign(input.voice, {
			configPresent: true,
			totalSegments: 1,
			attemptedSegments: 1,
			usableSegments: 1,
		});
		const model = mapAdaptiveWorkflowReadModel(
			resolveProjectApplicability(input),
		);
		const routes = Object.fromEntries(
			model.steps.map((step) => [
				step.capability,
				[
					step.primaryRoute.key,
					...step.secondaryRoutes.map((item) => item.key),
				],
			]),
		);
		expect(routes).toEqual({
			PRODUCT: ["product"],
			SCRIPT: ["content"],
			FACT_LOCK: ["fact-lock"],
			VOICE: ["voice"],
			RENDER: ["video", "preview"],
		});
		expect(model.steps.at(-1)?.primaryAction).toEqual({
			kind: "COMING_SOON",
			targetCapability: null,
			targetRouteKey: null,
		});
		expect(model.terminalState.eligible).toBe(false);
	});

	it("distinguishes NOT_REQUIRED and all OPTIONAL selection states", () => {
		const conceptual: ProjectApplicabilityResult = {
			capabilities: [
				resultItem(
					"PRODUCT",
					"NOT_REQUIRED",
					"NOT_STARTED",
					"PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
				),
				resultItem(
					"VOICE",
					"OPTIONAL",
					"NOT_STARTED",
					"VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
				),
			],
			nextApplicableStep: null,
		};
		const unsupported = mapAdaptiveWorkflowReadModel(conceptual);
		expect(unsupported.steps[0]).toMatchObject({
			visible: false,
			visibleOrdinal: null,
			optionalSelection: "NOT_APPLICABLE",
		});
		expect(unsupported.steps[1]).toMatchObject({
			visible: false,
			navigable: false,
			optionalSelection: "UNSUPPORTED",
		});

		const notSelected = mapAdaptiveWorkflowReadModel(conceptual, {
			optionalSelectionSupported: true,
		});
		expect(notSelected.steps[1]).toMatchObject({
			visible: false,
			navigable: true,
			optionalSelection: "NOT_SELECTED",
			primaryAction: { kind: "OPT_IN" },
		});

		const selected = mapAdaptiveWorkflowReadModel(conceptual, {
			optionalSelectionSupported: true,
			selectedOptionalCapabilities: ["VOICE"],
		});
		expect(selected.steps[1]).toMatchObject({
			visible: true,
			visibleOrdinal: 1,
			optionalSelection: "SELECTED",
			primaryAction: { kind: "OPEN_STEP" },
		});
	});

	it.each([
		[
			"partial identity",
			{ creationPath: null },
			"PARTIAL_CHANNEL_FIRST_FIELDS",
		],
		["invalid ContentType", { contentType: "BROKEN" }, "INVALID_CONTENT_TYPE"],
		[
			"invalid CreationPath",
			{ creationPath: "BROKEN" },
			"INVALID_CREATION_PATH",
		],
		[
			"unknown ContentFormat",
			{ contentFormatKey: "UNKNOWN" },
			"INVALID_CONTENT_FORMAT_REF",
		],
		[
			"invalid ContentFormat version",
			{ contentFormatVersion: 0 },
			"INVALID_CONTENT_FORMAT_REF",
		],
		[
			"Affiliate missing Product",
			{ hasProduct: false },
			"AFFILIATE_PRODUCT_MISSING",
		],
	] as const)(
		"represents unsupported %s without throwing",
		(_name, identityPatch, reason) => {
			const input = baseInput();
			Object.assign(input.projectIdentity, identityPatch);
			const classification = classifyLegacyProject(input.projectIdentity);
			const model = mapAdaptiveWorkflowReadModel(
				resolveProjectApplicability(input),
				{ identityClassification: classification },
			);
			expect(model.unsupportedState).toEqual({
				isUnsupported: true,
				reasonCode: reason,
			});
			expect(model.terminalState).toMatchObject({
				eligible: false,
				reason: "PROJECT_IDENTITY_UNSUPPORTED",
			});
			expect(
				model.steps.every((step) => step.applicabilityState === "BLOCKED"),
			).toBe(true);
		},
	);
});

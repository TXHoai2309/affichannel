import {
	type ApplicabilityCapability,
	type ApplicabilityCapabilityResult,
	deriveNextApplicableStep,
	type ProjectApplicabilityInput,
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

function capability(
	input: ProjectApplicabilityInput,
	name: ApplicabilityCapability,
): ApplicabilityCapabilityResult {
	const found = resolveProjectApplicability(input).capabilities.find(
		(item) => item.capability === name,
	);
	if (!found) throw new Error(`Missing ${name} capability`);
	return found;
}

function summary(result: ApplicabilityCapabilityResult) {
	return {
		state: result.state,
		completion: result.completion,
		reasonCode: result.reasonCode,
	};
}

function expectCapability(
	input: ProjectApplicabilityInput,
	name: ApplicabilityCapability,
	expected: ReturnType<typeof summary>,
) {
	expect(summary(capability(input, name))).toEqual(expected);
}

function withCurrentScript(input: ProjectApplicabilityInput) {
	input.script.generationStatus = "USABLE";
	input.script.usableGenerationPresent = true;
	input.script.currentVersionPresent = true;
	input.script.currentVersionFactLockReady = true;
}

function withPassedFactLock(input: ProjectApplicabilityInput) {
	withCurrentScript(input);
	input.factLock.gateReason = "FACT_LOCK_PASSED";
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const nested of Object.values(value)) deepFreeze(nested);
	}
	return value;
}

type ExpectedCapability = readonly [
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

function matrixInput(
	configure: (input: ProjectApplicabilityInput) => void,
): ProjectApplicabilityInput {
	const input = baseInput();
	configure(input);
	return input;
}

const matrixCases: Array<{
	name: string;
	input: ProjectApplicabilityInput;
	expected: Record<ApplicabilityCapability, ExpectedCapability>;
	next: ApplicabilityCapability;
}> = [
	{
		name: "A Product exists, no Script",
		input: baseInput(),
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
		next: "SCRIPT",
	},
	{
		name: "B generation exists, no current ScriptVersion",
		input: matrixInput((input) => {
			input.script.generationStatus = "USABLE";
			input.script.usableGenerationPresent = true;
		}),
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
		next: "SCRIPT",
	},
	{
		name: "C current ScriptVersion, no Fact Lock",
		input: matrixInput((input) => {
			withCurrentScript(input);
			input.factLock.gateReason = "FACT_LOCK_NOT_RUN";
		}),
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "NOT_STARTED", "FACT_LOCK_RUN_REQUIRED"],
			VOICE: ["REQUIRED", "NOT_STARTED", "VOICE_REQUIRES_FACT_LOCK_PASS"],
			RENDER: waitingRender,
		},
		next: "FACT_LOCK",
	},
	{
		name: "D Fact Lock review required",
		input: matrixInput((input) => {
			withCurrentScript(input);
			input.factLock.gateReason = "FACT_LOCK_REVIEW_REQUIRED";
		}),
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["BLOCKED", "IN_PROGRESS", "FACT_LOCK_REVIEW_REQUIRED"],
			VOICE: ["BLOCKED", "NOT_STARTED", "VOICE_BLOCKED_BY_FACT_LOCK"],
			RENDER: waitingRender,
		},
		next: "FACT_LOCK",
	},
	{
		name: "E Fact Lock PASS, no VoiceConfig",
		input: matrixInput(withPassedFactLock),
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "COMPLETE", "FACT_LOCK_PASSED"],
			VOICE: ["READY", "NOT_STARTED", "VOICE_CONFIG_REQUIRED"],
			RENDER: waitingRender,
		},
		next: "VOICE",
	},
	{
		name: "F VoiceConfig current, no segments",
		input: matrixInput((input) => {
			withPassedFactLock(input);
			input.voice.configPresent = true;
			input.voice.totalSegments = 2;
		}),
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "COMPLETE", "FACT_LOCK_PASSED"],
			VOICE: ["READY", "IN_PROGRESS", "VOICE_SEGMENTS_REQUIRED"],
			RENDER: waitingRender,
		},
		next: "VOICE",
	},
	{
		name: "G partial VoiceSegments",
		input: matrixInput((input) => {
			withPassedFactLock(input);
			Object.assign(input.voice, {
				configPresent: true,
				totalSegments: 2,
				attemptedSegments: 1,
				usableSegments: 1,
			});
		}),
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "COMPLETE", "FACT_LOCK_PASSED"],
			VOICE: ["READY", "IN_PROGRESS", "VOICE_SEGMENTS_INCOMPLETE"],
			RENDER: waitingRender,
		},
		next: "VOICE",
	},
	{
		name: "H all VoiceSegments usable/current",
		input: matrixInput((input) => {
			withPassedFactLock(input);
			Object.assign(input.voice, {
				configPresent: true,
				totalSegments: 2,
				attemptedSegments: 2,
				usableSegments: 2,
			});
		}),
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["READY", "COMPLETE", "FACT_LOCK_PASSED"],
			VOICE: ["READY", "COMPLETE", "VOICE_READY"],
			RENDER: ["BLOCKED", "NOT_STARTED", "RENDER_FEATURE_NOT_IMPLEMENTED"],
		},
		next: "RENDER",
	},
	{
		name: "I ScriptVersion changed after Fact Lock/Voice",
		input: matrixInput((input) => {
			withCurrentScript(input);
			input.factLock.gateReason = "FACT_LOCK_STALE_SCRIPT";
			input.voice.attemptedSegments = 1;
			input.voice.staleSegments = 1;
		}),
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["STALE", "IN_PROGRESS", "FACT_LOCK_STALE_SCRIPT"],
			VOICE: ["STALE", "IN_PROGRESS", "VOICE_ARTIFACTS_STALE"],
			RENDER: waitingRender,
		},
		next: "FACT_LOCK",
	},
	{
		name: "J Product Facts changed after Fact Lock",
		input: matrixInput((input) => {
			withCurrentScript(input);
			input.script.sourceDependencyCurrent = false;
			input.factLock.gateReason = "FACT_LOCK_STALE_FACTS";
			Object.assign(input.voice, {
				configPresent: true,
				totalSegments: 2,
				attemptedSegments: 2,
				usableSegments: 2,
			});
		}),
		expected: {
			PRODUCT: readyProduct,
			SCRIPT: ["READY", "COMPLETE", "SCRIPT_READY"],
			FACT_LOCK: ["STALE", "IN_PROGRESS", "FACT_LOCK_STALE_FACTS"],
			VOICE: ["BLOCKED", "IN_PROGRESS", "VOICE_BLOCKED_BY_FACT_LOCK"],
			RENDER: waitingRender,
		},
		next: "FACT_LOCK",
	},
];

describe("AFF-US-014 Applicability Resolver matrix", () => {
	it.each(matrixCases)(
		"asserts exact state/completion/reason for $name",
		({ input, expected, next }) => {
			const resolved = resolveProjectApplicability(input);
			for (const item of resolved.capabilities) {
				expect([item.state, item.completion, item.reasonCode]).toEqual(
					expected[item.capability],
				);
			}
			expect(resolved.nextApplicableStep).toBe(next);
		},
	);

	it("A: starts a canonical Affiliate Project at Script", () => {
		const input = baseInput();
		expectCapability(input, "PRODUCT", {
			state: "READY",
			completion: "COMPLETE",
			reasonCode: "PRODUCT_READY",
		});
		expectCapability(input, "SCRIPT", {
			state: "READY",
			completion: "NOT_STARTED",
			reasonCode: "SCRIPT_GENERATION_REQUIRED",
		});
		expectCapability(input, "FACT_LOCK", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_REQUIRES_CURRENT_SCRIPT",
		});
		expectCapability(input, "VOICE", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_REQUIRES_FACT_LOCK_PASS",
		});
		expectCapability(input, "RENDER", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "RENDER_REQUIRES_UPSTREAM_CAPABILITIES",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"SCRIPT",
		);
	});

	it("B: requires a current ScriptVersion after usable generation", () => {
		const input = baseInput();
		input.script.generationStatus = "USABLE";
		input.script.usableGenerationPresent = true;
		expectCapability(input, "SCRIPT", {
			state: "READY",
			completion: "IN_PROGRESS",
			reasonCode: "CURRENT_SCRIPT_VERSION_REQUIRED",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"SCRIPT",
		);
	});

	it("C: advances a Fact-Lock-ready Script to Fact Lock", () => {
		const input = baseInput();
		withCurrentScript(input);
		input.factLock.gateReason = "FACT_LOCK_NOT_RUN";
		expectCapability(input, "SCRIPT", {
			state: "READY",
			completion: "COMPLETE",
			reasonCode: "SCRIPT_READY",
		});
		expectCapability(input, "FACT_LOCK", {
			state: "READY",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_RUN_REQUIRED",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"FACT_LOCK",
		);
	});

	it("blocks Fact Lock when current Script claims are stale", () => {
		const input = baseInput();
		withCurrentScript(input);
		input.script.currentVersionFactLockReady = false;
		input.factLock.gateReason = "FACT_LOCK_NOT_RUN";

		expectCapability(input, "SCRIPT", {
			state: "BLOCKED",
			completion: "IN_PROGRESS",
			reasonCode: "SCRIPT_VERSION_NOT_FACT_LOCK_READY",
		});
		expectCapability(input, "FACT_LOCK", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_SCRIPT_NOT_READY",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"SCRIPT",
		);
	});

	it.each([
		["FACT_LOCK_REVIEW_REQUIRED", "FACT_LOCK_REVIEW_REQUIRED"],
		["FACT_LOCK_FAILED", "FACT_LOCK_FAILED"],
		["FACT_LOCK_INDETERMINATE", "FACT_LOCK_INDETERMINATE"],
	] as const)("D: blocks on %s", (gateReason, reasonCode) => {
		const input = baseInput();
		withCurrentScript(input);
		input.factLock.gateReason = gateReason;
		expectCapability(input, "FACT_LOCK", {
			state: "BLOCKED",
			completion: "IN_PROGRESS",
			reasonCode,
		});
		expectCapability(input, "VOICE", {
			state: "BLOCKED",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_BLOCKED_BY_FACT_LOCK",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"FACT_LOCK",
		);
	});

	it("E: requires Voice configuration after Fact Lock passes", () => {
		const input = baseInput();
		withPassedFactLock(input);
		expectCapability(input, "VOICE", {
			state: "READY",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_CONFIG_REQUIRED",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe("VOICE");
	});

	it("F: requires Voice segments after configuration", () => {
		const input = baseInput();
		withPassedFactLock(input);
		input.voice.configPresent = true;
		input.voice.totalSegments = 2;
		expectCapability(input, "VOICE", {
			state: "READY",
			completion: "IN_PROGRESS",
			reasonCode: "VOICE_SEGMENTS_REQUIRED",
		});
	});

	it("G: reports incomplete Voice segments", () => {
		const input = baseInput();
		withPassedFactLock(input);
		Object.assign(input.voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 1,
			usableSegments: 1,
		});
		expectCapability(input, "VOICE", {
			state: "READY",
			completion: "IN_PROGRESS",
			reasonCode: "VOICE_SEGMENTS_INCOMPLETE",
		});
	});

	it("H: reports Voice ready and Render unavailable without activating Render", () => {
		const input = baseInput();
		withPassedFactLock(input);
		Object.assign(input.voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 2,
			usableSegments: 2,
		});
		expectCapability(input, "VOICE", {
			state: "READY",
			completion: "COMPLETE",
			reasonCode: "VOICE_READY",
		});
		expectCapability(input, "RENDER", {
			state: "BLOCKED",
			completion: "NOT_STARTED",
			reasonCode: "RENDER_FEATURE_NOT_IMPLEMENTED",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"RENDER",
		);
	});

	it("I: gives stale Script Fact Lock precedence over stale Voice artifacts", () => {
		const input = baseInput();
		withCurrentScript(input);
		input.factLock.gateReason = "FACT_LOCK_STALE_SCRIPT";
		input.voice.staleSegments = 1;
		input.voice.attemptedSegments = 1;
		expectCapability(input, "FACT_LOCK", {
			state: "STALE",
			completion: "IN_PROGRESS",
			reasonCode: "FACT_LOCK_STALE_SCRIPT",
		});
		expectCapability(input, "VOICE", {
			state: "STALE",
			completion: "IN_PROGRESS",
			reasonCode: "VOICE_ARTIFACTS_STALE",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"FACT_LOCK",
		);
	});

	it("J: keeps a current Script ready while stale Product facts block downstream", () => {
		const input = baseInput();
		withCurrentScript(input);
		input.script.sourceDependencyCurrent = false;
		input.factLock.gateReason = "FACT_LOCK_STALE_FACTS";
		Object.assign(input.voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 2,
			usableSegments: 2,
		});
		expectCapability(input, "SCRIPT", {
			state: "READY",
			completion: "COMPLETE",
			reasonCode: "SCRIPT_READY",
		});
		expectCapability(input, "FACT_LOCK", {
			state: "STALE",
			completion: "IN_PROGRESS",
			reasonCode: "FACT_LOCK_STALE_FACTS",
		});
		expectCapability(input, "VOICE", {
			state: "BLOCKED",
			completion: "IN_PROGRESS",
			reasonCode: "VOICE_BLOCKED_BY_FACT_LOCK",
		});
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"FACT_LOCK",
		);
	});
});

describe("AFF-US-014 resolver safety and precedence", () => {
	it("supports deterministic legacy projection without changing persisted identity", () => {
		const input = baseInput();
		Object.assign(input.projectIdentity, {
			contentType: null,
			creationPath: null,
			contentFormatKey: null,
			contentFormatVersion: null,
		});
		expect(capability(input, "PRODUCT").reasonCode).toBe("PRODUCT_READY");
		expect(resolveProjectApplicability(input).nextApplicableStep).toBe(
			"SCRIPT",
		);
	});

	it("skips NOT_REQUIRED and OPTIONAL but not READY/IN_PROGRESS", () => {
		const dependencyFree = (
			capabilityName: ApplicabilityCapability,
			state: ApplicabilityCapabilityResult["state"],
			completion: ApplicabilityCapabilityResult["completion"],
		): ApplicabilityCapabilityResult => ({
			capability: capabilityName,
			state,
			completion,
			reasonCode: "PROJECT_IDENTITY_UNSUPPORTED",
			dependencies: [],
		});
		expect(
			deriveNextApplicableStep([
				dependencyFree("PRODUCT", "NOT_REQUIRED", "NOT_STARTED"),
				dependencyFree("SCRIPT", "OPTIONAL", "NOT_STARTED"),
				dependencyFree("FACT_LOCK", "READY", "COMPLETE"),
				dependencyFree("VOICE", "READY", "IN_PROGRESS"),
			]),
		).toBe("VOICE");
	});

	it.each([
		["missing Product", { hasProduct: false }, "AFFILIATE_PRODUCT_NOT_LINKED"],
		[
			"unsupported format",
			{ contentFormatKey: "UNKNOWN" },
			"PROJECT_IDENTITY_UNSUPPORTED",
		],
		[
			"partial identity",
			{ contentFormatVersion: null },
			"PROJECT_IDENTITY_UNSUPPORTED",
		],
		[
			"invalid ContentType",
			{ contentType: "HYBRID" },
			"PROJECT_IDENTITY_UNSUPPORTED",
		],
		[
			"invalid CreationPath",
			{ creationPath: "UNKNOWN" },
			"PROJECT_IDENTITY_UNSUPPORTED",
		],
		[
			"invalid version",
			{ contentFormatVersion: 99 },
			"PROJECT_IDENTITY_UNSUPPORTED",
		],
		[
			"known format/path mismatch",
			{ creationPath: "QUICK_IMAGE", contentFormatKey: "SCRIPTED_STANDARD" },
			"PROJECT_IDENTITY_UNSUPPORTED",
		],
	] as const)("fails closed for %s", (_label, identity, productReason) => {
		const input = baseInput();
		Object.assign(input.projectIdentity, identity);
		const resolved = resolveProjectApplicability(input);
		expect(
			resolved.capabilities.every((item) => item.state === "BLOCKED"),
		).toBe(true);
		expect(capability(input, "PRODUCT").reasonCode).toBe(productReason);
		expect(resolved.nextApplicableStep).toBe("PRODUCT");
	});

	it("preserves identity exception precedence over a missing Product", () => {
		const input = baseInput();
		Object.assign(input.projectIdentity, {
			contentType: "HYBRID",
			contentFormatVersion: null,
			hasProduct: false,
		});
		expectCapability(input, "PRODUCT", {
			state: "BLOCKED",
			completion: "NOT_STARTED",
			reasonCode: "PROJECT_IDENTITY_UNSUPPORTED",
		});
	});

	it("preserves Script, Voice, and Render reason precedence", () => {
		const input = baseInput();
		input.script.channelSettingsComplete = false;
		input.script.productFactsUsable = false;
		expect(capability(input, "SCRIPT").reasonCode).toBe(
			"SCRIPT_CHANNEL_SETTINGS_INCOMPLETE",
		);
		input.script.channelSettingsComplete = true;
		input.script.productFactsUsable = true;
		input.script.generationStatus = "PENDING";
		input.script.usableGenerationPresent = true;
		input.script.sourceDependencyCurrent = false;
		expect(capability(input, "SCRIPT").reasonCode).toBe(
			"SCRIPT_SOURCE_DEPENDENCY_STALE",
		);

		withCurrentScript(input);
		input.factLock.gateReason = "FACT_LOCK_FAILED";
		Object.assign(input.voice, {
			staleSegments: 1,
			failedSegments: 1,
			pendingSegments: 1,
			attemptedSegments: 1,
		});
		expect(capability(input, "VOICE").reasonCode).toBe("VOICE_ARTIFACTS_STALE");

		input.render.inputsStale = true;
		expect(capability(input, "RENDER").reasonCode).toBe(
			"RENDER_REQUIRES_UPSTREAM_CAPABILITIES",
		);
	});

	it("does not treat Voice preview as completion", () => {
		const input = baseInput();
		withPassedFactLock(input);
		input.voice.previewPresent = true;
		expect(capability(input, "VOICE").reasonCode).toBe("VOICE_CONFIG_REQUIRED");
	});

	it("allows Organic claimless/general-only Voice without Fact Lock", () => {
		const input = baseInput();
		Object.assign(input.projectIdentity, {
			contentType: "ORGANIC",
			hasProduct: false,
		});
		withCurrentScript(input);
		input.factLock.gateReason = "FACT_LOCK_NOT_RUN";
		input.claimSummary = {
			status: "CURRENT",
			subjectResolution: "CONFIRMED",
			productClaimState: "NONE",
			productClaimCount: 0,
			generalClaimCount: 1,
		};

		expectCapability(input, "FACT_LOCK", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
		});
		expectCapability(input, "VOICE", {
			state: "READY",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_CONFIG_REQUIRED",
		});
	});

	it("does not activate valid future Organic identity", () => {
		const input = baseInput();
		Object.assign(input.projectIdentity, {
			contentType: "ORGANIC",
			creationPath: "QUICK_IMAGE",
			contentFormatKey: "QUICK_IMAGE_STANDARD",
			contentFormatVersion: 1,
			hasProduct: false,
		});
		expect(resolveProjectApplicability(input).capabilities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "SCRIPT",
					state: "BLOCKED",
					reasonCode: "PROJECT_IDENTITY_UNSUPPORTED",
				}),
			]),
		);
	});

	it("is deterministic and does not mutate its input", () => {
		const input = deepFreeze(baseInput());
		const before = structuredClone(input);
		const first = resolveProjectApplicability(input);
		const second = resolveProjectApplicability(input);
		expect(first).toEqual(second);
		expect(input).toEqual(before);
	});
});

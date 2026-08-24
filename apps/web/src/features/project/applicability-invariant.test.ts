import {
	APPLICABILITY_CAPABILITIES,
	APPLICABILITY_REASON_CODES,
	type ApplicabilityCapabilityResult,
	type ApplicabilityReasonCode,
	isCanonicalApplicabilityCapabilityResult,
	type ProjectApplicabilityInput,
	resolveProjectApplicability,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

type ResultTuple = Pick<
	ApplicabilityCapabilityResult,
	"capability" | "state" | "completion" | "reasonCode"
>;

function tuple(patch: Partial<ResultTuple> = {}): ResultTuple {
	return {
		capability: "SCRIPT",
		state: "READY",
		completion: "NOT_STARTED",
		reasonCode: "SCRIPT_GENERATION_REQUIRED",
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

function input(
	configure: (value: ProjectApplicabilityInput) => void,
): ProjectApplicabilityInput {
	const value = baseInput();
	configure(value);
	return value;
}

function currentScript(value: ProjectApplicabilityInput) {
	Object.assign(value.script, {
		generationStatus: "USABLE",
		usableGenerationPresent: true,
		currentVersionPresent: true,
		currentVersionFactLockReady: true,
	});
}

function passedFactLock(value: ProjectApplicabilityInput) {
	currentScript(value);
	value.factLock.gateReason = "FACT_LOCK_PASSED";
}

function currentVoice(value: ProjectApplicabilityInput) {
	passedFactLock(value);
	Object.assign(value.voice, {
		configPresent: true,
		totalSegments: 2,
		attemptedSegments: 2,
		usableSegments: 2,
	});
}

const resolverInputs: readonly ProjectApplicabilityInput[] = [
	baseInput(),
	input((value) => {
		value.projectIdentity.contentFormatKey = "UNKNOWN";
	}),
	input((value) => {
		value.projectIdentity.hasProduct = false;
	}),
	input((value) => {
		value.product.accessible = false;
	}),
	input((value) => {
		value.script.channelSettingsComplete = false;
	}),
	input((value) => {
		value.script.productFactsUsable = false;
	}),
	input((value) => {
		value.script.generationStatus = "USABLE";
		value.script.usableGenerationPresent = true;
		value.script.sourceDependencyCurrent = false;
	}),
	...(["PENDING", "FAILED", "INDETERMINATE"] as const).map((status) =>
		input((value) => {
			value.script.generationStatus = status;
		}),
	),
	input((value) => {
		value.script.generationStatus = "USABLE";
		value.script.usableGenerationPresent = true;
	}),
	input((value) => {
		currentScript(value);
		value.script.currentVersionFactLockReady = false;
	}),
	...(
		[
			"NO_SCRIPT_VERSION",
			"SCRIPT_NOT_READY",
			"FACT_LOCK_NOT_RUN",
			"FACT_LOCK_PENDING",
			"FACT_LOCK_REVIEW_REQUIRED",
			"FACT_LOCK_STALE_SCRIPT",
			"FACT_LOCK_STALE_FACTS",
			"FACT_LOCK_FAILED",
			"FACT_LOCK_INDETERMINATE",
			"FACT_LOCK_PASSED",
		] as const
	).map((gateReason) =>
		input((value) => {
			currentScript(value);
			value.factLock.gateReason = gateReason;
		}),
	),
	input((value) => {
		value.voice.attemptedSegments = 1;
	}),
	input((value) => {
		currentScript(value);
		value.factLock.gateReason = "FACT_LOCK_REVIEW_REQUIRED";
		value.voice.attemptedSegments = 1;
	}),
	input((value) => {
		passedFactLock(value);
		value.voice.staleSegments = 1;
	}),
	input((value) => {
		passedFactLock(value);
		Object.assign(value.voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 1,
			failedSegments: 1,
		});
	}),
	input((value) => {
		passedFactLock(value);
		Object.assign(value.voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 1,
			indeterminateSegments: 1,
		});
	}),
	input((value) => {
		passedFactLock(value);
		Object.assign(value.voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 1,
			pendingSegments: 1,
		});
	}),
	input((value) => {
		passedFactLock(value);
		Object.assign(value.voice, { configPresent: true, totalSegments: 2 });
	}),
	input((value) => {
		passedFactLock(value);
		Object.assign(value.voice, {
			configPresent: true,
			totalSegments: 2,
			attemptedSegments: 1,
			usableSegments: 1,
		});
	}),
	input(currentVoice),
	input((value) => {
		currentVoice(value);
		value.render.inputsStale = true;
	}),
];

describe("AFF-US-015 canonical Applicability tuple invariant", () => {
	it("accepts every tuple emitted by current Resolver paths", () => {
		const seenReasons = new Set<string>();
		for (const value of resolverInputs) {
			for (const result of resolveProjectApplicability(value).capabilities) {
				seenReasons.add(result.reasonCode);
				expect(isCanonicalApplicabilityCapabilityResult(result)).toBe(true);
			}
		}

		const futureNotRequiredReasons = new Set([
			"PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
			"SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH",
			"VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
			"RENDER_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		]);
		expect([...seenReasons].sort()).toEqual(
			APPLICABILITY_REASON_CODES.filter(
				(reason) => !futureNotRequiredReasons.has(reason),
			).sort(),
		);
	});

	it.each([
		["PRODUCT", "PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY"],
		["SCRIPT", "SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH"],
		["VOICE", "VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY"],
		["RENDER", "RENDER_NOT_REQUIRED_FOR_PROJECT_IDENTITY"],
	] as const)(
		"accepts canonical future %s NOT_REQUIRED shape",
		(capability, reasonCode) => {
			expect(
				isCanonicalApplicabilityCapabilityResult(
					tuple({
						capability,
						state: "NOT_REQUIRED",
						completion: "NOT_STARTED",
						reasonCode,
					}),
				),
			).toBe(true);
		},
	);

	it("accepts the exact invalid-identity tuple for every downstream capability", () => {
		for (const capability of APPLICABILITY_CAPABILITIES) {
			expect(
				isCanonicalApplicabilityCapabilityResult(
					tuple({
						capability,
						state: "BLOCKED",
						completion: "NOT_STARTED",
						reasonCode: "PROJECT_IDENTITY_UNSUPPORTED",
					}),
				),
			).toBe(true);
		}
	});

	it.each([
		["SCRIPT_GENERATION_PENDING", "SCRIPT", "READY", "COMPLETE"],
		["SCRIPT_READY", "SCRIPT", "BLOCKED", "IN_PROGRESS"],
		["FACT_LOCK_PASSED", "FACT_LOCK", "REQUIRED", "NOT_STARTED"],
		["FACT_LOCK_REVIEW_REQUIRED", "FACT_LOCK", "READY", "COMPLETE"],
		["VOICE_READY", "VOICE", "REQUIRED", "IN_PROGRESS"],
		["VOICE_SEGMENTS_FAILED", "VOICE", "READY", "COMPLETE"],
		["RENDER_FEATURE_NOT_IMPLEMENTED", "RENDER", "READY", "COMPLETE"],
	] as const)(
		"rejects invalid tuple %s / %s / %s / %s",
		(reasonCode, capability, state, completion) => {
			expect(
				isCanonicalApplicabilityCapabilityResult(
					tuple({ reasonCode, capability, state, completion }),
				),
			).toBe(false);
		},
	);

	it("rejects deterministic mutations of a known valid tuple", () => {
		const valid = tuple();
		expect(isCanonicalApplicabilityCapabilityResult(valid)).toBe(true);
		expect(
			isCanonicalApplicabilityCapabilityResult({ ...valid, state: "BLOCKED" }),
		).toBe(false);
		expect(
			isCanonicalApplicabilityCapabilityResult({
				...valid,
				completion: "COMPLETE",
			}),
		).toBe(false);
		expect(
			isCanonicalApplicabilityCapabilityResult({
				...valid,
				capability: "VOICE",
			}),
		).toBe(false);
	});

	it("fails closed instead of throwing for an unknown runtime reason", () => {
		expect(
			isCanonicalApplicabilityCapabilityResult(
				tuple({
					reasonCode: "FUTURE_UNKNOWN_REASON" as ApplicabilityReasonCode,
				}),
			),
		).toBe(false);
	});
});

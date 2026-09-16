import {
	type ApplicabilityCapability,
	type ApplicabilityCapabilityResult,
	type ProjectApplicabilityInput,
	resolveProjectApplicability,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

function input(): ProjectApplicabilityInput {
	return {
		projectIdentity: {
			contentType: "ORGANIC",
			creationPath: "QUICK_IMAGE",
			contentFormatKey: "QUICK_IMAGE_STANDARD",
			contentFormatVersion: 1,
			hasProduct: false,
		},
		product: { accessible: false },
		script: {
			generationStatus: "NONE",
			usableGenerationPresent: false,
			sourceDependencyCurrent: false,
			currentVersionPresent: false,
			currentVersionFactLockReady: false,
			channelSettingsComplete: false,
			productFactsUsable: false,
		},
		claimSummary: {
			status: "UNKNOWN",
			subjectResolution: "UNKNOWN",
			productClaimState: "UNKNOWN",
			productClaimCount: null,
			generalClaimCount: null,
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
	value: ProjectApplicabilityInput,
	name: ApplicabilityCapability,
): ApplicabilityCapabilityResult {
	const result = resolveProjectApplicability(value).capabilities.find(
		(item) => item.capability === name,
	);
	if (!result) throw new Error(`Missing ${name}`);
	return result;
}

function expectCapability(
	value: ProjectApplicabilityInput,
	name: ApplicabilityCapability,
	expected: Pick<
		ApplicabilityCapabilityResult,
		"state" | "completion" | "reasonCode"
	>,
) {
	expect(capability(value, name)).toMatchObject(expected);
}

describe("AFF-US-022 US22-A Slice 4 Quick Image applicability", () => {
	it("supports Organic without Product and keeps Render applicable", () => {
		const value = input();

		expectCapability(value, "PRODUCT", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		});
		expectCapability(value, "SCRIPT", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH",
		});
		expectCapability(value, "FACT_LOCK", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
		});
		expectCapability(value, "VOICE", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		});
		expectCapability(value, "RENDER", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "RENDER_REQUIRES_UPSTREAM_CAPABILITIES",
		});
		expect(resolveProjectApplicability(value).nextApplicableStep).toBe(
			"RENDER",
		);
	});

	it("preserves Affiliate Product and Fact Lock policy", () => {
		const value = input();
		value.projectIdentity.contentType = "AFFILIATE";
		value.projectIdentity.hasProduct = true;
		value.product.accessible = true;
		value.factLock.gateReason = "FACT_LOCK_NOT_RUN";

		expectCapability(value, "PRODUCT", {
			state: "READY",
			completion: "COMPLETE",
			reasonCode: "PRODUCT_READY",
		});
		expectCapability(value, "SCRIPT", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH",
		});
		expectCapability(value, "FACT_LOCK", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_RUN_REQUIRED",
		});
		expectCapability(value, "VOICE", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		});
		expectCapability(value, "RENDER", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "RENDER_REQUIRES_UPSTREAM_CAPABILITIES",
		});
	});

	it("keeps Organic Product claim-free Quick Image Fact Lock not required", () => {
		const value = input();
		value.projectIdentity.hasProduct = true;
		value.product.accessible = true;
		value.claimSummary = {
			status: "CURRENT",
			subjectResolution: "CONFIRMED",
			productClaimState: "NONE",
			productClaimCount: 0,
			generalClaimCount: 0,
		};

		expectCapability(value, "PRODUCT", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		});
		expectCapability(value, "FACT_LOCK", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
		});
	});

	it("requires Organic Product Quick Image Fact Lock for claim-bearing content without Script", () => {
		const value = input();
		value.projectIdentity.hasProduct = true;
		value.product.accessible = true;
		value.claimSummary = {
			status: "CURRENT",
			subjectResolution: "CONFIRMED",
			productClaimState: "PRESENT",
			productClaimCount: 1,
			generalClaimCount: 0,
		};
		value.factLock.gateReason = "FACT_LOCK_NOT_RUN";

		expectCapability(value, "PRODUCT", {
			state: "READY",
			completion: "COMPLETE",
			reasonCode: "PRODUCT_READY",
		});
		expectCapability(value, "FACT_LOCK", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_RUN_REQUIRED",
		});
		expectCapability(value, "SCRIPT", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH",
		});
		expectCapability(value, "VOICE", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		});
	});

	it("maps Quick Image Fact Lock lifecycle states without ScriptVersion", () => {
		const value = input();
		value.projectIdentity.hasProduct = true;
		value.product.accessible = true;
		value.claimSummary = {
			status: "CURRENT",
			subjectResolution: "CONFIRMED",
			productClaimState: "PRESENT",
			productClaimCount: 1,
			generalClaimCount: 0,
		};

		for (const [gateReason, expected] of [
			["FACT_LOCK_PASSED", ["READY", "COMPLETE", "FACT_LOCK_PASSED"]],
			[
				"FACT_LOCK_STALE_SCRIPT",
				["STALE", "IN_PROGRESS", "FACT_LOCK_STALE_SCRIPT"],
			],
			[
				"FACT_LOCK_STALE_FACTS",
				["STALE", "IN_PROGRESS", "FACT_LOCK_STALE_FACTS"],
			],
			[
				"FACT_LOCK_REVIEW_REQUIRED",
				["BLOCKED", "IN_PROGRESS", "FACT_LOCK_REVIEW_REQUIRED"],
			],
			["FACT_LOCK_FAILED", ["BLOCKED", "IN_PROGRESS", "FACT_LOCK_FAILED"]],
		] as const) {
			value.factLock.gateReason = gateReason;
			expectCapability(value, "FACT_LOCK", {
				state: expected[0],
				completion: expected[1],
				reasonCode: expected[2],
			});
		}
	});

	it("blocks Product and Fact Lock when required Quick Image claims are unavailable", () => {
		const value = input();
		value.projectIdentity.hasProduct = true;
		value.product.accessible = true;
		value.factLock.gateReason = "FACT_LOCK_INDETERMINATE";

		expectCapability(value, "PRODUCT", {
			state: "BLOCKED",
			completion: "IN_PROGRESS",
			reasonCode: "CLAIM_SUBJECT_INVALID",
		});
		expectCapability(value, "FACT_LOCK", {
			state: "BLOCKED",
			completion: "IN_PROGRESS",
			reasonCode: "CLAIM_SUBJECT_INVALID",
		});
	});

	it("delegates Organic Product and Fact Lock claim policy", () => {
		const value = input();
		value.projectIdentity.hasProduct = true;
		value.product.accessible = true;
		value.factLock.gateReason = "FACT_LOCK_NOT_RUN";
		value.claimSummary = {
			status: "CURRENT",
			subjectResolution: "CONFIRMED",
			productClaimState: "PRESENT",
			productClaimCount: 1,
			generalClaimCount: 0,
		};

		expectCapability(value, "PRODUCT", {
			state: "READY",
			completion: "COMPLETE",
			reasonCode: "PRODUCT_READY",
		});
		expectCapability(value, "FACT_LOCK", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_RUN_REQUIRED",
		});
		expectCapability(value, "SCRIPT", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH",
		});
		expectCapability(value, "VOICE", {
			state: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		});
	});

	it.each([
		{
			label: "wrong format",
			identity: { contentFormatKey: "SCRIPTED_STANDARD" },
		},
		{
			label: "unsupported version",
			identity: { contentFormatVersion: 2 },
		},
		{
			label: "wrong creation path",
			identity: { creationPath: "SCRIPTED" },
		},
	] as const)("fails closed for Quick Image %s", ({ identity }) => {
		const value = input();
		Object.assign(value.projectIdentity, identity);
		const result = resolveProjectApplicability(value);
		expect(result.capabilities.every((item) => item.state === "BLOCKED")).toBe(
			true,
		);
		expect(result.nextApplicableStep).toBe("PRODUCT");
	});

	it("does not change existing Affiliate Scripted policy", () => {
		const value = input();
		Object.assign(value.projectIdentity, {
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			hasProduct: true,
		});
		value.product.accessible = true;
		value.script.channelSettingsComplete = true;
		value.script.productFactsUsable = true;

		expectCapability(value, "SCRIPT", {
			state: "READY",
			completion: "NOT_STARTED",
			reasonCode: "SCRIPT_GENERATION_REQUIRED",
		});
		expectCapability(value, "FACT_LOCK", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_REQUIRES_CURRENT_SCRIPT",
		});
		expectCapability(value, "VOICE", {
			state: "REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_REQUIRES_FACT_LOCK_PASS",
		});
	});
});

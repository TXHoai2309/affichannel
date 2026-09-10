import {
	classifyRenderExecutionOutcome,
	fingerprintOutputEncodingProfile,
	isOutputEncodingProfileComplete,
	MP4_H264_AAC_V1,
	validateRenderLeaseConfiguration,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

describe("AFF-US-021 EN001 21C render job Owner Locks", () => {
	it("never maps adapter success to COMPLETED without 21D proof", () => {
		expect(classifyRenderExecutionOutcome({ outcome: "SUCCESS" })).toBe(
			"INDETERMINATE",
		);
	});

	it("maps deterministic side-effect-free failure to terminal FAILED", () => {
		expect(
			classifyRenderExecutionOutcome({
				outcome: "FAILURE",
				classification: "DETERMINISTIC",
				sideEffectFree: true,
				errorCode: "ENCODER_INVALID_INPUT",
			}),
		).toBe("FAILED");
	});

	it("only retries a retryable failure when side-effect-free is proven", () => {
		expect(
			classifyRenderExecutionOutcome({
				outcome: "FAILURE",
				classification: "RETRYABLE",
				sideEffectFree: true,
				errorCode: "DEPENDENCY_READ_UNAVAILABLE",
			}),
		).toBe("QUEUED");
		expect(
			classifyRenderExecutionOutcome({
				outcome: "FAILURE",
				classification: "RETRYABLE",
				sideEffectFree: false,
				errorCode: "ADAPTER_TIMEOUT",
			}),
		).toBe("INDETERMINATE");
	});

	it("keeps the owner-frozen MP4 profile incomplete", async () => {
		expect(isOutputEncodingProfileComplete(MP4_H264_AAC_V1)).toBe(false);
		await expect(
			fingerprintOutputEncodingProfile(MP4_H264_AAC_V1),
		).rejects.toThrow("OUTPUT_ENCODING_PROFILE_INCOMPLETE");
	});

	it("requires the heartbeat interval to be shorter than the lease TTL", () => {
		expect(
			validateRenderLeaseConfiguration({
				leaseTtlSeconds: 300,
				heartbeatIntervalSeconds: 60,
			}),
		).toEqual({ leaseTtlSeconds: 300, heartbeatIntervalSeconds: 60 });
		expect(() =>
			validateRenderLeaseConfiguration({
				leaseTtlSeconds: 60,
				heartbeatIntervalSeconds: 60,
			}),
		).toThrow("RENDER_HEARTBEAT_INTERVAL_MUST_BE_LESS_THAN_LEASE_TTL");
	});
});

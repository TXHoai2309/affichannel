import {
	deriveQuickImageFactLockEffectiveStatus,
	isCurrentQuickImageFactLockSource,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const source = {
	sourceType: "NO_SCRIPT" as const,
	sourceSchemaVersion: "quick-image-claim-source.v1" as const,
	sourceRevision: "4",
	sourceContentHash: "a".repeat(64),
};

describe("Quick Image Fact Lock currentness", () => {
	it("requires matching source type, schema, revision and hash", () => {
		expect(
			isCurrentQuickImageFactLockSource({
				runSource: source,
				currentSource: source,
			}),
		).toBe(true);
		expect(
			isCurrentQuickImageFactLockSource({
				runSource: source,
				currentSource: { ...source, sourceRevision: "5" },
			}),
		).toBe(false);
		expect(
			isCurrentQuickImageFactLockSource({
				runSource: source,
				currentSource: { ...source, sourceContentHash: "b".repeat(64) },
			}),
		).toBe(false);
	});

	it("marks only terminal successful states stale for source/fact changes", () => {
		expect(
			deriveQuickImageFactLockEffectiveStatus({
				status: "passed",
				sourceCurrent: false,
				dependenciesCurrent: true,
			}),
		).toBe("stale");
		expect(
			deriveQuickImageFactLockEffectiveStatus({
				status: "review_required",
				sourceCurrent: true,
				dependenciesCurrent: false,
			}),
		).toBe("stale");
		expect(
			deriveQuickImageFactLockEffectiveStatus({
				status: "pending",
				sourceCurrent: false,
				dependenciesCurrent: false,
			}),
		).toBe("pending");
	});
});

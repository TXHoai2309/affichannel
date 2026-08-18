import type { FactLockInputSnapshot } from "@affichannel/core/fact-lock/types";
import {
	deriveFactLockEffectiveStatus,
	deriveFactLockRunStatus,
	validateFactLockProviderOutput,
} from "@affichannel/core/fact-lock/validation";
import { describe, expect, it } from "vitest";

const snapshot: FactLockInputSnapshot = {
	snapshotVersion: "fact-lock-input.v1",
	scriptVersion: {
		id: "script-1",
		revision: 4,
		snapshot: {
			schemaVersion: "script-draft.v2",
			language: "vi-VN",
			hookVariants: [
				{ key: "selected", text: "Bạn có biết tai nghe này có pin 20 giờ?" },
				{ key: "other", text: "Một hook khác." },
				{ key: "third", text: "Hook thứ ba." },
			],
			selectedHookKey: "selected",
			voiceoverSegments: [
				{ key: "intro", text: "Pin dùng 20 giờ trong một lần sạc." },
			],
			scenes: [
				{
					order: 1,
					durationSeconds: 10,
					visualDirection: "Cận cảnh",
					onScreenText: "Pin 20 giờ",
					voiceoverSegmentKeys: ["intro"],
				},
			],
			cta: { text: "Xem thêm thông tin" },
			caption: "Tai nghe cho ngày dài.",
			hashtags: ["#review"],
			disclosure: "Nội dung có liên kết affiliate.",
			claims: [],
			claimsSourceRevision: 3,
			claimsStatus: "stale",
		},
	},
	productFacts: [
		{
			id: "fact-1",
			revision: 2,
			content: "Pin dùng 20 giờ trong một lần sạc.",
			type: "specification",
			status: "verified",
			assessment: {
				verification: "verified",
				evidence: "complete",
				freshness: "not_applicable",
				freshnessReason: "not_applicable",
			},
			generationUsability: "allowed",
			source: {
				type: "official",
				label: "Website hãng",
				url: "https://example.com",
				confirmedAt: "2026-08-15",
				expiresAt: null,
			},
		},
	],
	policy: {
		avoidWords: ["cam kết tuyệt đối"],
		affiliateDisclosure: "Nội dung có liên kết affiliate.",
		language: "vi-VN",
	},
	outputRules: {
		language: "vi-VN",
		aspectRatio: "9:16",
		subtitleSafeArea: "standard",
		claimLimit: null,
		requireFinalCta: true,
	},
};

function output(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: "fact-lock-output.v1",
		claims: [
			{
				claimKey: "claim-1",
				claimText: "Pin dùng 20 giờ trong một lần sạc.",
				occurrence: { section: "voiceover", segmentKey: "intro" },
				classificationStatus: "SUPPORTED",
				reason: "Khớp Product Fact.",
				confidence: 0.98,
				suggestionText: null,
				factMappings: [{ factId: "fact-1", relation: "supports" }],
				...overrides,
			},
		],
	};
}

describe("AFF-US-010 Fact Lock foundation", () => {
	it("derives AUTO_PASSED for a supported claim and pins the fact revision", () => {
		const result = validateFactLockProviderOutput(output(), snapshot);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.claims[0]).toMatchObject({
				classificationStatus: "SUPPORTED",
				reviewStatus: "AUTO_PASSED",
				reviewedByUserId: null,
				reviewedAt: null,
				reviewNote: null,
			});
			expect(result.claims[0].factMappings[0]).toMatchObject({
				factId: "fact-1",
				factRevision: 2,
			});
		}
	});

	it("keeps NEEDS_REVIEW, UNSUPPORTED and confirmed PROHIBITED unresolved", () => {
		for (const classificationStatus of [
			"NEEDS_REVIEW",
			"UNSUPPORTED",
		] as const) {
			const result = validateFactLockProviderOutput(
				output({ classificationStatus, factMappings: [] }),
				snapshot,
			);
			expect(result.success).toBe(true);
			if (result.success)
				expect(result.claims[0].reviewStatus).toBe("UNRESOLVED");
		}
		const prohibited = validateFactLockProviderOutput(
			output({
				claimText: "Cam kết tuyệt đối cho mọi người.",
				classificationStatus: "PROHIBITED",
				factMappings: [],
			}),
			{
				...snapshot,
				scriptVersion: {
					...snapshot.scriptVersion,
					snapshot: {
						...snapshot.scriptVersion.snapshot,
						voiceoverSegments: [
							{ key: "intro", text: "Cam kết tuyệt đối cho mọi người." },
						],
					},
				},
			},
		);
		expect(prohibited.success).toBe(true);
		if (prohibited.success)
			expect(prohibited.claims[0].classificationStatus).toBe("PROHIBITED");
	});

	it("downgrades an AI-only prohibited classification when server policy does not confirm it", () => {
		const result = validateFactLockProviderOutput(
			output({ classificationStatus: "PROHIBITED", factMappings: [] }),
			snapshot,
		);
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.claims[0].classificationStatus).toBe("NEEDS_REVIEW");
	});

	it("treats a manually approved review claim as resolved", () => {
		expect(
			deriveFactLockRunStatus([
				{ classificationStatus: "SUPPORTED", reviewStatus: "AUTO_PASSED" },
				{
					classificationStatus: "NEEDS_REVIEW",
					reviewStatus: "MANUAL_APPROVED",
				},
			]),
		).toBe("passed");
		expect(
			deriveFactLockRunStatus([
				{ classificationStatus: "NEEDS_REVIEW", reviewStatus: "UNRESOLVED" },
			]),
		).toBe("review_required");
		expect(
			deriveFactLockRunStatus([
				{ classificationStatus: "UNSUPPORTED", reviewStatus: "UNRESOLVED" },
			]),
		).toBe("review_required");
		expect(
			deriveFactLockRunStatus([
				{ classificationStatus: "PROHIBITED", reviewStatus: "UNRESOLVED" },
			]),
		).toBe("review_required");
	});

	it("rejects invented Facts and claims that are not exact occurrence text", () => {
		expect(
			validateFactLockProviderOutput(
				output({
					factMappings: [{ factId: "invented", relation: "supports" }],
				}),
				snapshot,
			).success,
		).toBe(false);
		expect(
			validateFactLockProviderOutput(
				output({ claimText: "Nội dung không có trong script." }),
				snapshot,
			).success,
		).toBe(false);
		expect(
			validateFactLockProviderOutput(
				output({
					classificationStatus: "NEEDS_REVIEW",
					factMappings: [{ factId: "fact-1", relation: "context" }],
				}),
				snapshot,
			).success,
		).toBe(false);
	});

	it("derives stale only for result-bearing runs whose source or dependencies changed", () => {
		expect(deriveFactLockEffectiveStatus("passed", 4, 4, true)).toBe("passed");
		expect(deriveFactLockEffectiveStatus("review_required", 4, 5, true)).toBe(
			"stale",
		);
		expect(deriveFactLockEffectiveStatus("passed", 4, 4, false)).toBe("stale");
		expect(deriveFactLockEffectiveStatus("failed", 4, 5, false)).toBe("failed");
		expect(deriveFactLockEffectiveStatus("indeterminate", 4, 5, false)).toBe(
			"indeterminate",
		);
	});
});

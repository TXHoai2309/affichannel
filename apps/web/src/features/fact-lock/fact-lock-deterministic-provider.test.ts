import type { FactLockInputSnapshot } from "@affichannel/core/fact-lock/types";
import { validateFactLockProviderOutput } from "@affichannel/core/fact-lock/validation";
import { describe, expect, it } from "vitest";
import { DeterministicTextProvider } from "../../../../../packages/api/src/providers/text/deterministic-text-provider";

const snapshot = {
	snapshotVersion: "fact-lock-input.v1",
	scriptVersion: {
		id: "script-1",
		revision: 5,
		snapshot: {
			schemaVersion: "script-draft.v2",
			language: "vi-VN",
			hookVariants: [
				{
					key: "selected",
					text: "Hôm nay mình review nhanh mẫu chuột không dây này nhé!",
				},
				{ key: "other", text: "Chuột này có pin 20 giờ." },
			],
			selectedHookKey: "selected",
			voiceoverSegments: [
				{
					key: "mixed",
					text: "Hôm nay mình review nhanh. Pin có thời lượng 20 giờ.",
				},
			],
			scenes: [
				{
					order: 1,
					durationSeconds: 10,
					visualDirection: "Cận cảnh",
					onScreenText: "20 giờ sử dụng",
					voiceoverSegmentKeys: ["mixed"],
				},
			],
			cta: { text: "Xem thêm thông tin" },
			caption: "Chuột pin 20 giờ.",
			hashtags: ["#review"],
			disclosure: "Nội dung có liên kết affiliate.",
			claims: [
				{
					text: "Cũ",
					occurrence: { section: "hook", hookKey: "selected" },
				},
			],
			claimsSourceRevision: 4,
			claimsStatus: "stale",
		},
	},
	productFacts: [
		{
			id: "fact-1",
			revision: 2,
			content: "Pin có thời lượng 20 giờ",
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
		avoidWords: [],
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
} satisfies FactLockInputSnapshot;

describe("Deterministic Fact Lock extraction", () => {
	it("omits editorial hooks and keeps factual spans from mixed content", async () => {
		const provider = new DeterministicTextProvider({
			factLockSnapshot: snapshot,
		});
		const result = await provider.generate({
			messages: [],
			model: "deterministic",
			mode: "full",
			sections: ["claims"],
			idempotencyKey: "fact-lock-extraction-test",
			operation: "fact-lock",
			factLockSnapshot: snapshot,
		});
		const validation = validateFactLockProviderOutput(result.content, snapshot);

		expect(validation.success).toBe(true);
		if (validation.success) {
			expect(validation.claims).toHaveLength(3);
			expect(
				validation.claims.some((claim) => claim.occurrence.section === "hook"),
			).toBe(false);
			expect(validation.claims.map((claim) => claim.claimText)).toEqual(
				expect.arrayContaining(["Pin có thời lượng 20 giờ", "20 giờ"]),
			);
			expect(
				validation.claims.every(
					(claim) => claim.classificationStatus === "SUPPORTED",
				),
			).toBe(true);
		}
	});
});

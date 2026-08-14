import {
	SCRIPT_OUTPUT_SCHEMA_VERSION,
	canonicalizeJson,
	validateRepairScriptOutput,
	validateScriptDraftOutput,
} from "@affichannel/core";
import { DeterministicTextProvider } from "@affichannel/api/providers/text/deterministic-text-provider";
import { describe, expect, it } from "vitest";

const snapshot = {
	snapshotVersion: "script-input.v1",
	request: { mode: "full" as const, repair: null },
	project: {
		id: "project-1",
		name: "Test project",
		platform: "tiktok" as const,
		goal: "Tạo chuyển đổi",
		durationSeconds: 30,
		angle: "Trải nghiệm trước và sau khi dùng",
		description: null,
	},
	product: { id: "product-1", name: "Tai nghe", category: "Audio" },
	facts: [
		{
			id: "fact-1",
			revision: 1,
			content: "Pin dùng 20 giờ",
			type: "specification" as const,
			assessment: {
				verification: "verified" as const,
				evidence: "complete" as const,
				freshness: "not_applicable" as const,
				freshnessReason: "not_applicable" as const,
			},
			generationUsability: "allowed" as const,
			source: { type: null, label: null, url: null, confirmedAt: null, expiresAt: null },
		},
	],
};

describe("AFF-US-008 script-generation foundation", () => {
	it("canonicalizes object keys without reordering semantic arrays", () => {
		expect(canonicalizeJson({ b: 2, a: 1, items: ["b", "a"] })).toBe('{"a":1,"b":2,"items":["b","a"]}');
		expect(() => canonicalizeJson({ value: Number.NaN })).toThrow();
	});

	it("accepts a deterministic full draft and enforces duration tolerance", async () => {
		const provider = new DeterministicTextProvider({ snapshot });
		const result = await provider.generate({ messages: [{ role: "user", content: "test" }], model: "test", mode: "full", sections: [], idempotencyKey: "unit-test-1" });
		const validation = validateScriptDraftOutput(result.content, 30);
		expect(validation.status).toBe("completed");
		expect(validation.validSections).toHaveLength(8);
		expect(validation.output?.schemaVersion).toBe(SCRIPT_OUTPUT_SCHEMA_VERSION);
	});

	it("classifies missing scenes and claims as a usable partial draft", async () => {
		const provider = new DeterministicTextProvider({ snapshot, scenario: "partial" });
		const result = await provider.generate({ messages: [{ role: "user", content: "test" }], model: "test", mode: "full", sections: [], idempotencyKey: "unit-test-2" });
		const validation = validateScriptDraftOutput(result.content, 30);
		expect(validation.status).toBe("partial");
		expect(validation.validSections).toEqual(["hook", "cta", "caption", "hashtags", "disclosure"]);
		expect(validation.invalidSections).toEqual(["voiceover", "scenes", "claims"]);
	});

	it("rejects malformed, unknown-reference and out-of-budget output", () => {
		expect(validateScriptDraftOutput("not-json", 30).status).toBe("failed");
		expect(validateScriptDraftOutput({ schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION, language: "vi-VN", hook: { text: "x" }, voiceoverSegments: [{ key: "a", text: "x" }], scenes: [{ order: 1, durationSeconds: 30, visualDirection: "x", onScreenText: null, voiceoverSegmentKeys: ["missing"] }], cta: { text: "x" }, caption: "x", hashtags: [], disclosure: null, claims: [] }, 30).status).toBe("partial");
	});

	it("models timeout and provider failure without a live SDK", async () => {
		const request = { messages: [{ role: "user" as const, content: "test" }], model: "test", mode: "full" as const, sections: [], idempotencyKey: "unit-test-3" };
		await expect(new DeterministicTextProvider({ snapshot, scenario: "timeout" }).generate(request)).rejects.toMatchObject({ code: "AI_TIMEOUT" });
		await expect(new DeterministicTextProvider({ snapshot, scenario: "timeout_uncertain" }).generate(request)).rejects.toMatchObject({ code: "AI_TIMEOUT_UNCERTAIN" });
		await expect(new DeterministicTextProvider({ snapshot, scenario: "provider_error" }).generate(request)).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
	});

	it("does not validate cross-references against missing or invalid partial sections", () => {
		const output = validateScriptDraftOutput({
			schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
			language: "vi-VN",
			scenes: [{ order: 1, durationSeconds: 30, visualDirection: "x", onScreenText: null, voiceoverSegmentKeys: ["missing"] }],
			claims: [{ text: "claim", occurrence: { section: "hook" } }],
		}, 30);
		expect(output.validSections).not.toContain("scenes");
		expect(output.validSections).not.toContain("claims");
	});

	it("normalizes hashtag uniqueness case-insensitively and audits duplicate scene refs", () => {
		const output = validateScriptDraftOutput({
			schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
			language: "vi-VN",
			voiceoverSegments: [{ key: "a", text: "x" }],
			scenes: [{ order: 1, durationSeconds: 30, visualDirection: "x", onScreenText: null, voiceoverSegmentKeys: ["a", "a"] }],
			hashtags: [" #Review ", "#review"],
		}, 30);
		expect(output.validSections).not.toContain("scenes");
		expect(output.validSections).not.toContain("hashtags");
	});

	it("accepts only the requested sections in a repair payload", () => {
		const valid = validateRepairScriptOutput({ schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION, language: "vi-VN", claims: [] }, ["claims"]);
		const extra = validateRepairScriptOutput({ schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION, language: "vi-VN", claims: [], hook: { text: "not allowed" } }, ["claims"]);
		expect(valid.success).toBe(true);
		expect(extra.success).toBe(false);
	});
});

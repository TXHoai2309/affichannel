import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import {
	hasClaimRelevantScriptVersionChanges,
	hasStableScriptVersionStructure,
	mergeScriptVersionAutosave,
	validateScriptVersionDraft,
	validateScriptVersionForFactLock,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const snapshot: ScriptVersionEditableSnapshot = {
	schemaVersion: "script-draft.v2",
	language: "vi-VN",
	hookVariants: [
		{ key: "hook-1", text: "Bạn có đang dùng tai nghe sai cách?" },
		{ key: "hook-2", text: "Một thay đổi nhỏ cho trải nghiệm nghe tốt hơn." },
		{ key: "hook-3", text: "Đây là điều mình kiểm tra đầu tiên." },
	],
	selectedHookKey: null,
	voiceoverSegments: [
		{ key: "intro", text: "Mình thử sản phẩm trong một ngày." },
	],
	scenes: [
		{
			order: 1,
			durationSeconds: 5,
			visualDirection: "Cầm sản phẩm trước máy quay.",
			onScreenText: "Trải nghiệm thực tế",
			voiceoverSegmentKeys: ["intro"],
		},
	],
	cta: { text: "Xem thêm thông tin ở phần mô tả." },
	caption: "Một trải nghiệm ngắn gọn và dễ kiểm chứng.",
	hashtags: ["#review"],
	disclosure: "Nội dung có liên kết affiliate.",
	claims: [],
	claimsSourceRevision: 1,
	claimsStatus: "current",
};

describe("AFF-US-009 ScriptVersion foundation", () => {
	it("accepts an intermediate draft but blocks Fact Lock until a hook is selected", () => {
		const draft = validateScriptVersionDraft(snapshot);
		expect(draft.success).toBe(true);

		const ready = validateScriptVersionForFactLock(snapshot);
		expect(ready.success).toBe(false);
		if (!ready.success) {
			expect(ready.error.issues).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ path: ["selectedHookKey"] }),
				]),
			);
		}
	});

	it("requires current claims before Fact Lock", () => {
		const selected = { ...snapshot, selectedHookKey: "hook-1" as const };
		const stale = { ...selected, claimsStatus: "stale" as const };
		expect(validateScriptVersionForFactLock(stale).success).toBe(false);
		expect(validateScriptVersionForFactLock(selected).success).toBe(true);
	});

	it("marks claim-dependent content stale while preserving server metadata", () => {
		const edited = {
			...snapshot,
			voiceoverSegments: [
				{ key: "intro", text: "Mình đã kiểm tra kỹ sản phẩm." },
			],
			claimsSourceRevision: 999,
			claimsStatus: "current" as const,
		};

		expect(hasClaimRelevantScriptVersionChanges(snapshot, edited)).toBe(true);
		const merged = mergeScriptVersionAutosave(snapshot, edited);
		expect(merged).not.toBeNull();
		if (!merged) throw new Error("Expected an allowed autosave edit.");
		expect(merged.claims).toEqual(snapshot.claims);
		expect(merged.claimsSourceRevision).toBe(1);
		expect(merged.claimsStatus).toBe("stale");
	});

	const claimRelevantEdits: Array<
		[
			string,
			(current: ScriptVersionEditableSnapshot) => ScriptVersionEditableSnapshot,
		]
	> = [
		["selected hook", (current) => ({ ...current, selectedHookKey: "hook-1" })],
		[
			"hook text",
			(current) => ({
				...current,
				hookVariants: [
					{ ...current.hookVariants[0], text: "Hook mới" },
					...current.hookVariants.slice(1),
				],
			}),
		],
		[
			"voiceover text",
			(current) => ({
				...current,
				voiceoverSegments: [{ key: "intro", text: "Voiceover mới" }],
			}),
		],
		["CTA", (current) => ({ ...current, cta: { text: "CTA mới" } })],
		["disclosure", (current) => ({ ...current, disclosure: "Disclosure mới" })],
		[
			"scene on-screen text",
			(current) => ({
				...current,
				scenes: [{ ...current.scenes[0], onScreenText: "Text mới" }],
			}),
		],
		["caption", (current) => ({ ...current, caption: "Caption mới" })],
	];

	it.each(claimRelevantEdits)("marks %s stale", (_label, edit) => {
		const edited = edit(snapshot);
		expect(hasClaimRelevantScriptVersionChanges(snapshot, edited)).toBe(true);
		const merged = mergeScriptVersionAutosave(snapshot, edited);
		expect(merged?.claimsStatus).toBe("stale");
	});

	it("does not stale claims for a hashtag-only edit", () => {
		const edited = { ...snapshot, hashtags: ["#review", "#tai-nghe"] };
		expect(hasClaimRelevantScriptVersionChanges(snapshot, edited)).toBe(false);
		expect(mergeScriptVersionAutosave(snapshot, edited)?.claimsStatus).toBe(
			"current",
		);
	});

	const allowedEdits: Array<
		[
			string,
			(current: ScriptVersionEditableSnapshot) => ScriptVersionEditableSnapshot,
		]
	> = [
		[
			"hook text",
			(current) => ({
				...current,
				hookVariants: [
					{ ...current.hookVariants[0], text: "Hook đã chỉnh sửa" },
					...current.hookVariants.slice(1),
				],
			}),
		],
		["selected hook", (current) => ({ ...current, selectedHookKey: "hook-1" })],
		[
			"voiceover text",
			(current) => ({
				...current,
				voiceoverSegments: [{ key: "intro", text: "Voiceover đã chỉnh sửa" }],
			}),
		],
		[
			"scene duration",
			(current) => ({
				...current,
				scenes: [{ ...current.scenes[0], durationSeconds: 8 }],
			}),
		],
		[
			"scene visual direction",
			(current) => ({
				...current,
				scenes: [{ ...current.scenes[0], visualDirection: "Cảnh mới" }],
			}),
		],
		[
			"scene on-screen text",
			(current) => ({
				...current,
				scenes: [{ ...current.scenes[0], onScreenText: null }],
			}),
		],
		["CTA", (current) => ({ ...current, cta: { text: "CTA mới" } })],
		["caption", (current) => ({ ...current, caption: "Caption mới" })],
		["hashtags", (current) => ({ ...current, hashtags: ["#moi"] })],
		["disclosure", (current) => ({ ...current, disclosure: "Disclosure mới" })],
	];

	it.each(allowedEdits)(
		"merges allowed %s edits and validates the result",
		(_label, edit) => {
			const submitted = edit(snapshot);
			expect(validateScriptVersionDraft(submitted).success).toBe(true);
			expect(hasStableScriptVersionStructure(snapshot, submitted)).toBe(true);
			const merged = mergeScriptVersionAutosave(snapshot, submitted);
			expect(merged).not.toBeNull();
			if (!merged) throw new Error("Expected an allowed autosave edit.");
			expect(validateScriptVersionDraft(merged).success).toBe(true);
		},
	);

	const structuralTampering: Array<
		[
			string,
			(current: ScriptVersionEditableSnapshot) => ScriptVersionEditableSnapshot,
		]
	> = [
		[
			"hook key",
			(current) => ({
				...current,
				hookVariants: [
					{ ...current.hookVariants[0], key: "hook-tampered" },
					...current.hookVariants.slice(1),
				],
			}),
		],
		[
			"voiceover key and scene reference",
			(current) => ({
				...current,
				voiceoverSegments: [{ key: "voiceover-tampered", text: "Voiceover" }],
				scenes: [
					{
						...current.scenes[0],
						voiceoverSegmentKeys: ["voiceover-tampered"],
					},
				],
			}),
		],
		[
			"scene structure",
			(current) => ({
				...current,
				scenes: [
					...current.scenes,
					{
						order: 2,
						durationSeconds: 5,
						visualDirection: "Cảnh thêm",
						onScreenText: null,
						voiceoverSegmentKeys: [],
					},
				],
			}),
		],
		[
			"claims list and occurrence",
			(current) => ({
				...current,
				claims: [{ text: "Client claim", occurrence: { section: "cta" } }],
			}),
		],
		["language", (current) => ({ ...current, language: "en-US" })],
	];

	it.each(structuralTampering)(
		"rejects %s structural tampering",
		(_label, edit) => {
			const submitted = edit(snapshot);
			expect(validateScriptVersionDraft(submitted).success).toBe(true);
			expect(hasStableScriptVersionStructure(snapshot, submitted)).toBe(false);
			expect(mergeScriptVersionAutosave(snapshot, submitted)).toBeNull();
		},
	);

	it("rejects schema-version tampering at the request boundary", () => {
		const submitted = { ...snapshot, schemaVersion: "script-draft.v1" };
		expect(validateScriptVersionDraft(submitted).success).toBe(false);
	});

	it("rejects duplicate keys, broken references, and non-sequential scenes", () => {
		const invalid = {
			...snapshot,
			hookVariants: [snapshot.hookVariants[0], snapshot.hookVariants[0]],
			selectedHookKey: "missing",
			scenes: [
				{ ...snapshot.scenes[0], order: 2, voiceoverSegmentKeys: ["missing"] },
			],
		};
		expect(validateScriptVersionDraft(invalid).success).toBe(false);
	});
});

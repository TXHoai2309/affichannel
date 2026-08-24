import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import { describe, expect, it } from "vitest";

import { getSelectedHookKeys, selectScriptHook } from "./script-editor-state";

const snapshot: ScriptVersionEditableSnapshot = {
	schemaVersion: "script-draft.v2",
	language: "vi-VN",
	hookVariants: [
		{ key: "hook-1", text: "Hook 1" },
		{ key: "hook-2", text: "Hook 2" },
		{ key: "hook-3", text: "Hook 3" },
	],
	selectedHookKey: "hook-1",
	voiceoverSegments: [{ key: "intro", text: "Voiceover" }],
	scenes: [
		{
			order: 1,
			durationSeconds: 5,
			visualDirection: "Visual",
			onScreenText: "Text",
			voiceoverSegmentKeys: ["intro"],
		},
	],
	cta: { text: "CTA" },
	caption: "Caption",
	hashtags: ["#review"],
	disclosure: "Disclosure",
	claims: [],
	claimsSourceRevision: 1,
	claimsStatus: "current",
};

describe("Script Editor hook selection", () => {
	it("hydrates exactly one selected hook from selectedHookKey", () => {
		expect(getSelectedHookKeys(snapshot)).toEqual(["hook-1"]);
	});

	it("selects one different hook without changing hook content", () => {
		const selected = selectScriptHook(snapshot, "hook-2");

		expect(selected.selectedHookKey).toBe("hook-2");
		expect(getSelectedHookKeys(selected)).toEqual(["hook-2"]);
		expect(selected.hookVariants).toBe(snapshot.hookVariants);
	});

	it("preserves a legitimate null selection until the user chooses a hook", () => {
		const manualDraft = { ...snapshot, selectedHookKey: null };

		expect(getSelectedHookKeys(manualDraft)).toEqual([]);
		expect(selectScriptHook(manualDraft, "hook-3").selectedHookKey).toBe(
			"hook-3",
		);
	});

	it("does not introduce an unknown hook key", () => {
		expect(selectScriptHook(snapshot, "missing-hook")).toBe(snapshot);
	});

	it("keeps the same snapshot when the active hook is selected again", () => {
		expect(selectScriptHook(snapshot, "hook-1")).toBe(snapshot);
	});
});

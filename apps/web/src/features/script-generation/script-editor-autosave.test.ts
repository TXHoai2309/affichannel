import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createScriptAutosaveController,
	SCRIPT_AUTOSAVE_DEBOUNCE_MS,
} from "./script-editor-autosave";

const snapshot: ScriptVersionEditableSnapshot = {
	schemaVersion: "script-draft.v2",
	language: "vi-VN",
	hookVariants: [
		{ key: "hook-1", text: "Hook 1" },
		{ key: "hook-2", text: "Hook 2" },
		{ key: "hook-3", text: "Hook 3" },
	],
	selectedHookKey: null,
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

afterEach(() => {
	vi.useRealTimers();
});

describe("Script Editor autosave controller", () => {
	it("debounces one edit until 1000ms and saves the latest snapshot", async () => {
		vi.useFakeTimers();
		const save = vi.fn(async (request) => ({
			revision: request.baseRevision + 1,
			editableSnapshot: request.editableSnapshot,
		}));
		const controller = createScriptAutosaveController({
			scriptVersionId: "draft-1",
			initialSnapshot: snapshot,
			initialRevision: 1,
			save,
		});

		controller.updateSnapshot((current) => ({
			...current,
			caption: "Caption mới",
		}));
		await vi.advanceTimersByTimeAsync(SCRIPT_AUTOSAVE_DEBOUNCE_MS - 1);
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save.mock.calls[0]?.[0]).toMatchObject({
			baseRevision: 1,
			editableSnapshot: { caption: "Caption mới" },
		});
		expect(controller.getState()).toMatchObject({
			baseRevision: 2,
			dirty: false,
			status: "saved",
		});
	});

	it("coalesces rapid edits and never sends concurrent requests with one base revision", async () => {
		vi.useFakeTimers();
		const save = vi.fn(async (request) => ({
			revision: request.baseRevision + 1,
			editableSnapshot: request.editableSnapshot,
		}));
		const controller = createScriptAutosaveController({
			scriptVersionId: "draft-1",
			initialSnapshot: snapshot,
			initialRevision: 1,
			save,
		});

		controller.updateSnapshot((current) => ({ ...current, caption: "A" }));
		await vi.advanceTimersByTimeAsync(500);
		controller.updateSnapshot((current) => ({ ...current, caption: "B" }));
		await vi.advanceTimersByTimeAsync(999);
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save.mock.calls[0]?.[0].editableSnapshot.caption).toBe("B");
		expect(controller.getState().status).toBe("saved");
	});

	it("keeps a newer local edit while the earlier save is in flight", async () => {
		vi.useFakeTimers();
		let resolveFirst:
			| ((result: {
					revision: number;
					editableSnapshot: ScriptVersionEditableSnapshot;
			  }) => void)
			| undefined;
		const save = vi
			.fn()
			.mockImplementationOnce(
				(_request: {
					baseRevision: number;
					editableSnapshot: ScriptVersionEditableSnapshot;
				}) =>
					new Promise((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockImplementation(async (request) => ({
				revision: request.baseRevision + 1,
				editableSnapshot: request.editableSnapshot,
			}));
		const controller = createScriptAutosaveController({
			scriptVersionId: "draft-1",
			initialSnapshot: snapshot,
			initialRevision: 1,
			save,
		});

		controller.updateSnapshot((current) => ({ ...current, caption: "A" }));
		await vi.advanceTimersByTimeAsync(SCRIPT_AUTOSAVE_DEBOUNCE_MS);
		expect(save).toHaveBeenCalledTimes(1);
		controller.updateSnapshot((current) => ({ ...current, caption: "B" }));
		await vi.advanceTimersByTimeAsync(SCRIPT_AUTOSAVE_DEBOUNCE_MS);
		expect(save).toHaveBeenCalledTimes(1);

		resolveFirst?.({
			revision: 2,
			editableSnapshot: {
				...snapshot,
				caption: "A",
				claimsStatus: "stale",
			},
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(controller.getState()).toMatchObject({
			baseRevision: 2,
			status: "dirty",
			dirty: true,
		});
		expect(controller.getState().snapshot.caption).toBe("B");
		expect(controller.getState().snapshot.claimsStatus).toBe("stale");

		await vi.advanceTimersByTimeAsync(SCRIPT_AUTOSAVE_DEBOUNCE_MS);
		expect(save).toHaveBeenCalledTimes(2);
		expect(save.mock.calls[1]?.[0].baseRevision).toBe(2);
		expect(save.mock.calls[1]?.[0].editableSnapshot.caption).toBe("B");
		await vi.advanceTimersByTimeAsync(0);
		expect(controller.getState().status).toBe("saved");
	});

	it("pauses on conflict and only replaces local content after explicit reload", async () => {
		vi.useFakeTimers();
		const save = vi.fn().mockRejectedValue({
			data: { code: "SCRIPT_VERSION_CONFLICT", latestRevision: 7 },
		});
		const controller = createScriptAutosaveController({
			scriptVersionId: "draft-1",
			initialSnapshot: snapshot,
			initialRevision: 1,
			save,
		});

		controller.updateSnapshot((current) => ({
			...current,
			caption: "Local chưa lưu",
		}));
		await vi.advanceTimersByTimeAsync(SCRIPT_AUTOSAVE_DEBOUNCE_MS);
		expect(controller.getState()).toMatchObject({
			status: "conflict",
			dirty: true,
			latestRevision: 7,
		});
		await vi.advanceTimersByTimeAsync(SCRIPT_AUTOSAVE_DEBOUNCE_MS * 2);
		expect(save).toHaveBeenCalledTimes(1);
		expect(controller.getState().snapshot.caption).toBe("Local chưa lưu");

		controller.resetFromServer({ ...snapshot, caption: "Bản mới nhất" }, 7);
		expect(controller.getState()).toMatchObject({
			baseRevision: 7,
			dirty: false,
			status: "saved",
			snapshot: { caption: "Bản mới nhất" },
		});
	});
});

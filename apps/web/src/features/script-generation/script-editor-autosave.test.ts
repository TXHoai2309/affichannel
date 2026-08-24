import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createScriptAutosaveController,
	SCRIPT_AUTOSAVE_DEBOUNCE_MS,
} from "./script-editor-autosave";
import { selectScriptHook } from "./script-editor-state";

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
	it("autosaves a hook-card selection through the existing debounce path", async () => {
		vi.useFakeTimers();
		const save = vi.fn(async (request) => ({
			revision: request.baseRevision + 1,
			editableSnapshot: request.editableSnapshot,
		}));
		const controller = createScriptAutosaveController({
			scriptVersionId: "draft-1",
			initialSnapshot: { ...snapshot, selectedHookKey: "hook-1" },
			initialRevision: 1,
			save,
		});

		controller.updateSnapshot((current) => selectScriptHook(current, "hook-2"));
		expect(controller.getState()).toMatchObject({
			dirty: true,
			status: "dirty",
			snapshot: { selectedHookKey: "hook-2" },
		});
		await vi.advanceTimersByTimeAsync(SCRIPT_AUTOSAVE_DEBOUNCE_MS);

		expect(save).toHaveBeenCalledTimes(1);
		expect(save.mock.calls[0]?.[0].editableSnapshot.selectedHookKey).toBe(
			"hook-2",
		);
		expect(controller.getState().status).toBe("saved");
	});

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

	it("flushes pending dirty state when navigation disposes the editor", async () => {
		vi.useFakeTimers();
		const save = vi.fn(async (request) => ({
			revision: request.baseRevision + 1,
			editableSnapshot: request.editableSnapshot,
		}));
		const controller = createScriptAutosaveController({
			scriptVersionId: "draft-1",
			initialSnapshot: snapshot,
			initialRevision: 5,
			save,
		});

		controller.updateSnapshot((current) => ({
			...current,
			voiceoverSegments: [{ key: "intro", text: "Edit trước navigation" }],
		}));
		await vi.advanceTimersByTimeAsync(500);
		controller.dispose({ flush: true });

		expect(save).toHaveBeenCalledTimes(1);
		expect(save.mock.calls[0]?.[0]).toMatchObject({
			baseRevision: 5,
			editableSnapshot: {
				voiceoverSegments: [{ text: "Edit trước navigation" }],
			},
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(controller.getState().baseRevision).toBe(6);
	});

	it("does not save a clean editor during navigation", async () => {
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

		controller.dispose({ flush: true });
		await vi.advanceTimersByTimeAsync(SCRIPT_AUTOSAVE_DEBOUNCE_MS);

		expect(save).not.toHaveBeenCalled();
	});

	it("flushes newer edits after an in-flight save completes", async () => {
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
		controller.updateSnapshot((current) => ({ ...current, caption: "B" }));
		controller.dispose({ flush: true });
		expect(save).toHaveBeenCalledTimes(1);

		resolveFirst?.({
			revision: 2,
			editableSnapshot: { ...snapshot, caption: "A" },
		});
		await vi.advanceTimersByTimeAsync(0);

		expect(save).toHaveBeenCalledTimes(2);
		expect(save.mock.calls[1]?.[0]).toMatchObject({
			baseRevision: 2,
			editableSnapshot: { caption: "B" },
		});
	});

	it("flush waits for the latest revision before a version-save action continues", async () => {
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
		controller.updateSnapshot((current) => ({ ...current, caption: "B" }));
		const flushed = controller.flush();
		let settled = false;
		void flushed.then(() => {
			settled = true;
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(settled).toBe(false);

		resolveFirst?.({
			revision: 2,
			editableSnapshot: { ...snapshot, caption: "A" },
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(save).toHaveBeenCalledTimes(2);
		expect(save.mock.calls[1]?.[0]).toMatchObject({
			baseRevision: 2,
			editableSnapshot: { caption: "B" },
		});
		await vi.advanceTimersByTimeAsync(0);
		await expect(flushed).resolves.toMatchObject({
			baseRevision: 3,
			dirty: false,
			status: "saved",
		});
	});
});

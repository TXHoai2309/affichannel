"use client";

import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import { useEffect, useRef, useState } from "react";

export const SCRIPT_AUTOSAVE_DEBOUNCE_MS = 1_000;

export type ScriptAutosaveStatus =
	| "saved"
	| "dirty"
	| "saving"
	| "error"
	| "conflict";

export type ScriptAutosaveState = {
	snapshot: ScriptVersionEditableSnapshot;
	baseRevision: number;
	dirty: boolean;
	status: ScriptAutosaveStatus;
	errorCode?: string;
	latestRevision?: number;
};

export type ScriptAutosaveRequest = {
	scriptVersionId: string;
	baseRevision: number;
	editableSnapshot: ScriptVersionEditableSnapshot;
};

export type ScriptAutosaveResult = {
	revision: number;
	editableSnapshot: ScriptVersionEditableSnapshot;
};

type AutosaveControllerOptions = {
	scriptVersionId: string;
	initialSnapshot: ScriptVersionEditableSnapshot;
	initialRevision: number;
	debounceMs?: number;
	save: (request: ScriptAutosaveRequest) => Promise<ScriptAutosaveResult>;
	onStateChange?: (state: ScriptAutosaveState) => void;
};

export type ScriptAutosaveController = {
	getState: () => ScriptAutosaveState;
	updateSnapshot: (
		updater: (
			current: ScriptVersionEditableSnapshot,
		) => ScriptVersionEditableSnapshot,
	) => void;
	flush: () => void;
	retry: () => void;
	resetFromServer: (
		snapshot: ScriptVersionEditableSnapshot,
		revision: number,
	) => void;
	dispose: (options?: { flush?: boolean }) => void;
};

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

export function getScriptVersionErrorCode(error: unknown) {
	const record = getRecord(error);
	const data = getRecord(record?.data);
	const code = data?.code ?? record?.code ?? record?.message;
	return typeof code === "string" && code.length < 120 ? code : undefined;
}

export function getScriptVersionLatestRevision(error: unknown) {
	const record = getRecord(error);
	const data = getRecord(record?.data);
	const metadata = getRecord(data?.metadata);
	const revision =
		data?.latestRevision ?? metadata?.latestRevision ?? record?.latestRevision;
	return typeof revision === "number" && Number.isInteger(revision)
		? revision
		: undefined;
}

const SCRIPT_VERSION_ERROR_MESSAGES: Record<string, string> = {
	SCRIPT_VERSION_IMMUTABLE: "Bản nháp này không còn cho phép chỉnh sửa.",
	SCRIPT_VERSION_NOT_FOUND: "Không tìm thấy bản nháp ScriptVersion.",
	SCRIPT_GENERATION_NOT_FOUND: "Không tìm thấy bản AI phù hợp cho project.",
	SCRIPT_GENERATION_NOT_EDITABLE:
		"Bản AI này chưa sẵn sàng để bắt đầu chỉnh sửa.",
	SCRIPT_GENERATION_INVALIDATED:
		"Bản AI này đã mất hiệu lực vì Product Facts thay đổi.",
	SCRIPT_VERSION_DRAFT_ALREADY_EXISTS:
		"Project đã có một bản nháp. Hệ thống sẽ tải bản nháp hiện tại.",
	INVALID_SCRIPT_VERSION_SNAPSHOT:
		"Nội dung bản nháp chưa hợp lệ nên chưa thể lưu.",
};

export function getScriptVersionErrorMessage(error: unknown) {
	const code = getScriptVersionErrorCode(error);
	return (
		(code && SCRIPT_VERSION_ERROR_MESSAGES[code]) ??
		"Không thể lưu bản nháp. Hãy thử lại hoặc tải bản mới nhất."
	);
}

function mergeServerOwnedMetadata(
	local: ScriptVersionEditableSnapshot,
	server: ScriptVersionEditableSnapshot,
) {
	return {
		...local,
		schemaVersion: server.schemaVersion,
		language: server.language,
		claims: server.claims,
		claimsSourceRevision: server.claimsSourceRevision,
		claimsStatus: server.claimsStatus,
	} satisfies ScriptVersionEditableSnapshot;
}

export function createScriptAutosaveController(
	options: AutosaveControllerOptions,
): ScriptAutosaveController {
	const debounceMs = options.debounceMs ?? SCRIPT_AUTOSAVE_DEBOUNCE_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let inFlight = false;
	let sequence = 0;
	let epoch = 0;
	let disposed = false;
	let closing = false;
	let state: ScriptAutosaveState = {
		snapshot: options.initialSnapshot,
		baseRevision: options.initialRevision,
		dirty: false,
		status: "saved",
	};

	function emit() {
		if (!disposed && !closing) options.onStateChange?.(state);
	}

	function clearTimer() {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	}

	function schedule() {
		clearTimer();
		if (
			disposed ||
			closing ||
			inFlight ||
			state.status === "conflict" ||
			!state.dirty
		)
			return;
		timer = setTimeout(() => {
			timer = undefined;
			void startSave();
		}, debounceMs);
	}

	async function startSave() {
		if (disposed || inFlight || !state.dirty || state.status === "conflict")
			return;
		inFlight = true;
		const requestSequence = sequence;
		const requestEpoch = epoch;
		const requestSnapshot = state.snapshot;
		const requestRevision = state.baseRevision;
		state = {
			...state,
			status: "saving",
			errorCode: undefined,
			latestRevision: undefined,
		};
		emit();

		try {
			const result = await options.save({
				scriptVersionId: options.scriptVersionId,
				baseRevision: requestRevision,
				editableSnapshot: requestSnapshot,
			});
			inFlight = false;
			if (disposed || requestEpoch !== epoch) return;

			const localChanged = requestSequence !== sequence;
			state = {
				...state,
				baseRevision: result.revision,
				snapshot: localChanged
					? mergeServerOwnedMetadata(state.snapshot, result.editableSnapshot)
					: result.editableSnapshot,
				dirty: localChanged,
				status: localChanged ? "dirty" : "saved",
				errorCode: undefined,
				latestRevision: undefined,
			};
			emit();
			if (localChanged) {
				if (closing) void startSave();
				else schedule();
			} else if (closing) {
				finishClosing();
			}
		} catch (error) {
			inFlight = false;
			if (disposed || requestEpoch !== epoch) return;
			const code = getScriptVersionErrorCode(error);
			if (code === "SCRIPT_VERSION_CONFLICT") {
				state = {
					...state,
					status: "conflict",
					dirty: true,
					errorCode: code,
					latestRevision: getScriptVersionLatestRevision(error),
				};
			} else {
				state = {
					...state,
					status: "error",
					dirty: true,
					errorCode: code,
				};
			}
			if (closing) finishClosing();
			else emit();
		}
	}

	function finishClosing() {
		if (!closing || disposed || inFlight || timer !== undefined) return;
		disposed = true;
		closing = false;
		epoch += 1;
		clearTimer();
	}

	return {
		getState: () => state,
		updateSnapshot(updater) {
			if (disposed || closing) return;
			sequence += 1;
			const nextSnapshot = updater(state.snapshot);
			state = {
				...state,
				snapshot: nextSnapshot,
				dirty: true,
				status: state.status === "conflict" ? "conflict" : "dirty",
				errorCode: undefined,
				latestRevision:
					state.status === "conflict" ? state.latestRevision : undefined,
			};
			emit();
			if (state.status !== "conflict") schedule();
		},
		flush() {
			clearTimer();
			void startSave();
		},
		retry() {
			if (state.status !== "error") return;
			state = { ...state, status: "dirty", errorCode: undefined };
			emit();
			clearTimer();
			void startSave();
		},
		resetFromServer(snapshot, revision) {
			if (disposed) return;
			epoch += 1;
			sequence += 1;
			closing = false;
			clearTimer();
			state = {
				snapshot,
				baseRevision: revision,
				dirty: false,
				status: "saved",
			};
			emit();
		},
		dispose({ flush = false } = {}) {
			if (disposed) return;
			if (!flush) {
				disposed = true;
				epoch += 1;
				clearTimer();
				return;
			}

			closing = true;
			clearTimer();
			if (inFlight) return;
			if (state.dirty && state.status !== "conflict") {
				void startSave();
				return;
			}
			finishClosing();
		},
	};
}

export function useScriptAutosave(options: {
	scriptVersionId: string;
	initialSnapshot: ScriptVersionEditableSnapshot;
	initialRevision: number;
	save: (request: ScriptAutosaveRequest) => Promise<ScriptAutosaveResult>;
}) {
	const saveRef = useRef(options.save);
	saveRef.current = options.save;
	const [, forceRender] = useState(0);
	const controllerRef = useRef<{
		scriptVersionId: string;
		controller: ScriptAutosaveController;
	} | null>(null);
	const mountedControllerRef = useRef<ScriptAutosaveController | null>(null);
	const lifecycleRef = useRef(0);
	if (
		!controllerRef.current ||
		controllerRef.current.scriptVersionId !== options.scriptVersionId
	) {
		controllerRef.current = {
			scriptVersionId: options.scriptVersionId,
			controller: createScriptAutosaveController({
				scriptVersionId: options.scriptVersionId,
				initialSnapshot: options.initialSnapshot,
				initialRevision: options.initialRevision,
				save: (request) => saveRef.current(request),
				onStateChange: () => forceRender((current) => current + 1),
			}),
		};
	}
	const controller = controllerRef.current;

	useEffect(() => {
		const previousController = mountedControllerRef.current;
		if (previousController && previousController !== controller.controller) {
			previousController.dispose({ flush: true });
		}
		mountedControllerRef.current = controller.controller;

		const lifecycle = ++lifecycleRef.current;
		return () => {
			queueMicrotask(() => {
				if (lifecycleRef.current === lifecycle) {
					controller.controller.dispose({ flush: true });
				}
			});
		};
	}, [controller]);

	return {
		state: controller.controller.getState(),
		updateSnapshot: controller.controller.updateSnapshot,
		flush: controller.controller.flush,
		retry: controller.controller.retry,
		resetFromServer: controller.controller.resetFromServer,
	};
}

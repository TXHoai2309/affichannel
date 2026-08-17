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
	dispose: () => void;
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
	let state: ScriptAutosaveState = {
		snapshot: options.initialSnapshot,
		baseRevision: options.initialRevision,
		dirty: false,
		status: "saved",
	};

	function emit() {
		if (!disposed) options.onStateChange?.(state);
	}

	function clearTimer() {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	}

	function schedule() {
		clearTimer();
		if (disposed || inFlight || state.status === "conflict" || !state.dirty)
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
			if (localChanged) schedule();
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
			emit();
		}
	}

	return {
		getState: () => state,
		updateSnapshot(updater) {
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
			epoch += 1;
			sequence += 1;
			clearTimer();
			state = {
				snapshot,
				baseRevision: revision,
				dirty: false,
				status: "saved",
			};
			emit();
		},
		dispose() {
			disposed = true;
			epoch += 1;
			clearTimer();
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
	const initialSnapshotRef = useRef(options.initialSnapshot);
	initialSnapshotRef.current = options.initialSnapshot;
	const serverIdentityRef = useRef({
		scriptVersionId: options.scriptVersionId,
		revision: options.initialRevision,
	});
	const [state, setState] = useState<ScriptAutosaveState>(() => ({
		snapshot: options.initialSnapshot,
		baseRevision: options.initialRevision,
		dirty: false,
		status: "saved",
	}));
	const controllerRef = useRef<ScriptAutosaveController | null>(null);
	const lifecycleRef = useRef(0);
	if (!controllerRef.current) {
		controllerRef.current = createScriptAutosaveController({
			scriptVersionId: options.scriptVersionId,
			initialSnapshot: options.initialSnapshot,
			initialRevision: options.initialRevision,
			save: (request) => saveRef.current(request),
			onStateChange: setState,
		});
	}
	const controller = controllerRef.current;

	useEffect(() => {
		const identityChanged =
			serverIdentityRef.current.scriptVersionId !== options.scriptVersionId ||
			serverIdentityRef.current.revision !== options.initialRevision;
		serverIdentityRef.current = {
			scriptVersionId: options.scriptVersionId,
			revision: options.initialRevision,
		};
		if (!identityChanged) return;
		controller.resetFromServer(
			initialSnapshotRef.current,
			options.initialRevision,
		);
	}, [controller, options.initialRevision, options.scriptVersionId]);

	useEffect(() => {
		const lifecycle = ++lifecycleRef.current;
		return () => {
			queueMicrotask(() => {
				if (lifecycleRef.current === lifecycle) controller.dispose();
			});
		};
	}, [controller]);

	return {
		state,
		updateSnapshot: controller.updateSnapshot,
		flush: controller.flush,
		retry: controller.retry,
		resetFromServer: controller.resetFromServer,
	};
}

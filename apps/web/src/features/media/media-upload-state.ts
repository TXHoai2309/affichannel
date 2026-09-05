export type MediaUploadPhase =
	| "idle"
	| "preparing"
	| "uploading"
	| "validating"
	| "validating_wait"
	| "complete"
	| "error";

export type MediaPreparedUpload = Readonly<{
	assetId: string;
	uploadSessionId: string;
}>;

export type MediaUploadState = Readonly<{
	phase: MediaUploadPhase;
	attemptKey: string | null;
	prepared: MediaPreparedUpload | null;
}>;

export const initialMediaUploadState: MediaUploadState = {
	phase: "idle",
	attemptKey: null,
	prepared: null,
};

type MediaUploadAction =
	| { type: "reset" }
	| { type: "set_attempt_key"; attemptKey: string }
	| { type: "set_phase"; phase: MediaUploadPhase }
	| { type: "prepared"; prepared: MediaPreparedUpload }
	| { type: "put_failed"; terminal: boolean }
	| { type: "finalize_in_progress" }
	| { type: "finalize_failed" }
	| { type: "finalize_ready" };

export function mediaUploadReducer(
	state: MediaUploadState,
	action: MediaUploadAction,
): MediaUploadState {
	switch (action.type) {
		case "reset":
			return initialMediaUploadState;
		case "set_attempt_key":
			return { ...state, attemptKey: action.attemptKey };
		case "set_phase":
			return { ...state, phase: action.phase };
		case "prepared":
			return { ...state, phase: "uploading", prepared: action.prepared };
		case "put_failed":
			return action.terminal
				? { phase: "error", attemptKey: null, prepared: null }
				: { ...state, phase: "error" };
		case "finalize_in_progress":
			return { ...state, phase: "validating_wait" };
		case "finalize_failed":
			return { phase: "error", attemptKey: null, prepared: null };
		case "finalize_ready":
			return { phase: "complete", attemptKey: null, prepared: null };
	}
}

export function getMediaUploadErrorCode(error: unknown) {
	if (!error || typeof error !== "object") return undefined;
	const candidate = error as {
		code?: unknown;
		message?: unknown;
		data?: { code?: unknown };
	};
	if (typeof candidate.data?.code === "string") return candidate.data.code;
	if (typeof candidate.code === "string") return candidate.code;
	if (typeof candidate.message === "string") return candidate.message;
	return undefined;
}

const terminalUploadErrorCodes = new Set([
	"MEDIA_ASSET_CHECKSUM_INVALID",
	"MEDIA_ASSET_FILENAME_INVALID",
	"MEDIA_ASSET_GRANT_EXPIRED",
	"MEDIA_ASSET_GRANT_INVALID",
	"MEDIA_ASSET_IDEMPOTENCY_CONFLICT",
	"MEDIA_ASSET_INVALID_MEDIA",
	"MEDIA_ASSET_INVALID_METADATA",
	"MEDIA_ASSET_NOT_FOUND",
	"MEDIA_ASSET_SIZE_LIMIT_EXCEEDED",
	"MEDIA_ASSET_UPLOAD_EXPIRED",
	"MEDIA_ASSET_UPLOAD_NOT_ALLOWED",
	"MEDIA_ASSET_UPLOAD_SESSION_INVALID",
]);

export function isTerminalMediaUploadError(error: unknown) {
	const code = getMediaUploadErrorCode(error);
	return code ? terminalUploadErrorCodes.has(code) : false;
}

import { describe, expect, it } from "vitest";

import {
	initialMediaUploadState,
	isTerminalMediaUploadError,
	mediaUploadReducer,
} from "./media-upload-state";

const prepared = { assetId: "asset-old", uploadSessionId: "session-old" };

function preparedState() {
	let state = mediaUploadReducer(initialMediaUploadState, {
		type: "set_attempt_key",
		attemptKey: "attempt-old",
	});
	state = mediaUploadReducer(state, { type: "prepared", prepared });
	return state;
}

describe("media upload retry state", () => {
	it("resets terminal finalize failure so the next retry starts a new asset", () => {
		const failed = mediaUploadReducer(preparedState(), {
			type: "finalize_failed",
		});
		expect(failed).toEqual({
			phase: "error",
			attemptKey: null,
			prepared: null,
		});
		const next = mediaUploadReducer(failed, {
			type: "set_attempt_key",
			attemptKey: "attempt-new",
		});
		const preparedAgain = mediaUploadReducer(next, {
			type: "prepared",
			prepared: { assetId: "asset-new", uploadSessionId: "session-new" },
		});
		expect(preparedAgain.attemptKey).toBe("attempt-new");
		expect(preparedAgain.prepared?.assetId).toBe("asset-new");
	});

	it("classifies expired and upload-not-allowed as new-attempt failures", () => {
		expect(
			isTerminalMediaUploadError({ code: "MEDIA_ASSET_UPLOAD_EXPIRED" }),
		).toBe(true);
		expect(
			isTerminalMediaUploadError({
				data: { code: "MEDIA_ASSET_UPLOAD_NOT_ALLOWED" },
			}),
		).toBe(true);
		expect(
			isTerminalMediaUploadError({ code: "MEDIA_ASSET_IDEMPOTENCY_CONFLICT" }),
		).toBe(true);
	});

	it("retains the same asset/session while finalize is in progress", () => {
		const waiting = mediaUploadReducer(preparedState(), {
			type: "finalize_in_progress",
		});
		expect(waiting.phase).toBe("validating_wait");
		expect(waiting.prepared).toEqual(prepared);
		expect(waiting.attemptKey).toBe("attempt-old");
	});

	it("moves in-progress to complete without a second prepare or PUT", () => {
		const waiting = mediaUploadReducer(preparedState(), {
			type: "finalize_in_progress",
		});
		const ready = mediaUploadReducer(waiting, { type: "finalize_ready" });
		expect(ready).toEqual({
			phase: "complete",
			attemptKey: null,
			prepared: null,
		});
	});

	it("moves in-progress to terminal failure and resets the next retry", () => {
		const waiting = mediaUploadReducer(preparedState(), {
			type: "finalize_in_progress",
		});
		const failed = mediaUploadReducer(waiting, { type: "finalize_failed" });
		expect(failed.attemptKey).toBeNull();
		expect(failed.prepared).toBeNull();
	});

	it("retains a pending attempt after a transient PUT failure", () => {
		const retryable = mediaUploadReducer(preparedState(), {
			type: "put_failed",
			terminal: false,
		});
		expect(retryable.phase).toBe("error");
		expect(retryable.attemptKey).toBe("attempt-old");
		expect(retryable.prepared).toEqual(prepared);
	});

	it("keeps the normal prepare → PUT → finalize → READY outcome", () => {
		const ready = mediaUploadReducer(preparedState(), {
			type: "finalize_ready",
		});
		expect(ready.phase).toBe("complete");
		expect(ready.prepared).toBeNull();
	});
});

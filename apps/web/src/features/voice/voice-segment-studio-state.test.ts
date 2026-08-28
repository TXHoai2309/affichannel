import { describe, expect, it } from "vitest";

import {
	buildVoiceSegmentAudioUrl,
	calculateWaveformPeaks,
	createVoiceSegmentGenerateInput,
	createVoiceSegmentIdempotencyKey,
	formatVoiceSegmentDuration,
	getVoiceSegmentErrorMessage,
	getVoiceSegmentStatusLabel,
	settleVoiceSegmentMutation,
	waveformCacheKey,
} from "./voice-segment-studio-state";

describe("Voice Segment Studio state", () => {
	it("refetches Voice state before refreshing workflow after completed generation", async () => {
		const events: string[] = [];
		const result = await settleVoiceSegmentMutation(
			Promise.resolve({ artifact: { status: "completed" as const } }),
			async () => {
				events.push("voice-state-refetch");
			},
			() => {
				events.push("router.refresh");
			},
		);

		expect(result.artifact.status).toBe("completed");
		expect(events).toEqual(["voice-state-refetch", "router.refresh"]);
	});

	it.each(["pending", "failed", "indeterminate"] as const)(
		"does not refresh workflow for non-completed artifact status %s",
		async (status) => {
			const events: string[] = [];
			await settleVoiceSegmentMutation(
				Promise.resolve({ artifact: { status } }),
				async () => {
					events.push("voice-state-refetch");
				},
				() => {
					events.push("router.refresh");
				},
			);

			expect(events).toEqual(["voice-state-refetch"]);
		},
	);

	it("keeps server status labels distinct, including stale audio", () => {
		expect(getVoiceSegmentStatusLabel("not_generated")).toBe("Chưa tạo");
		expect(getVoiceSegmentStatusLabel("pending")).toBe("Đang tạo");
		expect(getVoiceSegmentStatusLabel("completed")).toBe("Đã tạo");
		expect(getVoiceSegmentStatusLabel("failed")).toBe("Tạo thất bại");
		expect(getVoiceSegmentStatusLabel("indeterminate")).toBe("Chưa xác định");
		expect(getVoiceSegmentStatusLabel("stale")).toBe("Audio đã cũ");
	});

	it("uses server duration and only sends the three allowed generate fields", () => {
		expect(formatVoiceSegmentDuration(4_200)).toBe("4.2 giây");
		expect(formatVoiceSegmentDuration(null)).toBeNull();
		expect(
			createVoiceSegmentGenerateInput(
				"project-1",
				"intro",
				"voice-segment-attempt-1",
			),
		).toEqual({
			projectId: "project-1",
			segmentKey: "intro",
			idempotencyKey: "voice-segment-attempt-1",
		});
	});

	it("creates a new idempotency key for each explicit generate action", () => {
		const first = createVoiceSegmentIdempotencyKey(() => "uuid-a");
		const second = createVoiceSegmentIdempotencyKey(() => "uuid-b");
		expect(first).not.toBe(second);
		expect(first).toBe("voice-segment-uuid-a");
	});

	it("maps conservative server errors without exposing raw provider details", () => {
		expect(
			getVoiceSegmentErrorMessage({
				data: { code: "TTS_TIMEOUT_UNCERTAIN", detail: "provider secret" },
			}),
		).toContain("không tự động gửi lại");
		expect(
			getVoiceSegmentErrorMessage({ code: "TTS_PROVIDER_FAILED" }),
		).toContain("từ chối");
	});

	it("calculates a deterministic fixed-bar waveform and caches by artifact identity", () => {
		const peaks = calculateWaveformPeaks(
			new Float32Array([0, 0.25, -0.5, 1, 0.5]),
			4,
		);
		expect(peaks).toHaveLength(4);
		expect(peaks[0]).toBe(0);
		expect(peaks[2]).toBe(0.5);
		expect(peaks[3]).toBe(1);
		expect(waveformCacheKey("artifact-1", "checksum-a")).toBe(
			"artifact-1/checksum-a",
		);
		expect(waveformCacheKey("artifact-1", "checksum-b")).not.toBe(
			waveformCacheKey("artifact-1", "checksum-a"),
		);
	});

	it("builds audio URLs from the protected artifact route, never storage keys", () => {
		expect(buildVoiceSegmentAudioUrl("project/1", "artifact 1")).toBe(
			"/api/projects/project%2F1/voice/segments/artifact%201/audio",
		);
	});
});

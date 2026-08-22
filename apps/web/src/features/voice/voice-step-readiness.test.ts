import type {
	VoiceSegmentArtifact,
	VoiceSegmentArtifactReadModel,
	VoiceSegmentFingerprint,
} from "@affichannel/core";
import { evaluateVoiceStepReadiness } from "@affichannel/core";
import { describe, expect, it } from "vitest";

const fingerprint: VoiceSegmentFingerprint = {
	workspaceId: "workspace-1",
	projectId: "project-1",
	sourceScriptVersionId: "script-1",
	sourceScriptRevision: 4,
	segmentKey: "intro",
	textHash: "a".repeat(64),
	voiceConfigRevision: 2,
	provider: "apikeyfun",
	voiceId: "eve",
	language: "vi",
	speed: 1,
};

function artifact(
	status: VoiceSegmentArtifact["status"] = "completed",
): VoiceSegmentArtifact {
	return {
		...fingerprint,
		id: "artifact-1",
		createdByUserId: "user-1",
		segmentTextSnapshot: "Thời lượng pin lên đến 20 giờ.",
		idempotencyKey: "voice-attempt-1",
		requestHash: "b".repeat(64),
		status,
		providerRequestId: null,
		errorCode: status === "failed" ? "TTS_PROVIDER_FAILED" : null,
		storageProvider: status === "completed" ? "local" : null,
		storageKey: status === "completed" ? "voice/key.mp3" : null,
		mimeType: status === "completed" ? "audio/mpeg" : null,
		byteSize: status === "completed" ? 100 : null,
		checksum: status === "completed" ? "c".repeat(64) : null,
		durationMs: status === "completed" ? 1_250 : null,
		createdAt: new Date("2026-08-21T00:00:00.000Z"),
		finishedAt:
			status === "pending" ? null : new Date("2026-08-21T00:00:01.000Z"),
	};
}

function segment(
	readModel: VoiceSegmentArtifactReadModel,
): Parameters<typeof evaluateVoiceStepReadiness>[0]["segments"][number] {
	return {
		segmentKey: fingerprint.segmentKey,
		text: "Thời lượng pin lên đến 20 giờ.",
		fingerprint,
		readModel,
	};
}

describe("Voice step readiness", () => {
	it("requires Fact Lock, config, script segments and every current usable artifact", () => {
		const current = artifact();
		const result = evaluateVoiceStepReadiness({
			factLockPassed: true,
			voiceConfigPresent: true,
			currentScriptVersionPresent: true,
			segments: [
				segment({
					latestRequest: current,
					latestUsableArtifact: current,
					effectiveStatus: "completed",
				}),
				segment({
					latestRequest: null,
					latestUsableArtifact: null,
					effectiveStatus: "not_generated",
				}),
			],
		});

		expect(result).toMatchObject({
			totalSegments: 2,
			completedSegments: 1,
			totalVoiceoverDurationMs: 1_250,
			ready: false,
		});
	});

	it("keeps readiness and duration when a failed regenerate leaves a usable current artifact", () => {
		const current = artifact();
		const failed = artifact("failed");
		failed.id = "artifact-2";
		failed.createdAt = new Date("2026-08-21T00:01:00.000Z");
		const result = evaluateVoiceStepReadiness({
			factLockPassed: true,
			voiceConfigPresent: true,
			currentScriptVersionPresent: true,
			segments: [
				segment({
					latestRequest: failed,
					latestUsableArtifact: current,
					effectiveStatus: "failed",
				}),
			],
		});

		expect(result).toMatchObject({
			completedSegments: 1,
			totalVoiceoverDurationMs: 1_250,
			ready: true,
		});
	});

	it("does not count pending or stale audio as completed", () => {
		const result = evaluateVoiceStepReadiness({
			factLockPassed: true,
			voiceConfigPresent: true,
			currentScriptVersionPresent: true,
			segments: [
				segment({
					latestRequest: artifact("pending"),
					latestUsableArtifact: null,
					effectiveStatus: "pending",
				}),
				segment({
					latestRequest: artifact("failed"),
					latestUsableArtifact: null,
					effectiveStatus: "stale",
				}),
			],
		});

		expect(result).toMatchObject({
			completedSegments: 0,
			pendingSegments: 1,
			staleSegments: 1,
			totalVoiceoverDurationMs: 0,
			ready: false,
		});
	});
});

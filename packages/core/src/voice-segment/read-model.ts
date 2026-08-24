import {
	isVoiceSegmentArtifactUsable,
	sameVoiceSegmentFingerprint,
} from "./fingerprint";
import type {
	VoiceSegmentArtifact,
	VoiceSegmentArtifactReadModel,
	VoiceSegmentFingerprint,
} from "./types";

export type VoiceSegmentReadTemporalContext = {
	now: Date;
	pendingLeaseMs: number;
};

export function isVoiceSegmentPendingExpired(
	artifact: Pick<VoiceSegmentArtifact, "status" | "createdAt">,
	now: Date,
	leaseMs: number,
) {
	return (
		artifact.status === "pending" &&
		Number.isFinite(leaseMs) &&
		leaseMs > 0 &&
		now.getTime() - artifact.createdAt.getTime() >= leaseMs
	);
}

function newestFirst(left: VoiceSegmentArtifact, right: VoiceSegmentArtifact) {
	return (
		right.createdAt.getTime() - left.createdAt.getTime() ||
		right.id.localeCompare(left.id)
	);
}

export function deriveVoiceSegmentReadModel(
	artifacts: VoiceSegmentArtifact[],
	currentFingerprint: VoiceSegmentFingerprint,
	temporalContext?: VoiceSegmentReadTemporalContext,
): VoiceSegmentArtifactReadModel {
	const ordered = [...artifacts].sort(newestFirst);
	const currentAttempts = ordered.filter((artifact) =>
		sameVoiceSegmentFingerprint(artifact, currentFingerprint),
	);
	const latestRequest = ordered[0] ?? null;
	const latestUsableArtifact =
		currentAttempts.find((artifact) =>
			isVoiceSegmentArtifactUsable(artifact, currentFingerprint),
		) ?? null;

	if (currentAttempts.length === 0) {
		return {
			latestRequest,
			latestUsableArtifact,
			effectiveStatus: ordered.length > 0 ? "stale" : "not_generated",
		};
	}

	const latestCurrentRequest = currentAttempts[0];
	if (!latestCurrentRequest) {
		return {
			latestRequest,
			latestUsableArtifact,
			effectiveStatus: "not_generated",
		};
	}
	const effectiveStatus =
		latestCurrentRequest.status === "pending" &&
		temporalContext &&
		isVoiceSegmentPendingExpired(
			latestCurrentRequest,
			temporalContext.now,
			temporalContext.pendingLeaseMs,
		)
			? "indeterminate"
			: latestCurrentRequest.status === "completed" && latestUsableArtifact
				? "completed"
				: latestCurrentRequest.status;

	return {
		latestRequest,
		latestUsableArtifact,
		effectiveStatus,
	};
}

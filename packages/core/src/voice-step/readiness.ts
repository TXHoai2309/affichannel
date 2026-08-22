import {
	isVoiceSegmentArtifactUsable,
	sameVoiceSegmentFingerprint,
} from "../voice-segment/fingerprint";
import type {
	VoiceSegmentArtifact,
	VoiceSegmentArtifactReadModel,
	VoiceSegmentFingerprint,
} from "../voice-segment/types";

export type VoiceStepSegmentEvaluation = {
	segmentKey: string;
	text: string;
	fingerprint: VoiceSegmentFingerprint;
	readModel: VoiceSegmentArtifactReadModel;
};

export type VoiceStepReadinessInput = {
	factLockPassed: boolean;
	voiceConfigPresent: boolean;
	currentScriptVersionPresent: boolean;
	segments: VoiceStepSegmentEvaluation[];
};

export type VoiceStepSummary = {
	totalSegments: number;
	completedSegments: number;
	pendingSegments: number;
	staleSegments: number;
	totalVoiceoverDurationMs: number;
	ready: boolean;
	factLockPassed: boolean;
	voiceConfigPresent: boolean;
	currentScriptVersionPresent: boolean;
};

function currentUsableArtifact(
	segment: VoiceStepSegmentEvaluation,
): VoiceSegmentArtifact | null {
	const artifact = segment.readModel.latestUsableArtifact;
	if (!artifact) return null;
	if (!sameVoiceSegmentFingerprint(artifact, segment.fingerprint)) return null;
	return isVoiceSegmentArtifactUsable(artifact, segment.fingerprint)
		? artifact
		: null;
}

/**
 * Canonical Voice workflow predicate. The API supplies all inputs from the
 * authenticated workspace; this function never trusts browser state or audio
 * playback metadata.
 */
export function evaluateVoiceStepReadiness(
	input: VoiceStepReadinessInput,
): VoiceStepSummary {
	let completedSegments = 0;
	let pendingSegments = 0;
	let staleSegments = 0;
	let totalVoiceoverDurationMs = 0;

	for (const segment of input.segments) {
		const usableArtifact = currentUsableArtifact(segment);
		if (usableArtifact) {
			completedSegments += 1;
			totalVoiceoverDurationMs += usableArtifact.durationMs ?? 0;
		}
		if (segment.readModel.effectiveStatus === "pending") pendingSegments += 1;
		if (segment.readModel.effectiveStatus === "stale") staleSegments += 1;
	}

	const hasSegments = input.segments.length > 0;
	const ready =
		input.factLockPassed &&
		input.voiceConfigPresent &&
		input.currentScriptVersionPresent &&
		hasSegments &&
		completedSegments === input.segments.length;

	return {
		totalSegments: input.segments.length,
		completedSegments,
		pendingSegments,
		staleSegments,
		totalVoiceoverDurationMs,
		ready,
		factLockPassed: input.factLockPassed,
		voiceConfigPresent: input.voiceConfigPresent,
		currentScriptVersionPresent: input.currentScriptVersionPresent,
	};
}

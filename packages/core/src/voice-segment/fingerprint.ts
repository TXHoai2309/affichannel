import type { VoiceSegmentArtifact, VoiceSegmentFingerprint } from "./types";

export function sameVoiceSegmentFingerprint(
	left: VoiceSegmentFingerprint,
	right: VoiceSegmentFingerprint,
) {
	return (
		left.workspaceId === right.workspaceId &&
		left.projectId === right.projectId &&
		left.sourceScriptVersionId === right.sourceScriptVersionId &&
		left.sourceScriptRevision === right.sourceScriptRevision &&
		left.segmentKey === right.segmentKey &&
		left.textHash === right.textHash &&
		left.voiceConfigRevision === right.voiceConfigRevision &&
		left.provider === right.provider &&
		left.voiceId === right.voiceId &&
		left.language === right.language &&
		left.speed === right.speed
	);
}

export function isVoiceSegmentArtifactUsable(
	artifact: VoiceSegmentArtifact,
	current: VoiceSegmentFingerprint,
) {
	return (
		artifact.status === "completed" &&
		artifact.mimeType === "audio/mpeg" &&
		artifact.storageProvider !== null &&
		artifact.storageKey !== null &&
		artifact.byteSize !== null &&
		artifact.byteSize > 0 &&
		artifact.checksum !== null &&
		artifact.durationMs !== null &&
		artifact.durationMs > 0 &&
		sameVoiceSegmentFingerprint(artifact, current)
	);
}

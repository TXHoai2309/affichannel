export const voiceSegmentArtifactStatuses = [
	"pending",
	"completed",
	"failed",
	"indeterminate",
] as const;

export type VoiceSegmentArtifactStatus =
	(typeof voiceSegmentArtifactStatuses)[number];

export const voiceSegmentEffectiveStatuses = [
	"not_generated",
	"pending",
	"completed",
	"failed",
	"indeterminate",
	"stale",
] as const;

export type VoiceSegmentEffectiveStatus =
	(typeof voiceSegmentEffectiveStatuses)[number];

export type VoiceAudioStorageProvider = "local" | "r2";

export type VoiceSegmentFingerprint = {
	workspaceId: string;
	projectId: string;
	sourceScriptVersionId: string;
	sourceScriptRevision: number;
	segmentKey: string;
	textHash: string;
	voiceConfigRevision: number;
	provider: string;
	voiceId: string;
	language: string;
	speed: number;
};

export type VoiceSegmentArtifact = VoiceSegmentFingerprint & {
	id: string;
	createdByUserId: string;
	segmentTextSnapshot: string;
	idempotencyKey: string;
	requestHash: string;
	status: VoiceSegmentArtifactStatus;
	providerRequestId: string | null;
	errorCode: string | null;
	storageProvider: VoiceAudioStorageProvider | null;
	storageKey: string | null;
	mimeType: "audio/mpeg" | null;
	byteSize: number | null;
	checksum: string | null;
	durationMs: number | null;
	createdAt: Date;
	finishedAt: Date | null;
};

export type VoiceSegmentArtifactReadModel = {
	latestRequest: VoiceSegmentArtifact | null;
	latestUsableArtifact: VoiceSegmentArtifact | null;
	effectiveStatus: VoiceSegmentEffectiveStatus;
};

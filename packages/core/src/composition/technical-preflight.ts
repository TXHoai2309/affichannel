import type { CompositionInputV1 } from "./types";

export const technicalPreflightStatuses = [
	"VALID",
	"INVALID",
	"UNSUPPORTED",
	"UNKNOWN",
] as const;

export type TechnicalPreflightStatus =
	(typeof technicalPreflightStatuses)[number];

export const technicalPreflightReasonCodes = [
	"UNSUPPORTED_COMPOSITION_SCHEMA",
	"INVALID_COMPOSITION_STRUCTURE",
	"MISSING_MEDIA_OBJECT",
	"MEDIA_CHECKSUM_MISMATCH",
	"MEDIA_BYTE_SIZE_MISMATCH",
	"MEDIA_MIME_MISMATCH",
	"MEDIA_METADATA_MISMATCH",
	"MEDIA_FORMAT_UNSUPPORTED",
	"MISSING_VOICE_OBJECT",
	"VOICE_CHECKSUM_MISMATCH",
	"VOICE_BYTE_SIZE_MISMATCH",
	"VOICE_MIME_MISMATCH",
	"VOICE_AUDIO_METADATA_INVALID",
	"AUDIO_SAMPLE_DOMAIN_UNPROVABLE",
	"AUDIO_TIMING_NOT_FEASIBLE",
	"FONT_NOT_AVAILABLE",
	"FONT_CHECKSUM_MISMATCH",
	"FONT_METADATA_MISMATCH",
	"FONT_UNSUPPORTED",
	"DEPENDENCY_READ_UNAVAILABLE",
] as const;

export type TechnicalPreflightReasonCode =
	(typeof technicalPreflightReasonCodes)[number];

export type TechnicalMediaManifestFact = Readonly<{
	dependencyKey: string;
	mediaAssetId: string;
	byteSize: number;
	checksumSha256: string;
	mimeType: "image/jpeg" | "image/png" | "image/webp";
	width: number;
	height: number;
}>;

export type TechnicalVoiceManifestFact = Readonly<{
	segmentKey: string;
	artifactId: string;
	byteSize: number;
	checksum: string;
	mimeType: "audio/mpeg";
	sourceSampleRate: number;
	sourceSampleCount: string;
}>;

export type TechnicalFontManifestFact = Readonly<{
	fontStableId: string;
	family: "Noto Sans";
	weight: 400 | 600 | 700;
	style: "normal";
	format: "ttf";
	byteLength: number;
	sha256: string;
	glyphCodePoints: readonly number[];
}>;

export type TechnicalTimingManifestFact = Readonly<{
	trackId: string;
	sourceVoiceKey: string;
	startFrame: string;
	durationFrames: string;
	endFrame: string;
	trimStartSample: string;
	trimEndSample: string;
}>;

/** Ephemeral, hash-bound technical evidence. It is never persisted in 21B. */
export type CompositionTechnicalManifestV1 = Readonly<{
	schemaVersion: "composition-technical-manifest.v1";
	compositionFingerprint: string;
	media: readonly TechnicalMediaManifestFact[];
	voice: readonly TechnicalVoiceManifestFact[];
	fonts: readonly TechnicalFontManifestFact[];
	timing: readonly TechnicalTimingManifestFact[];
}>;

export type TechnicalPreflightResult = Readonly<{
	status: TechnicalPreflightStatus;
	retryable: boolean;
	reasonCode: TechnicalPreflightReasonCode | null;
	compositionVersionId: string | null;
	compositionFingerprint: string | null;
	issues: readonly string[];
	technicalManifest?: CompositionTechnicalManifestV1;
}>;

/** Short-lived protected handoff evidence; it contains no storage credential or key. */
export type CompositionPreviewDescriptorV1 = Readonly<{
	schemaVersion: "composition-preview-descriptor.v1";
	access: "protected";
	compositionVersionId: string;
	compositionFingerprint: string;
	technicalManifestFingerprint: string;
	expiresAt: string;
}>;

export type CompositionAudioTimingFacts = Readonly<{
	sourceSampleRate: number;
	sourceSampleCount: string;
}>;

export type CompositionAudioTimingCheck =
	| { ok: true }
	| { ok: false; reasonCode: "AUDIO_TIMING_NOT_FEASIBLE" };

function parseNonNegativeInteger(value: string) {
	if (!/^\d+$/.test(value)) return undefined;
	try {
		return BigInt(value);
	} catch {
		return undefined;
	}
}

/**
 * Exact audio feasibility for the frozen 30/1 profile. No tolerance, float,
 * resampling, clipping, or duration-derived sample estimates are permitted.
 */
export function checkCompositionAudioTiming(
	track: CompositionInputV1["sceneComposition"]["audioTracks"][number],
	facts: CompositionAudioTimingFacts,
	fps = { numerator: 30, denominator: 1 },
	totalFrames?: string,
): CompositionAudioTimingCheck {
	if (
		!Number.isSafeInteger(facts.sourceSampleRate) ||
		facts.sourceSampleRate <= 0
	)
		return { ok: false, reasonCode: "AUDIO_TIMING_NOT_FEASIBLE" };
	const startFrame = parseNonNegativeInteger(track.startFrame);
	const durationFrames = parseNonNegativeInteger(track.durationFrames);
	const endFrame = parseNonNegativeInteger(track.endFrame);
	const trimStartSample = parseNonNegativeInteger(track.trimStartSample);
	const trimEndSample = parseNonNegativeInteger(track.trimEndSample);
	const totalSourceSamples = parseNonNegativeInteger(facts.sourceSampleCount);
	const totalTimelineFrames = totalFrames
		? parseNonNegativeInteger(totalFrames)
		: undefined;
	if (
		startFrame === undefined ||
		durationFrames === undefined ||
		endFrame === undefined ||
		trimStartSample === undefined ||
		trimEndSample === undefined ||
		totalSourceSamples === undefined ||
		totalSourceSamples <= 0 ||
		trimStartSample >= trimEndSample ||
		trimEndSample > totalSourceSamples ||
		endFrame !== startFrame + durationFrames ||
		(totalTimelineFrames !== undefined && endFrame > totalTimelineFrames) ||
		startFrame < 0 ||
		fps.numerator <= 0 ||
		fps.denominator <= 0
	)
		return { ok: false, reasonCode: "AUDIO_TIMING_NOT_FEASIBLE" };

	const sampleSpan = trimEndSample - trimStartSample;
	if (
		sampleSpan * BigInt(fps.numerator) !==
		durationFrames * BigInt(facts.sourceSampleRate) * BigInt(fps.denominator)
	)
		return { ok: false, reasonCode: "AUDIO_TIMING_NOT_FEASIBLE" };
	return { ok: true };
}

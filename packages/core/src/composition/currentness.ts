import {
	canonicalizeCompositionJson,
	compositionSemanticProjection,
} from "./canonicalization";
import type { CompositionCurrentness, CompositionInputV1 } from "./types";

export type CompositionCurrentSource = {
	scriptVersionId: string;
	scriptRevision: number;
	voiceConfigRevision: number;
	voiceArtifactIds: readonly string[];
	voiceArtifactChecksums?: readonly string[];
	mediaChecksums: readonly string[];
	compositionProfileId: string;
	currentConfigSemantic?: unknown;
};

export function evaluateCompositionCurrentness(
	input: CompositionInputV1,
	current: CompositionCurrentSource,
): CompositionCurrentness {
	if (
		input.script.provenance.scriptVersionId !== current.scriptVersionId ||
		input.script.provenance.revision !== current.scriptRevision
	)
		return { state: "STALE", reason: "SCRIPT_REVISION_CHANGED" };
	if (input.voice.provenance.configRevision !== current.voiceConfigRevision)
		return { state: "STALE", reason: "VOICE_SOURCE_CHANGED" };
	if (
		input.voice.provenance.segments.some(
			(segment) => !current.voiceArtifactIds.includes(segment.artifactId),
		)
	)
		return { state: "STALE", reason: "VOICE_SOURCE_CHANGED" };
	if (current.voiceArtifactChecksums) {
		const checksums = input.voice.semantic.segments.map(
			(segment) => segment.checksum,
		);
		if (
			checksums.length !== current.voiceArtifactChecksums.length ||
			checksums.some(
				(value, index) => value !== current.voiceArtifactChecksums?.[index],
			)
		)
			return { state: "STALE", reason: "VOICE_SOURCE_CHANGED" };
	}
	const checksums = input.media.map((item) => item.semantic.checksumSha256);
	if (
		checksums.length !== current.mediaChecksums.length ||
		checksums.some((value, index) => value !== current.mediaChecksums[index])
	)
		return { state: "STALE", reason: "MEDIA_BINARY_CHANGED" };
	if (input.profile.id !== current.compositionProfileId)
		return { state: "STALE", reason: "PROFILE_MISMATCH" };
	if (
		current.currentConfigSemantic !== undefined &&
		canonicalizeCompositionJson(input.config.semantic) !==
			canonicalizeCompositionJson(current.currentConfigSemantic)
	)
		return { state: "STALE", reason: "CONFIG_CHANGED" };
	return { state: "CURRENT" };
}

export function compositionSemanticFingerprintProjection(
	input: CompositionInputV1,
) {
	return compositionSemanticProjection(input);
}

export function canonicalCompositionSemanticJson(input: CompositionInputV1) {
	return canonicalizeCompositionJson(
		compositionSemanticFingerprintProjection(input),
	);
}

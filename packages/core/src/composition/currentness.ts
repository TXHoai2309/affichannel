import {
	canonicalizeCompositionJson,
	compositionSemanticProjection,
} from "./canonicalization";
import {
	type CompositionCurrentness,
	type CompositionInputV1,
	renderedVoiceKeysForComposition,
} from "./types";

export type CompositionCurrentSource = {
	scriptVersionId: string;
	scriptRevision: number;
	voiceConfigRevision: number;
	voiceArtifactIds: readonly string[];
	voiceArtifactChecksums?: readonly string[];
	mediaChecksums: readonly string[];
	voiceArtifactRefs?: readonly {
		segmentKey: string;
		artifactId: string;
		checksum: string;
	}[];
	mediaDependencyRefs?: readonly {
		dependencyKey: string;
		checksumSha256: string;
	}[];
	compositionProfileId: string;
	/** Retained for compatibility; v1 has no unmaterialized render config. */
	currentConfigSemantic?: unknown;
};

function sameKeyedValues<T extends { [key: string]: string }>(
	left: readonly T[],
	right: readonly T[],
	key: keyof T,
) {
	if (left.length !== right.length) return false;
	const rightByKey = new Map(right.map((value) => [value[key], value]));
	return left.every((value) => {
		const counterpart = rightByKey.get(value[key]);
		return (
			counterpart !== undefined &&
			Object.entries(value).every(
				([field, fieldValue]) => counterpart[field] === fieldValue,
			)
		);
	});
}

export function evaluateCompositionCurrentness(
	input: CompositionInputV1,
	current: CompositionCurrentSource,
): CompositionCurrentness {
	const renderedVoiceKeys = renderedVoiceKeysForComposition(input);
	const renderedVoiceSegments = input.voice.segments.filter((segment) =>
		renderedVoiceKeys.has(segment.segmentKey),
	);
	if (
		input.script.provenance.scriptVersionId !== current.scriptVersionId ||
		input.script.provenance.revision !== current.scriptRevision
	)
		return { state: "STALE", reason: "SCRIPT_REVISION_CHANGED" };
	if (renderedVoiceKeys.size > 0) {
		if (
			renderedVoiceSegments[0]?.provenance.configRevision !==
			current.voiceConfigRevision
		)
			return { state: "STALE", reason: "VOICE_SOURCE_CHANGED" };
		if (current.voiceArtifactRefs) {
			const inputVoiceRefs = renderedVoiceSegments.map((segment) => ({
				segmentKey: segment.segmentKey,
				artifactId: segment.provenance.artifactId,
				checksum: segment.semantic.checksum,
			}));
			const currentVoiceRefs = current.voiceArtifactRefs.filter((ref) =>
				renderedVoiceKeys.has(ref.segmentKey),
			);
			if (!sameKeyedValues(inputVoiceRefs, currentVoiceRefs, "segmentKey"))
				return { state: "STALE", reason: "VOICE_SOURCE_CHANGED" };
		} else if (
			renderedVoiceSegments.some(
				(segment) =>
					!current.voiceArtifactIds.includes(segment.provenance.artifactId),
			)
		)
			return { state: "STALE", reason: "VOICE_SOURCE_CHANGED" };
		if (current.voiceArtifactChecksums && !current.voiceArtifactRefs) {
			const checksums = renderedVoiceSegments.map(
				(segment) => segment.semantic.checksum,
			);
			if (
				checksums.length !== current.voiceArtifactChecksums.length ||
				checksums.some(
					(value, index) => value !== current.voiceArtifactChecksums?.[index],
				)
			)
				return { state: "STALE", reason: "VOICE_SOURCE_CHANGED" };
		}
	}
	if (current.mediaDependencyRefs) {
		const inputMediaRefs = input.media.map((item) => ({
			dependencyKey: item.dependencyKey,
			checksumSha256: item.semantic.checksumSha256,
		}));
		if (
			!sameKeyedValues(
				inputMediaRefs,
				current.mediaDependencyRefs,
				"dependencyKey",
			)
		)
			return { state: "STALE", reason: "MEDIA_BINARY_CHANGED" };
	}
	if (!current.mediaDependencyRefs) {
		const checksums = input.media.map((item) => item.semantic.checksumSha256);
		if (
			checksums.length !== current.mediaChecksums.length ||
			checksums.some((value, index) => value !== current.mediaChecksums[index])
		)
			return { state: "STALE", reason: "MEDIA_BINARY_CHANGED" };
	}
	if (input.profile.id !== current.compositionProfileId)
		return { state: "STALE", reason: "PROFILE_MISMATCH" };
	// Output Rules and other generation/business settings are audit inputs only
	// after materialization. They do not make a v1 composition stale.
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

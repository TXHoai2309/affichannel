import { canonicalizeJson } from "../script-generation/canonical-json";
import type { CompositionInputV1 } from "./types";

const decimalInteger = /^0$|^[1-9][0-9]*$/;

function compareStableKey(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeCompositionValue(value: unknown, path: string): unknown {
	if (typeof value === "bigint") return value.toString(10);
	if (typeof value === "string") {
		const normalized = value.normalize("NFC");
		if (/Frame$|Sample$|Frames$|Samples$/.test(path)) {
			if (!decimalInteger.test(normalized))
				throw new Error(`Invalid integer timing at ${path}`);
		}
		return normalized;
	}
	if (Array.isArray(value))
		return value.map((item, index) =>
			normalizeCompositionValue(item, `${path}[${index}]`),
		);
	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value))
			output[key] = normalizeCompositionValue(item, `${path}.${key}`);
		return output;
	}
	return value;
}

/** Composition-only canonicalization: NFC strings plus decimal timing values. */
export function canonicalizeCompositionJson(value: unknown): string {
	return canonicalizeJson(normalizeCompositionValue(value, "$"));
}

/**
 * Fingerprint only materialized render semantics. Script audit metadata,
 * publishing fields, and database identities are deliberately excluded.
 */
export function compositionSemanticProjection(input: CompositionInputV1) {
	const renderedVoiceKeys = new Set(
		input.sceneComposition.audioTracks.map((track) => track.sourceVoiceKey),
	);
	const renderedMediaKeys = new Set(
		input.sceneComposition.scenes.flatMap((scene) =>
			scene.layers.flatMap((layer) =>
				layer.kind === "MEDIA" ? [layer.sourceMediaKey] : [],
			),
		),
	);
	const renderedFontIds = new Set(
		input.sceneComposition.scenes.flatMap((scene) =>
			scene.layers.flatMap((layer) =>
				layer.kind === "TEXT" ? [layer.fontStableId] : [],
			),
		),
	);
	const sceneComposition = {
		...input.sceneComposition,
		audioTracks: [...input.sceneComposition.audioTracks].sort((left, right) =>
			compareStableKey(left.trackId, right.trackId),
		),
	};

	return {
		profile: input.profile,
		timeline: input.timeline,
		sceneComposition,
		voice: {
			segments: input.voice.segments
				.filter((segment) => renderedVoiceKeys.has(segment.segmentKey))
				.sort((left, right) =>
					compareStableKey(left.segmentKey, right.segmentKey),
				)
				.map((segment) => ({
					segmentKey: segment.segmentKey,
					checksum: segment.semantic.checksum,
				})),
		},
		media: input.media
			.filter((media) => renderedMediaKeys.has(media.dependencyKey))
			.sort((left, right) =>
				compareStableKey(left.dependencyKey, right.dependencyKey),
			)
			.map((media) => ({
				dependencyKey: media.dependencyKey,
				checksumSha256: media.semantic.checksumSha256,
			})),
		fonts: input.fonts.faces
			.filter((face) => renderedFontIds.has(face.fontId))
			.sort((left, right) => compareStableKey(left.fontId, right.fontId))
			.map((face) => ({
				fontId: face.fontId,
				contentSha256: face.contentSha256,
			})),
	};
}

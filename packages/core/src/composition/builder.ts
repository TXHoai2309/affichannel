import type { z } from "zod";
import { sha256Hex } from "../claim-manifest/canonicalization";
import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import {
	canonicalizeCompositionJson,
	compositionSemanticProjection,
} from "./canonicalization";
import { fontBundleManifestSchema, VERTICAL_STANDARD_PROFILE } from "./profile";
import {
	type CompositionInputV1,
	type CompositionInputV1Result,
	compositionInputV1Schema,
} from "./types";

const decimalInteger = /^0$|^[1-9][0-9]*$/;

export type CompositionInputBuilderSource = Omit<
	CompositionInputV1,
	"schemaVersion" | "profile"
> & {
	profile?: CompositionInputV1["profile"];
};

function issueLooksMissing(issue: z.ZodIssue) {
	return (
		(issue.code === "invalid_type" &&
			/received (undefined|null)$/.test(issue.message)) ||
		(issue.code === "custom" &&
			issue.path.join(".") === "script.semantic.selectedHookKey" &&
			issue.message === "Composition requires one selected hook to render.")
	);
}

function classifyIssues(issues: readonly z.ZodIssue[]) {
	return issues.some((issue) => !issueLooksMissing(issue))
		? ("COMPOSITION_INPUT_INVALID" as const)
		: ("COMPOSITION_INPUT_INCOMPLETE" as const);
}

const FALLBACK_FONT_HASH = "0".repeat(64);

function fallbackFontFace(index: number, fontId?: string) {
	return {
		family: "Noto Sans",
		weight: ([400, 600, 700] as const)[index] ?? 400,
		style: "normal",
		fontId: fontId ?? `missing-font-${index}`,
		contentSha256: FALLBACK_FONT_HASH,
	};
}

function fallbackFontsForCandidate(candidate: Record<string, unknown>) {
	const idsByWeight = new Map<number, string>();
	const sceneComposition = candidate.sceneComposition;
	if (typeof sceneComposition === "object" && sceneComposition !== null) {
		const scenes = (sceneComposition as Record<string, unknown>).scenes;
		if (Array.isArray(scenes)) {
			for (const scene of scenes) {
				if (typeof scene !== "object" || scene === null) continue;
				const layers = (scene as Record<string, unknown>).layers;
				if (!Array.isArray(layers)) continue;
				for (const layer of layers) {
					if (typeof layer !== "object" || layer === null) continue;
					const layerRecord = layer as Record<string, unknown>;
					if (
						layerRecord.kind === "TEXT" &&
						typeof layerRecord.fontWeight === "number" &&
						typeof layerRecord.fontStableId === "string"
					)
						idsByWeight.set(layerRecord.fontWeight, layerRecord.fontStableId);
				}
			}
		}
	}
	return [400, 600, 700].map((weight, index) =>
		fallbackFontFace(index, idsByWeight.get(weight)),
	);
}

/**
 * Zod does not run the root cross-field refinement when a nested required
 * object is absent. Validate once more with only missing font metadata filled
 * by inert placeholders so an invalid geometry/reference cannot be hidden by
 * an incomplete font pin. The original candidate is still the value returned
 * and remains incomplete when no contradiction exists.
 */
function withMissingFontPlaceholders(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return value;
	const candidate = { ...(value as Record<string, unknown>) };
	const fonts = candidate.fonts;
	if (typeof fonts !== "object" || fonts === null || Array.isArray(fonts)) {
		candidate.fonts = {
			bundleId: "affichannel-fonts-v1",
			faces: fallbackFontsForCandidate(candidate),
		};
		return candidate;
	}
	const fontRecord = { ...(fonts as Record<string, unknown>) };
	const faces = fontRecord.faces;
	if (!Array.isArray(faces)) {
		fontRecord.faces = fallbackFontsForCandidate(candidate);
	} else {
		fontRecord.faces = faces.map((face) => {
			if (typeof face !== "object" || face === null || Array.isArray(face))
				return face;
			const faceRecord = { ...(face as Record<string, unknown>) };
			if (
				faceRecord.contentSha256 === undefined ||
				faceRecord.contentSha256 === null
			)
				faceRecord.contentSha256 = FALLBACK_FONT_HASH;
			return faceRecord;
		});
	}
	candidate.fonts = fontRecord;
	return candidate;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function decimalValue(value: unknown): bigint | undefined {
	if (typeof value !== "string" || !decimalInteger.test(value))
		return undefined;
	try {
		return BigInt(value);
	} catch {
		return undefined;
	}
}

/** Detect contradictions that a missing child object could otherwise mask. */
function hasKnownCompositionContradiction(value: unknown) {
	const candidate = record(value);
	if (!candidate) return false;
	const profile = record(candidate.profile);
	const timeline = record(candidate.timeline);
	const totalFrames = decimalValue(timeline?.totalFrames);
	const sceneComposition = record(candidate.sceneComposition);
	const scenes = sceneComposition?.scenes;
	if (Array.isArray(scenes)) {
		for (const sceneValue of scenes) {
			const scene = record(sceneValue);
			const layers = scene?.layers;
			if (!Array.isArray(layers)) continue;
			let previousZ: number | undefined;
			const timelineScenes = Array.isArray(timeline?.scenes)
				? timeline.scenes
				: [];
			const timing = timelineScenes
				.map(record)
				.find((item) => item?.sceneKey === scene?.sceneKey);
			const sceneDuration = decimalValue(timing?.durationFrames);
			for (const layerValue of layers) {
				const layer = record(layerValue);
				if (!layer) continue;
				if (
					typeof layer.zIndex === "number" &&
					previousZ !== undefined &&
					previousZ >= layer.zIndex
				)
					return true;
				if (typeof layer.zIndex === "number") previousZ = layer.zIndex;
				const box = record(layer.box);
				if (
					box &&
					profile &&
					typeof box.xPx === "number" &&
					typeof box.yPx === "number" &&
					typeof box.widthPx === "number" &&
					typeof box.heightPx === "number" &&
					typeof profile.logicalWidth === "number" &&
					typeof profile.logicalHeight === "number" &&
					(box.xPx < 0 ||
						box.yPx < 0 ||
						box.xPx + box.widthPx > profile.logicalWidth ||
						box.yPx + box.heightPx > profile.logicalHeight)
				)
					return true;
				const start = decimalValue(layer.startOffsetFrame);
				const duration = decimalValue(layer.durationFrames);
				if (
					sceneDuration !== undefined &&
					start !== undefined &&
					duration !== undefined &&
					start + duration > sceneDuration
				)
					return true;
			}
		}
	}
	const tracks = sceneComposition?.audioTracks;
	if (Array.isArray(tracks)) {
		for (const trackValue of tracks) {
			const track = record(trackValue);
			if (!track) continue;
			const start = decimalValue(track.startFrame);
			const duration = decimalValue(track.durationFrames);
			const end = decimalValue(track.endFrame);
			if (
				start !== undefined &&
				duration !== undefined &&
				end !== undefined &&
				(end !== start + duration ||
					(totalFrames !== undefined && end > totalFrames))
			)
				return true;
		}
	}
	const fonts = record(candidate.fonts);
	if (Array.isArray(fonts?.faces)) {
		const ids = fonts.faces
			.map(record)
			.map((face) => face?.fontId)
			.filter((fontId): fontId is string => typeof fontId === "string");
		if (new Set(ids).size !== ids.length) return true;
	}
	const script = record(candidate.script);
	const scriptProvenance = record(script?.provenance);
	const voice = record(candidate.voice);
	if (Array.isArray(voice?.segments)) {
		const segments = voice.segments.map(record);
		for (const segment of segments) {
			const provenance = record(segment?.provenance);
			if (
				provenance &&
				((typeof scriptProvenance?.scriptVersionId === "string" &&
					provenance.sourceScriptVersionId !==
						scriptProvenance.scriptVersionId) ||
					(typeof scriptProvenance?.revision === "number" &&
						provenance.sourceScriptRevision !== scriptProvenance.revision))
			)
				return true;
		}
		const first = record(segments[0]?.provenance);
		if (first) {
			for (const segment of segments.slice(1)) {
				const provenance = record(segment?.provenance);
				if (
					provenance &&
					(provenance.configId !== first.configId ||
						provenance.configRevision !== first.configRevision ||
						provenance.provider !== first.provider ||
						provenance.voiceId !== first.voiceId ||
						provenance.language !== first.language ||
						provenance.speed !== first.speed)
				)
					return true;
			}
		}
	}
	const media = candidate.media;
	if (Array.isArray(media)) {
		for (const mediaValue of media) {
			const mediaDependency = record(mediaValue);
			const provenance = record(mediaDependency?.provenance);
			if (
				provenance &&
				((typeof candidate.workspaceId === "string" &&
					provenance.workspaceId !== candidate.workspaceId) ||
					(typeof candidate.projectId === "string" &&
						provenance.projectId !== candidate.projectId))
			)
				return true;
		}
	}
	return false;
}

export async function buildCompositionInputV1(
	source: CompositionInputBuilderSource,
): Promise<CompositionInputV1Result> {
	const candidate = {
		...source,
		schemaVersion: "composition-input.v1" as const,
		profile: source.profile ?? VERTICAL_STANDARD_PROFILE,
	};
	const parsed = compositionInputV1Schema.safeParse(candidate);
	if (!parsed.success) {
		const repairedParse = compositionInputV1Schema.safeParse(
			withMissingFontPlaceholders(candidate),
		);
		const issues = [
			...parsed.error.issues,
			...(repairedParse.success ? [] : repairedParse.error.issues),
		];
		return {
			ok: false,
			code: hasKnownCompositionContradiction(candidate)
				? "COMPOSITION_INPUT_INVALID"
				: classifyIssues(issues),
			issues: issues.map((issue) => issue.path.join(".")),
		};
	}
	const script = scriptVersionEditableSnapshotSchema.safeParse(
		parsed.data.script.semantic,
	);
	const fonts = fontBundleManifestSchema.safeParse(parsed.data.fonts);
	if (!script.success || !fonts.success)
		return { ok: false, code: "COMPOSITION_INPUT_INVALID" };
	const projection = compositionSemanticProjection(parsed.data);
	return {
		ok: true,
		input: parsed.data,
		fingerprint: await sha256Hex(canonicalizeCompositionJson(projection)),
	};
}

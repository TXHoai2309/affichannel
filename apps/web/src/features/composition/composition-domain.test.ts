import { compositionRouter } from "@affichannel/api/routers/composition";
import { assembleCompositionInputV1 } from "@affichannel/api/services/composition-assembly-service";
import {
	evaluateCompositionBusinessPreflight,
	isCompositionMediaEligible,
} from "@affichannel/api/services/composition-preflight-service";
import {
	buildCompositionInputV1,
	type CompositionInputBuilderSource,
	canonicalizeCompositionJson,
	canonicalRequestHash,
	compositionInputV1Schema,
	compositionSemanticProjection,
	evaluateCompositionCurrentness,
	fingerprintOutputEncodingProfile,
	MP4_H264_AAC_V1,
	type RenderRequestSpecV1,
	VERTICAL_STANDARD_PROFILE,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const HASH = "a".repeat(64);

function script() {
	return {
		schemaVersion: "script-draft.v2" as const,
		language: "vi-VN",
		hookVariants: [{ key: "hook-a", text: "Một hook" }],
		selectedHookKey: "hook-a",
		voiceoverSegments: [{ key: "voice-a", text: "Một đoạn thoại" }],
		scenes: [
			{
				order: 1,
				durationSeconds: 15,
				visualDirection: "Cận cảnh",
				onScreenText: "Xin chào",
				voiceoverSegmentKeys: ["voice-a"],
			},
		],
		cta: { text: "Mua ngay" },
		caption: "Mô tả",
		hashtags: ["#demo"],
		disclosure: "",
		claims: [],
		claimsSourceRevision: 1,
		claimsStatus: "current" as const,
	};
}

function source(
	overrides: Partial<CompositionInputBuilderSource> = {},
): CompositionInputBuilderSource {
	return {
		workspaceId: "w1",
		projectId: "p1",
		script: {
			semantic: script(),
			provenance: {
				scriptVersionId: "sv1",
				revision: 1,
				status: "draft",
				versionNumber: null,
			},
		},
		voice: {
			segments: [
				{
					segmentKey: "voice-a",
					semantic: {
						checksum: HASH,
						mimeType: "audio/mpeg",
						byteSize: 10,
						sourceSampleRate: 48000,
						sourceSampleCount: "24000",
						durationMs: 500,
					},
					provenance: {
						artifactId: "va1",
						sourceScriptVersionId: "sv1",
						sourceScriptRevision: 1,
						textSnapshot: "Một đoạn thoại",
						textHash: HASH,
						configId: "vc1",
						configRevision: 1,
						provider: "apikeyfun",
						voiceId: "vi-1",
						language: "vi-VN",
						speed: 1,
						storageProvider: "local",
					},
				},
			],
		},
		media: [
			{
				dependencyKey: "media-background",
				role: "background",
				semantic: {
					mediaType: "image",
					mimeType: "image/png",
					checksumSha256: HASH,
					byteSize: 100,
					width: 1080,
					height: 1920,
					durationMs: null,
				},
				provenance: { mediaAssetId: "ma1", workspaceId: "w1", projectId: "p1" },
			},
		],
		fonts: {
			bundleId: "affichannel-fonts-v1",
			faces: [
				{
					family: "Noto Sans",
					weight: 400,
					style: "normal",
					fontId: "noto-400",
					contentSha256: HASH,
				},
				{
					family: "Noto Sans",
					weight: 600,
					style: "normal",
					fontId: "noto-600",
					contentSha256: HASH,
				},
				{
					family: "Noto Sans",
					weight: 700,
					style: "normal",
					fontId: "noto-700",
					contentSha256: HASH,
				},
			],
		},
		config: {
			semantic: {
				compositionProfileId: "vertical-standard-v1",
				outputRules: {
					language: "vi-VN",
					aspectRatio: "9:16",
					subtitleSafeArea: "standard",
					claimLimit: 3,
					requireFinalCta: true,
				},
			},
			provenance: { outputRulesRevision: null },
		},
		timeline: {
			fps: { numerator: 30, denominator: 1 },
			totalFrames: "450",
			scenes: [
				{
					sceneKey: "scene-1",
					order: 1,
					startFrame: "0",
					durationFrames: "450",
				},
			],
		},
		sceneComposition: {
			version: "scene-composition.v1",
			scenes: [
				{
					sceneKey: "scene-1",
					layers: [
						{
							kind: "MEDIA",
							layerId: "layer-media",
							zIndex: 0,
							startOffsetFrame: "0",
							durationFrames: "450",
							box: { xPx: 0, yPx: 0, widthPx: 1080, heightPx: 1920 },
							opacityBasisPoints: 10000,
							sourceMediaKey: "media-background",
							fit: "COVER",
							objectPositionXBasisPoints: 5000,
							objectPositionYBasisPoints: 5000,
						},
						{
							kind: "TEXT",
							layerId: "layer-text",
							zIndex: 1,
							startOffsetFrame: "0",
							durationFrames: "450",
							box: { xPx: 90, yPx: 120, widthPx: 900, heightPx: 120 },
							opacityBasisPoints: 10000,
							text: "Xin chào",
							fontStableId: "noto-700",
							fontWeight: 700,
							fontStyle: "normal",
							fontSizePx: 64,
							lineHeightPx: 80,
							textAlign: "CENTER",
							colorRgba: { r: 255, g: 255, b: 255, a: 255 },
							maxLines: 2,
							textLayoutVersion: "affichannel-text-layout-v1",
						},
					],
				},
			],
			audioTracks: [
				{
					trackId: "track-voice-a",
					sourceVoiceKey: "voice-a",
					startFrame: "0",
					durationFrames: "15",
					endFrame: "15",
					trimStartSample: "0",
					trimEndSample: "24000",
					gainMilliDb: 0,
					panBasisPoints: 0,
					fadeInSamples: "0",
					fadeOutSamples: "0",
				},
			],
		},
		...overrides,
	};
}

async function built() {
	const result = await buildCompositionInputV1(source());
	if (!result.ok) throw new Error(result.code);
	return result;
}

async function builtVideoOnly() {
	const draft = structuredClone(source());
	draft.sceneComposition.audioTracks = [];
	const result = await buildCompositionInputV1(draft);
	if (!result.ok) throw new Error(result.code);
	return result;
}

function twoVoiceSource() {
	const draft = structuredClone(source());
	draft.script.semantic.voiceoverSegments.push({
		key: "voice-b",
		text: "Đoạn thoại thứ hai",
	});
	draft.script.semantic.scenes[0].voiceoverSegmentKeys.push("voice-b");
	const firstVoice = draft.voice.segments[0];
	draft.voice.segments = [
		{
			...firstVoice,
			segmentKey: "voice-b",
			provenance: { ...firstVoice.provenance, artifactId: "va2" },
		},
		firstVoice,
	];
	const firstTrack = draft.sceneComposition.audioTracks[0];
	draft.sceneComposition.audioTracks = [
		{
			...firstTrack,
			trackId: "track-voice-b",
			sourceVoiceKey: "voice-b",
			startFrame: "15",
			endFrame: "30",
		},
		firstTrack,
	];
	return draft;
}

function mutated(mutator: (draft: CompositionInputBuilderSource) => void) {
	const draft = structuredClone(source());
	mutator(draft);
	return draft;
}

describe("CompositionInputV1", () => {
	it("validates the frozen profile and exact timing authority", async () => {
		const result = await built();
		expect(compositionInputV1Schema.parse(result.input).profile).toEqual(
			VERTICAL_STANDARD_PROFILE,
		);
		expect(result.input.timeline.totalFrames).toBe("450");
	});

	it("materializes the exact scene, visual-layer, and audio-track plan", async () => {
		const result = await built();
		if (!result.ok) throw new Error("fixture incomplete");
		expect(result.input.sceneComposition).toMatchObject({
			version: "scene-composition.v1",
			scenes: [
				{
					sceneKey: "scene-1",
					layers: expect.arrayContaining([
						expect.objectContaining({
							kind: "MEDIA",
							sourceMediaKey: "media-background",
							fit: "COVER",
						}),
						expect.objectContaining({
							kind: "TEXT",
							fontStableId: "noto-700",
							textLayoutVersion: "affichannel-text-layout-v1",
						}),
					]),
				},
			],
			audioTracks: [
				{
					trackId: "track-voice-a",
					gainMilliDb: 0,
					panBasisPoints: 0,
					fadeInSamples: "0",
					fadeOutSamples: "0",
				},
			],
		});
	});

	it("keeps each voice segment's source facts and provenance in one record", async () => {
		const result = await built();
		if (!result.ok) throw new Error("fixture incomplete");
		expect(result.input.voice.segments).toHaveLength(1);
		expect(result.input.voice.segments[0]).toMatchObject({
			segmentKey: "voice-a",
			semantic: {
				checksum: HASH,
				sourceSampleRate: 48000,
				sourceSampleCount: "24000",
			},
			provenance: {
				artifactId: "va1",
				sourceScriptVersionId: "sv1",
				sourceScriptRevision: 1,
			},
		});
		expect(result.input.voice).not.toHaveProperty("semantic.segments");
		expect(result.input.voice).not.toHaveProperty("provenance.segments");
		expect(result.input.voice.segments[0].semantic).not.toHaveProperty(
			"timing",
		);
	});

	it("fails closed when voice timing or fonts are incomplete", async () => {
		const noFonts = await buildCompositionInputV1({
			...source(),
			fonts: null as never,
		});
		expect(noFonts.ok).toBe(false);
		if (!noFonts.ok) expect(noFonts.code).toBe("COMPOSITION_INPUT_INCOMPLETE");
		const noTiming = await buildCompositionInputV1({
			...source(),
			voice: {
				...source().voice,
				segments: [
					{
						...source().voice.segments[0],
						semantic: {
							...source().voice.segments[0].semantic,
							sourceSampleCount: undefined as never,
						},
					},
				],
			},
		});
		expect(noTiming.ok).toBe(false);
		if (!noTiming.ok)
			expect(noTiming.code).toBe("COMPOSITION_INPUT_INCOMPLETE");
		const noSelectedHook = await buildCompositionInputV1(
			mutated((draft) => {
				draft.script.semantic.selectedHookKey = null;
			}),
		);
		expect(noSelectedHook).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INCOMPLETE",
		});
	});

	it("classifies malformed references and contradictory timing as INVALID", async () => {
		const missingMediaReference = await buildCompositionInputV1(
			mutated((draft) => {
				const layer = draft.sceneComposition.scenes[0].layers[0];
				if (layer.kind !== "MEDIA") throw new Error("fixture layer kind");
				layer.sourceMediaKey = "missing-media";
			}),
		);
		expect(missingMediaReference).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INVALID",
		});
		const duplicateLayerId = await buildCompositionInputV1(
			mutated((draft) => {
				draft.sceneComposition.scenes[0].layers[1].layerId = "layer-media";
			}),
		);
		expect(duplicateLayerId).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INVALID",
		});
		const invalidTiming = await buildCompositionInputV1(
			mutated((draft) => {
				draft.sceneComposition.scenes[0].layers[0].durationFrames = "451";
			}),
		);
		expect(invalidTiming).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INVALID",
		});
	});

	it("rejects voice lineage, provider/config, and audio boundary contradictions", async () => {
		const scriptMismatch = await buildCompositionInputV1(
			mutated((draft) => {
				draft.voice.segments[0].provenance.sourceScriptVersionId = "sv-other";
			}),
		);
		const revisionMismatch = await buildCompositionInputV1(
			mutated((draft) => {
				draft.voice.segments[0].provenance.sourceScriptRevision = 2;
			}),
		);
		const providerMismatch = await buildCompositionInputV1(
			(() => {
				const draft = twoVoiceSource();
				draft.voice.segments[1].provenance.voiceId = "vi-other";
				return draft;
			})(),
		);
		const endMismatch = await buildCompositionInputV1(
			mutated((draft) => {
				draft.sceneComposition.audioTracks[0].endFrame = "14";
			}),
		);
		const overflow = await buildCompositionInputV1(
			mutated((draft) => {
				draft.sceneComposition.audioTracks[0].durationFrames = "451";
				draft.sceneComposition.audioTracks[0].endFrame = "451";
			}),
		);
		for (const result of [
			scriptMismatch,
			revisionMismatch,
			providerMismatch,
			endMismatch,
			overflow,
		])
			expect(result).toMatchObject({
				ok: false,
				code: "COMPOSITION_INPUT_INVALID",
			});
	});

	it("classifies missing plus invalid input as INVALID, not INCOMPLETE", async () => {
		const result = await buildCompositionInputV1(
			mutated((draft) => {
				draft.fonts = null as never;
				draft.sceneComposition.scenes[0].layers[0].box.widthPx = 1081;
			}),
		);
		expect(result).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INVALID",
		});
	});

	it("rejects duplicate font IDs and descending visual z-order", async () => {
		const duplicateFontId = await buildCompositionInputV1(
			mutated((draft) => {
				draft.fonts.faces[1].fontId = draft.fonts.faces[0].fontId;
			}),
		);
		const descendingZIndex = await buildCompositionInputV1(
			mutated((draft) => {
				draft.sceneComposition.scenes[0].layers[1].zIndex = -1;
			}),
		);
		expect(duplicateFontId).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INVALID",
		});
		expect(descendingZIndex).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INVALID",
		});
	});

	it("canonicalizes semantic input while excluding provenance-only identity", async () => {
		const first = await built();
		const second = await buildCompositionInputV1({
			...source(),
			media: [
				{
					...source().media[0],
					provenance: {
						...source().media[0].provenance,
						mediaAssetId: "ma-other",
					},
				},
			],
		});
		if (!second.ok || !first.ok) throw new Error("fixture incomplete");
		expect(second.fingerprint).toBe(first.fingerprint);
	});

	it("changes fingerprint for semantic media changes", async () => {
		const first = await built();
		const second = await buildCompositionInputV1({
			...source(),
			media: [
				{
					...source().media[0],
					semantic: {
						...source().media[0].semantic,
						checksumSha256: "b".repeat(64),
					},
				},
			],
		});
		if (!second.ok) throw new Error("fixture incomplete");
		expect(second.fingerprint).not.toBe(first.fingerprint);
	});

	it("fingerprints only rendered semantics and materialized timing/geometry", async () => {
		const first = await built();
		const geometryChanged = await buildCompositionInputV1(
			mutated((draft) => {
				draft.sceneComposition.scenes[0].layers[0].box.widthPx = 1000;
			}),
		);
		const zIndexChanged = await buildCompositionInputV1(
			mutated((draft) => {
				draft.sceneComposition.scenes[0].layers[1].zIndex = 2;
			}),
		);
		const audioPlacementChanged = await buildCompositionInputV1(
			mutated((draft) => {
				const track = draft.sceneComposition.audioTracks[0];
				track.startFrame = "1";
				track.endFrame = "16";
			}),
		);
		const renderedTextChanged = await buildCompositionInputV1(
			mutated((draft) => {
				const layer = draft.sceneComposition.scenes[0].layers[1];
				if (layer.kind !== "TEXT") throw new Error("fixture layer kind");
				layer.text = "Nội dung khác";
			}),
		);
		const hashtagsChanged = await buildCompositionInputV1(
			mutated((draft) => {
				draft.script.semantic.hashtags = ["#khac"];
			}),
		);
		const unselectedHookChanged = await buildCompositionInputV1(
			mutated((draft) => {
				draft.script.semantic.hookVariants.push({
					key: "hook-b",
					text: "Hook không chọn",
				});
			}),
		);
		const unrenderedCtaChanged = await buildCompositionInputV1(
			mutated((draft) => {
				draft.script.semantic.cta.text = "CTA không materialize";
			}),
		);
		const generationOnlyOutputRulesChanged = await buildCompositionInputV1(
			mutated((draft) => {
				draft.config.semantic.outputRules.claimLimit = 4;
			}),
		);
		const voiceProvenanceChanged = await buildCompositionInputV1(
			mutated((draft) => {
				draft.voice.segments[0].provenance.voiceId = "voice-provenance-only";
				draft.voice.segments[0].provenance.speed = 1.2;
			}),
		);
		const usedFontChanged = await buildCompositionInputV1(
			mutated((draft) => {
				draft.fonts.faces[2].contentSha256 = "b".repeat(64);
			}),
		);
		if (
			!first.ok ||
			!geometryChanged.ok ||
			!zIndexChanged.ok ||
			!audioPlacementChanged.ok ||
			!renderedTextChanged.ok ||
			!hashtagsChanged.ok ||
			!unselectedHookChanged.ok ||
			!unrenderedCtaChanged.ok ||
			!generationOnlyOutputRulesChanged.ok ||
			!voiceProvenanceChanged.ok ||
			!usedFontChanged.ok
		)
			throw new Error("fixture incomplete");
		expect(geometryChanged.fingerprint).not.toBe(first.fingerprint);
		expect(zIndexChanged.fingerprint).not.toBe(first.fingerprint);
		expect(audioPlacementChanged.fingerprint).not.toBe(first.fingerprint);
		expect(renderedTextChanged.fingerprint).not.toBe(first.fingerprint);
		expect(hashtagsChanged.fingerprint).toBe(first.fingerprint);
		expect(unselectedHookChanged.fingerprint).toBe(first.fingerprint);
		expect(unrenderedCtaChanged.fingerprint).toBe(first.fingerprint);
		expect(generationOnlyOutputRulesChanged.fingerprint).toBe(
			first.fingerprint,
		);
		expect(voiceProvenanceChanged.fingerprint).toBe(first.fingerprint);
		expect(usedFontChanged.fingerprint).not.toBe(first.fingerprint);
	});

	it("excludes audit-only voice bytes from a video-only fingerprint", async () => {
		const first = await builtVideoOnly();
		const changedSource = structuredClone(source());
		changedSource.sceneComposition.audioTracks = [];
		changedSource.voice.segments[0].semantic.checksum = "b".repeat(64);
		changedSource.voice.segments[0].provenance.artifactId =
			"changed-audit-artifact";
		const changed = await buildCompositionInputV1(changedSource);
		if (!changed.ok) throw new Error("video-only fixture incomplete");
		expect(changed.fingerprint).toBe(first.fingerprint);
	});

	it("canonicalizes non-semantic dependency order while retaining audio placement", async () => {
		const reordered = twoVoiceSource();
		reordered.voice.segments.reverse();
		reordered.sceneComposition.audioTracks.reverse();
		reordered.fonts.faces.reverse();
		const extraMedia = {
			...reordered.media[0],
			dependencyKey: "media-overlay",
			provenance: { ...reordered.media[0].provenance, mediaAssetId: "ma2" },
		};
		reordered.media = [extraMedia, reordered.media[0]];
		reordered.sceneComposition.scenes[0].layers.splice(2, 0, {
			kind: "MEDIA",
			layerId: "layer-overlay",
			zIndex: 2,
			startOffsetFrame: "0",
			durationFrames: "450",
			box: { xPx: 0, yPx: 0, widthPx: 100, heightPx: 100 },
			opacityBasisPoints: 10000,
			sourceMediaKey: "media-overlay",
			fit: "CONTAIN",
			objectPositionXBasisPoints: 5000,
			objectPositionYBasisPoints: 5000,
		});
		const second = await buildCompositionInputV1(reordered);
		if (!second.ok) throw new Error("fixture incomplete");
		// The added media layer is materialized, so compare against a source with
		// the same layer but only dependency/order changes below.
		const canonical = twoVoiceSource();
		canonical.media = [canonical.media[0], extraMedia];
		canonical.sceneComposition.scenes[0].layers.splice(2, 0, {
			kind: "MEDIA",
			layerId: "layer-overlay",
			zIndex: 2,
			startOffsetFrame: "0",
			durationFrames: "450",
			box: { xPx: 0, yPx: 0, widthPx: 100, heightPx: 100 },
			opacityBasisPoints: 10000,
			sourceMediaKey: "media-overlay",
			fit: "CONTAIN",
			objectPositionXBasisPoints: 5000,
			objectPositionYBasisPoints: 5000,
		});
		const canonicalResult = await buildCompositionInputV1(canonical);
		if (!canonicalResult.ok) throw new Error("fixture incomplete");
		expect(second.fingerprint).toBe(canonicalResult.fingerprint);

		const audioReordered = structuredClone(canonical);
		audioReordered.sceneComposition.audioTracks.reverse();
		const audioReorderedResult = await buildCompositionInputV1(audioReordered);
		if (!audioReorderedResult.ok) throw new Error("fixture incomplete");
		expect(audioReorderedResult.fingerprint).toBe(canonicalResult.fingerprint);
	});

	it("normalizes composed and decomposed Vietnamese text to one fingerprint", async () => {
		const first = await built();
		const decomposed = await buildCompositionInputV1(
			mutated((draft) => {
				const layer = draft.sceneComposition.scenes[0].layers[1];
				if (layer.kind !== "TEXT") throw new Error("fixture layer kind");
				layer.text = "Xin chào".normalize("NFD");
			}),
		);
		if (!first.ok || !decomposed.ok) throw new Error("fixture incomplete");
		expect(decomposed.fingerprint).toBe(first.fingerprint);
	});

	it("keeps textLayoutVersion semantic in the canonical projection", async () => {
		const result = await built();
		if (!result.ok) throw new Error("fixture incomplete");
		const projection = compositionSemanticProjection(result.input) as {
			sceneComposition: {
				scenes: Array<{ layers: Array<Record<string, unknown>> }>;
			};
		};
		const changed = structuredClone(projection);
		changed.sceneComposition.scenes[0].layers[1].textLayoutVersion =
			"affichannel-text-layout-v2";
		expect(canonicalizeCompositionJson(changed)).not.toBe(
			canonicalizeCompositionJson(projection),
		);
	});

	it("accepts canonical Output Rules default claimLimit=null", async () => {
		const result = await buildCompositionInputV1(
			mutated((draft) => {
				draft.config.semantic.outputRules.claimLimit = null;
			}),
		);
		expect(result.ok).toBe(true);
	});
});

describe("OutputEncodingProfile and render request boundary", () => {
	it("detects the built-in profile as incomplete", async () => {
		await expect(
			fingerprintOutputEncodingProfile(MP4_H264_AAC_V1),
		).rejects.toThrow("OUTPUT_ENCODING_PROFILE_INCOMPLETE");
	});

	it("excludes CompositionVersion ID from request hash", async () => {
		const profile = {
			...MP4_H264_AAC_V1,
			videoBitrateKbps: 5000,
			videoCrf: 20,
			audioBitrateKbps: 192,
			keyframeIntervalFrames: 60,
		};
		const profileFingerprint = await fingerprintOutputEncodingProfile(profile);
		const a: RenderRequestSpecV1 = {
			schemaVersion: "render-request.v1",
			compositionVersionId: "cv-a",
			compositionFingerprint: HASH,
			outputEncodingProfile: profile,
			outputEncodingProfileFingerprint: profileFingerprint,
			outputContractVersion: "output.v1",
		};
		const b = { ...a, compositionVersionId: "cv-b" };
		expect(await canonicalRequestHash(a)).toBe(await canonicalRequestHash(b));
	});

	it("changes request hash when the output profile fingerprint changes", async () => {
		const profile = {
			...MP4_H264_AAC_V1,
			videoBitrateKbps: 5000,
			videoCrf: 20,
			audioBitrateKbps: 192,
			keyframeIntervalFrames: 60,
		};
		const profileFingerprint = await fingerprintOutputEncodingProfile(profile);
		const request: RenderRequestSpecV1 = {
			schemaVersion: "render-request.v1",
			compositionVersionId: "cv-a",
			compositionFingerprint: HASH,
			outputEncodingProfile: profile,
			outputEncodingProfileFingerprint: profileFingerprint,
			outputContractVersion: "output.v1",
		};
		const changedProfile = { ...profile, videoBitrateKbps: 6000 };
		const changed = {
			...request,
			outputEncodingProfile: changedProfile,
			outputEncodingProfileFingerprint:
				await fingerprintOutputEncodingProfile(changedProfile),
		};
		expect(await canonicalRequestHash(changed)).not.toBe(
			await canonicalRequestHash(request),
		);
	});
});

describe("Composition currentness", () => {
	it("marks script revision changes stale and archive-only changes current", async () => {
		const result = await built();
		if (!result.ok) throw new Error("fixture incomplete");
		expect(
			evaluateCompositionCurrentness(result.input, {
				scriptVersionId: "sv1",
				scriptRevision: 2,
				voiceConfigRevision: 1,
				voiceArtifactIds: ["va1"],
				mediaChecksums: [HASH],
				compositionProfileId: "vertical-standard-v1",
			}).state,
		).toBe("STALE");
		expect(
			evaluateCompositionCurrentness(result.input, {
				scriptVersionId: "sv1",
				scriptRevision: 1,
				voiceConfigRevision: 1,
				voiceArtifactIds: ["va1"],
				mediaChecksums: [HASH],
				compositionProfileId: "vertical-standard-v1",
			}).state,
		).toBe("CURRENT");
	});

	it("marks voice source changes stale but ignores generation-only config changes", async () => {
		const result = await built();
		if (!result.ok) throw new Error("fixture incomplete");
		const base = {
			scriptVersionId: "sv1",
			scriptRevision: 1,
			voiceConfigRevision: 1,
			voiceArtifactIds: ["va1"],
			voiceArtifactChecksums: [HASH],
			mediaChecksums: [HASH],
			compositionProfileId: "vertical-standard-v1",
		};
		const voiceChanged = evaluateCompositionCurrentness(result.input, {
			...base,
			voiceArtifactChecksums: ["b".repeat(64)],
		});
		expect(voiceChanged.state).toBe("STALE");
		if (voiceChanged.state === "STALE")
			expect(voiceChanged.reason).toBe("VOICE_SOURCE_CHANGED");
		const mediaChanged = evaluateCompositionCurrentness(result.input, {
			...base,
			mediaChecksums: ["b".repeat(64)],
		});
		expect(mediaChanged.state).toBe("STALE");
		if (mediaChanged.state === "STALE")
			expect(mediaChanged.reason).toBe("MEDIA_BINARY_CHANGED");
		const configChanged = evaluateCompositionCurrentness(result.input, {
			...base,
			currentConfigSemantic: {
				...result.input.config.semantic,
				outputRules: {
					...result.input.config.semantic.outputRules,
					claimLimit: 4,
				},
			},
		});
		expect(configChanged.state).toBe("CURRENT");
	});

	it("ignores audit-only voice changes for video-only currentness", async () => {
		const result = await builtVideoOnly();
		const current = evaluateCompositionCurrentness(result.input, {
			scriptVersionId: "sv1",
			scriptRevision: 1,
			voiceConfigRevision: 999,
			voiceArtifactIds: [],
			voiceArtifactChecksums: ["b".repeat(64)],
			voiceArtifactRefs: [
				{
					segmentKey: "voice-a",
					artifactId: "changed-audit-artifact",
					checksum: "b".repeat(64),
				},
			],
			mediaChecksums: [HASH],
			compositionProfileId: "vertical-standard-v1",
		});
		expect(current).toEqual({ state: "CURRENT" });
	});

	it("still treats a rendered voice dependency as currentness-critical", async () => {
		const result = await built();
		const current = evaluateCompositionCurrentness(result.input, {
			scriptVersionId: "sv1",
			scriptRevision: 1,
			voiceConfigRevision: 1,
			voiceArtifactIds: ["changed-artifact"],
			voiceArtifactChecksums: [HASH],
			mediaChecksums: [HASH],
			compositionProfileId: "vertical-standard-v1",
		});
		expect(current).toMatchObject({
			state: "STALE",
			reason: "VOICE_SOURCE_CHANGED",
		});
	});

	it("ignores an unrendered voice dependency when another voice is rendered", async () => {
		const draft = structuredClone(twoVoiceSource());
		draft.sceneComposition.audioTracks =
			draft.sceneComposition.audioTracks.filter(
				(track) => track.sourceVoiceKey === "voice-a",
			);
		const result = await buildCompositionInputV1(draft);
		if (!result.ok) throw new Error(result.code);
		const current = evaluateCompositionCurrentness(result.input, {
			scriptVersionId: "sv1",
			scriptRevision: 1,
			voiceConfigRevision: 1,
			voiceArtifactRefs: [
				{
					segmentKey: "voice-a",
					artifactId: "va1",
					checksum: HASH,
				},
				{
					segmentKey: "voice-b",
					artifactId: "changed-unused-artifact",
					checksum: "b".repeat(64),
				},
			],
			voiceArtifactIds: ["va1", "changed-unused-artifact"],
			mediaChecksums: [HASH],
			compositionProfileId: "vertical-standard-v1",
		});
		expect(current).toEqual({ state: "CURRENT" });
	});
});

describe("Composition business preflight truth", () => {
	const currentness = { state: "CURRENT" as const };
	const factLockPass = {
		allowed: true,
		reason: "FACT_LOCK_PASSED" as const,
		currentScriptVersionId: "sv1",
		currentScriptRevision: 1,
		factLockRunId: "run-1",
		blockingRunStatus: null,
	};
	const capability = (
		state: "NOT_REQUIRED" | "READY" | "BLOCKED" | "STALE",
		completion: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE",
		reasonCode:
			| "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS"
			| "FACT_LOCK_RUN_REQUIRED"
			| "CLAIM_SUBJECT_CONFIRMATION_REQUIRED"
			| "FACT_LOCK_STALE_FACTS",
		capabilityName: "FACT_LOCK" | "SCRIPT" = "FACT_LOCK",
	) => ({
		capability: capabilityName,
		state,
		completion,
		reasonCode,
		dependencies: [],
	});
	const ready = (
		capabilityName: "PRODUCT" | "SCRIPT" | "FACT_LOCK" | "VOICE",
		reasonCode:
			| "PRODUCT_READY"
			| "SCRIPT_READY"
			| "FACT_LOCK_PASSED"
			| "VOICE_READY",
	) => ({
		capability: capabilityName,
		state: "READY" as const,
		completion: "COMPLETE" as const,
		reasonCode,
		dependencies: [],
	});

	it("does not let historical Fact Lock PASS override a current Resolver block", () => {
		const result = evaluateCompositionBusinessPreflight({
			compositionVersionId: "cv1",
			currentness,
			applicability: capability(
				"BLOCKED",
				"IN_PROGRESS",
				"CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
			),
			applicabilityCapabilities: [
				capability(
					"BLOCKED",
					"IN_PROGRESS",
					"CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
				),
			],
			factLock: factLockPass,
			mediaEligible: true,
			voiceEligible: true,
		});
		expect(result.authorization.allowed).toBe(false);
		expect(result.authorization.reasonCode).toBe(
			"CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
		);
		expect(result.factLock).toMatchObject({
			requirement: "REQUIRED",
			outcome: "SATISFIED",
			evidence: factLockPass,
		});
	});

	it("preserves required/not-evaluated truth on stale early exits", () => {
		const result = evaluateCompositionBusinessPreflight({
			compositionVersionId: "cv1",
			currentness: { state: "STALE", reason: "CONFIG_CHANGED" },
			applicability: capability(
				"READY",
				"NOT_STARTED",
				"FACT_LOCK_RUN_REQUIRED",
			),
			factLock: null,
			mediaEligible: true,
			voiceEligible: true,
		});
		expect(result.authorization.allowed).toBe(false);
		expect(result.factLock).toMatchObject({
			requirement: "REQUIRED",
			outcome: "NOT_EVALUATED",
			evidence: null,
		});
	});

	it("allows a video-only business preflight without voice configuration", () => {
		const result = evaluateCompositionBusinessPreflight({
			compositionVersionId: "cv-video-only",
			currentness,
			applicability: capability(
				"NOT_REQUIRED",
				"NOT_STARTED",
				"FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
			),
			applicabilityCapabilities: [
				capability(
					"NOT_REQUIRED",
					"NOT_STARTED",
					"FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
				),
				ready("VOICE", "VOICE_READY"),
			],
			factLock: null,
			mediaEligible: true,
			voiceEligible: true,
		});
		expect(result.authorization.allowed).toBe(true);
	});

	it("accepts a current Organic/general Resolver NOT_REQUIRED result without running Fact Lock", () => {
		const result = evaluateCompositionBusinessPreflight({
			compositionVersionId: "cv1",
			currentness,
			applicability: capability(
				"NOT_REQUIRED",
				"COMPLETE",
				"FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
			),
			factLock: null,
			mediaEligible: true,
			voiceEligible: true,
		});
		expect(result.authorization.allowed).toBe(true);
		expect(result.factLock).toMatchObject({
			requirement: "NOT_REQUIRED",
			outcome: "NOT_EVALUATED",
		});
	});

	it("does not let an irrelevant historical gate block a current NOT_REQUIRED Resolver result", () => {
		const result = evaluateCompositionBusinessPreflight({
			compositionVersionId: "cv1",
			currentness,
			applicability: capability(
				"NOT_REQUIRED",
				"COMPLETE",
				"FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
			),
			factLock: {
				...factLockPass,
				allowed: false,
				reason: "FACT_LOCK_FAILED",
			},
			mediaEligible: true,
			voiceEligible: true,
		});
		expect(result.authorization.allowed).toBe(true);
		expect(result.factLock).toMatchObject({
			requirement: "NOT_REQUIRED",
			outcome: "NOT_EVALUATED",
		});
	});

	it("fails closed when the current Resolver capability is unavailable", () => {
		const result = evaluateCompositionBusinessPreflight({
			compositionVersionId: "cv1",
			currentness,
			applicability: null,
			factLock: null,
			mediaEligible: true,
			voiceEligible: true,
		});
		expect(result.authorization.allowed).toBe(false);
		expect(result.authorization.reasonCode).toBe("FACT_LOCK_NOT_EVALUATED");
		expect(result.factLock).toMatchObject({
			requirement: "REQUIRED",
			outcome: "NOT_EVALUATED",
		});
	});

	it("blocks stale Resolver claims even when media and voice are eligible", () => {
		const result = evaluateCompositionBusinessPreflight({
			compositionVersionId: "cv1",
			currentness,
			applicability: capability(
				"STALE",
				"IN_PROGRESS",
				"FACT_LOCK_STALE_FACTS",
			),
			factLock: factLockPass,
			mediaEligible: true,
			voiceEligible: true,
		});
		expect(result.authorization.allowed).toBe(false);
		expect(result.authorization.reasonCode).toBe("FACT_LOCK_STALE_FACTS");
	});

	it("does not let the unimplemented Render placeholder self-block business preflight", () => {
		const factLock = {
			...factLockPass,
		};
		const upstream = [
			ready("PRODUCT", "PRODUCT_READY"),
			ready("SCRIPT", "SCRIPT_READY"),
			ready("FACT_LOCK", "FACT_LOCK_PASSED"),
			ready("VOICE", "VOICE_READY"),
		];
		const result = evaluateCompositionBusinessPreflight({
			compositionVersionId: "cv1",
			currentness,
			applicability: upstream[2],
			applicabilityCapabilities: [
				...upstream,
				{
					capability: "RENDER" as const,
					state: "BLOCKED" as const,
					completion: "NOT_STARTED" as const,
					reasonCode: "RENDER_FEATURE_NOT_IMPLEMENTED" as const,
					dependencies: [],
				},
			],
			factLock,
			mediaEligible: true,
			voiceEligible: true,
		});
		expect(result.authorization.allowed).toBe(true);
	});

	it("still blocks when an actual upstream prerequisite is blocked", () => {
		const result = evaluateCompositionBusinessPreflight({
			compositionVersionId: "cv1",
			currentness,
			applicability: ready("FACT_LOCK", "FACT_LOCK_PASSED"),
			applicabilityCapabilities: [
				{
					capability: "PRODUCT" as const,
					state: "BLOCKED" as const,
					completion: "NOT_STARTED" as const,
					reasonCode: "PRODUCT_NOT_ACCESSIBLE" as const,
					dependencies: [],
				},
				ready("SCRIPT", "SCRIPT_READY"),
				ready("FACT_LOCK", "FACT_LOCK_PASSED"),
				ready("VOICE", "VOICE_READY"),
			],
			factLock: factLockPass,
			mediaEligible: true,
			voiceEligible: true,
		});
		expect(result.authorization.allowed).toBe(false);
		expect(result.authorization.reasonCode).toBe("PRODUCT_NOT_ACCESSIBLE");
	});
});

describe("Server-owned composition assembly boundary", () => {
	it("has no client CompositionInput creation RPC and fails closed without technical pins", async () => {
		expect(compositionRouter).not.toHaveProperty("create");
		const result = await assembleCompositionInputV1(
			{ workspaceId: "w1", userId: "u1" },
			"p1",
			{
				read: async () => ({
					project: undefined,
					script: undefined,
					voiceConfig: null,
					voiceArtifacts: [],
					media: [],
					outputRules: {
						language: "vi-VN",
						aspectRatio: "9:16",
						subtitleSafeArea: "standard",
						claimLimit: null,
						requireFinalCta: true,
					},
					renderMaterialization: {
						fonts: null,
						voiceSourceFacts: null,
						timeline: null,
						sceneComposition: null,
					},
				}),
			},
		);
		expect(result).toMatchObject({
			ok: false,
			code: "COMPOSITION_INPUT_INCOMPLETE",
		});
	});
});

describe("Composition media reuse rights", () => {
	const base = {
		workspaceId: "w1",
		projectId: "p1",
		checksumSha256: HASH,
	};
	const asset = {
		workspaceId: "w1",
		projectId: "p1",
		status: "ready",
		usageRights: "owned",
		checksumSha256: HASH,
	};

	it.each([
		["owned", true],
		["licensed", true],
		["unknown", false],
		["restricted", false],
	] as const)("Affiliate %s rights resolve to %s", (usageRights, expected) => {
		expect(
			isCompositionMediaEligible({
				...base,
				contentType: "AFFILIATE",
				asset: { ...asset, usageRights },
			}),
		).toBe(expected);
	});

	it("keeps Organic rights unrestricted while still requiring READY/current scope", () => {
		expect(
			isCompositionMediaEligible({
				...base,
				contentType: "ORGANIC",
				asset: { ...asset, usageRights: "unknown" },
			}),
		).toBe(true);
		expect(
			isCompositionMediaEligible({
				...base,
				contentType: "ORGANIC",
				asset: { ...asset, status: "archived" },
			}),
		).toBe(false);
	});
});

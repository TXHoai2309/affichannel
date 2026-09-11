import {
	buildCompositionInputV1,
	type CompositionInputBuilderSource,
	type CompositionInputV1,
	type CompositionInputV1Result,
} from "@affichannel/core";

export const T09_MEDIA_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const FONT_HASHES = {
	"noto-sans-400":
		"b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5",
	"noto-sans-600":
		"87a8b90ece1e89746b544e4e086f85a3710e41485a8078f9be874837dfad45d5",
	"noto-sans-700":
		"c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a",
} as const;

const MEDIA_SHA256 =
	"431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460";

export type T09CanonicalCompositionFixture = Readonly<{
	compositionInput: CompositionInputV1;
	compositionFingerprint: string;
	compositionVersionId: string;
}>;

export type T09CompositionSourceFixture = CompositionInputBuilderSource;

function textLayer(input: { layerId: string; text: string }) {
	return {
		kind: "TEXT" as const,
		layerId: input.layerId,
		zIndex: 1,
		startOffsetFrame: "0",
		durationFrames: "30",
		box: { xPx: 90, yPx: 120, widthPx: 900, heightPx: 220 },
		opacityBasisPoints: 10_000,
		text: input.text,
		fontStableId: "noto-sans-700",
		fontWeight: 700 as const,
		fontStyle: "normal" as const,
		fontSizePx: 72,
		lineHeightPx: 88,
		textAlign: "LEFT" as const,
		colorRgba: { r: 255, g: 255, b: 255, a: 255 },
		maxLines: 2,
		textLayoutVersion: "affichannel-text-layout-v1" as const,
	};
}

function mediaLayer(input: { layerId: string; sourceMediaKey: string }) {
	return {
		kind: "MEDIA" as const,
		layerId: input.layerId,
		zIndex: 0,
		startOffsetFrame: "0",
		durationFrames: "30",
		box: { xPx: 0, yPx: 0, widthPx: 1080, heightPx: 1920 },
		opacityBasisPoints: 10_000,
		sourceMediaKey: input.sourceMediaKey,
		fit: "COVER" as const,
		objectPositionXBasisPoints: 5_000,
		objectPositionYBasisPoints: 5_000,
	};
}

/**
 * Small deterministic source data helper. It is deliberately only a builder
 * source; the authoritative fixture is produced by buildCompositionInputV1
 * below, so no T09-specific semantic fingerprint exists.
 */
export const T09_COMPOSITION_FIXTURE: T09CompositionSourceFixture = {
	workspaceId: "t09-workspace",
	projectId: "t09-project",
	script: {
		semantic: {
			schemaVersion: "script-draft.v2",
			language: "vi-VN",
			hookVariants: [{ key: "t09-hook", text: "T09" }],
			selectedHookKey: "t09-hook",
			voiceoverSegments: [{ key: "t09-voice", text: "T09 video-only fixture" }],
			scenes: [
				{
					order: 1,
					durationSeconds: 1,
					visualDirection: "Deterministic scene one",
					onScreenText: "VIDEO\nDEMO",
					voiceoverSegmentKeys: ["t09-voice"],
				},
				{
					order: 2,
					durationSeconds: 1,
					visualDirection: "Deterministic scene two",
					onScreenText: "PHASE\nTEST",
					voiceoverSegmentKeys: [],
				},
			],
			cta: { text: "T09" },
			caption: "T09 video-only fixture",
			hashtags: [],
			disclosure: "T09 internal test fixture",
			claims: [],
			claimsSourceRevision: 1,
			claimsStatus: "current",
		},
		provenance: {
			scriptVersionId: "t09-script-v1",
			revision: 1,
			status: "saved",
			versionNumber: 1,
		},
	},
	voice: {
		segments: [
			{
				segmentKey: "t09-voice",
				semantic: {
					checksum: "a".repeat(64),
					mimeType: "audio/mpeg",
					byteSize: 1,
					sourceSampleRate: 44_100,
					sourceSampleCount: "1",
					durationMs: 1,
				},
				provenance: {
					artifactId: "t09-voice-artifact",
					sourceScriptVersionId: "t09-script-v1",
					sourceScriptRevision: 1,
					textSnapshot: "T09 video-only fixture",
					textHash: "b".repeat(64),
					configId: "t09-voice-config",
					configRevision: 1,
					provider: "t09-fixture",
					voiceId: "t09-fixture-voice",
					language: "vi-VN",
					speed: 1,
					storageProvider: "local",
				},
			},
		],
	},
	media: [
		{
			dependencyKey: "t09-background-png",
			role: "t09-background",
			semantic: {
				mediaType: "image",
				mimeType: "image/png",
				checksumSha256: MEDIA_SHA256,
				byteSize: 68,
				width: 1,
				height: 1,
				durationMs: null,
			},
			provenance: {
				mediaAssetId: "t09-media-png",
				workspaceId: "t09-workspace",
				projectId: "t09-project",
			},
		},
	],
	fonts: {
		bundleId: "affichannel-fonts-v1",
		faces: [
			{
				family: "Noto Sans",
				weight: 400,
				style: "normal",
				fontId: "noto-sans-400",
				contentSha256: FONT_HASHES["noto-sans-400"],
			},
			{
				family: "Noto Sans",
				weight: 600,
				style: "normal",
				fontId: "noto-sans-600",
				contentSha256: FONT_HASHES["noto-sans-600"],
			},
			{
				family: "Noto Sans",
				weight: 700,
				style: "normal",
				fontId: "noto-sans-700",
				contentSha256: FONT_HASHES["noto-sans-700"],
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
				claimLimit: null,
				requireFinalCta: true,
			},
		},
		provenance: { outputRulesRevision: null },
	},
	timeline: {
		fps: { numerator: 30, denominator: 1 },
		totalFrames: "60",
		scenes: [
			{
				sceneKey: "t09-scene-1",
				order: 1,
				startFrame: "0",
				durationFrames: "30",
			},
			{
				sceneKey: "t09-scene-2",
				order: 2,
				startFrame: "30",
				durationFrames: "30",
			},
		],
	},
	sceneComposition: {
		version: "scene-composition.v1",
		scenes: [
			{
				sceneKey: "t09-scene-1",
				layers: [
					mediaLayer({
						layerId: "t09-media-scene-1",
						sourceMediaKey: "t09-background-png",
					}),
					textLayer({ layerId: "t09-text-scene-1", text: "VIDEO\nDEMO" }),
				],
			},
			{
				sceneKey: "t09-scene-2",
				layers: [
					mediaLayer({
						layerId: "t09-media-scene-2",
						sourceMediaKey: "t09-background-png",
					}),
					textLayer({ layerId: "t09-text-scene-2", text: "PHASE\nTEST" }),
				],
			},
		],
		audioTracks: [],
	},
};

export async function buildT09CanonicalCompositionFixture(): Promise<T09CanonicalCompositionFixture> {
	const result: CompositionInputV1Result = await buildCompositionInputV1(
		T09_COMPOSITION_FIXTURE,
	);
	if (!result.ok)
		throw new Error(
			`T09 canonical fixture is invalid: ${result.code}${result.issues ? ` (${result.issues.join(", ")})` : ""}`,
		);
	return {
		compositionInput: result.input,
		compositionFingerprint: result.fingerprint,
		compositionVersionId: "t09-composition-v1",
	};
}

/** Compatibility name retained for tests; it delegates to canonical hashing. */
export async function fingerprintT09CompositionFixture(): Promise<string> {
	return (await buildT09CanonicalCompositionFixture()).compositionFingerprint;
}

export { FONT_HASHES, MEDIA_SHA256 };

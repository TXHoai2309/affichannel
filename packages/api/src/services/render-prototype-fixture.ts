import {
	canonicalizeCompositionJson,
	sha256Hex,
	type T09FrameInterval,
} from "@affichannel/core";

export const T09_MEDIA_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export type T09CompositionFixture = Readonly<{
	schemaVersion: "t09-composition-fixture.v1";
	compositionVersionId: "t09-composition-v1";
	profileId: "vertical-standard-v1";
	width: 1080;
	height: 1920;
	fps: { numerator: 30; denominator: 1 };
	totalFrames: 60;
	media: readonly [
		{
			assetKey: "t09-background-png";
			mimeType: "image/png";
			base64: string;
			sha256: string;
			byteSize: 68;
			width: 1;
			height: 1;
		},
	];
	scenes: readonly [
		{
			sceneKey: "t09-scene-1";
			interval: T09FrameInterval;
			mediaAssetKey: "t09-background-png";
			textLayer: T09TextLayerFixture;
		},
		{
			sceneKey: "t09-scene-2";
			interval: T09FrameInterval;
			mediaAssetKey: "t09-background-png";
			textLayer: T09TextLayerFixture;
		},
	];
	audioTracks: readonly [];
	fonts: readonly [
		{ fontStableId: "noto-sans-400"; fontWeight: 400; sha256: string },
		{ fontStableId: "noto-sans-600"; fontWeight: 600; sha256: string },
		{ fontStableId: "noto-sans-700"; fontWeight: 700; sha256: string },
	];
}>;

export type T09TextLayerFixture = Readonly<{
	layerId: string;
	text: string;
	fontStableId: "noto-sans-700";
	fontFamily: "Noto Sans";
	fontWeight: 700;
	fontSizePx: 72;
	lineHeightPx: 88;
	textAlign: "CENTER";
	box: { xPx: 90; yPx: 120; widthPx: 900; heightPx: 220 };
	maxLines: 2;
	interval: T09FrameInterval;
	textLayoutVersion: "affichannel-text-layout-v1";
}>;

const FONT_HASHES = {
	"noto-sans-400":
		"b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5",
	"noto-sans-600":
		"87a8b90ece1e89746b544e4e086f85a3710e41485a8078f9be874837dfad45d5",
	"noto-sans-700":
		"c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a",
} as const;

export const T09_COMPOSITION_FIXTURE: T09CompositionFixture = {
	schemaVersion: "t09-composition-fixture.v1",
	compositionVersionId: "t09-composition-v1",
	profileId: "vertical-standard-v1",
	width: 1080,
	height: 1920,
	fps: { numerator: 30, denominator: 1 },
	totalFrames: 60,
	media: [
		{
			assetKey: "t09-background-png",
			mimeType: "image/png",
			base64: T09_MEDIA_PNG_BASE64,
			sha256:
				"431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
			byteSize: 68,
			width: 1,
			height: 1,
		},
	],
	scenes: [
		{
			sceneKey: "t09-scene-1",
			interval: { startFrame: 0, endFrame: 30 },
			mediaAssetKey: "t09-background-png",
			textLayer: {
				layerId: "t09-text-scene-1",
				text: "AFFI\nCHANNEL",
				fontStableId: "noto-sans-700",
				fontFamily: "Noto Sans",
				fontWeight: 700,
				fontSizePx: 72,
				lineHeightPx: 88,
				textAlign: "CENTER",
				box: { xPx: 90, yPx: 120, widthPx: 900, heightPx: 220 },
				maxLines: 2,
				interval: { startFrame: 0, endFrame: 30 },
				textLayoutVersion: "affichannel-text-layout-v1",
			},
		},
		{
			sceneKey: "t09-scene-2",
			interval: { startFrame: 30, endFrame: 60 },
			mediaAssetKey: "t09-background-png",
			textLayer: {
				layerId: "t09-text-scene-2",
				text: "PHASE\n21E-A",
				fontStableId: "noto-sans-700",
				fontFamily: "Noto Sans",
				fontWeight: 700,
				fontSizePx: 72,
				lineHeightPx: 88,
				textAlign: "CENTER",
				box: { xPx: 90, yPx: 120, widthPx: 900, heightPx: 220 },
				maxLines: 2,
				interval: { startFrame: 30, endFrame: 60 },
				textLayoutVersion: "affichannel-text-layout-v1",
			},
		},
	],
	audioTracks: [],
	fonts: [
		{
			fontStableId: "noto-sans-400",
			fontWeight: 400,
			sha256: FONT_HASHES["noto-sans-400"],
		},
		{
			fontStableId: "noto-sans-600",
			fontWeight: 600,
			sha256: FONT_HASHES["noto-sans-600"],
		},
		{
			fontStableId: "noto-sans-700",
			fontWeight: 700,
			sha256: FONT_HASHES["noto-sans-700"],
		},
	],
};

export async function fingerprintT09CompositionFixture(
	fixture: T09CompositionFixture = T09_COMPOSITION_FIXTURE,
): Promise<string> {
	return sha256Hex(canonicalizeCompositionJson(fixture));
}

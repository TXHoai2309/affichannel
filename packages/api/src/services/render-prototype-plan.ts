import { isAbsolute } from "node:path";
import {
	fingerprintT09PrototypeProfile,
	type PrototypeToolManifest,
	type T09RenderPlan,
	t09RenderPlanSchema,
} from "@affichannel/core";
import {
	fingerprintT09CompositionFixture,
	T09_COMPOSITION_FIXTURE,
	type T09CompositionFixture,
} from "./render-prototype-fixture";
import { layoutT09Text } from "./render-prototype-text-layout";

export type T09RenderPlanInputs = Readonly<{
	fixture?: T09CompositionFixture;
	tool: Readonly<{
		manifest: PrototypeToolManifest;
		manifestIdentity: string;
	}>;
	assetPaths: Readonly<Record<string, string>>;
	fontFilePaths: Readonly<Record<string, string>>;
	textFilePaths: Readonly<Record<string, string>>;
	outputReservation: Readonly<{
		jobId: string;
		attemptId: string;
		attemptNumber: number;
		outputReservationId: string;
	}>;
}>;

function requireAbsolutePath(path: string, label: string) {
	if (!isAbsolute(path))
		throw new Error(`${label} must be an absolute server path.`);
	return path;
}

export async function buildT09RenderPlan(
	input: T09RenderPlanInputs,
): Promise<T09RenderPlan> {
	const fixture = input.fixture ?? T09_COMPOSITION_FIXTURE;
	const compositionFingerprint =
		await fingerprintT09CompositionFixture(fixture);
	const outputProfileFingerprint = await fingerprintT09PrototypeProfile();
	const inputAssets = fixture.media.map((asset) => ({
		assetKey: asset.assetKey,
		path: requireAbsolutePath(
			input.assetPaths[asset.assetKey] ?? "",
			`Asset ${asset.assetKey}`,
		),
		sha256: asset.sha256,
		byteSize: asset.byteSize,
		width: asset.width,
		height: asset.height,
		interval: { startFrame: 0, endFrame: fixture.totalFrames },
	}));
	const materializedTextLines = [];
	for (const scene of fixture.scenes) {
		const layer = scene.textLayer;
		const layout = await layoutT09Text({
			text: layer.text,
			box: layer.box,
			fontStableId: layer.fontStableId,
			fontFamily: layer.fontFamily,
			fontWeight: layer.fontWeight,
			fontSizePx: layer.fontSizePx,
			lineHeightPx: layer.lineHeightPx,
			textAlign: layer.textAlign,
			maxLines: layer.maxLines,
			fontContentSha256:
				fixture.fonts.find((font) => font.fontStableId === layer.fontStableId)
					?.sha256 ?? "",
		});
		for (const line of layout.lines) {
			const key = `${layer.layerId}:${line.lineIndex}`;
			materializedTextLines.push({
				startFrame: scene.interval.startFrame,
				endFrame: scene.interval.endFrame,
				fontFilePath: requireAbsolutePath(
					input.fontFilePaths[layer.fontStableId] ?? "",
					`Font ${layer.fontStableId}`,
				),
				textFilePath: requireAbsolutePath(
					input.textFilePaths[key] ?? "",
					`Text file ${key}`,
				),
				line,
			});
		}
	}
	return t09RenderPlanSchema.parse({
		schemaVersion: "t09-render-plan.v1",
		exactToolManifestIdentity: input.tool.manifestIdentity,
		executionGate:
			input.tool.manifest.approvalStatus === "APPROVED"
				? "READY"
				: "BLOCKED_PENDING_BINARY_APPROVAL",
		compositionVersionId: fixture.compositionVersionId,
		compositionFingerprint,
		outputProfileFingerprint,
		width: fixture.width,
		height: fixture.height,
		fps: fixture.fps,
		totalFrames: fixture.totalFrames,
		inputAssets,
		materializedTextLines,
		outputReservation: input.outputReservation,
		expectedOutput: {
			mimeType: "video/mp4",
			videoCodec: "H.264/AVC",
			pixelFormat: "yuv420p",
			width: fixture.width,
			height: fixture.height,
			fps: fixture.fps,
			totalFrames: fixture.totalFrames,
			audio: null,
		},
	});
}

import { isAbsolute } from "node:path";
import type { PrototypeToolManifest } from "@affichannel/core";
import {
	buildCompositionInputV1,
	type CompositionInputV1,
	compositionInputV1Schema,
	fingerprintT09PrototypeProfile,
	prototypeToolManifestSchema,
	sha256Hex,
	type T09PlanLayer,
	type T09RenderPlan,
	t09RenderPlanSchema,
} from "@affichannel/core";
import {
	buildT09CanonicalCompositionFixture,
	type T09CanonicalCompositionFixture,
} from "./render-prototype-fixture";
import {
	assertT09ServerOwnedStagingPath,
	type T09ServerOwnedStagingPath,
} from "./render-prototype-staging";
import { layoutT09Text } from "./render-prototype-text-layout";

export class T09RenderPlanError extends Error {
	readonly code:
		| "COMPOSITION_INPUT_INVALID"
		| "COMPOSITION_FINGERPRINT_MISMATCH"
		| "RENDERER_FEATURE_UNSUPPORTED"
		| "T09_TOOL_MANIFEST_INVALID"
		| "T09_STAGING_PATH_INVALID";

	constructor(code: T09RenderPlanError["code"], message: string) {
		super(message);
		this.name = "T09RenderPlanError";
		this.code = code;
	}
}

export type T09RenderPlanInputs = Readonly<{
	composition?: T09CanonicalCompositionFixture;
	tool: Readonly<{ manifest: PrototypeToolManifest }>;
	assetPaths: Readonly<Record<string, string>>;
	fontFilePaths: Readonly<Record<string, string>>;
	textFilePaths: Readonly<Record<string, T09ServerOwnedStagingPath>>;
	outputReservation: Readonly<{
		jobId: string;
		attemptId: string;
		attemptNumber: number;
		outputReservationId: string;
	}>;
}>;

function requireAbsolutePath(path: string, label: string) {
	if (!isAbsolute(path))
		throw new T09RenderPlanError(
			"T09_STAGING_PATH_INVALID",
			`${label} must be an absolute server path.`,
		);
	return path;
}

function requireStagingPath(path: T09ServerOwnedStagingPath, label: string) {
	try {
		return assertT09ServerOwnedStagingPath(path, label);
	} catch (error) {
		throw new T09RenderPlanError(
			"T09_STAGING_PATH_INVALID",
			error instanceof Error ? error.message : `${label} is invalid.`,
		);
	}
}

function unsupported(message: string): never {
	throw new T09RenderPlanError("RENDERER_FEATURE_UNSUPPORTED", message);
}

function frameNumber(value: string, label: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0)
		throw new T09RenderPlanError(
			"COMPOSITION_INPUT_INVALID",
			`${label} must be a safe non-negative frame integer.`,
		);
	return parsed;
}

function verifyT09Composition(input: CompositionInputV1) {
	if (input.profile.id !== "vertical-standard-v1")
		unsupported("T09 only supports vertical-standard-v1.");
	if (
		input.profile.logicalWidth !== 1080 ||
		input.profile.logicalHeight !== 1920
	)
		unsupported("T09 only supports a 1080x1920 composition.");
	if (input.profile.fps.numerator !== 30 || input.profile.fps.denominator !== 1)
		unsupported("T09 only supports 30/1 FPS.");
	if (input.timeline.totalFrames !== "60")
		unsupported("T09 fixture execution requires exactly 60 frames.");
	if (input.sceneComposition.audioTracks.length !== 0)
		unsupported(
			"T09 prototype execution is video-only and cannot accept audio.",
		);
	if (
		input.timeline.scenes.length !== 2 ||
		input.timeline.scenes[0]?.sceneKey !== "t09-scene-1" ||
		input.timeline.scenes[1]?.sceneKey !== "t09-scene-2" ||
		input.timeline.scenes[0]?.startFrame !== "0" ||
		input.timeline.scenes[0]?.durationFrames !== "30" ||
		input.timeline.scenes[1]?.startFrame !== "30" ||
		input.timeline.scenes[1]?.durationFrames !== "30"
	)
		unsupported("T09 fixture execution requires two exact 30-frame scenes.");
	if (input.profile.workingColorSpace !== "BT.709")
		unsupported("T09 only supports BT.709 working color.");
	if (input.profile.workingPixelModel !== "RGBA")
		unsupported("T09 only supports RGBA working pixels.");
}

function requireT09LayerSemantics(input: CompositionInputV1): T09PlanLayer[] {
	const timelineByKey = new Map(
		input.timeline.scenes.map((scene) => [scene.sceneKey, scene]),
	);
	const layers: T09PlanLayer[] = [];
	for (const scene of input.sceneComposition.scenes) {
		if (
			scene.layers.length !== 2 ||
			scene.layers[0]?.kind !== "MEDIA" ||
			scene.layers[0]?.zIndex !== 0 ||
			scene.layers[1]?.kind !== "TEXT" ||
			scene.layers[1]?.zIndex !== 1
		)
			unsupported(
				`T09 only supports one zIndex 0 MEDIA layer followed by one zIndex 1 TEXT layer in ${scene.sceneKey}.`,
			);
		const timing = timelineByKey.get(scene.sceneKey);
		if (!timing) throw new Error(`Missing timeline for ${scene.sceneKey}.`);
		const sceneStart = frameNumber(
			timing.startFrame,
			`${scene.sceneKey} start`,
		);
		for (const layer of scene.layers) {
			const startFrame =
				sceneStart +
				frameNumber(layer.startOffsetFrame, `${layer.layerId} start`);
			const endFrame =
				startFrame +
				frameNumber(layer.durationFrames, `${layer.layerId} duration`);
			if (
				endFrame >
				sceneStart +
					frameNumber(timing.durationFrames, `${scene.sceneKey} duration`)
			)
				throw new T09RenderPlanError(
					"COMPOSITION_INPUT_INVALID",
					`${layer.layerId} exceeds its canonical scene timing.`,
				);
			if (
				layer.box.xPx < 0 ||
				layer.box.yPx < 0 ||
				layer.box.xPx + layer.box.widthPx > 1080 ||
				layer.box.yPx + layer.box.heightPx > 1920
			)
				unsupported(`${layer.layerId} has unsupported out-of-bounds geometry.`);
			if (layer.kind === "MEDIA") {
				if (
					layer.box.xPx !== 0 ||
					layer.box.yPx !== 0 ||
					layer.box.widthPx !== 1080 ||
					layer.box.heightPx !== 1920
				)
					unsupported("T09 only supports full-frame MEDIA layers.");
				if (layer.fit !== "COVER" && layer.fit !== "CONTAIN")
					unsupported(`Unsupported MEDIA fit ${layer.fit}.`);
				layers.push({
					kind: "MEDIA",
					layerId: layer.layerId,
					zIndex: layer.zIndex,
					startOffsetFrame: frameNumber(
						layer.startOffsetFrame,
						`${layer.layerId} start`,
					),
					durationFrames: frameNumber(
						layer.durationFrames,
						`${layer.layerId} duration`,
					),
					startFrame,
					endFrame,
					box: layer.box,
					opacityBasisPoints: layer.opacityBasisPoints,
					sourceMediaKey: layer.sourceMediaKey,
					fit: layer.fit,
					objectPositionXBasisPoints: layer.objectPositionXBasisPoints,
					objectPositionYBasisPoints: layer.objectPositionYBasisPoints,
				});
				continue;
			}
			if (layer.fontStyle !== "normal")
				unsupported(`Unsupported text font style on ${layer.layerId}.`);
			if (layer.textLayoutVersion !== "affichannel-text-layout-v1")
				unsupported(`Unsupported text layout version on ${layer.layerId}.`);
			layers.push({
				kind: "TEXT",
				layerId: layer.layerId,
				zIndex: layer.zIndex,
				startOffsetFrame: frameNumber(
					layer.startOffsetFrame,
					`${layer.layerId} start`,
				),
				durationFrames: frameNumber(
					layer.durationFrames,
					`${layer.layerId} duration`,
				),
				startFrame,
				endFrame,
				box: layer.box,
				opacityBasisPoints: layer.opacityBasisPoints,
				text: layer.text,
				fontStableId: layer.fontStableId,
				fontWeight: layer.fontWeight,
				fontStyle: layer.fontStyle,
				fontSizePx: layer.fontSizePx,
				lineHeightPx: layer.lineHeightPx,
				textAlign: layer.textAlign,
				colorRgba: layer.colorRgba,
				maxLines: layer.maxLines,
				textLayoutVersion: layer.textLayoutVersion,
			});
		}
	}
	const mediaLayers = layers.filter((layer) => layer.kind === "MEDIA");
	if (mediaLayers.length !== 2)
		unsupported("T09 requires exactly one MEDIA layer in each scene.");
	const firstMedia = mediaLayers[0];
	if (
		firstMedia &&
		mediaLayers.some(
			(layer) =>
				layer.sourceMediaKey !== firstMedia.sourceMediaKey ||
				layer.fit !== firstMedia.fit ||
				layer.objectPositionXBasisPoints !==
					firstMedia.objectPositionXBasisPoints ||
				layer.objectPositionYBasisPoints !==
					firstMedia.objectPositionYBasisPoints ||
				layer.opacityBasisPoints !== firstMedia.opacityBasisPoints ||
				JSON.stringify(layer.box) !== JSON.stringify(firstMedia.box),
		)
	)
		unsupported(
			"T09 requires one identical MEDIA contract across both scenes.",
		);
	if (layers.filter((layer) => layer.kind === "TEXT").length !== 2)
		unsupported("T09 requires exactly one TEXT layer in each scene.");
	return layers;
}

export async function buildT09RenderPlan(
	input: T09RenderPlanInputs,
): Promise<T09RenderPlan> {
	const compositionFixture =
		input.composition ?? (await buildT09CanonicalCompositionFixture());
	const parsedManifest = (() => {
		try {
			return prototypeToolManifestSchema.parse(input.tool.manifest);
		} catch {
			throw new T09RenderPlanError(
				"T09_TOOL_MANIFEST_INVALID",
				"T09 tool manifest must parse before a render plan can be built.",
			);
		}
	})();
	const canonicalResult = await buildCompositionInputV1(
		compositionFixture.compositionInput,
	);
	if (!canonicalResult.ok)
		throw new T09RenderPlanError(
			"COMPOSITION_INPUT_INVALID",
			`T09 canonical composition is invalid: ${canonicalResult.code}.`,
		);
	if (canonicalResult.fingerprint !== compositionFixture.compositionFingerprint)
		throw new T09RenderPlanError(
			"COMPOSITION_FINGERPRINT_MISMATCH",
			"T09 composition fixture fingerprint is not the canonical CompositionInput fingerprint.",
		);
	const compositionInput = compositionInputV1Schema.parse(
		canonicalResult.input,
	);
	verifyT09Composition(compositionInput);
	const renderLayers = requireT09LayerSemantics(compositionInput);
	const exactToolManifestIdentity = await sha256Hex(parsedManifest);
	const outputProfileFingerprint = await fingerprintT09PrototypeProfile();
	const inputAssets = compositionInput.media
		.filter((asset) =>
			renderLayers.some(
				(layer) =>
					layer.kind === "MEDIA" &&
					layer.sourceMediaKey === asset.dependencyKey,
			),
		)
		.map((asset) => ({
			assetKey: asset.dependencyKey,
			path: requireAbsolutePath(
				input.assetPaths[asset.dependencyKey] ?? "",
				`Asset ${asset.dependencyKey}`,
			),
			sha256: asset.semantic.checksumSha256,
			byteSize: asset.semantic.byteSize,
			width: asset.semantic.width ?? 0,
			height: asset.semantic.height ?? 0,
			interval: { startFrame: 0, endFrame: 60 },
		}));
	if (inputAssets.some((asset) => asset.width <= 0 || asset.height <= 0))
		throw new T09RenderPlanError(
			"COMPOSITION_INPUT_INVALID",
			"T09 MEDIA dependencies require exact positive dimensions.",
		);
	if (inputAssets.length !== 1)
		unsupported("T09 supports exactly one canonical MEDIA dependency.");
	const materializedTextLines: Array<{
		startFrame: number;
		endFrame: number;
		layerId: string;
		fontFilePath: string;
		textFilePath: string;
		line: {
			lineIndex: number;
			text: string;
			xPx: number;
			baselineYPx: number;
			measuredWidthPx: number;
			fontStableId: string;
			fontSizePx: number;
			lineHeightPx: number;
			fontStyle: "normal";
			colorRgba: { r: number; g: number; b: number; a: number };
			opacityBasisPoints: number;
			textLayoutVersion: "affichannel-text-layout-v1";
		};
	}> = [];
	for (const layer of renderLayers) {
		if (layer.kind !== "TEXT") continue;
		const canonicalLayer = compositionInput.sceneComposition.scenes
			.flatMap((scene) => scene.layers)
			.find((candidate) => candidate.layerId === layer.layerId);
		if (canonicalLayer?.kind !== "TEXT")
			throw new Error(`Missing canonical text layer ${layer.layerId}.`);
		const font = compositionInput.fonts.faces.find(
			(face) => face.fontId === layer.fontStableId,
		);
		if (
			!font ||
			font.weight !== layer.fontWeight ||
			font.family !== "Noto Sans"
		)
			unsupported(`T09 cannot resolve pinned font ${layer.fontStableId}.`);
		const layout = await layoutT09Text({
			text: layer.text,
			box: layer.box,
			fontStableId: layer.fontStableId,
			fontFamily: font.family,
			fontWeight: layer.fontWeight,
			fontSizePx: layer.fontSizePx,
			lineHeightPx: layer.lineHeightPx,
			textAlign: layer.textAlign,
			maxLines: layer.maxLines,
			fontContentSha256: font.contentSha256,
		});
		for (const line of layout.lines) {
			const key = `${layer.layerId}:${line.lineIndex}`;
			const textFilePath = input.textFilePaths[key];
			if (!textFilePath)
				throw new T09RenderPlanError(
					"T09_STAGING_PATH_INVALID",
					`Text file ${key} must be a server-owned T09 staging path.`,
				);
			materializedTextLines.push({
				startFrame: layer.startFrame,
				endFrame: layer.endFrame,
				layerId: layer.layerId,
				fontFilePath: requireAbsolutePath(
					input.fontFilePaths[layer.fontStableId] ?? "",
					`Font ${layer.fontStableId}`,
				),
				textFilePath: requireStagingPath(textFilePath, `Text file ${key}`),
				line: {
					...line,
					fontStyle: layer.fontStyle,
					colorRgba: layer.colorRgba,
					opacityBasisPoints: layer.opacityBasisPoints,
					textLayoutVersion: layer.textLayoutVersion,
				},
			});
		}
	}
	const stagingRoots = new Set(
		Object.values(input.textFilePaths).map((path) => {
			requireStagingPath(path, "T09 text staging path");
			return path.rootPath;
		}),
	);
	if (stagingRoots.size !== 1)
		throw new T09RenderPlanError(
			"T09_STAGING_PATH_INVALID",
			"T09 requires a server-owned staging root.",
		);
	const stagingRoot = [...stagingRoots][0];
	return t09RenderPlanSchema.parse({
		schemaVersion: "t09-render-plan.v1",
		exactToolManifestIdentity,
		executionGate:
			parsedManifest.approvalStatus === "APPROVED"
				? "READY"
				: "BLOCKED_PENDING_BINARY_APPROVAL",
		compositionVersionId: compositionFixture.compositionVersionId,
		compositionFingerprint: canonicalResult.fingerprint,
		outputProfileFingerprint,
		stagingRoot,
		width: compositionInput.profile.logicalWidth,
		height: compositionInput.profile.logicalHeight,
		fps: compositionInput.profile.fps,
		totalFrames: Number(compositionInput.timeline.totalFrames),
		inputAssets,
		renderLayers,
		materializedTextLines,
		outputReservation: input.outputReservation,
		expectedOutput: {
			mimeType: "video/mp4",
			videoCodec: "H.264/AVC",
			pixelFormat: "yuv420p",
			width: compositionInput.profile.logicalWidth,
			height: compositionInput.profile.logicalHeight,
			fps: compositionInput.profile.fps,
			totalFrames: Number(compositionInput.timeline.totalFrames),
			audio: null,
		},
	});
}

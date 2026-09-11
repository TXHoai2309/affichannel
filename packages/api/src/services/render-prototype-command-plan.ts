import { isAbsolute, resolve } from "node:path";
import {
	prototypeToolManifestSchema,
	sha256Hex,
	type T09RenderPlan,
} from "@affichannel/core";
import {
	assertT09ServerOwnedStagingPath,
	type T09ServerOwnedStagingPath,
} from "./render-prototype-staging";
import type { ResolvedT09FfmpegTool } from "./render-prototype-tool-resolver";

export type T09FfmpegCommandPlan = Readonly<{
	executablePath: string;
	argv: readonly string[];
	outputPath: string;
	filterGraph: string;
}>;

export class T09FfmpegCommandPlanError extends Error {
	readonly code:
		| "T09_PLAN_NOT_READY"
		| "T09_PLAN_TOOL_MISMATCH"
		| "T09_RESOLVED_TOOL_MANIFEST_INVALID"
		| "T09_RESOLVED_TOOL_BINARY_MISMATCH"
		| "T09_STAGING_PATH_INVALID"
		| "RENDERER_FEATURE_UNSUPPORTED";

	constructor(code: T09FfmpegCommandPlanError["code"], message: string) {
		super(message);
		this.name = "T09FfmpegCommandPlanError";
		this.code = code;
	}
}

function escapeFilterValue(value: string): string {
	return value.replace(/[\\':,[\]]/g, (character) => `\\${character}`);
}

function absolutePath(value: string, label: string): string {
	if (!isAbsolute(value))
		throw new T09FfmpegCommandPlanError(
			"T09_STAGING_PATH_INVALID",
			`${label} must be an absolute server path.`,
		);
	return value;
}

function ratio(basisPoints: number) {
	return (basisPoints / 10_000)
		.toFixed(4)
		.replace(/0+$/, "")
		.replace(/\.$/, "");
}

function alpha(colorAlpha: number, opacityBasisPoints: number) {
	return ratio((colorAlpha / 255) * opacityBasisPoints);
}

function color(
	value: {
		r: number;
		g: number;
		b: number;
		a: number;
	},
	opacityBasisPoints: number,
) {
	const rgb = [value.r, value.g, value.b]
		.map((channel) => channel.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
	return `0x${rgb}@${alpha(value.a, opacityBasisPoints)}`;
}

function mediaFilter(input: {
	plan: T09RenderPlan;
	media: Extract<T09RenderPlan["renderLayers"][number], { kind: "MEDIA" }>;
}) {
	const { plan, media } = input;
	const x = ratio(media.objectPositionXBasisPoints);
	const y = ratio(media.objectPositionYBasisPoints);
	const box = media.box;
	if (
		box.xPx !== 0 ||
		box.yPx !== 0 ||
		box.widthPx !== plan.width ||
		box.heightPx !== plan.height
	)
		throw new T09FfmpegCommandPlanError(
			"RENDERER_FEATURE_UNSUPPORTED",
			"T09 FFmpeg planning only supports a full-frame MEDIA layer.",
		);
	const geometry =
		media.fit === "COVER"
			? `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=increase,crop=${plan.width}:${plan.height}:x=(iw-ow)*${x}:y=(ih-oh)*${y}`
			: `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:x=(ow-iw)*${x}:y=(oh-ih)*${y}`;
	return `[0:v]${geometry},setsar=1,colorchannelmixer=aa=${ratio(media.opacityBasisPoints)}[base]`;
}

function frameEnable(startFrame: number, endFrame: number) {
	return `between(n,${startFrame},${endFrame - 1})`;
}

export async function buildT09FfmpegCommandPlan(input: {
	plan: T09RenderPlan;
	tool: ResolvedT09FfmpegTool;
	outputPath: T09ServerOwnedStagingPath;
}): Promise<T09FfmpegCommandPlan> {
	if (input.plan.executionGate !== "READY")
		throw new T09FfmpegCommandPlanError(
			"T09_PLAN_NOT_READY",
			"T09 FFmpeg command planning is blocked until the binary is approved.",
		);
	const parsedManifest = prototypeToolManifestSchema.safeParse(
		input.tool.manifest,
	);
	if (!parsedManifest.success)
		throw new T09FfmpegCommandPlanError(
			"T09_RESOLVED_TOOL_MANIFEST_INVALID",
			"The resolved FFmpeg tool manifest is invalid.",
		);
	const computedManifestIdentity = await sha256Hex(parsedManifest.data);
	if (
		input.plan.exactToolManifestIdentity !== input.tool.manifestIdentity ||
		input.tool.manifestIdentity !== computedManifestIdentity ||
		parsedManifest.data.approvalStatus !== "APPROVED"
	)
		throw new T09FfmpegCommandPlanError(
			"T09_PLAN_TOOL_MISMATCH",
			"The executable tool manifest does not exactly match the approved render plan.",
		);
	if (
		!parsedManifest.data.binarySha256 ||
		input.tool.binarySha256 !== parsedManifest.data.binarySha256
	)
		throw new T09FfmpegCommandPlanError(
			"T09_RESOLVED_TOOL_BINARY_MISMATCH",
			"The resolved FFmpeg bytes do not match the approved manifest.",
		);
	let outputPath: string;
	try {
		outputPath = assertT09ServerOwnedStagingPath(
			input.outputPath,
			"Output path",
		);
	} catch (error) {
		throw new T09FfmpegCommandPlanError(
			"T09_STAGING_PATH_INVALID",
			error instanceof Error ? error.message : "Output path is invalid.",
		);
	}
	if (resolve(input.outputPath.rootPath) !== resolve(input.plan.stagingRoot))
		throw new T09FfmpegCommandPlanError(
			"T09_STAGING_PATH_INVALID",
			"Output staging must use the same server-owned root as text staging.",
		);
	const mediaLayers = input.plan.renderLayers.filter(
		(layer): layer is Extract<typeof layer, { kind: "MEDIA" }> =>
			layer.kind === "MEDIA",
	);
	if (mediaLayers.length === 0 || input.plan.inputAssets.length !== 1)
		throw new T09FfmpegCommandPlanError(
			"RENDERER_FEATURE_UNSUPPORTED",
			"T09 requires one canonical MEDIA dependency.",
		);
	const media = mediaLayers[0];
	if (!media)
		throw new T09FfmpegCommandPlanError(
			"RENDERER_FEATURE_UNSUPPORTED",
			"T09 requires one canonical MEDIA dependency.",
		);
	const asset = input.plan.inputAssets.find(
		(candidate) => candidate.assetKey === media.sourceMediaKey,
	);
	if (!asset)
		throw new T09FfmpegCommandPlanError(
			"RENDERER_FEATURE_UNSUPPORTED",
			"T09 MEDIA source does not resolve to the planned input asset.",
		);
	const filterParts = [mediaFilter({ plan: input.plan, media })];
	let currentLabel = "base";
	const textOrder = new Map(
		input.plan.renderLayers
			.filter((layer) => layer.kind === "TEXT")
			.map((layer, index) => [layer.layerId, [layer.zIndex, index]]),
	);
	const lines = [...input.plan.materializedTextLines].sort((left, right) => {
		const leftOrder = textOrder.get(left.layerId) ?? [
			Number.MAX_SAFE_INTEGER,
			0,
		];
		const rightOrder = textOrder.get(right.layerId) ?? [
			Number.MAX_SAFE_INTEGER,
			0,
		];
		return (
			(leftOrder[0] ?? Number.MAX_SAFE_INTEGER) -
				(rightOrder[0] ?? Number.MAX_SAFE_INTEGER) ||
			left.line.lineIndex - right.line.lineIndex
		);
	});
	for (const [index, line] of lines.entries()) {
		const textLayer = input.plan.renderLayers.find(
			(layer): layer is Extract<typeof layer, { kind: "TEXT" }> =>
				layer.kind === "TEXT" && layer.layerId === line.layerId,
		);
		if (!textLayer)
			throw new T09FfmpegCommandPlanError(
				"RENDERER_FEATURE_UNSUPPORTED",
				`Text line ${line.layerId} has no canonical TEXT layer.`,
			);
		const nextLabel = `text${index}`;
		filterParts.push(
			`[${currentLabel}]drawtext=fontfile='${escapeFilterValue(absolutePath(line.fontFilePath, "Font path"))}':textfile='${escapeFilterValue(line.textFilePath)}':fontsize=${textLayer.fontSizePx}:fontcolor=${color(textLayer.colorRgba, textLayer.opacityBasisPoints)}:x=${line.line.xPx}:y=${line.line.baselineYPx - textLayer.fontSizePx}:enable='${frameEnable(line.startFrame, line.endFrame)}'[${nextLabel}]`,
		);
		currentLabel = nextLabel;
	}
	filterParts.push(`[${currentLabel}]format=yuv420p[vout]`);
	const filterGraph = filterParts.join(";");
	const fps = `${input.plan.fps.numerator}/${input.plan.fps.denominator}`;
	const argv = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-threads",
		"1",
		"-n",
		...input.plan.inputAssets.flatMap((candidate) => [
			"-loop",
			"1",
			"-framerate",
			fps,
			"-i",
			absolutePath(candidate.path, "Input asset path"),
		]),
		"-filter_complex",
		filterGraph,
		"-map",
		"[vout]",
		"-an",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-color_primaries",
		"bt709",
		"-color_trc",
		"bt709",
		"-colorspace",
		"bt709",
		"-b:v",
		"2000k",
		"-g",
		"30",
		"-keyint_min",
		"30",
		"-sc_threshold",
		"0",
		"-bf",
		"0",
		"-flags",
		"+cgop",
		"-r",
		fps,
		"-frames:v",
		String(input.plan.totalFrames),
		"-f",
		"mp4",
		outputPath,
	] as const;
	return {
		executablePath: input.tool.executablePath,
		argv,
		outputPath,
		filterGraph,
	};
}

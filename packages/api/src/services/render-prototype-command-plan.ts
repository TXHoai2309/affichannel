import { isAbsolute } from "node:path";
import type { T09RenderPlan } from "@affichannel/core";
import type { ResolvedT09FfmpegTool } from "./render-prototype-tool-resolver";

export type T09FfmpegCommandPlan = Readonly<{
	executablePath: string;
	argv: readonly string[];
	outputPath: string;
	filterGraph: string;
}>;

function escapeFilterValue(value: string): string {
	return value.replace(/[\\':,[\]]/g, (character) => `\\${character}`);
}

function absolutePath(value: string, label: string): string {
	if (!isAbsolute(value))
		throw new Error(`${label} must be an absolute server path.`);
	return value;
}

export function buildT09FfmpegCommandPlan(input: {
	plan: T09RenderPlan;
	tool: ResolvedT09FfmpegTool;
	outputPath: string;
}): T09FfmpegCommandPlan {
	if (input.plan.executionGate !== "READY")
		throw new Error(
			"T09 FFmpeg command planning is blocked until the binary is approved.",
		);
	const outputPath = absolutePath(input.outputPath, "Output path");
	const filterParts = [
		"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[base]",
	];
	let currentLabel = "base";
	for (const [index, line] of input.plan.materializedTextLines.entries()) {
		const nextLabel = `text${index}`;
		filterParts.push(
			`[${currentLabel}]drawtext=fontfile='${escapeFilterValue(absolutePath(line.fontFilePath, "Font path"))}':textfile='${escapeFilterValue(absolutePath(line.textFilePath, "Text path"))}':fontsize=${line.line.fontSizePx}:fontcolor=white:x=${line.line.xPx}:y=${line.line.baselineYPx - line.line.fontSizePx}:enable='between(n,${line.startFrame},${line.endFrame - 1})'[${nextLabel}]`,
		);
		currentLabel = nextLabel;
	}
	filterParts.push(`[${currentLabel}]format=yuv420p[vout]`);
	const filterGraph = filterParts.join(";");
	const argv = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-threads",
		"1",
		"-y",
		...input.plan.inputAssets.flatMap((asset) => [
			"-loop",
			"1",
			"-framerate",
			"30/1",
			"-i",
			absolutePath(asset.path, "Input asset path"),
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
		"30/1",
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

import { isAbsolute, resolve } from "node:path";
import {
	fingerprintT09PrototypeProfile,
	prototypeToolManifestSchema,
	sha256Hex,
	type T09RenderPlan,
	t09PrototypeOutputProfileSchema,
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
		| "T09_PROFILE_MISMATCH"
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

function decimalRatio(numerator: number, denominator: number) {
	if (
		!Number.isSafeInteger(numerator) ||
		!Number.isSafeInteger(denominator) ||
		denominator <= 0
	)
		throw new Error("UNSAFE_DECIMAL_RATIO");
	const whole = Math.floor(numerator / denominator);
	let remainder = numerator % denominator;
	const digits: number[] = [];
	for (let index = 0; index < 18; index += 1) {
		remainder *= 10;
		const digit = Math.floor(remainder / denominator);
		digits.push(digit);
		remainder %= denominator;
	}
	if (remainder * 2 >= denominator) {
		let index = digits.length - 1;
		while (index >= 0 && digits[index] === 9) {
			digits[index] = 0;
			index -= 1;
		}
		if (index >= 0) digits[index] = (digits[index] ?? 0) + 1;
		else return String(whole + 1);
	}
	const fraction = digits.join("").replace(/0+$/, "");
	return fraction ? `${whole}.${fraction}` : String(whole);
}

function ratio(basisPoints: number) {
	return decimalRatio(basisPoints, 10_000);
}

function alpha(colorAlpha: number, opacityBasisPoints: number) {
	return decimalRatio(colorAlpha * opacityBasisPoints, 255 * 10_000);
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
	const profile = plan.outputProfile;
	const x = ratio(media.objectPositionXBasisPoints);
	const y = ratio(media.objectPositionYBasisPoints);
	const box = media.box;
	if (
		box.xPx !== 0 ||
		box.yPx !== 0 ||
		box.widthPx !== profile.width ||
		box.heightPx !== profile.height
	)
		throw new T09FfmpegCommandPlanError(
			"RENDERER_FEATURE_UNSUPPORTED",
			"T09 FFmpeg planning only supports a full-frame MEDIA layer.",
		);
	const geometry =
		media.fit === "COVER"
			? `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=increase,crop=${profile.width}:${profile.height}:x=(iw-ow)*${x}:y=(ih-oh)*${y}`
			: `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:x=(ow-iw)*${x}:y=(oh-ih)*${y}`;
	if (profile.color !== "BT.709")
		throw new T09FfmpegCommandPlanError(
			"RENDERER_FEATURE_UNSUPPORTED",
			`T09 has no deterministic RGB conversion plan for ${profile.color}.`,
		);
	return `[0:v]${geometry},setsar=1,colorspace=all=bt709:iall=bt709:fast=0,colorchannelmixer=aa=${ratio(media.opacityBasisPoints)}[base]`;
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
	let profile: T09RenderPlan["outputProfile"];
	try {
		profile = t09PrototypeOutputProfileSchema.parse(input.plan.outputProfile);
		const profileFingerprint = await fingerprintT09PrototypeProfile(profile);
		if (profileFingerprint !== input.plan.outputProfileFingerprint)
			throw new Error("PROFILE_FINGERPRINT_MISMATCH");
		if (
			input.plan.width !== profile.width ||
			input.plan.height !== profile.height ||
			input.plan.fps.numerator !== profile.fps.numerator ||
			input.plan.fps.denominator !== profile.fps.denominator ||
			input.plan.expectedOutput.width !== profile.width ||
			input.plan.expectedOutput.height !== profile.height ||
			input.plan.expectedOutput.fps.numerator !== profile.fps.numerator ||
			input.plan.expectedOutput.fps.denominator !== profile.fps.denominator ||
			input.plan.expectedOutput.pixelFormat !== profile.pixelFormat ||
			input.plan.expectedOutput.audio !== null
		)
			throw new Error("PROFILE_PLAN_MISMATCH");
	} catch {
		throw new T09FfmpegCommandPlanError(
			"T09_PROFILE_MISMATCH",
			"The render plan output profile is invalid or does not match its fingerprint and output contract.",
		);
	}
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
	for (const textLayer of input.plan.renderLayers.filter(
		(layer): layer is Extract<typeof layer, { kind: "TEXT" }> =>
			layer.kind === "TEXT",
	)) {
		if (textLayer.textAlign !== "LEFT")
			throw new T09FfmpegCommandPlanError(
				"RENDERER_FEATURE_UNSUPPORTED",
				`T09 FFmpeg text planning only supports LEFT alignment; ${textLayer.layerId} is ${textLayer.textAlign}.`,
			);
		const expectedLines = textLayer.text
			.normalize("NFC")
			.replace(/\r\n?/g, "\n")
			.split("\n");
		const actualLines = lines
			.filter((line) => line.layerId === textLayer.layerId)
			.sort((left, right) => left.line.lineIndex - right.line.lineIndex);
		if (
			actualLines.length !== expectedLines.length ||
			actualLines.some((line, index) => line.line.text !== expectedLines[index])
		)
			throw new T09FfmpegCommandPlanError(
				"RENDERER_FEATURE_UNSUPPORTED",
				`T09 FFmpeg text planning requires explicit canonical hard lines for ${textLayer.layerId}.`,
			);
	}
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
			`[${currentLabel}]drawtext=fontfile='${escapeFilterValue(absolutePath(line.fontFilePath, "Font path"))}':textfile='${escapeFilterValue(line.textFilePath)}':expansion=none:y_align=baseline:fontsize=${textLayer.fontSizePx}:fontcolor=${color(textLayer.colorRgba, textLayer.opacityBasisPoints)}:x=${line.line.xPx}:y=${line.line.baselineYPx}:enable='${frameEnable(line.startFrame, line.endFrame)}'[${nextLabel}]`,
		);
		currentLabel = nextLabel;
	}
	filterParts.push(`[${currentLabel}]format=${profile.pixelFormat}[vout]`);
	const filterGraph = filterParts.join(";");
	const fps = `${profile.fps.numerator}/${profile.fps.denominator}`;
	if (profile.keyint !== profile.gop)
		throw new T09FfmpegCommandPlanError(
			"T09_PROFILE_MISMATCH",
			"T09 requires the profile GOP and keyint values to agree.",
		);
	const videoEncoder =
		profile.videoCodec === "H.264/AVC"
			? "libx264"
			: (() => {
					throw new T09FfmpegCommandPlanError(
						"RENDERER_FEATURE_UNSUPPORTED",
						`T09 has no encoder mapping for ${profile.videoCodec}.`,
					);
				})();
	if (profile.container !== "MP4")
		throw new T09FfmpegCommandPlanError(
			"RENDERER_FEATURE_UNSUPPORTED",
			`T09 has no container mapping for ${profile.container}.`,
		);
	if (profile.audio !== "NONE")
		throw new T09FfmpegCommandPlanError(
			"RENDERER_FEATURE_UNSUPPORTED",
			`T09 prototype audio mode ${profile.audio} is unsupported.`,
		);
	const colorMetadata: readonly [string, string, string] =
		profile.color === "BT.709"
			? ["bt709", "bt709", "bt709"]
			: (() => {
					throw new T09FfmpegCommandPlanError(
						"RENDERER_FEATURE_UNSUPPORTED",
						`T09 has no color metadata mapping for ${profile.color}.`,
					);
				})();
	const argv = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-threads",
		String(profile.threads),
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
		videoEncoder,
		"-pix_fmt",
		profile.pixelFormat,
		"-color_primaries",
		colorMetadata[0],
		"-color_trc",
		colorMetadata[1],
		"-colorspace",
		colorMetadata[2],
		"-b:v",
		`${profile.videoBitrateKbps}k`,
		"-g",
		String(profile.keyint),
		"-keyint_min",
		String(profile.minKeyint),
		"-sc_threshold",
		profile.scenecut ? "1" : "0",
		"-bf",
		String(profile.bFrames),
		"-flags",
		profile.closedGop ? "+cgop" : "-cgop",
		"-r",
		fps,
		"-frames:v",
		String(input.plan.totalFrames),
		"-f",
		profile.container.toLowerCase(),
		outputPath,
	] as const;
	return {
		executablePath: input.tool.executablePath,
		argv,
		outputPath,
		filterGraph,
	};
}

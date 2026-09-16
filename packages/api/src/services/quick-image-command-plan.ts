import {
	CENTER_ZOOM_IN_V1,
	fingerprintVideoOnlyOutputProfile,
	type QuickImageRenderPlan,
	type VideoOnlyOutputProfile,
} from "@affichannel/core";
import {
	assertQuickImageServerOwnedPath,
	type QuickImageServerOwnedPath,
} from "./quick-image-materialization";

export const QUICK_IMAGE_COMMAND_PLAN_SCHEMA_VERSION =
	"quick-image-command-plan.v1" as const;
export const QUICK_IMAGE_TOOL_BINDING = "US22_TOOL_APPROVAL_REQUIRED" as const;

export type QuickImageCommandPlan = Readonly<{
	schemaVersion: typeof QUICK_IMAGE_COMMAND_PLAN_SCHEMA_VERSION;
	kind: "QUICK_IMAGE";
	renderPlanFingerprint: string;
	toolBinding: typeof QUICK_IMAGE_TOOL_BINDING;
	executablePath: null;
	shell: false;
	inputPath: QuickImageServerOwnedPath;
	outputPath: QuickImageServerOwnedPath;
	filterGraph: string;
	argv: readonly string[];
}>;

function canonicalNumber(value: number, label: string) {
	if (!Number.isFinite(value) || value <= 0)
		throw new Error(`${label} must be a positive finite number.`);
	return String(value);
}

function ceilToEvenRatio(
	numerator: bigint,
	denominator: bigint,
	label: string,
) {
	const roundedUp =
		numerator % denominator === BigInt(0)
			? numerator / denominator
			: numerator / denominator + BigInt(1);
	const even =
		roundedUp % BigInt(2) === BigInt(0) ? roundedUp : roundedUp + BigInt(1);
	if (even > BigInt(Number.MAX_SAFE_INTEGER))
		throw new Error(`${label} exceeds the safe integer range.`);
	return Number(even);
}

export type QuickImageCoverRasterPlan = Readonly<{
	branch: "WIDER_OR_EQUAL" | "NARROWER";
	semanticBaseScale: number;
	scaledWidth: number;
	scaledHeight: number;
	cropWidth: number;
	cropHeight: number;
	cropX: number;
	cropY: number;
	roundingRule: "EVEN_CEIL_SCALE_CENTERED_INTEGER_CROP";
}>;

/**
 * Compiles the shared C1 centered-cover geometry into an integer raster step.
 * The scale keeps the limiting dimension exact, rounds only the overflowing
 * dimension up to an even pixel count, and then performs one centered crop.
 */
export function compileQuickImageCoverRaster(
	plan: QuickImageRenderPlan,
): QuickImageCoverRasterPlan {
	const { source, outputProfile: profile } = plan;
	const viewportWidth = profile.width;
	const viewportHeight = profile.height;
	const sourceWidth = source.width;
	const sourceHeight = source.height;
	const semanticBaseScale = Math.max(
		profile.width / source.width,
		profile.height / source.height,
	);
	const widerOrEqual =
		BigInt(sourceWidth) * BigInt(viewportHeight) >=
		BigInt(sourceHeight) * BigInt(viewportWidth);
	const scaledWidth = widerOrEqual
		? ceilToEvenRatio(
				BigInt(sourceWidth) * BigInt(viewportHeight),
				BigInt(sourceHeight),
				"Quick Image scaled width",
			)
		: viewportWidth;
	const scaledHeight = widerOrEqual
		? viewportHeight
		: ceilToEvenRatio(
				BigInt(sourceHeight) * BigInt(viewportWidth),
				BigInt(sourceWidth),
				"Quick Image scaled height",
			);
	if (
		!Number.isSafeInteger(scaledWidth) ||
		!Number.isSafeInteger(scaledHeight) ||
		scaledWidth < viewportWidth ||
		scaledHeight < viewportHeight
	)
		throw new Error("QUICK_IMAGE_COVER_RASTER_INVALID");
	const cropX = (scaledWidth - viewportWidth) / 2;
	const cropY = (scaledHeight - viewportHeight) / 2;
	if (!Number.isInteger(cropX) || !Number.isInteger(cropY))
		throw new Error("QUICK_IMAGE_COVER_CROP_NOT_CENTERED");
	return {
		branch: widerOrEqual ? "WIDER_OR_EQUAL" : "NARROWER",
		semanticBaseScale,
		scaledWidth,
		scaledHeight,
		cropWidth: viewportWidth,
		cropHeight: viewportHeight,
		cropX,
		cropY,
		roundingRule: "EVEN_CEIL_SCALE_CENTERED_INTEGER_CROP",
	};
}

export type QuickImageCompiledMotion = Readonly<{
	kind: typeof CENTER_ZOOM_IN_V1.kind;
	startScale: number;
	endScale: number;
	delta: number;
	finalFrame: number;
	expression: string;
}>;

/** Compiles motion from the validated RenderPlan, never from local literals. */
export function compileQuickImageMotion(
	plan: QuickImageRenderPlan,
): QuickImageCompiledMotion {
	const motion = plan.motion;
	if (
		motion.kind !== CENTER_ZOOM_IN_V1.kind ||
		motion.anchor !== CENTER_ZOOM_IN_V1.anchor ||
		motion.startScale !== CENTER_ZOOM_IN_V1.startScale ||
		motion.endScale !== CENTER_ZOOM_IN_V1.endScale ||
		motion.interpolation !== CENTER_ZOOM_IN_V1.interpolation ||
		motion.timing !== CENTER_ZOOM_IN_V1.timing ||
		motion.randomness !== CENTER_ZOOM_IN_V1.randomness ||
		motion.pan !== CENTER_ZOOM_IN_V1.pan ||
		motion.customization !== CENTER_ZOOM_IN_V1.customization
	)
		throw new Error("QUICK_IMAGE_MOTION_UNSUPPORTED");
	const finalFrame = plan.timeline.totalFrames - 1;
	const startScale = Number(
		canonicalNumber(motion.startScale, "Quick Image motion start scale"),
	);
	const endScale = Number(
		canonicalNumber(motion.endScale, "Quick Image motion end scale"),
	);
	const delta = endScale - startScale;
	canonicalNumber(delta, "Quick Image motion delta");
	return {
		kind: motion.kind,
		startScale,
		endScale,
		delta,
		finalFrame,
		expression: `${startScale}+(${endScale}-${startScale})*on/${finalFrame}`,
	};
}

export type QuickImageCompiledColorMetadata = Readonly<{
	profileColorRange: VideoOnlyOutputProfile["colorRange"];
	colorRange: "tv";
	primaries: "bt709";
	transfer: "bt709";
	colorspace: "bt709";
}>;

/** Narrow profile-to-FFmpeg mapping; the profile remains the only authority. */
export function compileQuickImageColorMetadata(
	profile: VideoOnlyOutputProfile,
): QuickImageCompiledColorMetadata {
	if (profile.colorRange !== "LIMITED_TV")
		throw new Error("QUICK_IMAGE_COLOR_RANGE_UNSUPPORTED");
	if (
		profile.colorPrimaries !== "BT.709" ||
		profile.colorTransfer !== "BT.709" ||
		profile.colorSpace !== "BT.709"
	)
		throw new Error("QUICK_IMAGE_COLOR_METADATA_UNSUPPORTED");
	return {
		profileColorRange: profile.colorRange,
		colorRange: "tv",
		primaries: "bt709",
		transfer: "bt709",
		colorspace: "bt709",
	};
}

function compileQuickImageVideoCodec(
	videoCodec: VideoOnlyOutputProfile["videoCodec"],
) {
	if (videoCodec !== "H.264/AVC")
		throw new Error("QUICK_IMAGE_VIDEO_CODEC_UNSUPPORTED");
	return "libx264" as const;
}

function buildFilterGraph(plan: QuickImageRenderPlan) {
	const { outputProfile: profile } = plan;
	const raster = compileQuickImageCoverRaster(plan);
	const motion = compileQuickImageMotion(plan);
	const color = compileQuickImageColorMetadata(profile);
	const fps = `${profile.fps.numerator}/${profile.fps.denominator}`;
	return (
		"[0:v]" +
		[
			`scale=w=${raster.scaledWidth}:h=${raster.scaledHeight}:flags=lanczos`,
			`crop=w=${raster.cropWidth}:h=${raster.cropHeight}:x=${raster.cropX}:y=${raster.cropY}`,
			`zoompan=z='${motion.expression}':x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':d=1:s=${profile.width}x${profile.height}:fps=${fps}`,
			`format=${profile.pixelFormat}`,
			`setrange=${color.colorRange}`,
			`colorspace=all=${color.colorspace}:iall=${color.colorspace}:fast=0`,
		].join(",") +
		"[vout]"
	);
}

/**
 * Pure Quick Image command compilation. It returns an argument array only;
 * D2 owns approved-tool resolution and process execution.
 */
export async function buildQuickImageCommandPlan(input: {
	plan: QuickImageRenderPlan;
	inputPath: QuickImageServerOwnedPath;
	outputPath: QuickImageServerOwnedPath;
}): Promise<QuickImageCommandPlan> {
	const inputPath = assertQuickImageServerOwnedPath(
		input.inputPath,
		"Quick Image input path",
	);
	const outputPath = assertQuickImageServerOwnedPath(
		input.outputPath,
		"Quick Image output path",
	);
	const profileFingerprint = await fingerprintVideoOnlyOutputProfile(
		input.plan.outputProfile,
	);
	if (profileFingerprint !== input.plan.outputProfileFingerprint)
		throw new Error("QUICK_IMAGE_COMMAND_PROFILE_MISMATCH");

	const profile = input.plan.outputProfile;
	if (profile.audio !== "NONE")
		throw new Error("QUICK_IMAGE_AUDIO_UNSUPPORTED");
	if (profile.gop !== profile.keyint)
		throw new Error("QUICK_IMAGE_PROFILE_GOP_KEYINT_MISMATCH");
	const fps = `${profile.fps.numerator}/${profile.fps.denominator}`;
	const color = compileQuickImageColorMetadata(profile);
	const videoCodec = compileQuickImageVideoCodec(profile.videoCodec);
	const filterGraph = buildFilterGraph(input.plan);
	const argv = [
		"-hide_banner",
		"-loglevel",
		"error",
		"-threads",
		String(profile.threads),
		"-n",
		"-loop",
		"1",
		"-framerate",
		fps,
		"-i",
		inputPath,
		"-filter_complex",
		filterGraph,
		"-map",
		"[vout]",
		"-an",
		"-c:v",
		videoCodec,
		"-pix_fmt",
		profile.pixelFormat,
		"-color_primaries",
		color.primaries,
		"-color_trc",
		color.transfer,
		"-colorspace",
		color.colorspace,
		"-color_range",
		color.colorRange,
		"-b:v",
		`${profile.videoBitrateKbps}k`,
		"-g",
		String(profile.gop),
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
		String(input.plan.timeline.totalFrames),
		"-f",
		profile.container.toLowerCase(),
		"-use_editlist",
		"0",
		outputPath,
	] as const;

	return Object.freeze({
		schemaVersion: QUICK_IMAGE_COMMAND_PLAN_SCHEMA_VERSION,
		kind: "QUICK_IMAGE" as const,
		renderPlanFingerprint: input.plan.planFingerprint,
		toolBinding: QUICK_IMAGE_TOOL_BINDING,
		executablePath: null,
		shell: false as const,
		inputPath: input.inputPath,
		outputPath: input.outputPath,
		filterGraph,
		argv: Object.freeze([...argv]),
	});
}

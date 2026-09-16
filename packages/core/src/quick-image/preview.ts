import type { CompositionProfile } from "../composition/profile";
import { CENTER_ZOOM_IN_V1 } from "./motion";

export type QuickImagePreviewFrame = Readonly<{
	frameIndex: number;
	totalFrames: number;
	progress: number;
	zoom: number;
}>;

export type QuickImagePreviewGeometry = Readonly<
	QuickImagePreviewFrame & {
		sourceWidth: number;
		sourceHeight: number;
		viewportWidth: number;
		viewportHeight: number;
		baseScale: number;
		finalScale: number;
		renderedWidth: number;
		renderedHeight: number;
		x: number;
		y: number;
	}
>;

export type QuickImagePreviewFrameIndexInput = Readonly<{
	elapsedSeconds: number;
	totalFrames: number;
	fps: Readonly<{ numerator: number; denominator: number }>;
}>;

function validFrameDomain(frameIndex: number, totalFrames: number) {
	return (
		Number.isSafeInteger(frameIndex) &&
		frameIndex >= 0 &&
		Number.isSafeInteger(totalFrames) &&
		totalFrames >= 2 &&
		frameIndex < totalFrames
	);
}

function validDimensions(width: number, height: number) {
	return (
		Number.isSafeInteger(width) &&
		width > 0 &&
		Number.isSafeInteger(height) &&
		height > 0
	);
}

/** The canonical integer-frame progress for CENTER_ZOOM_IN_V1. */
export function resolveQuickImageFrameProgress(
	frameIndex: number,
	totalFrames: number,
): number | null {
	if (!validFrameDomain(frameIndex, totalFrames)) return null;
	return frameIndex / (totalFrames - 1);
}

/** Resolves the canonical zoom without any browser or renderer state. */
export function resolveQuickImageZoomForFrame(
	frameIndex: number,
	totalFrames: number,
): number | null {
	const progress = resolveQuickImageFrameProgress(frameIndex, totalFrames);
	if (progress === null) return null;
	return (
		CENTER_ZOOM_IN_V1.startScale +
		(CENTER_ZOOM_IN_V1.endScale - CENTER_ZOOM_IN_V1.startScale) * progress
	);
}

/** Maps elapsed playback time to the authoritative integer frame index. */
export function resolveQuickImageFrameIndex(
	input: QuickImagePreviewFrameIndexInput,
): number | null {
	if (
		!Number.isFinite(input.elapsedSeconds) ||
		input.elapsedSeconds < 0 ||
		!Number.isSafeInteger(input.totalFrames) ||
		input.totalFrames < 2 ||
		!Number.isSafeInteger(input.fps.numerator) ||
		input.fps.numerator <= 0 ||
		!Number.isSafeInteger(input.fps.denominator) ||
		input.fps.denominator <= 0
	)
		return null;
	const rawFrame = Math.floor(
		(input.elapsedSeconds * input.fps.numerator) / input.fps.denominator,
	);
	return Math.min(input.totalFrames - 1, Math.max(0, rawFrame));
}

/** Resolves centered cover geometry for one exact integer frame. */
export function resolveQuickImageCoverGeometry(input: {
	frameIndex: number;
	totalFrames: number;
	sourceWidth: number;
	sourceHeight: number;
	profile: Pick<CompositionProfile, "logicalWidth" | "logicalHeight">;
}): QuickImagePreviewGeometry | null {
	if (
		!validFrameDomain(input.frameIndex, input.totalFrames) ||
		!validDimensions(input.sourceWidth, input.sourceHeight) ||
		!validDimensions(input.profile.logicalWidth, input.profile.logicalHeight)
	)
		return null;
	const progress = resolveQuickImageFrameProgress(
		input.frameIndex,
		input.totalFrames,
	);
	const zoom = resolveQuickImageZoomForFrame(
		input.frameIndex,
		input.totalFrames,
	);
	if (progress === null || zoom === null) return null;
	const baseScale = Math.max(
		input.profile.logicalWidth / input.sourceWidth,
		input.profile.logicalHeight / input.sourceHeight,
	);
	const finalScale = baseScale * zoom;
	const renderedWidth = input.sourceWidth * finalScale;
	const renderedHeight = input.sourceHeight * finalScale;
	return {
		frameIndex: input.frameIndex,
		totalFrames: input.totalFrames,
		progress,
		zoom,
		sourceWidth: input.sourceWidth,
		sourceHeight: input.sourceHeight,
		viewportWidth: input.profile.logicalWidth,
		viewportHeight: input.profile.logicalHeight,
		baseScale,
		finalScale,
		renderedWidth,
		renderedHeight,
		x: (input.profile.logicalWidth - renderedWidth) / 2,
		y: (input.profile.logicalHeight - renderedHeight) / 2,
	};
}

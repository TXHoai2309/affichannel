import {
	resolveQuickImageCoverGeometry,
	resolveQuickImageFrameIndex,
	resolveQuickImageFrameProgress,
	resolveQuickImageZoomForFrame,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const profile = { logicalWidth: 1080, logicalHeight: 1920 } as const;

describe("AFF-US-022-C Quick Image preview core", () => {
	it.each([
		[5, 150],
		[10, 300],
		[15, 450],
	] as const)(
		"uses canonical duration frame count %s -> %s",
		(_seconds, frames) => {
			expect(resolveQuickImageFrameProgress(0, frames)).toBe(0);
			expect(resolveQuickImageFrameProgress(frames - 1, frames)).toBe(1);
		},
	);

	it("uses exact integer-frame progress and zoom", () => {
		expect(resolveQuickImageFrameProgress(0, 300)).toBe(0);
		expect(resolveQuickImageZoomForFrame(0, 300)).toBe(1);
		expect(resolveQuickImageFrameProgress(150, 300)).toBe(150 / 299);
		expect(resolveQuickImageZoomForFrame(150, 300)).toBeCloseTo(
			1 + 0.08 * (150 / 299),
			12,
		);
		expect(resolveQuickImageZoomForFrame(299, 300)).toBe(1.08);
	});

	it("maps time by floor and clamps at the final frame", () => {
		const fps = { numerator: 30, denominator: 1 } as const;
		expect(
			resolveQuickImageFrameIndex({ elapsedSeconds: 0, totalFrames: 150, fps }),
		).toBe(0);
		expect(
			resolveQuickImageFrameIndex({
				elapsedSeconds: 1 / 30 - 1e-6,
				totalFrames: 150,
				fps,
			}),
		).toBe(0);
		expect(
			resolveQuickImageFrameIndex({
				elapsedSeconds: 1 / 30,
				totalFrames: 150,
				fps,
			}),
		).toBe(1);
		expect(
			resolveQuickImageFrameIndex({
				elapsedSeconds: 4.999,
				totalFrames: 150,
				fps,
			}),
		).toBe(149);
		expect(
			resolveQuickImageFrameIndex({ elapsedSeconds: 5, totalFrames: 150, fps }),
		).toBe(149);
		expect(
			resolveQuickImageFrameIndex({
				elapsedSeconds: 99,
				totalFrames: 150,
				fps,
			}),
		).toBe(149);
	});

	it("resolves centered cover at base scale and final zoom", () => {
		const base = resolveQuickImageCoverGeometry({
			frameIndex: 0,
			totalFrames: 150,
			sourceWidth: 800,
			sourceHeight: 600,
			profile,
		});
		const final = resolveQuickImageCoverGeometry({
			frameIndex: 149,
			totalFrames: 150,
			sourceWidth: 800,
			sourceHeight: 600,
			profile,
		});
		expect(base).toMatchObject({
			zoom: 1,
			baseScale: 1920 / 600,
			finalScale: 1920 / 600,
			x: (1080 - 800 * (1920 / 600)) / 2,
			y: 0,
		});
		expect(final?.zoom).toBe(1.08);
		expect(final?.x).toBe((1080 - 800 * (1920 / 600) * 1.08) / 2);
		expect(final?.y).toBe((1920 - 600 * (1920 / 600) * 1.08) / 2);
	});

	it.each([
		["portrait", 600, 1200],
		["exact 9:16", 1080, 1920],
		["very wide", 2400, 400],
		["very tall", 400, 2400],
	] as const)(
		"covers %s sources while keeping the visual center",
		(_label, width, height) => {
			for (const frameIndex of [0, 149]) {
				const geometry = resolveQuickImageCoverGeometry({
					frameIndex,
					totalFrames: 150,
					sourceWidth: width,
					sourceHeight: height,
					profile,
				});
				expect(geometry).not.toBeNull();
				expect(geometry?.renderedWidth).toBeGreaterThanOrEqual(
					profile.logicalWidth,
				);
				expect(geometry?.renderedHeight).toBeGreaterThanOrEqual(
					profile.logicalHeight,
				);
				expect(geometry?.x).toBe(
					(profile.logicalWidth - (geometry?.renderedWidth ?? 0)) / 2,
				);
				expect(geometry?.y).toBe(
					(profile.logicalHeight - (geometry?.renderedHeight ?? 0)) / 2,
				);
			}
		},
	);

	it("fails closed for invalid frame domains, time, and dimensions", () => {
		expect(resolveQuickImageFrameProgress(-1, 150)).toBeNull();
		expect(resolveQuickImageFrameProgress(150, 150)).toBeNull();
		expect(resolveQuickImageZoomForFrame(0, 1)).toBeNull();
		expect(
			resolveQuickImageFrameIndex({
				elapsedSeconds: -1,
				totalFrames: 150,
				fps: { numerator: 30, denominator: 1 },
			}),
		).toBeNull();
		expect(
			resolveQuickImageCoverGeometry({
				frameIndex: 0,
				totalFrames: 150,
				sourceWidth: 0,
				sourceHeight: 600,
				profile,
			}),
		).toBeNull();
	});
});

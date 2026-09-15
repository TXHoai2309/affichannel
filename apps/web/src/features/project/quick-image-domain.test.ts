import {
	CENTER_ZOOM_IN_V1,
	QUICK_IMAGE_FPS,
	quickImageDurationSecondsSchema,
	quickImageProjectInputSchema,
	resolveQuickImageDuration,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

describe("AFF-US-022 Quick Image Slice 1 domain", () => {
	it("accepts the explicit Quick Image request boundary without Content Brief fields", () => {
		const result = quickImageProjectInputSchema.safeParse({
			name: "Quick Image project",
			productId: null,
			contentType: "ORGANIC",
			creationPath: "QUICK_IMAGE",
			contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 1 },
			quickImage: { durationSeconds: 5 },
		});

		expect(result.success).toBe(true);
	});

	it("requires explicit Quick Image duration input", () => {
		const result = quickImageProjectInputSchema.safeParse({
			name: "Quick Image project",
			productId: null,
			contentType: "ORGANIC",
			creationPath: "QUICK_IMAGE",
			contentFormat: { key: "QUICK_IMAGE_STANDARD", version: 1 },
		});

		expect(result.success).toBe(false);
	});

	it.each([
		[5, 150],
		[10, 300],
		[15, 450],
	] as const)("resolves %s seconds to %s frames at 30/1", (seconds, frames) => {
		expect(resolveQuickImageDuration(seconds)).toEqual({
			seconds,
			totalFrames: frames,
			fps: QUICK_IMAGE_FPS,
		});
	});

	it.each([0, -1, 7, 5.5, Number.NaN, Number.POSITIVE_INFINITY, "5", 30])(
		"rejects invalid duration %s",
		(value) => {
			expect(resolveQuickImageDuration(value)).toBeNull();
			expect(quickImageDurationSecondsSchema.safeParse(value).success).toBe(
				false,
			);
		},
	);

	it("exposes the exact immutable CENTER_ZOOM_IN_V1 contract", () => {
		expect(CENTER_ZOOM_IN_V1).toEqual({
			kind: "CENTER_ZOOM_IN_V1",
			anchor: "CENTER",
			startScale: 1,
			endScale: 1.08,
			interpolation: "LINEAR_BY_FRAME",
			timing: "INTEGER_FRAME_INDEX",
			randomness: "NONE",
			pan: "NONE",
			customization: "NONE",
		});
		expect(Object.isFrozen(CENTER_ZOOM_IN_V1)).toBe(true);
	});
});

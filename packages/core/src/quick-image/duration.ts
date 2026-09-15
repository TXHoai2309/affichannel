import { z } from "zod";

import { QUICK_IMAGE_FPS } from "./types";

export const QUICK_IMAGE_DURATION_SECONDS = [5, 10, 15] as const;

export type QuickImageDurationSeconds =
	(typeof QUICK_IMAGE_DURATION_SECONDS)[number];

export const quickImageDurationSecondsSchema = z.union([
	z.literal(5),
	z.literal(10),
	z.literal(15),
]);

export type QuickImageDuration = Readonly<{
	seconds: QuickImageDurationSeconds;
	totalFrames: number;
	fps: typeof QUICK_IMAGE_FPS;
}>;

const FRAME_COUNT_BY_DURATION: Readonly<
	Record<QuickImageDurationSeconds, number>
> = Object.freeze({
	5: 150,
	10: 300,
	15: 450,
});

export function resolveQuickImageDuration(
	value: unknown,
): QuickImageDuration | null {
	const parsed = quickImageDurationSecondsSchema.safeParse(value);
	if (!parsed.success) return null;

	return Object.freeze({
		seconds: parsed.data,
		totalFrames: FRAME_COUNT_BY_DURATION[parsed.data],
		fps: QUICK_IMAGE_FPS,
	});
}

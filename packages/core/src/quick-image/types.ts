import { z } from "zod";

import { CONTENT_FORMAT_DEFAULTS } from "../content-format/registry";
import { CONTENT_TYPES } from "../project/channel-first-types";

export const QUICK_IMAGE_FPS = Object.freeze({
	numerator: 30,
	denominator: 1,
} as const);

export const quickImageIdentitySchema = z
	.object({
		contentType: z.enum(CONTENT_TYPES),
		creationPath: z.literal("QUICK_IMAGE"),
		contentFormat: z
			.object({
				key: z.literal(CONTENT_FORMAT_DEFAULTS.QUICK_IMAGE.key),
				version: z.literal(CONTENT_FORMAT_DEFAULTS.QUICK_IMAGE.version),
			})
			.strict(),
	})
	.strict();

export type QuickImageIdentity = z.infer<typeof quickImageIdentitySchema>;

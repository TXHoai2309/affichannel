import { z } from "zod";

const requiredText = (max: number) => z.string().trim().min(1).max(max);

const uniqueStrings = (values: string[]) =>
	new Set(values.map((value) => value.trim().toLocaleLowerCase("vi-VN")))
		.size === values.length;

export const channelSettingsSchema = z
	.object({
		niche: requiredText(500),
		targetAudience: requiredText(500),
		tone: requiredText(500),
		contentPillar: requiredText(500),
		defaultCta: requiredText(500),
		affiliateDisclosure: requiredText(500),
		avoidWords: z
			.array(requiredText(80))
			.max(50)
			.refine(uniqueStrings, "avoidWords must be unique."),
	})
	.strict();

export type ChannelSettings = z.infer<typeof channelSettingsSchema>;

export const aiSettingsSchema = z
	.object({
		textProvider: requiredText(100),
		textModel: requiredText(200),
	})
	.strict();

export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const outputRulesSchema = z
	.object({
		language: z.literal("vi-VN"),
		aspectRatio: z.literal("9:16"),
		subtitleSafeArea: z.literal("standard"),
		claimLimit: z.number().int().positive().nullable(),
		requireFinalCta: z.literal(true),
	})
	.strict();

export type OutputRules = z.infer<typeof outputRulesSchema>;

export const mediaMetadataSchema = z
	.object({
		id: requiredText(120),
		mediaType: z.enum(["image", "video", "audio"]),
		aspectRatio: requiredText(32),
		durationSeconds: z.number().int().nonnegative().nullable(),
		usageRights: z.enum(["owned", "licensed", "unknown", "restricted"]),
		status: z.enum(["ready", "needs_review", "archived"]),
		sceneSuitability: requiredText(120),
		tags: z
			.array(requiredText(80))
			.max(50)
			.refine(uniqueStrings, "tags must be unique."),
		reference: z
			.object({
				displayName: requiredText(240),
				referenceUrl: z.string().trim().url().max(2_048).nullable(),
			})
			.strict(),
	})
	.strict();

export type MediaMetadataSnapshot = z.infer<typeof mediaMetadataSchema>;

export const defaultOutputRules: OutputRules = {
	language: "vi-VN",
	aspectRatio: "9:16",
	subtitleSafeArea: "standard",
	claimLimit: null,
	requireFinalCta: true,
};

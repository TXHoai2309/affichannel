import { z } from "zod";
import {
	getContentFormatDefinition,
	INITIAL_CONTENT_FORMAT_REGISTRY,
} from "./content-format/registry";
import {
	CREATION_PATHS,
	type CreationPath,
} from "./project/channel-first-types";

export const CHANNEL_STRATEGY_PRESENCE_MODES = [
	"FACELESS",
	"FACE_PREFERRED",
	"FLEXIBLE",
] as const;

export type ChannelStrategyPresenceMode =
	(typeof CHANNEL_STRATEGY_PRESENCE_MODES)[number];

const normalizedText = (max: number) => z.string().trim().min(1).max(max);

const uniqueNormalizedStrings = (values: string[]) =>
	new Set(values.map((value) => value.toLocaleLowerCase("vi-VN"))).size ===
	values.length;

const contentPillarsSchema = z
	.array(normalizedText(160))
	.min(3)
	.max(5)
	.refine(uniqueNormalizedStrings, "Content pillars must be unique.");

const contentSeriesSchema = z
	.array(normalizedText(160))
	.min(1)
	.max(20)
	.refine(uniqueNormalizedStrings, "Content series must be unique.");

const preferredCreationPathsSchema = z
	.array(z.enum(CREATION_PATHS))
	.min(1)
	.max(CREATION_PATHS.length)
	.refine(
		(values) => new Set(values).size === values.length,
		"Preferred CreationPaths must be unique.",
	);

export const channelStrategyContentFormatRefSchema = z
	.object({
		key: normalizedText(120),
		version: z.number().int().positive(),
	})
	.strict();

const preferredContentFormatsSchema = z
	.array(channelStrategyContentFormatRefSchema)
	.min(1)
	.max(INITIAL_CONTENT_FORMAT_REGISTRY.length)
	.superRefine((values, context) => {
		const identities = new Set<string>();
		for (const [index, value] of values.entries()) {
			const identity = `${value.key}\u0000${value.version}`;
			if (identities.has(identity)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [index],
					message: "Preferred ContentFormats must be unique.",
				});
			}
			identities.add(identity);
			if (!getContentFormatDefinition(value)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [index],
					message: "Preferred ContentFormat is not canonical.",
				});
			}
		}
	});

export const channelStrategyPostingFrequencySchema = z
	.object({
		postsPerWeek: z.number().int().min(1).max(7),
		preferredDays: z
			.array(z.number().int().min(0).max(6))
			.max(7)
			.refine(
				(values) => new Set(values).size === values.length,
				"Preferred posting days must be unique.",
			),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.preferredDays.length > value.postsPerWeek) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["preferredDays"],
				message: "Preferred posting days cannot exceed posts per week.",
			});
		}
	});

export const channelStrategyMixTargetSchema = z
	.object({
		organicPercentage: z.number().int().min(0).max(100),
		affiliatePercentage: z.number().int().min(0).max(100),
	})
	.strict()
	.refine(
		(value) => value.organicPercentage + value.affiliatePercentage === 100,
		"Organic and Affiliate percentages must total 100.",
	);

export const channelStrategyInputSchema = z
	.object({
		niche: normalizedText(500),
		targetAudience: normalizedText(500),
		presenceMode: z.enum(CHANNEL_STRATEGY_PRESENCE_MODES),
		tone: normalizedText(500),
		contentPillars: contentPillarsSchema,
		contentSeries: contentSeriesSchema,
		preferredCreationPaths: preferredCreationPathsSchema,
		preferredContentFormats: preferredContentFormatsSchema,
		postingFrequency: channelStrategyPostingFrequencySchema,
		visualStyle: normalizedText(500),
		organicAffiliateMixTarget: channelStrategyMixTargetSchema,
	})
	.strict()
	.superRefine((value, context) => {
		for (const [index, format] of value.preferredContentFormats.entries()) {
			const definition = getContentFormatDefinition(format);
			if (
				definition &&
				!value.preferredCreationPaths.some((path) =>
					definition.supportedCreationPaths.includes(path),
				)
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["preferredContentFormats", index],
					message: "ContentFormat does not match preferred CreationPaths.",
				});
			}
		}
	});

export const channelStrategySaveInputSchema = channelStrategyInputSchema.extend(
	{
		expectedVersion: z.number().int().positive().nullable(),
	},
);

export type ChannelStrategyInput = z.infer<typeof channelStrategyInputSchema>;
export type ChannelStrategySaveInput = z.infer<
	typeof channelStrategySaveInputSchema
>;

export type ChannelStrategyReadModel = ChannelStrategyInput & {
	id: string;
	workspaceId: string;
	version: number;
	createdByUserId: string;
	updatedByUserId: string;
	createdAt: Date;
	updatedAt: Date;
};

export type ProjectChannelStrategySnapshot = Readonly<{
	id: string;
	version: number;
}>;

export type PreferredCreationPath = CreationPath;

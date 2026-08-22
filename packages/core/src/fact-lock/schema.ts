import { z } from "zod";
import {
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	factLockClassifications,
	factLockFactRelations,
} from "./types";

const occurrence = z.union([
	z
		.object({
			section: z.literal("hook"),
			hookKey: z.string().trim().min(1).max(120),
		})
		.strict(),
	z
		.object({
			section: z.literal("voiceover"),
			segmentKey: z.string().trim().min(1).max(120),
		})
		.strict(),
	z
		.object({
			section: z.literal("scene"),
			sceneOrder: z.number().int().positive(),
		})
		.strict(),
	z.object({ section: z.literal("cta") }).strict(),
	z.object({ section: z.literal("caption") }).strict(),
]);

export const factLockProviderClaimSchema = z
	.object({
		claimKey: z.string().trim().min(1).max(120),
		claimText: z.string().trim().min(1).max(4_000),
		occurrence,
		classificationStatus: z.enum(factLockClassifications),
		reason: z.string().trim().min(1).max(2_000),
		confidence: z.number().min(0).max(1).nullable().optional().default(null),
		suggestionText: z
			.string()
			.trim()
			.max(4_000)
			.nullable()
			.optional()
			.default(null),
		factMappings: z
			.array(
				z
					.object({
						factId: z.string().trim().min(1).max(120),
						relation: z.enum(factLockFactRelations),
					})
					.strict(),
			)
			.max(32),
	})
	.strict();

export const factLockProviderOutputSchema = z
	.object({
		schemaVersion: z.literal(FACT_LOCK_OUTPUT_SCHEMA_VERSION),
		claims: z.array(factLockProviderClaimSchema).max(64),
	})
	.strict()
	.superRefine((output, context) => {
		const keys = output.claims.map((claim) => claim.claimKey);
		if (new Set(keys).size !== keys.length) {
			context.addIssue({
				code: "custom",
				path: ["claims"],
				message: "Claim keys must be unique.",
			});
		}
		for (const [index, claim] of output.claims.entries()) {
			const mappingKeys = claim.factMappings.map(
				(mapping) => `${mapping.factId}:${mapping.relation}`,
			);
			if (new Set(mappingKeys).size !== mappingKeys.length) {
				context.addIssue({
					code: "custom",
					path: ["claims", index, "factMappings"],
					message: "Fact mappings must be unique.",
				});
			}
		}
	});

export type FactLockProviderOutputInput = z.input<
	typeof factLockProviderOutputSchema
>;

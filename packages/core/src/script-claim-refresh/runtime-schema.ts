import { z } from "zod";

import { claimOccurrenceSchema } from "../script-generation/schema";
import {
	SCRIPT_CLAIM_REFRESH_INPUT_VERSION,
	SCRIPT_CLAIM_REFRESH_MAX_CLAIMS,
} from "./runtime-types";

const nonEmptyText = z
	.string()
	.min(1)
	.refine((value) => value === value.trim());
const hash = z.string().regex(/^[0-9a-f]{64}$/);

export const scriptClaimRefreshSourceProjectionSchema = z
	.object({
		selectedHook: z
			.object({ key: nonEmptyText.max(120), text: nonEmptyText.max(4_000) })
			.strict(),
		voiceover: z
			.array(
				z
					.object({ key: nonEmptyText.max(120), text: nonEmptyText.max(4_000) })
					.strict(),
			)
			.min(1)
			.max(32),
		scenes: z
			.array(
				z
					.object({
						order: z.number().int().positive(),
						onScreenText: z.string().trim().max(500).nullable(),
					})
					.strict(),
			)
			.min(1)
			.max(32),
		cta: z.object({ text: nonEmptyText.max(4_000) }).strict(),
		caption: nonEmptyText.max(4_000),
	})
	.strict()
	.superRefine((source, context) => {
		if (
			new Set(source.voiceover.map((segment) => segment.key)).size !==
			source.voiceover.length
		) {
			context.addIssue({
				code: "custom",
				path: ["voiceover"],
				message: "Voiceover keys must be unique.",
			});
		}
		if (
			new Set(source.scenes.map((scene) => scene.order)).size !==
				source.scenes.length ||
			source.scenes.some((scene, index) => scene.order !== index + 1)
		) {
			context.addIssue({
				code: "custom",
				path: ["scenes"],
				message: "Scene order must be unique and sequential.",
			});
		}
	});

export const scriptClaimRefreshInputSnapshotSchema = z
	.object({
		inputVersion: z.literal(SCRIPT_CLAIM_REFRESH_INPUT_VERSION),
		scriptVersionId: nonEmptyText.max(200),
		sourceScriptRevision: z.number().int().positive(),
		sourceContentHash: hash,
		source: scriptClaimRefreshSourceProjectionSchema,
	})
	.strict();

export const scriptClaimRefreshProviderOutputSchema = z
	.object({
		claims: z
			.array(
				z
					.object({
						text: nonEmptyText.max(4_000),
						occurrence: claimOccurrenceSchema,
					})
					.strict(),
			)
			.max(SCRIPT_CLAIM_REFRESH_MAX_CLAIMS),
	})
	.strict()
	.superRefine((output, context) => {
		const seen = new Set<string>();
		for (const [index, claim] of output.claims.entries()) {
			const identity = JSON.stringify([
				claim.text.normalize("NFKC").replace(/\s+/g, " ").trim(),
				claim.occurrence,
			]);
			if (seen.has(identity)) {
				context.addIssue({
					code: "custom",
					path: ["claims", index],
					message: "Duplicate candidate claim.",
				});
			}
			seen.add(identity);
		}
	});

export type ScriptClaimRefreshInputSnapshotInput = z.input<
	typeof scriptClaimRefreshInputSnapshotSchema
>;

export type ScriptClaimRefreshProviderOutputInput = z.input<
	typeof scriptClaimRefreshProviderOutputSchema
>;

export function parseScriptClaimRefreshInputSnapshot(value: unknown) {
	return scriptClaimRefreshInputSnapshotSchema.parse(value);
}

export function parseScriptClaimRefreshProviderOutput(value: unknown) {
	return scriptClaimRefreshProviderOutputSchema.parse(value);
}

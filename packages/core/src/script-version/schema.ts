import { z } from "zod";
import {
	ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
	SCRIPT_GENERATION_LIMITS,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
} from "../script-generation/policy";
import {
	claimSchema,
	hookVariantSchema,
	organicCanonicalClaimSchema,
	sceneSchema,
	voiceoverSegmentSchema,
} from "../script-generation/schema";
import { scriptVersionClaimsStatuses } from "./types";

const draftText = z.string().trim().max(SCRIPT_GENERATION_LIMITS.maxTextLength);
const draftHookVariantSchema = hookVariantSchema.extend({ text: draftText });
const draftVoiceoverSegmentSchema = voiceoverSegmentSchema.extend({
	text: draftText,
});
const draftSceneSchema = sceneSchema.extend({
	visualDirection: draftText,
	onScreenText: z.string().trim().max(500).nullable(),
});

const unique = <T>(values: T[]) => new Set(values).size === values.length;

const scriptVersionEditableSnapshotV2Schema = z
	.object({
		schemaVersion: z.literal(SCRIPT_OUTPUT_SCHEMA_VERSION),
		language: z.string().trim().min(2).max(20),
		hookVariants: z
			.array(draftHookVariantSchema)
			.min(1)
			.max(SCRIPT_GENERATION_LIMITS.maxHookVariants),
		selectedHookKey: z.string().trim().max(120).nullable(),
		voiceoverSegments: z
			.array(draftVoiceoverSegmentSchema)
			.min(1)
			.max(SCRIPT_GENERATION_LIMITS.maxVoiceoverSegments),
		scenes: z
			.array(draftSceneSchema)
			.min(1)
			.max(SCRIPT_GENERATION_LIMITS.maxScenes),
		cta: z.object({ text: draftText }).strict(),
		caption: draftText,
		hashtags: z
			.array(z.string().trim().max(SCRIPT_GENERATION_LIMITS.maxHashtagLength))
			.max(SCRIPT_GENERATION_LIMITS.maxHashtags),
		disclosure: z.string().trim().max(500),
		claims: z.array(claimSchema).max(SCRIPT_GENERATION_LIMITS.maxClaims),
		claimsSourceRevision: z.number().int().positive(),
		claimsStatus: z.enum(scriptVersionClaimsStatuses),
	})
	.strict()
	.superRefine((snapshot, context) => {
		const hookKeys = snapshot.hookVariants.map((variant) => variant.key);
		const voiceoverKeys = snapshot.voiceoverSegments.map(
			(segment) => segment.key,
		);
		const voiceoverKeySet = new Set(voiceoverKeys);
		const sceneOrders = snapshot.scenes.map((scene) => scene.order);

		if (!unique(hookKeys)) {
			context.addIssue({
				code: "custom",
				path: ["hookVariants"],
				message: "Hook variant keys must be unique.",
			});
		}
		if (!unique(voiceoverKeys)) {
			context.addIssue({
				code: "custom",
				path: ["voiceoverSegments"],
				message: "Voiceover segment keys must be unique.",
			});
		}
		if (
			!unique(sceneOrders) ||
			sceneOrders.some((order, index) => order !== index + 1)
		) {
			context.addIssue({
				code: "custom",
				path: ["scenes"],
				message: "Scene order must be unique and sequential.",
			});
		}
		if (
			snapshot.selectedHookKey !== null &&
			!hookKeys.includes(snapshot.selectedHookKey)
		) {
			context.addIssue({
				code: "custom",
				path: ["selectedHookKey"],
				message: "Selected hook must reference an existing hook variant.",
			});
		}
		for (const [index, scene] of snapshot.scenes.entries()) {
			if (!unique(scene.voiceoverSegmentKeys)) {
				context.addIssue({
					code: "custom",
					path: ["scenes", index, "voiceoverSegmentKeys"],
					message: "Scene voiceover references must be unique.",
				});
			}
			if (scene.voiceoverSegmentKeys.some((key) => !voiceoverKeySet.has(key))) {
				context.addIssue({
					code: "custom",
					path: ["scenes", index, "voiceoverSegmentKeys"],
					message: "Scene references an unknown voiceover segment.",
				});
			}
		}
		for (const [index, claim] of snapshot.claims.entries()) {
			const occurrence = claim.occurrence;
			if (
				(occurrence.section === "hook" &&
					!hookKeys.includes(occurrence.hookKey)) ||
				(occurrence.section === "voiceover" &&
					!voiceoverKeySet.has(occurrence.segmentKey)) ||
				(occurrence.section === "scene" &&
					!sceneOrders.includes(occurrence.sceneOrder))
			) {
				context.addIssue({
					code: "custom",
					path: ["claims", index, "occurrence"],
					message: "Claim references an unknown script element.",
				});
			}
		}
	});

const scriptVersionEditableSnapshotV3Schema = z
	.object({
		schemaVersion: z.literal(ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION),
		language: z.string().trim().min(2).max(20),
		hookVariants: z
			.array(draftHookVariantSchema)
			.min(1)
			.max(SCRIPT_GENERATION_LIMITS.maxHookVariants),
		selectedHookKey: z.string().trim().max(120).nullable(),
		voiceoverSegments: z
			.array(draftVoiceoverSegmentSchema)
			.min(1)
			.max(SCRIPT_GENERATION_LIMITS.maxVoiceoverSegments),
		scenes: z
			.array(draftSceneSchema)
			.min(1)
			.max(SCRIPT_GENERATION_LIMITS.maxScenes),
		cta: z.object({ text: draftText }).strict(),
		caption: draftText,
		hashtags: z
			.array(z.string().trim().max(SCRIPT_GENERATION_LIMITS.maxHashtagLength))
			.max(SCRIPT_GENERATION_LIMITS.maxHashtags),
		disclosure: z.string().trim().max(500),
		claims: z
			.array(organicCanonicalClaimSchema)
			.max(SCRIPT_GENERATION_LIMITS.maxClaims),
		claimsSourceRevision: z.number().int().positive(),
		claimsStatus: z.enum(scriptVersionClaimsStatuses),
	})
	.strict()
	.superRefine((snapshot, context) => {
		const hookKeys = snapshot.hookVariants.map((variant) => variant.key);
		const voiceoverKeys = snapshot.voiceoverSegments.map(
			(segment) => segment.key,
		);
		const voiceoverKeySet = new Set(voiceoverKeys);
		const sceneOrders = snapshot.scenes.map((scene) => scene.order);
		if (!unique(hookKeys))
			context.addIssue({
				code: "custom",
				path: ["hookVariants"],
				message: "Hook variant keys must be unique.",
			});
		if (!unique(voiceoverKeys))
			context.addIssue({
				code: "custom",
				path: ["voiceoverSegments"],
				message: "Voiceover keys must be unique.",
			});
		if (
			!unique(sceneOrders) ||
			sceneOrders.some((order, index) => order !== index + 1)
		)
			context.addIssue({
				code: "custom",
				path: ["scenes"],
				message: "Scene order must be unique and sequential.",
			});
		if (
			snapshot.selectedHookKey !== null &&
			!hookKeys.includes(snapshot.selectedHookKey)
		)
			context.addIssue({
				code: "custom",
				path: ["selectedHookKey"],
				message: "Selected hook must reference an existing hook variant.",
			});
		for (const [index, scene] of snapshot.scenes.entries()) {
			if (
				!unique(scene.voiceoverSegmentKeys) ||
				scene.voiceoverSegmentKeys.some((key) => !voiceoverKeySet.has(key))
			)
				context.addIssue({
					code: "custom",
					path: ["scenes", index, "voiceoverSegmentKeys"],
					message:
						"Scene references an unknown or duplicate voiceover segment.",
				});
		}
		for (const [index, claim] of snapshot.claims.entries()) {
			const occurrence = claim.occurrence;
			if (
				(occurrence.section === "hook" &&
					!hookKeys.includes(occurrence.hookKey)) ||
				(occurrence.section === "voiceover" &&
					!voiceoverKeySet.has(occurrence.segmentKey)) ||
				(occurrence.section === "scene" &&
					!sceneOrders.includes(occurrence.sceneOrder))
			)
				context.addIssue({
					code: "custom",
					path: ["claims", index, "occurrence"],
					message: "Claim references an unknown script element.",
				});
		}
	});

export const scriptVersionEditableSnapshotSchema = z.union([
	scriptVersionEditableSnapshotV2Schema,
	scriptVersionEditableSnapshotV3Schema,
]);

export type ScriptVersionEditableSnapshotInput = z.input<
	typeof scriptVersionEditableSnapshotSchema
>;

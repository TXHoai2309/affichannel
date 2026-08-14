import { z } from "zod";

import { canonicalizeJson } from "./canonical-json";
import {
	SCRIPT_GENERATION_LIMITS,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
} from "./policy";
import {
	scriptGenerationSections,
	type ClaimOccurrence,
	type PartialScriptDraft,
	type ScriptGenerationSection,
} from "./types";

const text = (max: number = SCRIPT_GENERATION_LIMITS.maxTextLength) =>
	z.string().trim().min(1).max(max);

export const claimOccurrenceSchema = z.discriminatedUnion("section", [
	z.object({ section: z.literal("hook") }).strict(),
	z.object({ section: z.literal("voiceover"), segmentKey: text(120) }).strict(),
	z.object({ section: z.literal("scene"), sceneOrder: z.number().int().positive() }).strict(),
	z.object({ section: z.literal("cta") }).strict(),
	z.object({ section: z.literal("caption") }).strict(),
]);

export const hookSchema = z.object({ text: text() }).strict();
export const voiceoverSegmentSchema = z
	.object({ key: text(120), text: text() })
	.strict();
export const sceneSchema = z
	.object({
		order: z.number().int().positive(),
		durationSeconds: z.number().int().positive().max(180),
		visualDirection: text(),
		onScreenText: z.string().trim().max(500).nullable(),
		voiceoverSegmentKeys: z.array(text(120)).max(32),
	})
	.strict();
export const ctaSchema = z.object({ text: text() }).strict();
export const hashtagsSchema = z
	.array(text(SCRIPT_GENERATION_LIMITS.maxHashtagLength))
	.max(SCRIPT_GENERATION_LIMITS.maxHashtags);
export const claimSchema = z
	.object({ text: text(), occurrence: claimOccurrenceSchema })
	.strict();

const unique = <T>(values: T[]) => new Set(values).size === values.length;

export const scriptDraftSchema = z
	.object({
		schemaVersion: z.literal(SCRIPT_OUTPUT_SCHEMA_VERSION),
		language: z.string().trim().min(2).max(20),
		hook: hookSchema,
		voiceoverSegments: z
			.array(voiceoverSegmentSchema)
			.min(1)
			.max(SCRIPT_GENERATION_LIMITS.maxVoiceoverSegments),
		scenes: z
			.array(sceneSchema)
			.min(1)
			.max(SCRIPT_GENERATION_LIMITS.maxScenes),
		cta: ctaSchema,
		caption: text(),
		hashtags: hashtagsSchema,
		disclosure: z.string().trim().max(500).nullable(),
		claims: z.array(claimSchema).max(SCRIPT_GENERATION_LIMITS.maxClaims),
	})
	.strict()
	.superRefine((draft, context) => {
		if (!unique(draft.hashtags)) {
			context.addIssue({ code: "custom", path: ["hashtags"], message: "Hashtags must be unique." });
		}
		const voiceoverKeys = draft.voiceoverSegments.map((segment) => segment.key);
		if (!unique(voiceoverKeys)) {
			context.addIssue({ code: "custom", path: ["voiceoverSegments"], message: "Voiceover keys must be unique." });
		}

		const orders = draft.scenes.map((scene) => scene.order);
		if (!unique(orders) || orders.some((order, index) => order !== index + 1)) {
			context.addIssue({ code: "custom", path: ["scenes"], message: "Scene order must be unique and sequential." });
		}
		const voiceoverKeySet = new Set(voiceoverKeys);
		for (const [index, scene] of draft.scenes.entries()) {
			if (scene.voiceoverSegmentKeys.some((key) => !voiceoverKeySet.has(key))) {
				context.addIssue({ code: "custom", path: ["scenes", index, "voiceoverSegmentKeys"], message: "Scene references an unknown voiceover segment." });
			}
		}
		for (const [index, claim] of draft.claims.entries()) {
			const occurrence = claim.occurrence;
			if (occurrence.section === "voiceover" && !voiceoverKeySet.has(occurrence.segmentKey)) {
				context.addIssue({ code: "custom", path: ["claims", index, "occurrence"], message: "Claim references an unknown voiceover segment." });
			}
			if (occurrence.section === "scene" && !orders.includes(occurrence.sceneOrder)) {
				context.addIssue({ code: "custom", path: ["claims", index, "occurrence"], message: "Claim references an unknown scene." });
			}
		}
	});

export const scriptSectionSchemas = {
	hook: hookSchema,
	voiceover: z.array(voiceoverSegmentSchema).min(1).max(SCRIPT_GENERATION_LIMITS.maxVoiceoverSegments),
	scenes: z.array(sceneSchema).min(1).max(SCRIPT_GENERATION_LIMITS.maxScenes),
	cta: ctaSchema,
	caption: text(),
	hashtags: hashtagsSchema.superRefine((values, context) => {
		if (!unique(values)) context.addIssue({ code: "custom", message: "Hashtags must be unique." });
	}),
	disclosure: z.string().trim().max(500).nullable(),
	claims: z.array(claimSchema).max(SCRIPT_GENERATION_LIMITS.maxClaims),
} as const;

function parseUnknownOutput(raw: unknown): unknown {
	if (typeof raw !== "string") return raw;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return undefined;
	}
}

function byteLength(value: unknown) {
	return new TextEncoder().encode(canonicalizeJson(value)).byteLength;
}

function allSections(): ScriptGenerationSection[] {
	return [...scriptGenerationSections];
}

export type ScriptOutputValidation = {
	status: "completed" | "partial" | "failed";
	output: PartialScriptDraft | null;
	validSections: ScriptGenerationSection[];
	invalidSections: ScriptGenerationSection[];
	errorCode: "INVALID_GENERATION_OUTPUT" | null;
};

export function validateScriptDraftOutput(
	raw: unknown,
	targetDurationSeconds: number,
): ScriptOutputValidation {
	const parsed = parseUnknownOutput(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { status: "failed", output: null, validSections: [], invalidSections: allSections(), errorCode: "INVALID_GENERATION_OUTPUT" };
	}
	const root = parsed as Record<string, unknown>;
	const full = scriptDraftSchema.safeParse(root);
	if (full.success) {
		const totalDuration = full.data.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
		const withinDuration = Math.abs(totalDuration - targetDurationSeconds) <= targetDurationSeconds * SCRIPT_GENERATION_LIMITS.durationToleranceRatio;
		if (!withinDuration || byteLength(full.data) > SCRIPT_GENERATION_LIMITS.maxOutputBytes) {
			return { status: "failed", output: null, validSections: [], invalidSections: allSections(), errorCode: "INVALID_GENERATION_OUTPUT" };
		}
		return { status: "completed", output: full.data, validSections: allSections(), invalidSections: [], errorCode: null };
	}

	const schemaVersion = root.schemaVersion;
	const language = root.language;
	if (schemaVersion !== SCRIPT_OUTPUT_SCHEMA_VERSION || typeof language !== "string" || language.trim().length < 2) {
		return { status: "failed", output: null, validSections: [], invalidSections: allSections(), errorCode: "INVALID_GENERATION_OUTPUT" };
	}

	const output: PartialScriptDraft = { schemaVersion, language: language.trim() };
	const validSections: ScriptGenerationSection[] = [];
	const invalidSections: ScriptGenerationSection[] = [];
	const allowedKeys = new Set(["schemaVersion", "language", ...scriptGenerationSections, "voiceoverSegments"]);
	for (const key of Object.keys(root)) {
		if (!allowedKeys.has(key)) {
			return { status: "failed", output: null, validSections: [], invalidSections: allSections(), errorCode: "INVALID_GENERATION_OUTPUT" };
		}
	}
	for (const section of scriptGenerationSections) {
		const inputKey = section === "voiceover" ? "voiceoverSegments" : section;
		if (!(inputKey in root)) {
			invalidSections.push(section);
			continue;
		}
		const result = scriptSectionSchemas[section].safeParse(root[inputKey]);
		if (result.success) {
			(output as Record<string, unknown>)[inputKey] = result.data;
			validSections.push(section);
		} else {
			invalidSections.push(section);
		}
	}

	const voiceover = output.voiceoverSegments;
	const scenes = output.scenes;
	if (voiceover && !unique(voiceover.map((segment) => segment.key))) {
		validSections.splice(validSections.indexOf("voiceover"), 1);
		if (!invalidSections.includes("voiceover")) invalidSections.push("voiceover");
		delete output.voiceoverSegments;
	}
	if (scenes) {
		const orders = scenes.map((scene) => scene.order);
		const keys = new Set(voiceover?.map((segment) => segment.key) ?? []);
		if (!unique(orders) || orders.some((order, index) => order !== index + 1) || (voiceover && scenes.some((scene) => scene.voiceoverSegmentKeys.some((key) => !keys.has(key))))) {
			validSections.splice(validSections.indexOf("scenes"), 1);
			if (!invalidSections.includes("scenes")) invalidSections.push("scenes");
			delete output.scenes;
		}
	}
	if (output.claims) {
		const claimTargetValid = output.claims.every((claim) => {
			const occurrence = claim.occurrence;
			if (occurrence.section === "voiceover") return Boolean(output.voiceoverSegments?.some((segment) => segment.key === occurrence.segmentKey));
			if (occurrence.section === "scene") return Boolean(output.scenes?.some((scene) => scene.order === occurrence.sceneOrder));
			return true;
		});
		if (!claimTargetValid) {
			validSections.splice(validSections.indexOf("claims"), 1);
			if (!invalidSections.includes("claims")) invalidSections.push("claims");
			delete output.claims;
		}
	}
	if (output.scenes) {
		const totalDuration = output.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
		if (Math.abs(totalDuration - targetDurationSeconds) > targetDurationSeconds * SCRIPT_GENERATION_LIMITS.durationToleranceRatio) {
			validSections.splice(validSections.indexOf("scenes"), 1);
			if (!invalidSections.includes("scenes")) invalidSections.push("scenes");
			delete output.scenes;
		}
	}
	if (byteLength(output) > SCRIPT_GENERATION_LIMITS.maxOutputBytes) {
		return { status: "failed", output: null, validSections: [], invalidSections: allSections(), errorCode: "INVALID_GENERATION_OUTPUT" };
	}
	validSections.sort((a, b) => scriptGenerationSections.indexOf(a) - scriptGenerationSections.indexOf(b));
	invalidSections.sort((a, b) => scriptGenerationSections.indexOf(a) - scriptGenerationSections.indexOf(b));
	return {
		status: validSections.length === 0 ? "failed" : validSections.length === scriptGenerationSections.length ? "completed" : "partial",
		output: validSections.length === 0 ? null : output,
		validSections,
		invalidSections,
		errorCode: validSections.length === 0 ? "INVALID_GENERATION_OUTPUT" : null,
	};
}

export type ValidScriptDraft = z.infer<typeof scriptDraftSchema>;
export type ParsedClaimOccurrence = ClaimOccurrence;

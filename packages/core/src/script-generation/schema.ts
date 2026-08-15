import { z } from "zod";

import { canonicalizeJson } from "./canonical-json";
import { defaultOutputRules } from "./input-contract";
import {
	SCRIPT_GENERATION_LIMITS,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
} from "./policy";
import {
	type ClaimOccurrence,
	type PartialScriptDraft,
	type ScriptGenerationSection,
	scriptGenerationSections,
} from "./types";

const text = (max: number = SCRIPT_GENERATION_LIMITS.maxTextLength) =>
	z.string().trim().min(1).max(max);

export const claimOccurrenceSchema = z.discriminatedUnion("section", [
	z.object({ section: z.literal("hook"), hookKey: text(120) }).strict(),
	z.object({ section: z.literal("voiceover"), segmentKey: text(120) }).strict(),
	z
		.object({
			section: z.literal("scene"),
			sceneOrder: z.number().int().positive(),
		})
		.strict(),
	z.object({ section: z.literal("cta") }).strict(),
	z.object({ section: z.literal("caption") }).strict(),
]);

export const hookVariantSchema = z
	.object({ key: text(120), text: text() })
	.strict();
export const hookVariantsSchema = z
	.array(hookVariantSchema)
	.min(SCRIPT_GENERATION_LIMITS.minHookVariants)
	.max(SCRIPT_GENERATION_LIMITS.maxHookVariants)
	.superRefine((variants, context) => {
		if (
			new Set(variants.map((variant) => variant.key)).size !== variants.length
		) {
			context.addIssue({
				code: "custom",
				message: "Hook variant keys must be unique.",
			});
		}
	});
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
const uniqueNormalized = (values: string[]) =>
	new Set(values.map((value) => value.trim().toLocaleLowerCase("vi-VN")))
		.size === values.length;

export const scriptDraftSchema = z
	.object({
		schemaVersion: z.literal(SCRIPT_OUTPUT_SCHEMA_VERSION),
		language: z.string().trim().min(2).max(20),
		hookVariants: hookVariantsSchema,
		voiceoverSegments: z
			.array(voiceoverSegmentSchema)
			.min(1)
			.max(SCRIPT_GENERATION_LIMITS.maxVoiceoverSegments),
		scenes: z.array(sceneSchema).min(1).max(SCRIPT_GENERATION_LIMITS.maxScenes),
		cta: ctaSchema,
		caption: text(),
		hashtags: hashtagsSchema,
		disclosure: z.string().trim().min(1).max(500),
		claims: z.array(claimSchema).max(SCRIPT_GENERATION_LIMITS.maxClaims),
	})
	.strict()
	.superRefine((draft, context) => {
		if (!unique(draft.hookVariants.map((variant) => variant.key))) {
			context.addIssue({
				code: "custom",
				path: ["hookVariants"],
				message: "Hook variant keys must be unique.",
			});
		}
		if (!uniqueNormalized(draft.hashtags)) {
			context.addIssue({
				code: "custom",
				path: ["hashtags"],
				message: "Hashtags must be unique after normalization.",
			});
		}
		const voiceoverKeys = draft.voiceoverSegments.map((segment) => segment.key);
		if (!unique(voiceoverKeys)) {
			context.addIssue({
				code: "custom",
				path: ["voiceoverSegments"],
				message: "Voiceover keys must be unique.",
			});
		}

		const orders = draft.scenes.map((scene) => scene.order);
		if (!unique(orders) || orders.some((order, index) => order !== index + 1)) {
			context.addIssue({
				code: "custom",
				path: ["scenes"],
				message: "Scene order must be unique and sequential.",
			});
		}
		const hookKeys = new Set(draft.hookVariants.map((variant) => variant.key));
		const voiceoverKeySet = new Set(voiceoverKeys);
		for (const [index, scene] of draft.scenes.entries()) {
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
		for (const [index, claim] of draft.claims.entries()) {
			const occurrence = claim.occurrence;
			if (occurrence.section === "hook" && !hookKeys.has(occurrence.hookKey)) {
				context.addIssue({
					code: "custom",
					path: ["claims", index, "occurrence"],
					message: "Claim references an unknown hook variant.",
				});
			}
			if (
				occurrence.section === "voiceover" &&
				!voiceoverKeySet.has(occurrence.segmentKey)
			) {
				context.addIssue({
					code: "custom",
					path: ["claims", index, "occurrence"],
					message: "Claim references an unknown voiceover segment.",
				});
			}
			if (
				occurrence.section === "scene" &&
				!orders.includes(occurrence.sceneOrder)
			) {
				context.addIssue({
					code: "custom",
					path: ["claims", index, "occurrence"],
					message: "Claim references an unknown scene.",
				});
			}
		}
	});

export const scriptSectionSchemas = {
	hook: hookVariantsSchema,
	voiceover: z
		.array(voiceoverSegmentSchema)
		.min(1)
		.max(SCRIPT_GENERATION_LIMITS.maxVoiceoverSegments),
	scenes: z.array(sceneSchema).min(1).max(SCRIPT_GENERATION_LIMITS.maxScenes),
	cta: ctaSchema,
	caption: text(),
	hashtags: hashtagsSchema.superRefine((values, context) => {
		if (!uniqueNormalized(values))
			context.addIssue({
				code: "custom",
				message: "Hashtags must be unique after normalization.",
			});
	}),
	disclosure: z.string().trim().min(1).max(500),
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

function inputKey(section: ScriptGenerationSection) {
	return section === "hook"
		? "hookVariants"
		: section === "voiceover"
			? "voiceoverSegments"
			: section;
}

function removeValidSection(
	validSections: ScriptGenerationSection[],
	invalidSections: ScriptGenerationSection[],
	section: ScriptGenerationSection,
) {
	const index = validSections.indexOf(section);
	if (index >= 0) validSections.splice(index, 1);
	if (!invalidSections.includes(section)) invalidSections.push(section);
}

export type ScriptOutputValidation = {
	status: "completed" | "partial" | "failed";
	output: PartialScriptDraft | null;
	validSections: ScriptGenerationSection[];
	invalidSections: ScriptGenerationSection[];
	errorCode: "INVALID_GENERATION_OUTPUT" | null;
};

export type ScriptDraftValidationOptions = {
	expectedLanguage?: string;
	requiredDisclosure?: string | null;
	avoidWords?: string[];
};

function normalizePolicyText(value: string) {
	return value.normalize("NFKC").trim().toLocaleLowerCase("vi-VN");
}

function containsAvoidWord(value: string, avoidWords: string[]) {
	const normalizedValue = normalizePolicyText(value);
	return avoidWords.some((word) => {
		const normalizedWord = normalizePolicyText(word);
		return (
			normalizedWord.length > 0 && normalizedValue.includes(normalizedWord)
		);
	});
}

function textValuesForSection(
	section: ScriptGenerationSection,
	value: unknown,
): string[] {
	if (section === "hook" && Array.isArray(value)) {
		return value.flatMap((item) =>
			item &&
			typeof item === "object" &&
			"text" in item &&
			typeof item.text === "string"
				? [item.text]
				: [],
		);
	}
	if (section === "voiceover" && Array.isArray(value)) {
		return value.flatMap((item) =>
			item &&
			typeof item === "object" &&
			"text" in item &&
			typeof item.text === "string"
				? [item.text]
				: [],
		);
	}
	if (section === "scenes" && Array.isArray(value)) {
		return value.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const record = item as Record<string, unknown>;
			return [record.visualDirection, record.onScreenText].filter(
				(text): text is string => typeof text === "string",
			);
		});
	}
	if (
		section === "cta" &&
		value &&
		typeof value === "object" &&
		"text" in value
	) {
		return typeof value.text === "string" ? [value.text] : [];
	}
	if (section === "caption" && typeof value === "string") return [value];
	if (section === "hashtags" && Array.isArray(value)) {
		return value.filter((text): text is string => typeof text === "string");
	}
	if (section === "disclosure" && typeof value === "string") return [value];
	if (section === "claims" && Array.isArray(value)) {
		return value.flatMap((item) =>
			item &&
			typeof item === "object" &&
			"text" in item &&
			typeof item.text === "string"
				? [item.text]
				: [],
		);
	}
	return [];
}

function sectionViolatesPolicy(
	section: ScriptGenerationSection,
	value: unknown,
	options: Required<
		Pick<ScriptDraftValidationOptions, "requiredDisclosure" | "avoidWords">
	>,
) {
	if (
		section === "disclosure" &&
		options.requiredDisclosure !== null &&
		(typeof value !== "string" ||
			normalizePolicyText(value) !==
				normalizePolicyText(options.requiredDisclosure))
	) {
		return true;
	}
	return textValuesForSection(section, value).some((text) => {
		if (
			section === "disclosure" &&
			options.requiredDisclosure !== null &&
			normalizePolicyText(text) ===
				normalizePolicyText(options.requiredDisclosure)
		) {
			return false;
		}
		return containsAvoidWord(text, options.avoidWords);
	});
}

function resolvedValidationOptions(options: ScriptDraftValidationOptions) {
	return {
		expectedLanguage: options.expectedLanguage ?? defaultOutputRules.language,
		requiredDisclosure: options.requiredDisclosure ?? null,
		avoidWords: options.avoidWords ?? [],
	};
}

export function validateScriptDraftOutput(
	raw: unknown,
	targetDurationSeconds: number,
	claimLimit: number | null = null,
	options: ScriptDraftValidationOptions = {},
): ScriptOutputValidation {
	const resolvedOptions = resolvedValidationOptions(options);
	const parsed = parseUnknownOutput(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			status: "failed",
			output: null,
			validSections: [],
			invalidSections: allSections(),
			errorCode: "INVALID_GENERATION_OUTPUT",
		};
	}
	const root = parsed as Record<string, unknown>;
	const full = scriptDraftSchema.safeParse(root);
	if (full.success && full.data.language === resolvedOptions.expectedLanguage) {
		const totalDuration = full.data.scenes.reduce(
			(sum, scene) => sum + scene.durationSeconds,
			0,
		);
		const withinDuration =
			Math.abs(totalDuration - targetDurationSeconds) <=
			targetDurationSeconds * SCRIPT_GENERATION_LIMITS.durationToleranceRatio;
		const withinClaimLimit =
			claimLimit === null || full.data.claims.length <= claimLimit;
		const policyValid = scriptGenerationSections.every(
			(section) =>
				!sectionViolatesPolicy(
					section,
					section === "hook"
						? full.data.hookVariants
						: section === "voiceover"
							? full.data.voiceoverSegments
							: full.data[section],
					resolvedOptions,
				),
		);
		if (
			!withinDuration ||
			!withinClaimLimit ||
			byteLength(full.data) > SCRIPT_GENERATION_LIMITS.maxOutputBytes
		) {
			return {
				status: "failed",
				output: null,
				validSections: [],
				invalidSections: allSections(),
				errorCode: "INVALID_GENERATION_OUTPUT",
			};
		}
		if (policyValid) {
			return {
				status: "completed",
				output: full.data,
				validSections: allSections(),
				invalidSections: [],
				errorCode: null,
			};
		}
	}

	const schemaVersion = root.schemaVersion;
	const language = root.language;
	if (
		schemaVersion !== SCRIPT_OUTPUT_SCHEMA_VERSION ||
		typeof language !== "string" ||
		language.trim() !== resolvedOptions.expectedLanguage
	) {
		return {
			status: "failed",
			output: null,
			validSections: [],
			invalidSections: allSections(),
			errorCode: "INVALID_GENERATION_OUTPUT",
		};
	}

	const output: PartialScriptDraft = {
		schemaVersion,
		language: language.trim(),
	};
	const validSections: ScriptGenerationSection[] = [];
	const invalidSections: ScriptGenerationSection[] = [];
	const allowedKeys = new Set([
		"schemaVersion",
		"language",
		"hookVariants",
		"voiceoverSegments",
		...scriptGenerationSections.filter(
			(section) => section !== "hook" && section !== "voiceover",
		),
	]);
	for (const key of Object.keys(root)) {
		if (!allowedKeys.has(key)) {
			return {
				status: "failed",
				output: null,
				validSections: [],
				invalidSections: allSections(),
				errorCode: "INVALID_GENERATION_OUTPUT",
			};
		}
	}
	for (const section of scriptGenerationSections) {
		const key = inputKey(section);
		if (!(key in root)) {
			invalidSections.push(section);
			continue;
		}
		const result = scriptSectionSchemas[section].safeParse(root[key]);
		if (result.success) {
			if (sectionViolatesPolicy(section, result.data, resolvedOptions)) {
				invalidSections.push(section);
				continue;
			}
			(output as Record<string, unknown>)[key] = result.data;
			validSections.push(section);
		} else {
			invalidSections.push(section);
		}
	}

	const hookVariants = output.hookVariants;
	const voiceover = output.voiceoverSegments;
	const scenes = output.scenes;
	if (hookVariants && !unique(hookVariants.map((variant) => variant.key))) {
		removeValidSection(validSections, invalidSections, "hook");
		delete output.hookVariants;
	}
	if (voiceover && !unique(voiceover.map((segment) => segment.key))) {
		removeValidSection(validSections, invalidSections, "voiceover");
		delete output.voiceoverSegments;
	}
	if (scenes) {
		const orders = scenes.map((scene) => scene.order);
		const keys = new Set(voiceover?.map((segment) => segment.key) ?? []);
		const hasUnprovableVoiceoverRefs = scenes.some(
			(scene) => scene.voiceoverSegmentKeys.length > 0 && !voiceover,
		);
		const hasDuplicateSceneRefs = scenes.some(
			(scene) => !unique(scene.voiceoverSegmentKeys),
		);
		if (
			!unique(orders) ||
			orders.some((order, index) => order !== index + 1) ||
			hasUnprovableVoiceoverRefs ||
			hasDuplicateSceneRefs ||
			(voiceover &&
				scenes.some((scene) =>
					scene.voiceoverSegmentKeys.some((key) => !keys.has(key)),
				))
		) {
			removeValidSection(validSections, invalidSections, "scenes");
			delete output.scenes;
		}
	}
	if (
		output.claims &&
		claimLimit !== null &&
		output.claims.length > claimLimit
	) {
		removeValidSection(validSections, invalidSections, "claims");
		delete output.claims;
	}
	if (output.claims) {
		const claimTargetValid = output.claims.every((claim) => {
			const occurrence = claim.occurrence;
			if (occurrence.section === "hook")
				return Boolean(
					output.hookVariants?.some(
						(variant) => variant.key === occurrence.hookKey,
					),
				);
			if (occurrence.section === "voiceover")
				return Boolean(
					output.voiceoverSegments?.some(
						(segment) => segment.key === occurrence.segmentKey,
					),
				);
			if (occurrence.section === "scene")
				return Boolean(
					output.scenes?.some((scene) => scene.order === occurrence.sceneOrder),
				);
			return validSections.includes(occurrence.section);
		});
		if (!claimTargetValid) {
			removeValidSection(validSections, invalidSections, "claims");
			delete output.claims;
		}
	}
	if (output.scenes) {
		const totalDuration = output.scenes.reduce(
			(sum, scene) => sum + scene.durationSeconds,
			0,
		);
		if (
			Math.abs(totalDuration - targetDurationSeconds) >
			targetDurationSeconds * SCRIPT_GENERATION_LIMITS.durationToleranceRatio
		) {
			removeValidSection(validSections, invalidSections, "scenes");
			delete output.scenes;
		}
	}
	if (byteLength(output) > SCRIPT_GENERATION_LIMITS.maxOutputBytes) {
		return {
			status: "failed",
			output: null,
			validSections: [],
			invalidSections: allSections(),
			errorCode: "INVALID_GENERATION_OUTPUT",
		};
	}
	validSections.sort(
		(a, b) =>
			scriptGenerationSections.indexOf(a) - scriptGenerationSections.indexOf(b),
	);
	invalidSections.sort(
		(a, b) =>
			scriptGenerationSections.indexOf(a) - scriptGenerationSections.indexOf(b),
	);
	return {
		status:
			validSections.length === 0
				? "failed"
				: validSections.length === scriptGenerationSections.length
					? "completed"
					: "partial",
		output: validSections.length === 0 ? null : output,
		validSections,
		invalidSections,
		errorCode: validSections.length === 0 ? "INVALID_GENERATION_OUTPUT" : null,
	};
}

export type RepairOutputValidation = {
	success: boolean;
	output: PartialScriptDraft | null;
};

export function validateRepairScriptOutput(
	raw: unknown,
	repairSections: ScriptGenerationSection[],
	claimLimit: number | null = null,
	options: ScriptDraftValidationOptions = {},
): RepairOutputValidation {
	const resolvedOptions = resolvedValidationOptions(options);
	const parsed = parseUnknownOutput(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		return { success: false, output: null };
	const root = parsed as Record<string, unknown>;
	if (
		root.schemaVersion !== SCRIPT_OUTPUT_SCHEMA_VERSION ||
		typeof root.language !== "string" ||
		root.language.trim() !== resolvedOptions.expectedLanguage
	)
		return { success: false, output: null };
	const normalizedSections = [...new Set(repairSections)];
	if (
		normalizedSections.length !== repairSections.length ||
		normalizedSections.length === 0 ||
		normalizedSections.some(
			(section) => !scriptGenerationSections.includes(section),
		)
	)
		return { success: false, output: null };
	const inputKeyForSection = (section: ScriptGenerationSection) =>
		section === "hook"
			? "hookVariants"
			: section === "voiceover"
				? "voiceoverSegments"
				: section;
	const allowedKeys = new Set([
		"schemaVersion",
		"language",
		...normalizedSections.map(inputKeyForSection),
	]);
	if (Object.keys(root).some((key) => !allowedKeys.has(key)))
		return { success: false, output: null };
	const output: PartialScriptDraft = {
		schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		language: root.language.trim(),
	};
	for (const section of normalizedSections) {
		const key = inputKeyForSection(section);
		if (!(key in root)) return { success: false, output: null };
		const result = scriptSectionSchemas[section].safeParse(root[key]);
		if (!result.success) return { success: false, output: null };
		if (
			section === "claims" &&
			claimLimit !== null &&
			Array.isArray(result.data) &&
			result.data.length > claimLimit
		)
			return { success: false, output: null };
		if (sectionViolatesPolicy(section, result.data, resolvedOptions))
			return { success: false, output: null };
		(output as Record<string, unknown>)[key] = result.data;
	}
	return { success: true, output };
}

export type ValidScriptDraft = z.infer<typeof scriptDraftSchema>;
export type ParsedClaimOccurrence = ClaimOccurrence;

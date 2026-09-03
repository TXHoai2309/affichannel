import { z } from "zod";
import { proposedClaimSubjects } from "../claim-subject/types";
import { canonicalizeJson } from "./canonical-json";
import { defaultOutputRules } from "./input-contract";
import {
	ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
	SCRIPT_GENERATION_LIMITS,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
} from "./policy";
import { parseSingleJsonObject } from "./structured-json";
import {
	type ClaimOccurrence,
	type PartialScriptDraft,
	type ScriptDraft,
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

const organicClaimSubjectSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("GENERAL") }).strict(),
	z
		.object({
			kind: z.literal("PRODUCT"),
			binding: z.literal("PROJECT_PRODUCT"),
		})
		.strict(),
]);

/**
 * Organic providers return a proposal, while persisted v3 claims retain the
 * proposal alongside unresolved subject metadata.  No provider payload can
 * satisfy the CONFIRMED/source invariant by itself.
 */
export const organicClaimSchema = z
	.object({
		text: text(),
		occurrence: claimOccurrenceSchema,
		proposedSubject: z.enum(proposedClaimSubjects).optional(),
		subject: organicClaimSubjectSchema.optional(),
		subjectStatus: z.enum(["CONFIRMED", "NEEDS_CONFIRMATION"]).optional(),
		subjectSource: z
			.enum(["USER", "STRUCTURED_SOURCE", "LEGACY_COMPATIBILITY"])
			.nullable()
			.optional(),
	})
	.strict()
	.superRefine((claim, context) => {
		const hasAnySubjectField =
			claim.subject !== undefined ||
			claim.subjectStatus !== undefined ||
			claim.subjectSource !== undefined;
		const hasAllSubjectFields =
			claim.subject !== undefined &&
			claim.subjectStatus !== undefined &&
			claim.subjectSource !== undefined;
		if (hasAnySubjectField && !hasAllSubjectFields) {
			context.addIssue({
				code: "custom",
				message: "Organic claim subject metadata must be complete.",
			});
		}
		if (!hasAnySubjectField && claim.proposedSubject === undefined) {
			context.addIssue({
				code: "custom",
				message: "Organic claims require a subject proposal.",
			});
		}
		if (hasAllSubjectFields) {
			if (claim.subjectStatus === "CONFIRMED" && claim.subjectSource === null) {
				context.addIssue({
					code: "custom",
					message: "Confirmed Organic claims require an explicit source.",
				});
			}
			if (
				claim.subjectStatus === "NEEDS_CONFIRMATION" &&
				claim.subjectSource !== null
			) {
				context.addIssue({
					code: "custom",
					message: "Unconfirmed Organic claims cannot carry a source.",
				});
			}
			if (
				claim.proposedSubject !== undefined &&
				claim.proposedSubject !== claim.subject?.kind
			) {
				context.addIssue({
					code: "custom",
					message: "Organic proposal and subject metadata disagree.",
				});
			}
		}
	});

export const organicCanonicalClaimSchema = organicClaimSchema.superRefine(
	(claim, context) => {
		if (
			claim.subject === undefined ||
			claim.subjectStatus === undefined ||
			claim.subjectSource === undefined
		) {
			context.addIssue({
				code: "custom",
				message: "Persisted Organic claims require subject-aware metadata.",
			});
		}
	},
);

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

export const scriptDraftV3Schema = z
	.object({
		schemaVersion: z.literal(ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION),
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
		// Organic content never carries the Affiliate disclosure. Empty string is
		// the explicit v3 "none" representation.
		disclosure: z.string().trim().max(500),
		claims: z
			.array(organicCanonicalClaimSchema)
			.max(SCRIPT_GENERATION_LIMITS.maxClaims),
	})
	.strict()
	.superRefine((draft, context) => {
		if (!unique(draft.hookVariants.map((variant) => variant.key)))
			context.addIssue({
				code: "custom",
				path: ["hookVariants"],
				message: "Hook variant keys must be unique.",
			});
		if (!uniqueNormalized(draft.hashtags))
			context.addIssue({
				code: "custom",
				path: ["hashtags"],
				message: "Hashtags must be unique after normalization.",
			});
		const voiceoverKeys = draft.voiceoverSegments.map((segment) => segment.key);
		if (!unique(voiceoverKeys))
			context.addIssue({
				code: "custom",
				path: ["voiceoverSegments"],
				message: "Voiceover keys must be unique.",
			});
		const orders = draft.scenes.map((scene) => scene.order);
		if (!unique(orders) || orders.some((order, index) => order !== index + 1))
			context.addIssue({
				code: "custom",
				path: ["scenes"],
				message: "Scene order must be unique and sequential.",
			});
		const voiceoverKeySet = new Set(voiceoverKeys);
		for (const [index, scene] of draft.scenes.entries()) {
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
		const hookKeys = new Set(draft.hookVariants.map((variant) => variant.key));
		for (const [index, claim] of draft.claims.entries()) {
			const occurrence = claim.occurrence;
			if (occurrence.section === "hook" && !hookKeys.has(occurrence.hookKey))
				context.addIssue({
					code: "custom",
					path: ["claims", index, "occurrence"],
					message: "Claim references an unknown hook variant.",
				});
			if (
				occurrence.section === "voiceover" &&
				!voiceoverKeySet.has(occurrence.segmentKey)
			)
				context.addIssue({
					code: "custom",
					path: ["claims", index, "occurrence"],
					message: "Claim references an unknown voiceover segment.",
				});
			if (
				occurrence.section === "scene" &&
				!orders.includes(occurrence.sceneOrder)
			)
				context.addIssue({
					code: "custom",
					path: ["claims", index, "occurrence"],
					message: "Claim references an unknown scene.",
				});
		}
	});

export type OrganicScriptDraft = z.infer<typeof scriptDraftV3Schema>;

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
	issueCodes: ScriptOutputValidationIssueCode[];
};

export const scriptOutputValidationIssueCodes = [
	"ROOT_NOT_JSON",
	"ROOT_NOT_OBJECT",
	"SCHEMA_VERSION_MISMATCH",
	"LANGUAGE_MISMATCH",
	"UNKNOWN_ROOT_KEY",
	"HOOK_SCHEMA_INVALID",
	"VOICEOVER_SCHEMA_INVALID",
	"SCENES_SCHEMA_INVALID",
	"CTA_SCHEMA_INVALID",
	"CAPTION_SCHEMA_INVALID",
	"HASHTAGS_SCHEMA_INVALID",
	"DISCLOSURE_SCHEMA_INVALID",
	"CLAIMS_SCHEMA_INVALID",
	"HOOK_KEYS_INVALID",
	"VOICEOVER_KEYS_INVALID",
	"SCENES_REFERENCE_INVALID",
	"SCENES_DURATION_INVALID",
	"CLAIM_LIMIT_EXCEEDED",
	"CLAIM_REFERENCE_INVALID",
	"DISCLOSURE_POLICY_INVALID",
	"CONTENT_POLICY_INVALID",
	"OUTPUT_TOO_LARGE",
	"NO_VALID_SECTIONS",
	"REPAIR_OUTPUT_INVALID",
	"REPAIR_MERGE_INVALID",
	"REPAIR_RESULT_INVALID",
	"ORGANIC_PRODUCT_CLAIM_PROPOSAL",
	"ORGANIC_PROVIDER_AUTHORITY_FORBIDDEN",
] as const;

export type ScriptOutputValidationIssueCode =
	(typeof scriptOutputValidationIssueCodes)[number];

const sectionSchemaIssueCodes: Record<
	ScriptGenerationSection,
	ScriptOutputValidationIssueCode
> = {
	hook: "HOOK_SCHEMA_INVALID",
	voiceover: "VOICEOVER_SCHEMA_INVALID",
	scenes: "SCENES_SCHEMA_INVALID",
	cta: "CTA_SCHEMA_INVALID",
	caption: "CAPTION_SCHEMA_INVALID",
	hashtags: "HASHTAGS_SCHEMA_INVALID",
	disclosure: "DISCLOSURE_SCHEMA_INVALID",
	claims: "CLAIMS_SCHEMA_INVALID",
};

function uniqueIssueCodes(codes: ScriptOutputValidationIssueCode[]) {
	return [...new Set(codes)];
}

function failedValidation(
	issueCodes: ScriptOutputValidationIssueCode[],
): ScriptOutputValidation {
	return {
		status: "failed",
		output: null,
		validSections: [],
		invalidSections: allSections(),
		errorCode: "INVALID_GENERATION_OUTPUT",
		issueCodes: uniqueIssueCodes(issueCodes),
	};
}

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
	const parsed = parseSingleJsonObject(raw);
	if (!parsed.success) return failedValidation([parsed.issueCode]);
	const root = parsed.data;
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
		if (byteLength(full.data) > SCRIPT_GENERATION_LIMITS.maxOutputBytes) {
			return failedValidation(["OUTPUT_TOO_LARGE"]);
		}
		if (withinDuration && withinClaimLimit && policyValid) {
			return {
				status: "completed",
				output: full.data,
				validSections: allSections(),
				invalidSections: [],
				errorCode: null,
				issueCodes: [],
			};
		}
	}

	const schemaVersion = root.schemaVersion;
	const language = root.language;
	if (schemaVersion !== SCRIPT_OUTPUT_SCHEMA_VERSION)
		return failedValidation(["SCHEMA_VERSION_MISMATCH"]);
	if (
		typeof language !== "string" ||
		language.trim() !== resolvedOptions.expectedLanguage
	)
		return failedValidation(["LANGUAGE_MISMATCH"]);

	const output: PartialScriptDraft = {
		schemaVersion,
		language: language.trim(),
	};
	const validSections: ScriptGenerationSection[] = [];
	const invalidSections: ScriptGenerationSection[] = [];
	const issueCodes: ScriptOutputValidationIssueCode[] = [];
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
			return failedValidation(["UNKNOWN_ROOT_KEY"]);
		}
	}
	for (const section of scriptGenerationSections) {
		const key = inputKey(section);
		if (!(key in root)) {
			invalidSections.push(section);
			issueCodes.push(sectionSchemaIssueCodes[section]);
			continue;
		}
		const result = scriptSectionSchemas[section].safeParse(root[key]);
		if (result.success) {
			if (sectionViolatesPolicy(section, result.data, resolvedOptions)) {
				invalidSections.push(section);
				issueCodes.push(
					section === "disclosure"
						? "DISCLOSURE_POLICY_INVALID"
						: "CONTENT_POLICY_INVALID",
				);
				continue;
			}
			(output as Record<string, unknown>)[key] = result.data;
			validSections.push(section);
		} else {
			invalidSections.push(section);
			issueCodes.push(sectionSchemaIssueCodes[section]);
		}
	}

	const hookVariants = output.hookVariants;
	const voiceover = output.voiceoverSegments;
	const scenes = output.scenes;
	if (hookVariants && !unique(hookVariants.map((variant) => variant.key))) {
		removeValidSection(validSections, invalidSections, "hook");
		issueCodes.push("HOOK_KEYS_INVALID");
		delete output.hookVariants;
	}
	if (voiceover && !unique(voiceover.map((segment) => segment.key))) {
		removeValidSection(validSections, invalidSections, "voiceover");
		issueCodes.push("VOICEOVER_KEYS_INVALID");
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
			issueCodes.push("SCENES_REFERENCE_INVALID");
			delete output.scenes;
		}
	}
	if (
		output.claims &&
		claimLimit !== null &&
		output.claims.length > claimLimit
	) {
		removeValidSection(validSections, invalidSections, "claims");
		issueCodes.push("CLAIM_LIMIT_EXCEEDED");
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
			issueCodes.push("CLAIM_REFERENCE_INVALID");
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
			issueCodes.push("SCENES_DURATION_INVALID");
			delete output.scenes;
		}
	}
	if (byteLength(output) > SCRIPT_GENERATION_LIMITS.maxOutputBytes) {
		return failedValidation(["OUTPUT_TOO_LARGE"]);
	}
	validSections.sort(
		(a, b) =>
			scriptGenerationSections.indexOf(a) - scriptGenerationSections.indexOf(b),
	);
	invalidSections.sort(
		(a, b) =>
			scriptGenerationSections.indexOf(a) - scriptGenerationSections.indexOf(b),
	);
	const status =
		validSections.length === 0
			? "failed"
			: validSections.length === scriptGenerationSections.length
				? "completed"
				: "partial";
	if (status === "failed" && issueCodes.length === 0)
		issueCodes.push("NO_VALID_SECTIONS");
	return {
		status,
		output: validSections.length === 0 ? null : output,
		validSections,
		invalidSections,
		errorCode: validSections.length === 0 ? "INVALID_GENERATION_OUTPUT" : null,
		issueCodes: uniqueIssueCodes(issueCodes),
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
	const parsed = parseSingleJsonObject(raw);
	if (!parsed.success) return { success: false, output: null };
	const root = parsed.data;
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

function organicCanonicalClaim(claim: z.infer<typeof organicClaimSchema>) {
	if (
		claim.proposedSubject === "PRODUCT" ||
		claim.subject?.kind === "PRODUCT"
	) {
		return null;
	}
	if (claim.subject) return claim;
	// Provider proposals are deliberately unresolved.  A GENERAL proposal is
	// useful metadata, never confirmation authority.
	return {
		text: claim.text,
		occurrence: claim.occurrence,
		subject: { kind: "GENERAL" as const },
		subjectStatus: "NEEDS_CONFIRMATION" as const,
		subjectSource: null,
		proposedSubject: claim.proposedSubject,
	};
}

/**
 * Organic v3 validation shares the established structural rules with v2,
 * while adding strict subject proposals and an explicit empty disclosure.
 * The temporary v2 projection is validation-only; the returned payload is
 * always v3 and retains subject/proposal metadata.
 */
export function validateOrganicScriptDraftOutput(
	raw: unknown,
	targetDurationSeconds: number,
	claimLimit: number | null = null,
	options: ScriptDraftValidationOptions = {},
): ScriptOutputValidation {
	const parsed = parseSingleJsonObject(raw);
	if (!parsed.success) return failedValidation([parsed.issueCode]);
	const root = parsed.data;
	if (root.schemaVersion !== ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION)
		return failedValidation(["SCHEMA_VERSION_MISMATCH"]);
	const expectedLanguage =
		options.expectedLanguage ?? defaultOutputRules.language;
	if (
		typeof root.language !== "string" ||
		root.language.trim() !== expectedLanguage
	)
		return failedValidation(["LANGUAGE_MISMATCH"]);
	if (
		"disclosure" in root &&
		(typeof root.disclosure !== "string" || root.disclosure.trim() !== "")
	)
		return failedValidation([
			typeof root.disclosure === "string"
				? "DISCLOSURE_POLICY_INVALID"
				: "DISCLOSURE_SCHEMA_INVALID",
		]);

	let canonicalClaims: ScriptDraft["claims"] | undefined;
	if ("claims" in root) {
		if (!Array.isArray(root.claims))
			return failedValidation(["CLAIMS_SCHEMA_INVALID"]);
		canonicalClaims = [];
		for (const rawClaim of root.claims) {
			const claim = organicClaimSchema.safeParse(rawClaim);
			if (!claim.success) return failedValidation(["CLAIMS_SCHEMA_INVALID"]);
			if (
				claim.data.subjectStatus === "CONFIRMED" ||
				(claim.data.subjectSource !== undefined &&
					claim.data.subjectSource !== null)
			)
				return failedValidation(["ORGANIC_PROVIDER_AUTHORITY_FORBIDDEN"]);
			const canonical = organicCanonicalClaim(claim.data);
			if (!canonical)
				return failedValidation(["ORGANIC_PRODUCT_CLAIM_PROPOSAL"]);
			canonicalClaims.push(canonical);
		}
	}

	const originalDisclosure =
		typeof root.disclosure === "string" ? root.disclosure.trim() : "";
	const compatible = {
		...root,
		schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		...("disclosure" in root
			? {
					disclosure:
						typeof root.disclosure === "string" && originalDisclosure
							? root.disclosure
							: typeof root.disclosure === "string"
								? "__organic_disclosure_none__"
								: root.disclosure,
				}
			: {}),
		...(canonicalClaims
			? {
					claims: canonicalClaims.map((claim) => ({
						text: (claim as { text: string }).text,
						occurrence: (claim as { occurrence: unknown }).occurrence,
					})),
				}
			: {}),
	};
	const validated = validateScriptDraftOutput(
		compatible,
		targetDurationSeconds,
		claimLimit,
		{
			expectedLanguage,
			requiredDisclosure: null,
			avoidWords: options.avoidWords,
		},
	);
	if (!validated.output) return validated;
	const output: PartialScriptDraft = {
		...validated.output,
		schemaVersion: ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
		disclosure: originalDisclosure,
		...(canonicalClaims ? { claims: canonicalClaims } : {}),
	};
	return { ...validated, output };
}

export function validateRepairOrganicScriptOutput(
	raw: unknown,
	repairSections: ScriptGenerationSection[],
	claimLimit: number | null = null,
	options: ScriptDraftValidationOptions = {},
): RepairOutputValidation {
	const parsed = parseSingleJsonObject(raw);
	if (!parsed.success) return { success: false, output: null };
	const root = parsed.data;
	if (root.schemaVersion !== ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION)
		return { success: false, output: null };
	if (
		"disclosure" in root &&
		(typeof root.disclosure !== "string" || root.disclosure.trim() !== "")
	)
		return { success: false, output: null };
	let canonicalClaims: ScriptDraft["claims"] | undefined;
	if ("claims" in root) {
		if (!Array.isArray(root.claims)) return { success: false, output: null };
		canonicalClaims = [];
		for (const rawClaim of root.claims) {
			const claim = organicClaimSchema.safeParse(rawClaim);
			if (!claim.success) return { success: false, output: null };
			if (
				claim.data.subjectStatus === "CONFIRMED" ||
				(claim.data.subjectSource !== undefined &&
					claim.data.subjectSource !== null)
			)
				return { success: false, output: null };
			const canonical = organicCanonicalClaim(claim.data);
			if (!canonical) return { success: false, output: null };
			canonicalClaims.push(canonical);
		}
	}
	const compatible = {
		...root,
		schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		...("disclosure" in root
			? {
					disclosure:
						typeof root.disclosure === "string"
							? root.disclosure.trim() || "__organic_disclosure_none__"
							: root.disclosure,
				}
			: {}),
		...(canonicalClaims
			? {
					claims: canonicalClaims.map((claim) => ({
						text: (claim as { text: string }).text,
						occurrence: (claim as { occurrence: unknown }).occurrence,
					})),
				}
			: {}),
	};
	const validated = validateRepairScriptOutput(
		compatible,
		repairSections,
		claimLimit,
		{
			expectedLanguage: options.expectedLanguage,
			requiredDisclosure: null,
			avoidWords: options.avoidWords,
		},
	);
	if (!validated.success || !validated.output)
		return { success: false, output: null };
	return {
		success: true,
		output: {
			...validated.output,
			schemaVersion: ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
			...("disclosure" in root
				? {
						disclosure:
							typeof root.disclosure === "string" ? root.disclosure.trim() : "",
					}
				: {}),
			...(canonicalClaims ? { claims: canonicalClaims } : {}),
		},
	};
}

export type ValidScriptDraft = z.infer<typeof scriptDraftSchema>;
export type ParsedClaimOccurrence = ClaimOccurrence;

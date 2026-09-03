import { z } from "zod";

import { claimOccurrenceSchema } from "../script-generation/schema";
import { ClaimSubjectError } from "./errors";
import {
	claimSubjectKinds,
	claimSubjectSources,
	claimSubjectStatuses,
} from "./types";
import {
	CLAIM_SUBJECT_CURRENT_SCRIPT_OUTPUT_SCHEMA_VERSION,
	CLAIM_SUBJECT_NEXT_SCRIPT_OUTPUT_SCHEMA_VERSION,
} from "./versioning";

const claimTextSchema = z
	.string()
	.min(1)
	.max(4_000)
	.refine((value) => value === value.trim(), {
		message: "Claim text must already be validated and outer-trimmed.",
	});

export const claimSubjectSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(claimSubjectKinds[0]) }).strict(),
	z
		.object({
			kind: z.literal(claimSubjectKinds[1]),
			binding: z.literal("PROJECT_PRODUCT"),
		})
		.strict(),
]);

export const claimSubjectStatusSchema = z.enum(claimSubjectStatuses);
export const claimSubjectSourceSchema = z.enum(claimSubjectSources);
export const proposedClaimSubjectSchema = z.enum(claimSubjectKinds);

export const subjectAwareScriptClaimSchema = z
	.object({
		text: claimTextSchema,
		occurrence: claimOccurrenceSchema,
		subject: claimSubjectSchema,
		subjectStatus: claimSubjectStatusSchema,
		subjectSource: claimSubjectSourceSchema.nullable(),
		proposedSubject: proposedClaimSubjectSchema.optional(),
	})
	.strict()
	.superRefine((claim, context) => {
		if (claim.subjectStatus === "CONFIRMED" && claim.subjectSource === null) {
			context.addIssue({
				code: "custom",
				path: ["subjectSource"],
				message: "CLAIM_SUBJECT_CONFIRMED_SOURCE_REQUIRED",
			});
		}
		if (
			claim.subjectStatus === "NEEDS_CONFIRMATION" &&
			claim.subjectSource !== null
		) {
			context.addIssue({
				code: "custom",
				path: ["subjectSource"],
				message: "CLAIM_SUBJECT_UNCONFIRMED_SOURCE_MUST_BE_NULL",
			});
		}
	});

export const legacyScriptClaimSchema = z
	.object({
		text: claimTextSchema,
		occurrence: claimOccurrenceSchema,
	})
	.strict();

export type SubjectAwareScriptClaimInput = z.input<
	typeof subjectAwareScriptClaimSchema
>;
export type LegacyScriptClaimInput = z.input<typeof legacyScriptClaimSchema>;

export type VersionedScriptClaim =
	| LegacyScriptClaimInput
	| SubjectAwareScriptClaimInput;

function parseClaimError(error: z.ZodError): ClaimSubjectError {
	if (
		error.issues.some(
			(issue) => issue.message === "CLAIM_SUBJECT_CONFIRMED_SOURCE_REQUIRED",
		)
	) {
		return new ClaimSubjectError("CLAIM_SUBJECT_CONFIRMED_SOURCE_REQUIRED");
	}
	if (
		error.issues.some(
			(issue) =>
				issue.message === "CLAIM_SUBJECT_UNCONFIRMED_SOURCE_MUST_BE_NULL",
		)
	) {
		return new ClaimSubjectError("CLAIM_SUBJECT_UNCONFIRMED_SOURCE_FORBIDDEN");
	}
	return new ClaimSubjectError("CLAIM_SUBJECT_INVALID");
}

export function parseSubjectAwareScriptClaim(
	value: unknown,
): SubjectAwareScriptClaimInput {
	const parsed = subjectAwareScriptClaimSchema.safeParse(value);
	if (!parsed.success) throw parseClaimError(parsed.error);
	return parsed.data;
}

export function parseLegacyScriptClaim(value: unknown): LegacyScriptClaimInput {
	const parsed = legacyScriptClaimSchema.safeParse(value);
	if (!parsed.success) {
		throw new ClaimSubjectError("CLAIM_SUBJECT_INVALID");
	}
	return parsed.data;
}

/**
 * Version-aware parsing keeps the accepted v2 payload separate from the
 * subject-required v3 payload. Unknown versions fail closed.
 */
export function parseScriptClaimByOutputVersion(input: {
	version: string;
	claim: unknown;
}): VersionedScriptClaim {
	if (input.version === CLAIM_SUBJECT_CURRENT_SCRIPT_OUTPUT_SCHEMA_VERSION) {
		return parseLegacyScriptClaim(input.claim);
	}
	if (input.version === CLAIM_SUBJECT_NEXT_SCRIPT_OUTPUT_SCHEMA_VERSION) {
		return parseSubjectAwareScriptClaim(input.claim);
	}
	throw new ClaimSubjectError("CLAIM_SUBJECT_INVALID");
}

export const parseVersionedScriptClaim = parseScriptClaimByOutputVersion;

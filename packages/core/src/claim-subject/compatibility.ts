import { legacyScriptClaimSchema, parseLegacyScriptClaim } from "./schema";
import type {
	ClaimSubjectContext,
	LegacyScriptClaim,
	SubjectAwareScriptClaim,
} from "./types";

export const LEGACY_AFFILIATE_CLAIM_SUBJECT = Object.freeze({
	kind: "PRODUCT" as const,
	binding: "PROJECT_PRODUCT" as const,
});

export type LegacyClaimAdaptation =
	| Readonly<{
			kind: "effective";
			claim: SubjectAwareScriptClaim;
	  }>
	| Readonly<{
			kind: "unknown";
			reasonCode: "CLAIM_SUBJECT_LEGACY_CONTEXT_UNSUPPORTED";
	  }>;

/**
 * Legacy mapping is effective read/policy metadata only. It never mutates the
 * subject-less payload stored in a historical ScriptVersion.
 */
export function adaptLegacyAffiliateClaim(input: {
	context: ClaimSubjectContext;
	claim: unknown;
}): LegacyClaimAdaptation {
	const claim = parseLegacyScriptClaim(input.claim) as LegacyScriptClaim;
	if (
		input.context.contentType !== "AFFILIATE" ||
		input.context.creationPath !== "SCRIPTED"
	) {
		return {
			kind: "unknown",
			reasonCode: "CLAIM_SUBJECT_LEGACY_CONTEXT_UNSUPPORTED",
		};
	}
	return {
		kind: "effective",
		claim: Object.freeze({
			text: claim.text,
			occurrence: claim.occurrence,
			subject: LEGACY_AFFILIATE_CLAIM_SUBJECT,
			subjectStatus: "CONFIRMED" as const,
			subjectSource: "LEGACY_COMPATIBILITY" as const,
		}),
	};
}

/**
 * A malformed subject-aware object must not fall back to the legacy adapter.
 */
export function hasClaimSubjectMetadata(value: unknown): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	return (
		Object.hasOwn(value, "subject") ||
		Object.hasOwn(value, "subjectStatus") ||
		Object.hasOwn(value, "subjectSource")
	);
}

export function isLegacyScriptClaim(
	value: unknown,
): value is LegacyScriptClaim {
	return legacyScriptClaimSchema.safeParse(value).success;
}

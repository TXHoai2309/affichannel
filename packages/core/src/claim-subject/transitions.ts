import { claimSubjectSchema, parseSubjectAwareScriptClaim } from "./schema";
import type {
	ClaimSubject,
	ClaimSubjectProposal,
	SubjectAwareScriptClaim,
} from "./types";

function subjectForProposal(
	proposedSubject: ClaimSubjectProposal["proposedSubject"],
): ClaimSubject {
	return proposedSubject === "GENERAL"
		? { kind: "GENERAL" }
		: { kind: "PRODUCT", binding: "PROJECT_PRODUCT" };
}

/**
 * Converts provider/extraction metadata into an unresolved current claim. The
 * proposal is never an authoritative source.
 */
export function createNeedsConfirmationClaim(
	input: ClaimSubjectProposal,
): SubjectAwareScriptClaim {
	return Object.freeze({
		text: input.text,
		occurrence: input.occurrence,
		subject: subjectForProposal(input.proposedSubject),
		subjectStatus: "NEEDS_CONFIRMATION" as const,
		subjectSource: null,
	});
}

/**
 * Pure user confirmation/correction. It changes metadata only, never Script
 * text or occurrence.
 */
export function confirmClaimSubject(input: {
	claim: SubjectAwareScriptClaim;
	subject: ClaimSubject;
}): SubjectAwareScriptClaim {
	const subject = claimSubjectSchema.parse(input.subject);
	const claim = parseSubjectAwareScriptClaim(input.claim);
	return Object.freeze({
		text: claim.text,
		occurrence: claim.occurrence,
		subject,
		subjectStatus: "CONFIRMED" as const,
		subjectSource: "USER" as const,
	});
}

/**
 * Explicit structured-source confirmation. Callers must have deterministic
 * structured evidence; free-text Organic source mode is not an implicit caller.
 */
export function confirmStructuredClaimSubject(input: {
	claim: SubjectAwareScriptClaim;
	subject: ClaimSubject;
}): SubjectAwareScriptClaim {
	const subject = claimSubjectSchema.parse(input.subject);
	const claim = parseSubjectAwareScriptClaim(input.claim);
	return Object.freeze({
		text: claim.text,
		occurrence: claim.occurrence,
		subject,
		subjectStatus: "CONFIRMED" as const,
		subjectSource: "STRUCTURED_SOURCE" as const,
	});
}

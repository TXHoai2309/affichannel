export const claimSubjectErrorCodes = [
	"CLAIM_SUBJECT_INVALID",
	"CLAIM_SUBJECT_CONFIRMED_SOURCE_REQUIRED",
	"CLAIM_SUBJECT_UNCONFIRMED_SOURCE_FORBIDDEN",
	"CLAIM_SUBJECT_LEGACY_CONTEXT_UNSUPPORTED",
] as const;

export type ClaimSubjectErrorCode = (typeof claimSubjectErrorCodes)[number];

export class ClaimSubjectError extends Error {
	readonly code: ClaimSubjectErrorCode;

	constructor(code: ClaimSubjectErrorCode, message: string = code) {
		super(message);
		this.name = "ClaimSubjectError";
		this.code = code;
	}
}

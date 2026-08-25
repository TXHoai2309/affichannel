export const claimManifestErrorCodes = [
	"INVALID_CLAIM_MANIFEST",
	"CLAIM_MANIFEST_SOURCE_NOT_USABLE",
] as const;

export type ClaimManifestErrorCode = (typeof claimManifestErrorCodes)[number];

export const claimManifestIssueCodes = [
	"INVALID_SOURCE",
	"UNSUPPORTED_SCHEMA_VERSION",
	"CLAIM_LIMIT_EXCEEDED",
	"CLAIM_REFERENCE_INVALID",
	"DUPLICATE_CLAIM_KEY",
	"CLAIM_COUNT_MISMATCH",
	"CLAIM_EMPTY_MISMATCH",
	"FINGERPRINT_MISMATCH",
] as const;

export type ClaimManifestIssueCode = (typeof claimManifestIssueCodes)[number];

export class ClaimManifestError extends Error {
	readonly code: ClaimManifestErrorCode;
	readonly issueCodes: readonly ClaimManifestIssueCode[];

	constructor(
		code: ClaimManifestErrorCode,
		issueCodes: readonly ClaimManifestIssueCode[],
		message: string = code,
	) {
		super(message);
		this.name = "ClaimManifestError";
		this.code = code;
		this.issueCodes = [...new Set(issueCodes)];
	}
}

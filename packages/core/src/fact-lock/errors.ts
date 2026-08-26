export const factLockErrorCodes = [
	"FACT_LOCK_NOT_FOUND",
	"FACT_LOCK_ALREADY_PENDING",
	"FACT_LOCK_IDEMPOTENCY_CONFLICT",
	"FACT_LOCK_SCRIPT_NOT_READY",
	"FACT_LOCK_NO_USABLE_FACTS",
	"INVALID_FACT_LOCK_OUTPUT",
	"FACT_LOCK_PROVIDER_NOT_CONFIGURED",
	"FACT_LOCK_PROVIDER_UNAVAILABLE",
	"FACT_LOCK_COST_ESTIMATE_UNAVAILABLE",
	"FACT_LOCK_STALE",
	"FACT_LOCK_CONFLICT",
	"FACT_LOCK_CLAIM_NOT_FOUND",
	"FACT_LOCK_CLAIM_NOT_REVIEWABLE",
	"FACT_LOCK_CLAIM_DELETE_REQUIRES_EDIT",
	"FACT_LOCK_CLAIM_SOURCE_MISMATCH",
	"FACT_LOCK_CLAIM_SUGGESTION_UNAVAILABLE",
	"FACT_LOCK_SCRIPT_VERSION_NOT_FOUND",
	"FACT_LOCK_SCRIPT_VERSION_IMMUTABLE",
	"FACT_LOCK_EDIT_INVALID",
	"FACT_LOCK_REQUIRED",
	"FACT_LOCK_MANIFEST_REQUIRED",
	"CLAIM_MANIFEST_NOT_FOUND",
	"CLAIM_MANIFEST_NOT_EXECUTABLE",
	"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
	"FACT_LOCK_PROVIDER_RESULT_MISMATCH",
] as const;
export type FactLockErrorCode = (typeof factLockErrorCodes)[number];

export class FactLockError extends Error {
	readonly code: FactLockErrorCode;
	readonly metadata: Record<string, unknown> | undefined;

	constructor(
		code: FactLockErrorCode,
		message: string = code,
		metadata?: Record<string, unknown>,
	) {
		super(message);
		this.name = "FactLockError";
		this.code = code;
		this.metadata = metadata;
	}
}

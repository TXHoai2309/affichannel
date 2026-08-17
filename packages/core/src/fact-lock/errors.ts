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
] as const;
export type FactLockErrorCode = (typeof factLockErrorCodes)[number];

export class FactLockError extends Error {
	readonly code: FactLockErrorCode;

	constructor(code: FactLockErrorCode, message: string = code) {
		super(message);
		this.name = "FactLockError";
		this.code = code;
	}
}

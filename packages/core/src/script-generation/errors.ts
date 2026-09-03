export const scriptGenerationErrorCodes = [
	"CHANNEL_SETTINGS_INCOMPLETE",
	"NO_USABLE_PRODUCT_FACTS",
	"TEXT_PROVIDER_NOT_CONFIGURED",
	"TEXT_PROVIDER_UNAVAILABLE",
	"COST_ESTIMATE_UNAVAILABLE",
	"GENERATION_ALREADY_IN_PROGRESS",
	"IDEMPOTENCY_CONFLICT",
	"GENERATION_NOT_FOUND",
	"GENERATION_INVALID_TRANSITION",
	"INVALID_REPAIR_SECTIONS",
	"BASE_GENERATION_INVALIDATED",
	"INVALID_GENERATION_OUTPUT",
	"AI_TIMEOUT",
	"AI_TIMEOUT_UNCERTAIN",
	"AI_PROVIDER_ERROR",
	"AI_INVALID_OUTPUT",
	"AI_OUTPUT_TRUNCATED",
	"AI_REQUEST_STATE_UNCERTAIN",
	"INVALID_REPAIR_REQUEST",
	"GENERATION_INDETERMINATE",
	"GENERATION_NOT_STALE",
	"ORGANIC_PRODUCT_CLAIM_PROPOSAL",
	"ORGANIC_SOURCE_NOT_SUPPORTED",
] as const;
export type ScriptGenerationErrorCode =
	(typeof scriptGenerationErrorCodes)[number];

export class ScriptGenerationError extends Error {
	readonly code: ScriptGenerationErrorCode;

	constructor(code: ScriptGenerationErrorCode, message: string = code) {
		super(message);
		this.name = "ScriptGenerationError";
		this.code = code;
	}
}

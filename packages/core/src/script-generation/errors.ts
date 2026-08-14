export const scriptGenerationErrorCodes = [
	"NO_USABLE_PRODUCT_FACTS",
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
	"GENERATION_INDETERMINATE",
	"GENERATION_NOT_STALE",
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

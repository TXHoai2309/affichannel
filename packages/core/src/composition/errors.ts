export const compositionErrorCodes = [
	"COMPOSITION_INPUT_INCOMPLETE",
	"COMPOSITION_INPUT_INVALID",
	"COMPOSITION_VERSION_NOT_FOUND",
	"COMPOSITION_SCOPE_MISMATCH",
	"COMPOSITION_CURRENTNESS_UNKNOWN",
	"COMPOSITION_STALE",
	"COMPOSITION_EXECUTION_BLOCKED",
	"OUTPUT_ENCODING_PROFILE_INCOMPLETE",
	"RENDER_REQUEST_PROFILE_INVALID",
] as const;

export type CompositionErrorCode = (typeof compositionErrorCodes)[number];

export class CompositionError extends Error {
	readonly code: CompositionErrorCode;
	readonly metadata: Record<string, unknown>;

	constructor(
		code: CompositionErrorCode,
		message: string = code,
		metadata: Record<string, unknown> = {},
	) {
		super(message);
		this.name = "CompositionError";
		this.code = code;
		this.metadata = metadata;
	}
}

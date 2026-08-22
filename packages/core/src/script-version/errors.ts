export const scriptVersionErrorCodes = [
	"SCRIPT_VERSION_NOT_FOUND",
	"SCRIPT_GENERATION_NOT_FOUND",
	"SCRIPT_GENERATION_NOT_EDITABLE",
	"SCRIPT_GENERATION_INVALIDATED",
	"SCRIPT_VERSION_DRAFT_ALREADY_EXISTS",
	"SCRIPT_VERSION_CONFLICT",
	"SCRIPT_VERSION_IMMUTABLE",
	"INVALID_SCRIPT_VERSION_SNAPSHOT",
] as const;

export type ScriptVersionErrorCode = (typeof scriptVersionErrorCodes)[number];

export class ScriptVersionError extends Error {
	readonly code: ScriptVersionErrorCode;
	readonly metadata: { latestRevision?: number } | undefined;

	constructor(
		code: ScriptVersionErrorCode,
		message: string = code,
		metadata?: { latestRevision?: number },
	) {
		super(message);
		this.name = "ScriptVersionError";
		this.code = code;
		this.metadata = metadata;
	}
}

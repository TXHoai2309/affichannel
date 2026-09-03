import {
	ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
} from "../script-generation/policy";
import {
	SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V1,
	SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V2,
	SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V1,
	SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V2,
} from "./runtime-types";

export const scriptClaimRefreshModes = ["AFFILIATE_V1", "ORGANIC_V2"] as const;
export type ScriptClaimRefreshMode = (typeof scriptClaimRefreshModes)[number];

export type ScriptClaimRefreshStrategy = Readonly<{
	mode: ScriptClaimRefreshMode;
	promptVersion:
		| typeof SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V1
		| typeof SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V2;
	outputSchemaVersion:
		| typeof SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V1
		| typeof SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V2;
}>;

export function resolveScriptClaimRefreshStrategy(input: {
	contentType: string;
	creationPath: string;
	contentFormatKey: string;
	contentFormatVersion: number;
	scriptSchemaVersion: string;
}): ScriptClaimRefreshStrategy | null {
	if (
		input.contentType === "AFFILIATE" &&
		input.creationPath === "SCRIPTED" &&
		input.contentFormatKey === "SCRIPTED_STANDARD" &&
		input.contentFormatVersion === 1 &&
		input.scriptSchemaVersion === SCRIPT_OUTPUT_SCHEMA_VERSION
	) {
		return {
			mode: "AFFILIATE_V1",
			promptVersion: SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V1,
			outputSchemaVersion: SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V1,
		};
	}
	if (
		input.contentType === "ORGANIC" &&
		input.creationPath === "SCRIPTED" &&
		input.contentFormatKey === "SCRIPTED_STANDARD" &&
		input.contentFormatVersion === 1 &&
		input.scriptSchemaVersion === ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION
	) {
		return {
			mode: "ORGANIC_V2",
			promptVersion: SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V2,
			outputSchemaVersion: SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V2,
		};
	}
	return null;
}

export function resolveScriptClaimRefreshVersionPair(input: {
	promptVersion: string;
	outputSchemaVersion: string;
}): ScriptClaimRefreshStrategy | null {
	if (
		input.promptVersion === SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V1 &&
		input.outputSchemaVersion === SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V1
	) {
		return {
			mode: "AFFILIATE_V1",
			promptVersion: SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V1,
			outputSchemaVersion: SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V1,
		};
	}
	if (
		input.promptVersion === SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V2 &&
		input.outputSchemaVersion === SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V2
	) {
		return {
			mode: "ORGANIC_V2",
			promptVersion: SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V2,
			outputSchemaVersion: SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V2,
		};
	}
	return null;
}

import type { ClaimOccurrence } from "../script-generation/types";

export const SCRIPT_CLAIM_REFRESH_INPUT_VERSION =
	"script-claim-refresh.v1" as const;
export const SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V1 =
	"script-claim-refresh-prompt.v1" as const;
export const SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V2 =
	"script-claim-refresh-prompt.v2" as const;
export const SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V1 =
	"script-claim-refresh-output.v1" as const;
export const SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V2 =
	"script-claim-refresh-output.v2" as const;

// v1 aliases remain the Affiliate contract and are intentionally unchanged.
export const SCRIPT_CLAIM_REFRESH_PROMPT_VERSION =
	SCRIPT_CLAIM_REFRESH_PROMPT_VERSION_V1;
export const SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION =
	SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION_V1;
export const SCRIPT_CLAIM_REFRESH_MAX_CLAIMS = 64 as const;

export type ScriptClaimRefreshSourceProjection = Readonly<{
	selectedHook: Readonly<{ key: string; text: string }>;
	voiceover: readonly Readonly<{ key: string; text: string }>[];
	scenes: readonly Readonly<{
		order: number;
		onScreenText: string | null;
	}>[];
	cta: Readonly<{ text: string }>;
	caption: string;
}>;

export type ScriptClaimRefreshInputSnapshot = Readonly<{
	inputVersion: typeof SCRIPT_CLAIM_REFRESH_INPUT_VERSION;
	scriptVersionId: string;
	sourceScriptRevision: number;
	sourceContentHash: string;
	source: ScriptClaimRefreshSourceProjection;
}>;

export type ScriptClaimRefreshCandidateClaim = Readonly<{
	text: string;
	occurrence: ClaimOccurrence;
}>;

export type OrganicScriptClaimRefreshCandidateClaim = Readonly<{
	text: string;
	occurrence: ClaimOccurrence;
	proposedSubject: "GENERAL" | "PRODUCT";
}>;

export type ScriptClaimRefreshProviderOutput = Readonly<{
	claims: readonly ScriptClaimRefreshCandidateClaim[];
}>;

export type OrganicScriptClaimRefreshProviderOutput = Readonly<{
	claims: readonly OrganicScriptClaimRefreshCandidateClaim[];
}>;

import type { ClaimOccurrence } from "../script-generation/types";

export const SCRIPT_CLAIM_REFRESH_INPUT_VERSION =
	"script-claim-refresh.v1" as const;
export const SCRIPT_CLAIM_REFRESH_PROMPT_VERSION =
	"script-claim-refresh-prompt.v1" as const;
export const SCRIPT_CLAIM_REFRESH_OUTPUT_SCHEMA_VERSION =
	"script-claim-refresh-output.v1" as const;
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

export type ScriptClaimRefreshProviderOutput = Readonly<{
	claims: readonly ScriptClaimRefreshCandidateClaim[];
}>;

export const SCRIPT_SNAPSHOT_VERSION = "script-input.v2";
export const SCRIPT_OUTPUT_SCHEMA_VERSION = "script-draft.v2";
export const SCRIPT_PROMPT_VERSION = "script-prompt.v2";

export const SCRIPT_GENERATION_LIMITS = {
	maxInputSnapshotBytes: 128 * 1024,
	maxOutputBytes: 128 * 1024,
	maxVoiceoverSegments: 32,
	maxScenes: 32,
	maxHashtags: 30,
	maxClaims: 64,
	minHookVariants: 3,
	maxHookVariants: 5,
	maxTextLength: 4_000,
	maxHashtagLength: 80,
	durationToleranceRatio: 0.15,
} as const;

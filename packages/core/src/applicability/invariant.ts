import type {
	ApplicabilityCapability,
	ApplicabilityCapabilityResult,
	ApplicabilityCompletion,
	ApplicabilityReasonCode,
	ApplicabilityState,
} from "./types";

type ApplicabilityResultTuple = Pick<
	ApplicabilityCapabilityResult,
	"capability" | "state" | "completion" | "reasonCode"
>;

type CanonicalTuple = readonly [
	ApplicabilityCapability,
	ApplicabilityState,
	ApplicabilityCompletion,
];

const unsupportedIdentityTuples = [
	["PRODUCT", "BLOCKED", "NOT_STARTED"],
	["SCRIPT", "BLOCKED", "NOT_STARTED"],
	["FACT_LOCK", "BLOCKED", "NOT_STARTED"],
	["VOICE", "BLOCKED", "NOT_STARTED"],
	["RENDER", "BLOCKED", "NOT_STARTED"],
] as const satisfies readonly CanonicalTuple[];

/**
 * Canonical output-shape contract for Applicability reason codes. This table
 * validates Resolver output only; it does not derive applicability policy.
 */
const CANONICAL_APPLICABILITY_REASON_TUPLES = {
	PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY: [
		["PRODUCT", "NOT_REQUIRED", "NOT_STARTED"],
	],
	PROJECT_IDENTITY_UNSUPPORTED: unsupportedIdentityTuples,
	AFFILIATE_PRODUCT_NOT_LINKED: [["PRODUCT", "BLOCKED", "NOT_STARTED"]],
	PRODUCT_NOT_ACCESSIBLE: [["PRODUCT", "BLOCKED", "IN_PROGRESS"]],
	PRODUCT_READY: [["PRODUCT", "READY", "COMPLETE"]],
	SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH: [
		["SCRIPT", "NOT_REQUIRED", "NOT_STARTED"],
	],
	SCRIPT_REQUIRES_ACCESSIBLE_PRODUCT: [["SCRIPT", "REQUIRED", "NOT_STARTED"]],
	SCRIPT_CHANNEL_SETTINGS_INCOMPLETE: [["SCRIPT", "BLOCKED", "NOT_STARTED"]],
	SCRIPT_PRODUCT_FACTS_UNUSABLE: [["SCRIPT", "BLOCKED", "NOT_STARTED"]],
	SCRIPT_SOURCE_DEPENDENCY_STALE: [["SCRIPT", "STALE", "IN_PROGRESS"]],
	SCRIPT_GENERATION_PENDING: [["SCRIPT", "REQUIRED", "IN_PROGRESS"]],
	SCRIPT_GENERATION_FAILED: [["SCRIPT", "BLOCKED", "IN_PROGRESS"]],
	SCRIPT_GENERATION_INDETERMINATE: [["SCRIPT", "BLOCKED", "IN_PROGRESS"]],
	SCRIPT_GENERATION_REQUIRED: [["SCRIPT", "READY", "NOT_STARTED"]],
	CURRENT_SCRIPT_VERSION_REQUIRED: [["SCRIPT", "READY", "IN_PROGRESS"]],
	SCRIPT_VERSION_NOT_FACT_LOCK_READY: [["SCRIPT", "BLOCKED", "IN_PROGRESS"]],
	SCRIPT_READY: [["SCRIPT", "READY", "COMPLETE"]],
	FACT_LOCK_REQUIRES_CURRENT_SCRIPT: [["FACT_LOCK", "REQUIRED", "NOT_STARTED"]],
	FACT_LOCK_SCRIPT_NOT_READY: [["FACT_LOCK", "REQUIRED", "NOT_STARTED"]],
	FACT_LOCK_STALE_FACTS: [["FACT_LOCK", "STALE", "IN_PROGRESS"]],
	FACT_LOCK_PASSED: [["FACT_LOCK", "READY", "COMPLETE"]],
	FACT_LOCK_REVIEW_REQUIRED: [["FACT_LOCK", "BLOCKED", "IN_PROGRESS"]],
	FACT_LOCK_PENDING: [["FACT_LOCK", "REQUIRED", "IN_PROGRESS"]],
	FACT_LOCK_FAILED: [["FACT_LOCK", "BLOCKED", "IN_PROGRESS"]],
	FACT_LOCK_INDETERMINATE: [["FACT_LOCK", "BLOCKED", "IN_PROGRESS"]],
	FACT_LOCK_STALE_SCRIPT: [["FACT_LOCK", "STALE", "IN_PROGRESS"]],
	FACT_LOCK_RUN_REQUIRED: [["FACT_LOCK", "READY", "NOT_STARTED"]],
	VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY: [
		["VOICE", "NOT_REQUIRED", "NOT_STARTED"],
	],
	VOICE_ARTIFACTS_STALE: [["VOICE", "STALE", "IN_PROGRESS"]],
	VOICE_REQUIRES_FACT_LOCK_PASS: [
		["VOICE", "REQUIRED", "NOT_STARTED"],
		["VOICE", "REQUIRED", "IN_PROGRESS"],
	],
	VOICE_BLOCKED_BY_FACT_LOCK: [
		["VOICE", "BLOCKED", "NOT_STARTED"],
		["VOICE", "BLOCKED", "IN_PROGRESS"],
	],
	VOICE_CONFIG_REQUIRED: [["VOICE", "READY", "NOT_STARTED"]],
	VOICE_SEGMENTS_FAILED: [["VOICE", "BLOCKED", "IN_PROGRESS"]],
	VOICE_SEGMENTS_INDETERMINATE: [["VOICE", "BLOCKED", "IN_PROGRESS"]],
	VOICE_SEGMENTS_PENDING: [["VOICE", "REQUIRED", "IN_PROGRESS"]],
	VOICE_SEGMENTS_REQUIRED: [["VOICE", "READY", "IN_PROGRESS"]],
	VOICE_SEGMENTS_INCOMPLETE: [["VOICE", "READY", "IN_PROGRESS"]],
	VOICE_READY: [["VOICE", "READY", "COMPLETE"]],
	RENDER_NOT_REQUIRED_FOR_PROJECT_IDENTITY: [
		["RENDER", "NOT_REQUIRED", "NOT_STARTED"],
	],
	RENDER_REQUIRES_UPSTREAM_CAPABILITIES: [
		["RENDER", "REQUIRED", "NOT_STARTED"],
	],
	RENDER_INPUTS_STALE: [["RENDER", "STALE", "IN_PROGRESS"]],
	RENDER_FEATURE_NOT_IMPLEMENTED: [["RENDER", "BLOCKED", "NOT_STARTED"]],
} as const satisfies Record<ApplicabilityReasonCode, readonly CanonicalTuple[]>;

export function isCanonicalApplicabilityCapabilityResult(
	result: ApplicabilityResultTuple,
): boolean {
	const tuples = (
		CANONICAL_APPLICABILITY_REASON_TUPLES as Partial<
			Record<ApplicabilityReasonCode, readonly CanonicalTuple[]>
		>
	)[result.reasonCode];
	if (!tuples) return false;
	return tuples.some(
		([capability, state, completion]) =>
			capability === result.capability &&
			state === result.state &&
			completion === result.completion,
	);
}

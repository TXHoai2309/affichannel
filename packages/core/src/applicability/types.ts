import type { FactLockGateReason } from "../fact-lock/gate";
import type { LegacyProjectState } from "../project/legacy-affiliate-compatibility";

export const APPLICABILITY_CAPABILITIES = [
	"PRODUCT",
	"SCRIPT",
	"FACT_LOCK",
	"VOICE",
	"RENDER",
] as const;

export type ApplicabilityCapability =
	(typeof APPLICABILITY_CAPABILITIES)[number];

export const APPLICABILITY_STATES = [
	"NOT_REQUIRED",
	"OPTIONAL",
	"REQUIRED",
	"READY",
	"BLOCKED",
	"STALE",
] as const;

export type ApplicabilityState = (typeof APPLICABILITY_STATES)[number];

export const APPLICABILITY_COMPLETIONS = [
	"NOT_STARTED",
	"IN_PROGRESS",
	"COMPLETE",
] as const;

export type ApplicabilityCompletion =
	(typeof APPLICABILITY_COMPLETIONS)[number];

export const APPLICABILITY_REASON_CODES = [
	"PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
	"PROJECT_IDENTITY_UNSUPPORTED",
	"AFFILIATE_PRODUCT_NOT_LINKED",
	"PRODUCT_NOT_ACCESSIBLE",
	"PRODUCT_READY",
	"SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH",
	"SCRIPT_REQUIRES_ACCESSIBLE_PRODUCT",
	"SCRIPT_CHANNEL_SETTINGS_INCOMPLETE",
	"SCRIPT_PRODUCT_FACTS_UNUSABLE",
	"SCRIPT_SOURCE_DEPENDENCY_STALE",
	"SCRIPT_GENERATION_PENDING",
	"SCRIPT_GENERATION_FAILED",
	"SCRIPT_GENERATION_INDETERMINATE",
	"SCRIPT_GENERATION_REQUIRED",
	"CURRENT_SCRIPT_VERSION_REQUIRED",
	"SCRIPT_VERSION_NOT_FACT_LOCK_READY",
	"SCRIPT_READY",
	"FACT_LOCK_REQUIRES_CURRENT_SCRIPT",
	"FACT_LOCK_SCRIPT_NOT_READY",
	"FACT_LOCK_STALE_FACTS",
	"FACT_LOCK_PASSED",
	"FACT_LOCK_REVIEW_REQUIRED",
	"FACT_LOCK_PENDING",
	"FACT_LOCK_FAILED",
	"FACT_LOCK_INDETERMINATE",
	"FACT_LOCK_STALE_SCRIPT",
	"FACT_LOCK_RUN_REQUIRED",
	"VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
	"VOICE_ARTIFACTS_STALE",
	"VOICE_REQUIRES_FACT_LOCK_PASS",
	"VOICE_BLOCKED_BY_FACT_LOCK",
	"VOICE_CONFIG_REQUIRED",
	"VOICE_SEGMENTS_FAILED",
	"VOICE_SEGMENTS_INDETERMINATE",
	"VOICE_SEGMENTS_PENDING",
	"VOICE_SEGMENTS_REQUIRED",
	"VOICE_SEGMENTS_INCOMPLETE",
	"VOICE_READY",
	"RENDER_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
	"RENDER_REQUIRES_UPSTREAM_CAPABILITIES",
	"RENDER_INPUTS_STALE",
	"RENDER_FEATURE_NOT_IMPLEMENTED",
] as const;

export type ApplicabilityReasonCode =
	(typeof APPLICABILITY_REASON_CODES)[number];

export const APPLICABILITY_DEPENDENCIES = [
	"PROJECT_IDENTITY",
	"PRODUCT_LINK",
	"SCRIPT_GENERATION",
	"SCRIPT_VERSION",
	"FACT_LOCK_GATE",
	"VOICE_CONFIG",
	"VOICE_SEGMENTS",
	"RENDER_IMPLEMENTATION",
] as const;

export type ApplicabilityDependency =
	(typeof APPLICABILITY_DEPENDENCIES)[number];

export const APPLICABILITY_DEPENDENCY_STATUSES = [
	"CURRENT",
	"MISSING",
	"INACCESSIBLE",
	"UNSUPPORTED",
	"NOT_STARTED",
	"PENDING",
	"FAILED",
	"INDETERMINATE",
	"STALE",
	"READY",
	"INCOMPLETE",
	"COMPLETE",
	"NOT_IMPLEMENTED",
] as const;

export type ApplicabilityDependencyStatus =
	(typeof APPLICABILITY_DEPENDENCY_STATUSES)[number];

export type ApplicabilityDependencySummary = {
	dependency: ApplicabilityDependency;
	status: ApplicabilityDependencyStatus;
	total?: number;
	current?: number;
};

export type ScriptGenerationApplicabilityStatus =
	| "NONE"
	| "PENDING"
	| "FAILED"
	| "INDETERMINATE"
	| "USABLE";

export type ProjectApplicabilityInput = {
	projectIdentity: LegacyProjectState;
	product: {
		accessible: boolean;
	};
	script: {
		generationStatus: ScriptGenerationApplicabilityStatus;
		usableGenerationPresent: boolean;
		sourceDependencyCurrent: boolean;
		currentVersionPresent: boolean;
		currentVersionFactLockReady: boolean;
		channelSettingsComplete: boolean;
		productFactsUsable: boolean;
	};
	factLock: {
		gateReason: FactLockGateReason;
	};
	voice: {
		configPresent: boolean;
		previewPresent: boolean;
		totalSegments: number;
		attemptedSegments: number;
		usableSegments: number;
		pendingSegments: number;
		failedSegments: number;
		indeterminateSegments: number;
		staleSegments: number;
	};
	render: {
		featureImplemented: false;
		inputsStale: boolean;
	};
};

export type ApplicabilityCapabilityResult = {
	capability: ApplicabilityCapability;
	state: ApplicabilityState;
	completion: ApplicabilityCompletion;
	reasonCode: ApplicabilityReasonCode;
	dependencies: readonly ApplicabilityDependencySummary[];
};

export type ProjectApplicabilityResult = {
	capabilities: readonly ApplicabilityCapabilityResult[];
	nextApplicableStep: ApplicabilityCapability | null;
};

import type {
	ApplicabilityCapability,
	ApplicabilityCompletion,
	ApplicabilityReasonCode,
	ApplicabilityState,
} from "../applicability/types";
import type { LegacyProjectExceptionReason } from "../project/legacy-affiliate-compatibility";

export const ADAPTIVE_WORKFLOW_ROUTE_KEYS = [
	"product",
	"content",
	"fact-lock",
	"voice",
	"video",
	"preview",
] as const;

export type AdaptiveWorkflowRouteKey =
	(typeof ADAPTIVE_WORKFLOW_ROUTE_KEYS)[number];

export type AdaptiveWorkflowRouteDescriptor = {
	key: AdaptiveWorkflowRouteKey;
	segment: AdaptiveWorkflowRouteKey;
};

export const ADAPTIVE_WORKFLOW_ACTION_KINDS = [
	"OPEN_STEP",
	"RESOLVE_BLOCKER",
	"RETRY_OR_REFRESH",
	"OPT_IN",
	"COMING_SOON",
] as const;

export type AdaptiveWorkflowActionKind =
	(typeof ADAPTIVE_WORKFLOW_ACTION_KINDS)[number];

export type AdaptiveWorkflowAction = {
	kind: AdaptiveWorkflowActionKind;
	targetCapability: ApplicabilityCapability | null;
	targetRouteKey: AdaptiveWorkflowRouteKey | null;
};

export const ADAPTIVE_WORKFLOW_OPTIONAL_SELECTIONS = [
	"NOT_APPLICABLE",
	"NOT_SELECTED",
	"SELECTED",
	"UNSUPPORTED",
] as const;

export type AdaptiveWorkflowOptionalSelection =
	(typeof ADAPTIVE_WORKFLOW_OPTIONAL_SELECTIONS)[number];

export type AdaptiveWorkflowStep = {
	capability: ApplicabilityCapability;
	applicabilityState: ApplicabilityState;
	completion: ApplicabilityCompletion;
	reasonCode: ApplicabilityReasonCode;
	primaryRoute: AdaptiveWorkflowRouteDescriptor;
	secondaryRoutes: readonly AdaptiveWorkflowRouteDescriptor[];
	visible: boolean;
	navigable: boolean;
	visibleOrdinal: number | null;
	optionalSelection: AdaptiveWorkflowOptionalSelection;
	primaryAction: AdaptiveWorkflowAction | null;
};

export type AdaptiveWorkflowUnsupportedReason =
	| LegacyProjectExceptionReason
	| "PROJECT_IDENTITY_UNSUPPORTED"
	| "AFFILIATE_PRODUCT_NOT_LINKED";

export type AdaptiveWorkflowUnsupportedState = {
	isUnsupported: boolean;
	reasonCode: AdaptiveWorkflowUnsupportedReason | null;
};

export type AdaptiveWorkflowTerminalState = {
	routeKey: "completed";
	eligible: boolean;
	reason:
		| "NO_APPLICABLE_STEP_REMAINS"
		| "NEXT_APPLICABLE_STEP_REMAINS"
		| "PROJECT_IDENTITY_UNSUPPORTED";
};

export type AdaptiveWorkflowReadModel = {
	steps: readonly AdaptiveWorkflowStep[];
	nextApplicableStep: ApplicabilityCapability | null;
	nextRouteKey: AdaptiveWorkflowRouteKey | null;
	terminalState: AdaptiveWorkflowTerminalState;
	unsupportedState: AdaptiveWorkflowUnsupportedState;
};

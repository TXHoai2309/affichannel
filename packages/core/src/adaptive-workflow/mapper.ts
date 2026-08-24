import type {
	ApplicabilityCapability,
	ApplicabilityCapabilityResult,
	ProjectApplicabilityResult,
} from "../applicability/types";
import type { LegacyProjectClassification } from "../project/legacy-affiliate-compatibility";
import type {
	AdaptiveWorkflowAction,
	AdaptiveWorkflowOptionalSelection,
	AdaptiveWorkflowReadModel,
	AdaptiveWorkflowRouteDescriptor,
	AdaptiveWorkflowRouteKey,
	AdaptiveWorkflowStep,
	AdaptiveWorkflowUnsupportedReason,
} from "./types";

const route = (
	key: AdaptiveWorkflowRouteKey,
): AdaptiveWorkflowRouteDescriptor => ({ key, segment: key });

export const ADAPTIVE_WORKFLOW_ROUTES = {
	PRODUCT: { primary: route("product"), secondary: [] },
	SCRIPT: { primary: route("content"), secondary: [] },
	FACT_LOCK: { primary: route("fact-lock"), secondary: [] },
	VOICE: { primary: route("voice"), secondary: [] },
	RENDER: { primary: route("video"), secondary: [route("preview")] },
} as const satisfies Record<
	ApplicabilityCapability,
	{
		primary: AdaptiveWorkflowRouteDescriptor;
		secondary: readonly AdaptiveWorkflowRouteDescriptor[];
	}
>;

export type AdaptiveWorkflowMapperOptions = {
	identityClassification?: LegacyProjectClassification;
	optionalSelectionSupported?: boolean;
	selectedOptionalCapabilities?: readonly ApplicabilityCapability[];
};

function optionalSelection(
	result: ApplicabilityCapabilityResult,
	options: AdaptiveWorkflowMapperOptions,
): AdaptiveWorkflowOptionalSelection {
	if (result.state !== "OPTIONAL") return "NOT_APPLICABLE";
	if (!options.optionalSelectionSupported) return "UNSUPPORTED";
	return options.selectedOptionalCapabilities?.includes(result.capability)
		? "SELECTED"
		: "NOT_SELECTED";
}

function actionFor(
	result: ApplicabilityCapabilityResult,
	selection: AdaptiveWorkflowOptionalSelection,
	nextApplicableStep: ApplicabilityCapability | null,
): AdaptiveWorkflowAction | null {
	if (result.state === "NOT_REQUIRED") return null;
	if (result.state === "OPTIONAL") {
		if (selection === "UNSUPPORTED") return null;
		return selection === "SELECTED"
			? {
					kind: "OPEN_STEP",
					targetCapability: result.capability,
					targetRouteKey:
						ADAPTIVE_WORKFLOW_ROUTES[result.capability].primary.key,
				}
			: {
					kind: "OPT_IN",
					targetCapability: result.capability,
					targetRouteKey:
						ADAPTIVE_WORKFLOW_ROUTES[result.capability].primary.key,
				};
	}
	if (
		result.reasonCode === "RENDER_FEATURE_NOT_IMPLEMENTED" &&
		result.state === "BLOCKED"
	) {
		return {
			kind: "COMING_SOON",
			targetCapability: null,
			targetRouteKey: null,
		};
	}
	if (result.state === "STALE") {
		return {
			kind: "RETRY_OR_REFRESH",
			targetCapability: result.capability,
			targetRouteKey: ADAPTIVE_WORKFLOW_ROUTES[result.capability].primary.key,
		};
	}
	if (result.state === "BLOCKED" || result.state === "REQUIRED") {
		const targetCapability = nextApplicableStep ?? result.capability;
		return {
			kind: "RESOLVE_BLOCKER",
			targetCapability,
			targetRouteKey: ADAPTIVE_WORKFLOW_ROUTES[targetCapability].primary.key,
		};
	}
	return {
		kind: "OPEN_STEP",
		targetCapability: result.capability,
		targetRouteKey: ADAPTIVE_WORKFLOW_ROUTES[result.capability].primary.key,
	};
}

function unsupportedReason(
	result: ProjectApplicabilityResult,
	classification: LegacyProjectClassification | undefined,
): AdaptiveWorkflowUnsupportedReason | null {
	if (classification?.kind === "exception") return classification.reasonCode;
	const productReason = result.capabilities.find(
		(item) =>
			item.reasonCode === "PROJECT_IDENTITY_UNSUPPORTED" ||
			item.reasonCode === "AFFILIATE_PRODUCT_NOT_LINKED",
	)?.reasonCode;
	return productReason === "PROJECT_IDENTITY_UNSUPPORTED" ||
		productReason === "AFFILIATE_PRODUCT_NOT_LINKED"
		? productReason
		: null;
}

/**
 * Pure presentation-structure mapper. Applicability and next-step truth are copied
 * from the Resolver result; this function never re-derives domain policy.
 */
export function mapAdaptiveWorkflowReadModel(
	result: ProjectApplicabilityResult,
	options: AdaptiveWorkflowMapperOptions = {},
): AdaptiveWorkflowReadModel {
	const unsupported = unsupportedReason(result, options.identityClassification);
	let visibleOrdinal = 0;
	const steps: AdaptiveWorkflowStep[] = result.capabilities.map(
		(capability) => {
			const selection = optionalSelection(capability, options);
			const visible =
				capability.state !== "NOT_REQUIRED" &&
				(capability.state !== "OPTIONAL" || selection === "SELECTED");
			const ordinal = visible ? ++visibleOrdinal : null;
			const routes = ADAPTIVE_WORKFLOW_ROUTES[capability.capability];
			return {
				capability: capability.capability,
				applicabilityState: capability.state,
				completion: capability.completion,
				reasonCode: capability.reasonCode,
				primaryRoute: routes.primary,
				secondaryRoutes: routes.secondary,
				visible,
				navigable:
					capability.state !== "NOT_REQUIRED" && selection !== "UNSUPPORTED",
				visibleOrdinal: ordinal,
				optionalSelection: selection,
				primaryAction: actionFor(
					capability,
					selection,
					result.nextApplicableStep,
				),
			};
		},
	);
	const nextRouteKey = result.nextApplicableStep
		? ADAPTIVE_WORKFLOW_ROUTES[result.nextApplicableStep].primary.key
		: null;

	return {
		steps,
		nextApplicableStep: result.nextApplicableStep,
		nextRouteKey,
		terminalState: {
			routeKey: "completed",
			eligible: unsupported === null && result.nextApplicableStep === null,
			reason:
				unsupported !== null
					? "PROJECT_IDENTITY_UNSUPPORTED"
					: result.nextApplicableStep === null
						? "NO_APPLICABLE_STEP_REMAINS"
						: "NEXT_APPLICABLE_STEP_REMAINS",
		},
		unsupportedState: {
			isUnsupported: unsupported !== null,
			reasonCode: unsupported,
		},
	};
}

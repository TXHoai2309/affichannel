import type {
	ApplicabilityCapability,
	ApplicabilityCompletion,
	ApplicabilityReasonCode,
	ApplicabilityState,
} from "../applicability/types";
import type {
	AdaptiveWorkflowActionKind,
	AdaptiveWorkflowReadModel,
	AdaptiveWorkflowRouteKey,
} from "./types";

export type ProjectWorkflowEntrySummary = {
	projectId: string;
	nextCapability: ApplicabilityCapability | null;
	nextRouteKey: AdaptiveWorkflowRouteKey | null;
	nextState: ApplicabilityState | null;
	nextCompletion: ApplicabilityCompletion | null;
	nextReasonCode: ApplicabilityReasonCode | null;
	nextActionKind: AdaptiveWorkflowActionKind | null;
	completedVisibleSteps: number;
	totalVisibleSteps: number;
	unsupported: boolean;
	canContinue: boolean;
};

export function mapProjectWorkflowEntrySummary(
	projectId: string,
	workflow: AdaptiveWorkflowReadModel,
): ProjectWorkflowEntrySummary {
	const visibleSteps = workflow.steps.filter((step) => step.visible);
	const nextStep = workflow.nextApplicableStep
		? workflow.steps.find(
				(step) => step.capability === workflow.nextApplicableStep,
			)
		: undefined;
	const nextActionKind = nextStep?.primaryAction?.kind ?? null;
	const canContinue =
		!workflow.unsupportedState.isUnsupported &&
		workflow.nextRouteKey !== null &&
		nextStep?.navigable === true &&
		nextActionKind !== null &&
		nextActionKind !== "COMING_SOON";

	return {
		projectId,
		nextCapability: nextStep?.capability ?? null,
		nextRouteKey: workflow.nextRouteKey,
		nextState: nextStep?.applicabilityState ?? null,
		nextCompletion: nextStep?.completion ?? null,
		nextReasonCode: nextStep?.reasonCode ?? null,
		nextActionKind,
		completedVisibleSteps: visibleSteps.filter(
			(step) => step.completion === "COMPLETE",
		).length,
		totalVisibleSteps: visibleSteps.length,
		unsupported: workflow.unsupportedState.isUnsupported,
		canContinue,
	};
}

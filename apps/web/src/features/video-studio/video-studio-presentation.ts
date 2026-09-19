import type {
	AdaptiveWorkflowReadModel,
	AdaptiveWorkflowStep,
} from "@affichannel/core";
import { VIDEO_STUDIO_TABS, type VideoStudioTabKey } from "./video-studio-tabs";

export const VIDEO_STUDIO_PRESENTATION_STATES = [
	"AVAILABLE",
	"REQUIRED",
	"OPTIONAL",
	"NOT_APPLICABLE",
	"PLACEHOLDER",
] as const;

export type VideoStudioPresentationState =
	(typeof VIDEO_STUDIO_PRESENTATION_STATES)[number];

export type VideoStudioTabPresentation = {
	key: VideoStudioTabKey;
	label: string;
	description: string;
	state: VideoStudioPresentationState;
	helpText: string;
	capabilities: readonly string[];
};

function stateForStep(
	step: AdaptiveWorkflowStep | undefined,
): VideoStudioPresentationState {
	if (!step || step.applicabilityState === "NOT_REQUIRED")
		return "NOT_APPLICABLE";
	if (step.applicabilityState === "OPTIONAL") return "OPTIONAL";
	if (step.reasonCode === "RENDER_FEATURE_NOT_IMPLEMENTED")
		return "PLACEHOLDER";
	if (step.applicabilityState === "READY") return "AVAILABLE";
	return "REQUIRED";
}

function stepFor(
	workflow: AdaptiveWorkflowReadModel,
	capability: AdaptiveWorkflowStep["capability"],
) {
	return workflow.steps.find((step) => step.capability === capability);
}

function aggregateState(
	steps: readonly (AdaptiveWorkflowStep | undefined)[],
): VideoStudioPresentationState {
	const states = steps.map(stateForStep);
	if (states.includes("REQUIRED")) return "REQUIRED";
	if (states.includes("PLACEHOLDER")) return "PLACEHOLDER";
	if (states.includes("OPTIONAL")) return "OPTIONAL";
	if (states.includes("AVAILABLE")) return "AVAILABLE";
	return "NOT_APPLICABLE";
}

function helpText(state: VideoStudioPresentationState, key: VideoStudioTabKey) {
	if (state === "NOT_APPLICABLE") return "Không áp dụng cho project hiện tại.";
	if (state === "PLACEHOLDER")
		return "Vertical slice này chưa sẵn sàng; shell không bật action render.";
	if (state === "REQUIRED") return "Cần hoàn tất các yêu cầu phù hợp trước.";
	if (state === "OPTIONAL")
		return "Bước này là tùy chọn theo Applicability Resolver.";
	if (key === "export")
		return "Có thể xem preflight và trạng thái output hiện tại.";
	return "Có thể mở các tài nguyên phù hợp với project.";
}

/** Derives only UI state from the server/shared Applicability Resolver read model. */
export function deriveVideoStudioTabPresentation(
	workflow: AdaptiveWorkflowReadModel,
): readonly VideoStudioTabPresentation[] {
	const contentSteps = [
		stepFor(workflow, "PRODUCT"),
		stepFor(workflow, "SCRIPT"),
		stepFor(workflow, "FACT_LOCK"),
	];
	const resourcesSteps = [stepFor(workflow, "VOICE")];
	const renderStep = stepFor(workflow, "RENDER");
	return VIDEO_STUDIO_TABS.map((tab) => {
		const steps =
			tab.key === "content"
				? contentSteps
				: tab.key === "resources"
					? resourcesSteps
					: [renderStep];
		const state = aggregateState(steps);
		return {
			...tab,
			state,
			helpText: helpText(state, tab.key),
			capabilities: steps
				.filter((step): step is AdaptiveWorkflowStep => Boolean(step))
				.map((step) => step.capability),
		};
	});
}

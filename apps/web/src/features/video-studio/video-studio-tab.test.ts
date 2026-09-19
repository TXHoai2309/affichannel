import type { AdaptiveWorkflowReadModel } from "@affichannel/core";
import { describe, expect, it } from "vitest";
import {
	deriveVideoStudioTabPresentation,
	VIDEO_STUDIO_PRESENTATION_STATES,
} from "./video-studio-presentation";
import {
	mapPersistedStepToVideoStudioTab,
	resolveVideoStudioTab,
	VIDEO_STUDIO_TAB_KEYS,
} from "./video-studio-tabs";

const workflow = {
	steps: [
		{
			capability: "PRODUCT",
			applicabilityState: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		},
		{
			capability: "SCRIPT",
			applicabilityState: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH",
		},
		{
			capability: "FACT_LOCK",
			applicabilityState: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
		},
		{
			capability: "VOICE",
			applicabilityState: "NOT_REQUIRED",
			completion: "NOT_STARTED",
			reasonCode: "VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY",
		},
		{
			capability: "RENDER",
			applicabilityState: "BLOCKED",
			completion: "NOT_STARTED",
			reasonCode: "RENDER_FEATURE_NOT_IMPLEMENTED",
		},
	],
	unsupportedState: { isUnsupported: false, reasonCode: null },
	nextApplicableStep: null,
	nextRouteKey: null,
	terminalState: {
		routeKey: "completed",
		eligible: false,
		reason: "NEXT_APPLICABLE_STEP_REMAINS",
	},
} as unknown as AdaptiveWorkflowReadModel;

describe("Video Studio presentation mapping", () => {
	it("defines exactly the four URL-navigable tabs", () => {
		expect(VIDEO_STUDIO_TAB_KEYS).toEqual([
			"content",
			"resources",
			"compose",
			"export",
		]);
		expect(VIDEO_STUDIO_PRESENTATION_STATES).toContain("PLACEHOLDER");
	});

	it("maps existing persisted keys without inventing a new key", () => {
		expect(mapPersistedStepToVideoStudioTab("product")).toBe("content");
		expect(mapPersistedStepToVideoStudioTab("preview")).toBe("export");
		expect(mapPersistedStepToVideoStudioTab("future-step")).toBeNull();
		expect(mapPersistedStepToVideoStudioTab("toString")).toBeNull();
		expect(resolveVideoStudioTab("not-a-tab")).toBe("content");
	});

	it("derives Media First/render placeholder states from the shared read model", () => {
		const presentation = deriveVideoStudioTabPresentation(workflow);
		expect(presentation.find((tab) => tab.key === "content")?.state).toBe(
			"NOT_APPLICABLE",
		);
		expect(presentation.find((tab) => tab.key === "resources")?.state).toBe(
			"NOT_APPLICABLE",
		);
		expect(presentation.find((tab) => tab.key === "compose")?.state).toBe(
			"PLACEHOLDER",
		);
	});
});

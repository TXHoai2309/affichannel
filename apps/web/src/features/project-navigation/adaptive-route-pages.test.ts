import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/project-navigation/gated-project-step-page", () => ({
	default: "adaptive-route-gate",
}));
vi.mock("@/features/script-generation/script-studio", () => ({
	default: "script-studio",
}));
vi.mock("@/features/fact-lock/fact-lock-review", () => ({
	default: "fact-lock-review",
}));
vi.mock("@/features/voice/voice-studio", () => ({ default: "voice-studio" }));

import ContentPage from "../../app/(protected)/projects/[projectId]/content/page";
import FactLockPage from "../../app/(protected)/projects/[projectId]/fact-lock/page";
import PreviewPage from "../../app/(protected)/projects/[projectId]/preview/page";
import VideoPage from "../../app/(protected)/projects/[projectId]/video/page";
import VoicePage from "../../app/(protected)/projects/[projectId]/voice/page";

describe("AFF-US-015/15C internal route wiring", () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([
		["/content", ContentPage, "content", "script-studio"],
		["/fact-lock", FactLockPage, "fact-lock", "fact-lock-review"],
		["/voice", VoicePage, "voice", "voice-studio"],
		["/video", VideoPage, "video", null],
		["/preview", PreviewPage, "preview", null],
	] as const)(
		"routes %s through the shared Adaptive gate",
		async (_route, Page, stepKey, childType) => {
			const result = await Page({
				params: Promise.resolve({ projectId: "project-route" }),
			});

			expect(result.type).toBe("adaptive-route-gate");
			expect(result.props).toMatchObject({
				projectId: "project-route",
				stepKey,
			});
			if (childType) expect(result.props.children.type).toBe(childType);
			else expect(result.props.children).toBeUndefined();
		},
	);
});

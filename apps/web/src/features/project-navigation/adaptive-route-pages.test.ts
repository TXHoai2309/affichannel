import { beforeEach, describe, expect, it, vi } from "vitest";

const previewMocks = vi.hoisted(() => ({
	getCurrentWorkspaceActor: vi.fn(),
	getProjectForCurrentUser: vi.fn(),
	preflight: vi.fn(),
}));

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
vi.mock("@/lib/project-loader", () => ({
	getCurrentWorkspaceActor: previewMocks.getCurrentWorkspaceActor,
	getProjectForCurrentUser: previewMocks.getProjectForCurrentUser,
}));
vi.mock("@affichannel/api/services/quick-image-preview-preflight", () => ({
	preflightQuickImageCompositionVersion: previewMocks.preflight,
}));

import ContentPage from "../../app/(protected)/projects/[projectId]/content/page";
import FactLockPage from "../../app/(protected)/projects/[projectId]/fact-lock/page";
import PreviewPage from "../../app/(protected)/projects/[projectId]/preview/page";
import VideoPage from "../../app/(protected)/projects/[projectId]/video/page";
import VoicePage from "../../app/(protected)/projects/[projectId]/voice/page";

function projectWithIdentity({
	creationPath,
	contentFormatKey,
	contentFormatVersion,
}: {
	creationPath: "QUICK_IMAGE" | "SCRIPTED" | string;
	contentFormatKey: string;
	contentFormatVersion: number;
}) {
	return {
		product: { id: "product-route", name: "Product" },
		contentType: "ORGANIC",
		creationPath,
		contentFormat: {
			ref: { key: contentFormatKey, version: contentFormatVersion },
		},
	};
}

const scriptedProject = () =>
	projectWithIdentity({
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
	});

const quickImageProject = () =>
	projectWithIdentity({
		creationPath: "QUICK_IMAGE",
		contentFormatKey: "QUICK_IMAGE_STANDARD",
		contentFormatVersion: 1,
	});

describe("AFF-US-015/15C internal route wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		previewMocks.getCurrentWorkspaceActor.mockResolvedValue({
			workspaceId: "workspace-1",
			userId: "user-1",
		});
		previewMocks.getProjectForCurrentUser.mockResolvedValue(scriptedProject());
		previewMocks.preflight.mockResolvedValue({ ok: true });
	});

	it.each([
		["/content", ContentPage, "content", "script-studio"],
		["/fact-lock", FactLockPage, "fact-lock", "fact-lock-review"],
		["/voice", VoicePage, "voice", "voice-studio"],
		["/video", VideoPage, "video", null],
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

	it("routes canonical Quick Image preview by one explicit CompositionVersion", async () => {
		previewMocks.getProjectForCurrentUser.mockResolvedValue(
			quickImageProject(),
		);
		const result = await PreviewPage({
			params: Promise.resolve({ projectId: "project-route" }),
			searchParams: Promise.resolve({ compositionVersionId: "version-1" }),
		});

		expect(result.props).toMatchObject({
			"data-project-id": "project-route",
			"data-composition-version-id": "version-1",
		});
		expect(result.props.children[0].props.children).toBe("Quick Image preview");
		expect(previewMocks.preflight).toHaveBeenCalledWith(
			{ workspaceId: "workspace-1", userId: "user-1" },
			"project-route",
			"version-1",
		);
	});

	it("keeps canonical Quick Image preview in a safe state when the query is missing", async () => {
		previewMocks.getProjectForCurrentUser.mockResolvedValue(
			quickImageProject(),
		);
		const result = await PreviewPage({
			params: Promise.resolve({ projectId: "project-route" }),
		});

		expect(result.props["data-composition-version-id"]).toBe("");
		expect(result.props.children[1].props.children[1].props.children).toBe(
			"compositionVersionId",
		);
		expect(previewMocks.preflight).not.toHaveBeenCalled();
	});

	it("fails closed without preflight when compositionVersionId repeats", async () => {
		previewMocks.getProjectForCurrentUser.mockResolvedValue(
			quickImageProject(),
		);
		const result = await PreviewPage({
			params: Promise.resolve({ projectId: "project-route" }),
			searchParams: Promise.resolve({
				compositionVersionId: ["version-a", "version-b"],
			}),
		});

		expect(result.props["data-composition-version-id"]).toBe("");
		expect(result.props.children[1].props.children[1].props.children).toBe(
			"compositionVersionId",
		);
		expect(previewMocks.preflight).not.toHaveBeenCalled();
	});

	it("renders a safe state when the explicit version fails server preflight", async () => {
		previewMocks.getProjectForCurrentUser.mockResolvedValue(
			quickImageProject(),
		);
		previewMocks.preflight.mockResolvedValue({
			ok: false,
			code: "PREVIEW_COMPOSITION_MISSING",
			message: "missing",
		});
		const result = await PreviewPage({
			params: Promise.resolve({ projectId: "project-route" }),
			searchParams: Promise.resolve({
				compositionVersionId: "missing-version",
			}),
		});

		expect(result.props.children[1].props.children).toContain("không hợp lệ");
	});

	it("preserves the pre-C1 adaptive preview gate for Scripted projects", async () => {
		const result = await PreviewPage({
			params: Promise.resolve({ projectId: "project-route" }),
		});

		expect(result.type).toBe("adaptive-route-gate");
		expect(result.props).toMatchObject({
			projectId: "project-route",
			stepKey: "preview",
		});
		expect(previewMocks.preflight).not.toHaveBeenCalled();
	});

	it("does not let a Scripted query switch into Quick Image preview", async () => {
		const result = await PreviewPage({
			params: Promise.resolve({ projectId: "project-route" }),
			searchParams: Promise.resolve({ compositionVersionId: "version-1" }),
		});

		expect(result.type).toBe("adaptive-route-gate");
		expect(result.props.stepKey).toBe("preview");
		expect(previewMocks.preflight).not.toHaveBeenCalled();
	});

	it.each([
		[
			"malformed path/format",
			projectWithIdentity({
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "SCRIPTED_STANDARD",
				contentFormatVersion: 1,
			}),
		],
		[
			"unsupported Quick Image format version",
			projectWithIdentity({
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "QUICK_IMAGE_STANDARD",
				contentFormatVersion: 2,
			}),
		],
	] as const)("fails closed for %s identity", async (_label, project) => {
		previewMocks.getProjectForCurrentUser.mockResolvedValue(project);
		const result = await PreviewPage({
			params: Promise.resolve({ projectId: "project-route" }),
			searchParams: Promise.resolve({ compositionVersionId: "version-1" }),
		});

		expect(result.type).toBe("adaptive-route-gate");
		expect(result.props.stepKey).toBe("preview");
		expect(previewMocks.preflight).not.toHaveBeenCalled();
	});
});

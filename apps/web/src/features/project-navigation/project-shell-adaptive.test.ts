import type { AdaptiveWorkflowReadModel } from "@affichannel/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({
	getCurrentWorkspaceActor: vi.fn(),
	getAdaptiveWorkflowForCurrentUser: vi.fn(),
	getProjectForCurrentUser: vi.fn(),
	getFactLockGateForCurrentUser: vi.fn(),
	getVoiceStepSummaryForCurrentUser: vi.fn(),
}));

vi.mock("@/lib/project-loader", () => loader);

import ProjectLayout from "../../app/(protected)/projects/[projectId]/layout";
import ProjectOverviewPage from "../../app/(protected)/projects/[projectId]/page";

function workflow(): AdaptiveWorkflowReadModel {
	return {
		steps: [],
		nextApplicableStep: null,
		nextRouteKey: null,
		terminalState: {
			routeKey: "completed",
			eligible: false,
			reason: "NEXT_APPLICABLE_STEP_REMAINS",
		},
		unsupportedState: { isUnsupported: false, reasonCode: null },
	};
}

function project() {
	return {
		id: "project-shell",
		name: "Project shell fixture",
		product: { id: "product-shell", name: "Sản phẩm fixture" },
		brief: {
			platform: "tiktok" as const,
			goal: "Kiểm tra Project Overview",
			durationSeconds: 30,
			angle: "Deterministic",
			description: null,
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

describe("AFF-US-015 Project shell adaptive cutover", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loader.getCurrentWorkspaceActor.mockResolvedValue({
			workspaceId: "workspace-shell",
			userId: "user-shell",
		});
		loader.getAdaptiveWorkflowForCurrentUser.mockResolvedValue(workflow());
		loader.getProjectForCurrentUser.mockResolvedValue(project());
	});

	it("loads only Adaptive Workflow for the ProjectStepper presentation", async () => {
		const result = await ProjectLayout({
			children: "child",
			params: Promise.resolve({ projectId: "project-shell" }),
		});

		expect(loader.getAdaptiveWorkflowForCurrentUser).toHaveBeenCalledWith(
			"project-shell",
		);
		expect(loader.getProjectForCurrentUser).not.toHaveBeenCalled();
		expect(loader.getFactLockGateForCurrentUser).not.toHaveBeenCalled();
		expect(loader.getVoiceStepSummaryForCurrentUser).not.toHaveBeenCalled();
		expect(result.props.children[0].props).toMatchObject({
			projectId: "project-shell",
			workflow: workflow(),
		});
	});

	it("starts cached Project metadata and Adaptive Workflow reads in parallel for Overview", async () => {
		const projectRead = deferred<ReturnType<typeof project>>();
		const workflowRead = deferred<AdaptiveWorkflowReadModel>();
		loader.getProjectForCurrentUser.mockReturnValue(projectRead.promise);
		loader.getAdaptiveWorkflowForCurrentUser.mockReturnValue(
			workflowRead.promise,
		);

		const pending = ProjectOverviewPage({
			params: Promise.resolve({ projectId: "project-shell" }),
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(loader.getProjectForCurrentUser).toHaveBeenCalledWith(
			"project-shell",
		);
		expect(loader.getAdaptiveWorkflowForCurrentUser).toHaveBeenCalledWith(
			"project-shell",
		);
		expect(loader.getFactLockGateForCurrentUser).not.toHaveBeenCalled();
		expect(loader.getVoiceStepSummaryForCurrentUser).not.toHaveBeenCalled();

		projectRead.resolve(project());
		workflowRead.resolve(workflow());
		const result = await pending;
		expect(result.props).toMatchObject({
			projectId: "project-shell",
			workflow: workflow(),
		});
	});
});

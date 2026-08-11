import {
	createInitialProjectWorkflowState,
	createProject,
	ProjectServiceError,
} from "@affichannel/core/project/project-service";
import {
	createProjectInputSchema,
	normalizeProjectName,
} from "@affichannel/core/project/project-validation";
import { describe, expect, it } from "vitest";

const productId = "4d52617e-54d1-4f12-92d0-a98e7e9a4d81";

describe("project domain contract", () => {
	it("normalizes a project name without making it globally unique", () => {
		expect(normalizeProjectName("  Video   Review  ")).toBe("video review");
	});

	it("validates the Content Brief required fields", () => {
		expect(() =>
			createProjectInputSchema.parse({
				name: "Video review Tai nghe X1",
				productId,
				platform: "tiktok",
				goal: "Tạo đơn qua affiliate",
				durationSeconds: 14,
				angle: "Review trải nghiệm dùng thật",
			}),
		).toThrow();
	});

	it("initializes exactly seven persisted statuses and a product current step", () => {
		const workflow = createInitialProjectWorkflowState();

		expect(workflow.currentStepKey).toBe("product");
		expect(workflow.stepStatuses).toHaveLength(7);
		expect(
			workflow.stepStatuses.every((step) => step.status === "not_started"),
		).toBe(true);
	});

	it("refuses project creation when the selected product is outside the workspace", async () => {
		const repository = {
			findAccessibleProduct: async () => undefined,
			createProjectBundle: async () => "should-not-create",
			findProject: async () => undefined,
			listProjects: async () => [],
			updateProjectBundle: async () => undefined,
			archiveProject: async () => undefined,
			updateWorkflow: async () => undefined,
		};

		await expect(
			createProject(
				repository,
				{ workspaceId: "internal", userId: "user-1" },
				{
					name: "Video review Tai nghe X1",
					productId,
					platform: "tiktok",
					goal: "Tạo đơn qua affiliate",
					durationSeconds: 30,
					description: undefined,
					angle: "Review trải nghiệm dùng thật",
				},
			),
		).rejects.toBeInstanceOf(ProjectServiceError);
	});
});

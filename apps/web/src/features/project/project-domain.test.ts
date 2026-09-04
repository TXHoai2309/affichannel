import type { ProjectRepository } from "@affichannel/core/project/project-service";
import {
	createInitialProjectWorkflowState,
	createProject,
	ProjectServiceError,
	updateProject,
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

	it("rejects missing required Content Brief fields", () => {
		const result = createProjectInputSchema.safeParse({
			name: "",
			productId: "",
			platform: "tiktok",
			goal: "",
			durationSeconds: 30,
			angle: "",
		});

		expect(result.success).toBe(false);
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
			findProjectIdentity: async () => undefined,
			listProjects: async () => [],
			updateProjectBundle: async () => undefined,
			archiveProject: async () => undefined,
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

	it("allows Organic Scripted creation without Product linkage", async () => {
		let productLookupCount = 0;
		const repository: ProjectRepository<{ id: string }> = {
			findAccessibleProduct: async () => {
				productLookupCount += 1;
				return undefined;
			},
			createProjectBundle: async ({ input, identity }) => ({
				id: "organic-project",
				contentType: identity.contentType,
				productId: input.productId,
			}),
			findProject: async () => undefined,
			findProjectIdentity: async () => undefined,
			listProjects: async () => [],
			updateProjectBundle: async () => undefined,
			archiveProject: async () => undefined,
		};

		const result = await createProject(
			repository,
			{ workspaceId: "internal", userId: "user-1" },
			{
				name: "Organic không sản phẩm",
				productId: null,
				contentType: "ORGANIC",
				creationPath: "SCRIPTED",
				contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
				platform: "tiktok",
				goal: "Tăng nhận biết",
				durationSeconds: 30,
				description: undefined,
				angle: "Chia sẻ trải nghiệm",
			},
		);

		expect(result).toMatchObject({
			contentType: "ORGANIC",
			productId: null,
		});
		expect(productLookupCount).toBe(0);
	});

	it("still rejects Affiliate creation without Product linkage", async () => {
		const repository: ProjectRepository<{ id: string }> = {
			findAccessibleProduct: async () => ({ id: productId }),
			createProjectBundle: async () => ({ id: "should-not-create" }),
			findProject: async () => undefined,
			findProjectIdentity: async () => undefined,
			listProjects: async () => [],
			updateProjectBundle: async () => undefined,
			archiveProject: async () => undefined,
		};

		await expect(
			createProject(
				repository,
				{ workspaceId: "internal", userId: "user-1" },
				{
					name: "Affiliate thiếu sản phẩm",
					productId: null,
					contentType: "AFFILIATE",
					creationPath: "SCRIPTED",
					contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
					platform: "tiktok",
					goal: "Tạo đơn",
					durationSeconds: 30,
					description: undefined,
					angle: "Review thật",
				},
			),
		).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
	});

	it("allows duplicate project names while keeping project records distinct", async () => {
		const createdProjects: Array<{ id: string; name: string }> = [];
		const repository: ProjectRepository<{ id: string; name: string }> = {
			findAccessibleProduct: async () => ({ id: productId }),
			createProjectBundle: async ({ input }) => {
				const project = {
					id: `project-${createdProjects.length + 1}`,
					name: input.name,
				};
				createdProjects.push(project);
				return project;
			},
			findProject: async () => undefined,
			findProjectIdentity: async () => undefined,
			listProjects: async () => createdProjects,
			updateProjectBundle: async () => undefined,
			archiveProject: async () => undefined,
		};
		const input = {
			name: "Chiến dịch mùa hè",
			productId,
			platform: "tiktok" as const,
			goal: "Tạo đơn qua affiliate",
			durationSeconds: 30,
			description: undefined,
			angle: "Review trải nghiệm dùng thật",
		};

		const first = await createProject(
			repository,
			{
				workspaceId: "internal",
				userId: "user-1",
			},
			input,
		);
		const second = await createProject(
			repository,
			{
				workspaceId: "internal",
				userId: "user-1",
			},
			input,
		);

		expect(first.name).toBe(second.name);
		expect(first.id).not.toBe(second.id);
		expect(createdProjects).toHaveLength(2);
	});

	it("allows an existing project to keep its archived product reference", async () => {
		const calls: Array<{ productId: string; projectId?: string }> = [];
		const repository: ProjectRepository<{ id: string }> = {
			findAccessibleProduct: async (input) => {
				calls.push({ productId: input.productId, projectId: input.projectId });
				return input.projectId ? { id: input.productId } : undefined;
			},
			createProjectBundle: async () => ({ id: "created" }),
			findProject: async () => ({ id: "project-1" }),
			findProjectIdentity: async () => ({
				productId,
				contentType: null,
				creationPath: null,
				contentFormatKey: null,
				contentFormatVersion: null,
			}),
			listProjects: async () => [],
			updateProjectBundle: async () => ({ id: "project-1" }),
			archiveProject: async () => undefined,
		};

		await updateProject(
			repository,
			{ workspaceId: "internal", userId: "user-1" },
			{
				id: "project-1",
				name: "Review tai nghe",
				productId,
				platform: "tiktok",
				goal: "Tạo đơn qua affiliate",
				durationSeconds: 30,
				description: undefined,
				angle: "Review trải nghiệm dùng thật",
			},
		);

		expect(calls).toEqual([{ productId, projectId: "project-1" }]);
	});
});

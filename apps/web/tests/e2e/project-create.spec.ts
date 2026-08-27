import { randomUUID } from "node:crypto";
import type { ProjectWorkflowEntrySummary } from "@affichannel/core";
import {
	contentBrief,
	db,
	product,
	productFact,
	project,
	projectStepStatus,
} from "@affichannel/db";
import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { getPostCreateProjectHref } from "../../src/features/project-navigation/project-entry-presentation";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;

test.describe("AFF-US-004 project creation", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("creates a project, persists its workflow, and reopens its current step", async ({
		page,
	}) => {
		const suffix = randomUUID().slice(0, 8);
		const projectName = `E2E project ${suffix}`;
		const productName = `E2E product ${suffix}`;
		let projectId: string | undefined;
		let productId: string | undefined;
		let factId: string | undefined;
		let createProjectRequests = 0;

		try {
			await signIn(page);
			await page.goto("/projects/new");

			await page.getByRole("button", { name: "Tạo sản phẩm" }).click();
			await page.getByLabel("Tên sản phẩm mới").fill(productName);
			const createProductResponsePromise = page.waitForResponse((response) =>
				response.url().includes("/api/rpc/product/createMinimal"),
			);
			await page.getByRole("button", { name: "Tạo", exact: true }).click();
			const createProductResponse = await createProductResponsePromise;
			expect(createProductResponse.ok()).toBeTruthy();

			const [createdProduct] = await db
				.select({
					id: product.id,
					workspaceId: product.workspaceId,
					createdByUserId: product.createdByUserId,
				})
				.from(product)
				.where(eq(product.name, productName))
				.limit(1);
			expect(createdProduct).toBeTruthy();
			productId = createdProduct?.id;
			factId = randomUUID();
			await db.insert(productFact).values({
				id: factId,
				workspaceId: createdProduct?.workspaceId as string,
				productId: createdProduct?.id as string,
				content: "E2E verified product fact for adaptive create routing.",
				type: "specification",
				status: "verified",
				sourceType: "official",
				sourceLabel: "E2E fixture",
				confirmedAt: "2026-08-27",
				createdByUserId: createdProduct?.createdByUserId as string,
				updatedByUserId: createdProduct?.createdByUserId as string,
			});

			page.on("request", (request) => {
				if (
					request.method() === "POST" &&
					request.url().includes("/api/rpc/project/create")
				) {
					createProjectRequests += 1;
				}
			});
			await page.route("**/api/rpc/scriptGeneration/getState", (route) =>
				route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						json: {
							context: {
								project: {
									id: projectId ?? "created-project",
									name: projectName,
								},
								contentBrief: {
									platform: "tiktok",
									goal: "Kiểm tra luồng tạo project",
									durationSeconds: 30,
									angle: "Kiểm tra persistence của content brief",
									description: null,
								},
								product: {
									id: productId,
									name: productName,
									category: null,
								},
								channelSettings: null,
								mediaMetadata: [],
								outputRules: {
									language: "vi-VN",
									aspectRatio: "9:16",
									subtitleSafeArea: "standard",
									claimLimit: null,
									requireFinalCta: true,
								},
								generationConfig: {
									textProvider: "deterministic",
									textModel: "e2e-model",
									promptVersion: "test-prompt",
									outputSchemaVersion: "test-output",
								},
								facts: [
									{
										id: factId,
										revision: 1,
										content:
											"E2E verified product fact for adaptive create routing.",
										type: "specification",
										assessment: {
											verification: "verified",
											evidence: "complete",
											freshness: "not_applicable",
											freshnessReason: "not_applicable",
										},
										generationUsability: "allowed",
										source: {
											type: "official",
											label: "E2E fixture",
											url: null,
											confirmedAt: "2026-08-27",
											expiresAt: null,
										},
									},
								],
							},
							latestRequest: null,
							latestUsableArtifact: null,
							dependencyState: null,
						},
					}),
				}),
			);

			await page.getByLabel("Tên dự án").fill(projectName);
			await page.getByLabel("Mục tiêu").fill("Kiểm tra luồng tạo project");
			await page
				.getByLabel("Góc tiếp cận")
				.fill("Kiểm tra persistence của content brief");
			const createResponsePromise = page.waitForResponse((response) =>
				response.url().includes("/api/rpc/project/create"),
			);
			await page.getByRole("button", { name: "Tạo dự án" }).click();
			const createResponse = await createResponsePromise;
			expect(createResponse.ok()).toBeTruthy();
			const createdProject = (
				(await createResponse.json()) as {
					json: {
						id: string;
						workflowEntry: ProjectWorkflowEntrySummary;
					};
				}
			).json;
			projectId = createdProject.id;
			const expectedPostCreateHref = getPostCreateProjectHref(createdProject);
			expect(createdProject.workflowEntry.nextRouteKey).toBe("content");
			await expect(page).toHaveURL(expectedPostCreateHref);
			expect(createProjectRequests).toBe(1);
			await expect(
				page.getByRole("heading", { name: "Script Studio" }),
			).toBeVisible();
			await expect(
				page.getByText(
					"E2E verified product fact for adaptive create routing.",
					{ exact: true },
				),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Tạo kịch bản" }).first(),
			).toBeDisabled();
			await page.goto(`/projects/${projectId}/product`);

			const persistedProjects = await db
				.select({ id: project.id })
				.from(project)
				.where(eq(project.name, projectName));
			expect(persistedProjects).toHaveLength(1);
			const [persistedProject] = await db
				.select({
					id: project.id,
					currentStepKey: project.currentStepKey,
				})
				.from(project)
				.where(eq(project.id, projectId as string));
			expect(persistedProject).toEqual({
				id: projectId,
				currentStepKey: "product",
			});

			const persistedBrief = await db
				.select({ id: contentBrief.id })
				.from(contentBrief)
				.where(eq(contentBrief.projectId, projectId as string));
			expect(persistedBrief).toHaveLength(1);

			const persistedStatuses = await db
				.select({ stepKey: projectStepStatus.stepKey })
				.from(projectStepStatus)
				.where(eq(projectStepStatus.projectId, projectId as string));
			expect(persistedStatuses).toHaveLength(7);

			await page.getByRole("button", { name: "Tổng quan project" }).click();
			await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
			const overview = page.getByRole("region", { name: projectName });
			await expect(
				overview.getByRole("heading", { name: projectName }),
			).toBeVisible();
			await expect(
				overview.getByText(productName, { exact: true }),
			).toBeVisible();
			await expect(overview.getByText("TikTok", { exact: true })).toBeVisible();
			await expect(
				overview.getByText("Sản phẩm", { exact: true }),
			).toBeVisible();
			await expect(
				overview.getByText("Kiểm tra luồng tạo project"),
			).toBeVisible();
			await expect(
				overview.getByText("Kiểm tra persistence của content brief"),
			).toBeVisible();

			await page.reload();
			await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
			await expect(
				page
					.getByRole("region", { name: projectName })
					.getByRole("heading", { name: projectName }),
			).toBeVisible();

			await page.goBack();
			await expect(page).toHaveURL(
				new RegExp(`/projects/${projectId}/product$`),
			);
			await expect(
				page
					.getByRole("navigation", { name: "Các bước project" })
					.getByRole("link", { name: "Sản phẩm" }),
			).toContainText("Hoàn thành");

			await page.goto("/projects");
			await expect(page.getByText(projectName)).toBeVisible();

			await page.goto("/dashboard");
			await expect(
				page.getByRole("heading", { name: "Tổng quan nhanh" }),
			).toBeVisible();
			await page.getByRole("link", { name: `Mở dự án ${projectName}` }).click();
			await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
			await expect(
				page.getByRole("navigation", { name: "Các bước project" }),
			).toBeVisible();
		} finally {
			await db.delete(project).where(eq(project.name, projectName));
			if (factId) {
				await db.delete(productFact).where(eq(productFact.id, factId));
			}

			const [createdProduct] = await db
				.select({ id: product.id })
				.from(product)
				.where(eq(product.name, productName))
				.limit(1);
			productId = createdProduct?.id;

			if (productId) {
				await db.delete(product).where(eq(product.id, productId));
			}
		}
	});
});

async function signIn(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
}

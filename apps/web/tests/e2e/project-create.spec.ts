import { randomUUID } from "node:crypto";
import { db, product, project } from "@affichannel/db";
import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";

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

		try {
			await signIn(page);
			await page.goto("/projects/new");

			await page.getByRole("button", { name: "Tạo sản phẩm" }).click();
			await page.getByLabel("newProductName").fill(productName);
			await page.getByRole("button", { name: "Tạo", exact: true }).click();

			await page.getByLabel("Tên dự án").fill(projectName);
			await page.getByLabel("Mục tiêu").fill("Kiểm tra luồng tạo project");
			await page
				.getByLabel("Góc tiếp cận")
				.fill("Kiểm tra persistence của content brief");
			await page.getByRole("button", { name: "Tạo dự án" }).click();

			await expect(page).toHaveURL(/\/projects\/[^/]+\/product$/);
			projectId = page.url().match(/\/projects\/([^/]+)\/product$/)?.[1];
			expect(projectId).toBeTruthy();

			await page.goto(`/projects/${projectId}`);
			await expect(page).toHaveURL(
				new RegExp(`/projects/${projectId}/product$`),
			);
			await expect(
				page
					.getByRole("navigation", { name: "Các bước project" })
					.getByRole("link", { name: "Sản phẩm" }),
			).toContainText("Đang làm");

			await page.goto("/projects");
			await expect(page.getByText(projectName)).toBeVisible();
		} finally {
			if (projectId) {
				await db.delete(project).where(eq(project.id, projectId));
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

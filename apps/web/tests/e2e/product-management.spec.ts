import { randomUUID } from "node:crypto";
import { INTERNAL_WORKSPACE_ID } from "@affichannel/core/workspace";
import { db, product, user } from "@affichannel/db";
import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;

test.describe("AFF-US-005 product management", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("creates, searches, edits, archives, restores, and deletes an unused Product", async ({
		page,
	}) => {
		const suffix = Date.now().toString(36);
		const productName = `E2E Product ${suffix}`;
		const editedProductName = `${productName} Updated`;

		try {
			await signIn(page);
			await page.goto("/products/new");
			await page.getByLabel("Tên sản phẩm").fill(productName);
			await page.getByLabel("Danh mục").fill("E2E test");
			await page.getByLabel("Giá tham khảo (VND)").fill("129000");
			await page.getByRole("button", { name: "Lưu sản phẩm" }).click();

			await expect(page).toHaveURL(/\/products\/[^/]+$/);
			await expect(
				page.getByRole("heading", { name: productName }),
			).toBeVisible();

			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await page.getByLabel("Tên sản phẩm").fill(editedProductName);
			await page.getByRole("button", { name: "Lưu thay đổi" }).click();
			await expect(page).toHaveURL(/\/products\/[^/]+$/);
			await expect(
				page.getByRole("heading", { name: editedProductName }),
			).toBeVisible();

			await page.goto("/products");
			await page.getByLabel("Tìm kiếm sản phẩm").fill(editedProductName);
			await expect(
				page.getByRole("link", {
					name: `Mở chi tiết sản phẩm ${editedProductName}`,
				}),
			).toBeVisible();
			await page
				.getByRole("link", {
					name: `Mở chi tiết sản phẩm ${editedProductName}`,
				})
				.click();

			await page.getByRole("button", { name: "Lưu trữ" }).click();
			await expect(page.getByText("Đã lưu trữ", { exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Khôi phục" }).click();
			await expect(page.getByText("Đang hoạt động")).toBeVisible();

			await page.getByRole("button", { name: "Xóa sản phẩm" }).click();
			await expect(
				page.getByRole("heading", { name: "Xóa sản phẩm?" }),
			).toBeVisible();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Xóa sản phẩm" })
				.click();
			await expect(page).toHaveURL(/\/products$/);
		} finally {
			await db.delete(product).where(eq(product.name, editedProductName));
			await db.delete(product).where(eq(product.name, productName));
		}
	});

	test("loads the next cursor page and appends products", async ({ page }) => {
		const suffix = Date.now().toString(36);
		const productPrefix = `E2E Pagination ${suffix}`;
		const [fixedUser] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, fixedAccountEmail as string))
			.limit(1);

		if (!fixedUser) {
			throw new Error("E2E_AUTH_EMAIL does not exist in the database.");
		}

		const now = Date.now();
		const seededProducts = Array.from({ length: 51 }, (_, index) => {
			const timestamp = new Date(now - index * 1_000);
			return {
				id: randomUUID(),
				workspaceId: INTERNAL_WORKSPACE_ID,
				name: `${productPrefix} ${String(index + 1).padStart(2, "0")}`,
				category: "E2E pagination",
				status: "active",
				currency: "VND",
				createdByUserId: fixedUser.id,
				createdAt: timestamp,
				updatedAt: timestamp,
			};
		});

		try {
			await db.insert(product).values(seededProducts);
			await signIn(page);
			await page.goto("/products");
			await page.getByLabel("Tìm kiếm sản phẩm").fill(productPrefix);

			await expect(
				page.getByRole("link", {
					name: `Mở chi tiết sản phẩm ${productPrefix} 01`,
				}),
			).toBeVisible();
			await expect(
				page.getByRole("link", {
					name: `Mở chi tiết sản phẩm ${productPrefix} 51`,
				}),
			).toHaveCount(0);

			await page.getByRole("button", { name: "Tải thêm" }).click();
			await expect(
				page.getByRole("link", {
					name: `Mở chi tiết sản phẩm ${productPrefix} 51`,
				}),
			).toBeVisible();
		} finally {
			await db.delete(product).where(like(product.name, `${productPrefix}%`));
		}
	});
});

async function signIn(page: import("@playwright/test").Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
}

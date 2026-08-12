import { db, product } from "@affichannel/db";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

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
			await expect(page.getByText("Đã lưu trữ")).toBeVisible();
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
});

async function signIn(page: import("@playwright/test").Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
}

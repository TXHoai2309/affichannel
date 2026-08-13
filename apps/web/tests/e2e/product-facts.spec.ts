import { db } from "@affichannel/db";
import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;

test.describe("AFF-US-006 Product Facts", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("deep-links, creates, edits, filters, deletes, and preserves Fact history", async ({
		page,
	}) => {
		const consoleErrors: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		const suffix = Date.now().toString(36);
		const productName = `E2E Fact Product ${suffix}`;
		const factContent = `Giá kiểm thử ${suffix}`;
		const editedContent = `${factContent} updated`;
		let productId: string | undefined;

		try {
			await signIn(page);
			await page.goto("/products/new");
			await page.getByLabel("Tên sản phẩm").fill(productName);
			await page.getByRole("button", { name: "Lưu sản phẩm" }).click();
			await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/i);
			productId = new URL(page.url()).pathname.split("/").at(-1);
			if (!productId) throw new Error("Could not read the created Product id.");

			await page.getByRole("tab", { name: /Product Facts/ }).click();
			await expect(page).toHaveURL(/\?tab=facts$/);
			await page.goBack();
			await expect(page).toHaveURL(new RegExp(`/products/${productId}$`));
			await expect(
				page.getByRole("tab", { name: "Tổng quan" }),
			).toHaveAttribute("aria-selected", "true");
			await page.goForward();
			await expect(page).toHaveURL(/\?tab=facts$/);
			await expect(
				page.getByRole("tab", { name: /Product Facts/ }),
			).toHaveAttribute("aria-selected", "true");
			await page.reload();
			await expect(
				page.getByRole("tab", { name: /Product Facts/ }),
			).toHaveAttribute("aria-selected", "true");

			const verifiedFeatureContent = `Pin sử dụng liên tục 30 giờ ${suffix}`;
			await page.getByRole("button", { name: "Thêm Fact" }).click();
			await page.getByLabel("Nội dung Fact").fill(verifiedFeatureContent);
			await page.getByLabel("Loại Fact").selectOption("feature");
			await page
				.getByLabel("Trạng thái", { exact: true })
				.selectOption("verified");
			await page.getByRole("button", { name: "Thêm Fact" }).click();
			await expect(
				page.getByText(verifiedFeatureContent, { exact: true }),
			).toBeVisible();
			const verifiedFeatureRow = page
				.getByText(verifiedFeatureContent, { exact: true })
				.locator(
					"xpath=ancestor::div[.//button[starts-with(@aria-label, 'Sửa Fact')]][1]",
				);
			await expect(
				verifiedFeatureRow.getByText("Đã xác minh", { exact: true }),
			).toBeVisible();
			await expect(
				verifiedFeatureRow.getByText("Thiếu căn cứ", { exact: true }),
			).toBeVisible();
			await expect(
				verifiedFeatureRow.getByText("Tính năng", { exact: true }),
			).toBeVisible();

			await page.getByRole("button", { name: "Thêm Fact" }).click();
			await expect(
				page.getByRole("heading", { name: "Thêm Product Fact" }),
			).toBeVisible();
			expect(
				consoleErrors.some((message) => message.includes("Drawer.Popup")),
			).toBe(false);
			await page.getByLabel("Nội dung Fact").fill(factContent);
			await page.getByLabel("Loại Fact").selectOption("price");
			await page
				.getByLabel("Trạng thái", { exact: true })
				.selectOption("verified");
			await page.getByLabel("Loại nguồn").selectOption("official");
			await page.getByLabel("Nhãn nguồn").fill("Website thương hiệu");
			await page
				.getByLabel("URL nguồn (không bắt buộc nếu có nhãn)")
				.fill("https://example.com/fact");
			await page.getByLabel("Ngày xác nhận").fill("2026-08-12");
			await page.getByRole("button", { name: "Thêm Fact" }).click();
			await expect(page.getByText(factContent, { exact: true })).toBeVisible();
			await expect(
				page
					.getByText(factContent, { exact: true })
					.locator(
						"xpath=ancestor::div[.//button[starts-with(@aria-label, 'Sửa Fact')]][1]",
					)
					.getByText("Đã xác minh", { exact: true }),
			).toBeVisible();

			await page
				.getByRole("button", { name: `Sửa Fact ${factContent}` })
				.click();
			await page.getByLabel("Nội dung Fact").fill(editedContent);
			await page.getByRole("button", { name: "Lưu thay đổi" }).click();
			await expect(
				page.getByText(editedContent, { exact: true }),
			).toBeVisible();
			await expect(
				page
					.getByText(editedContent, { exact: true })
					.locator(
						"xpath=ancestor::div[.//button[starts-with(@aria-label, 'Sửa Fact')]][1]",
					)
					.getByText("Bản nháp", { exact: true }),
			).toBeVisible();

			await page.getByLabel("Tìm nội dung Product Facts").fill(editedContent);
			await expect(
				page.getByText(editedContent, { exact: true }),
			).toBeVisible();
			await page.reload();
			await expect(
				page.getByText(editedContent, { exact: true }),
			).toBeVisible();

			await page
				.getByRole("button", { name: `Xóa Fact ${editedContent}` })
				.click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Xóa Fact" })
				.click();
			await expect(page.getByText(editedContent, { exact: true })).toHaveCount(
				0,
			);
			await page.getByRole("tab", { name: "Tổng quan" }).click();
			await page.getByRole("button", { name: "Lưu trữ" }).click();
			await expect(page.getByText("Đã lưu trữ", { exact: true })).toBeVisible();
		} finally {
			if (productId) {
				await db.execute(
					sql`delete from product_fact_history where product_id = ${productId}`,
				);
				await db.execute(
					sql`delete from product_fact where product_id = ${productId}`,
				);
				await db.execute(sql`delete from product where id = ${productId}`);
			}
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

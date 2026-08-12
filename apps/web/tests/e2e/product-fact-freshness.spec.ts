import { db } from "@affichannel/db";
import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;

function businessDate(offsetDays: number) {
	const now = new Date();
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Ho_Chi_Minh",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const values = Object.fromEntries(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value]),
	);
	const date = new Date(
		Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)),
	);
	date.setUTCDate(date.getUTCDate() + offsetDays);
	return date.toISOString().slice(0, 10);
}

test.describe("AFF-US-007 Fact freshness", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("shows stale Fact badge and Dashboard warning with a deep link", async ({
		page,
	}) => {
		const suffix = Date.now().toString(36);
		const productName = `E2E Freshness Product ${suffix}`;
		const factContent = `Giá stale ${suffix}`;
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
			await page.getByRole("button", { name: "Thêm Fact" }).click();
			await page.getByLabel("Nội dung Fact").fill(factContent);
			await page.getByLabel("Loại Fact").selectOption("price");
			await page
				.getByLabel("Trạng thái", { exact: true })
				.selectOption("verified");
			await page.getByLabel("Loại nguồn").selectOption("official");
			await page.getByLabel("Nhãn nguồn").fill("Website hãng");
			await page
				.getByLabel("URL nguồn (không bắt buộc nếu có nhãn)")
				.fill("https://example.com/stale");
			await page.getByLabel("Ngày xác nhận").fill(businessDate(-8));
			await page.getByRole("button", { name: "Thêm Fact" }).click();

			const factRow = page
				.getByText(factContent, { exact: true })
				.locator("..", {
					hasText: factContent,
				});
			await expect(page.getByText(factContent, { exact: true })).toBeVisible();
			await expect(
				page.getByText("Cần cập nhật", { exact: true }),
			).toBeVisible();
			await expect(factRow).toBeVisible();

			await page.goto("/dashboard");
			const warning = page.getByRole("link", {
				name: new RegExp(`${productName}.*cần xem lại`),
			});
			await expect(warning).toBeVisible();
			expect(await warning.getAttribute("href")).toBe(
				`/products/${productId}?tab=facts`,
			);
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

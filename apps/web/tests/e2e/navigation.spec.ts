import { expect, type Page, test } from "@playwright/test";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;

test.describe("AFF-US-002 app shell navigation", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("keeps the shell on a direct project URL", async ({ page }) => {
		await signIn(page);
		await page.goto("/projects/demo/fact-lock");

		await expect(page).toHaveURL(/\/projects\/demo\/fact-lock$/);
		await expect(
			page.getByRole("navigation", { name: "Điều hướng chính" }),
		).toBeVisible();
		await expect(page.getByRole("link", { name: "Fact Lock" })).toHaveAttribute(
			"aria-current",
			"step",
		);
	});

	test("supports step navigation with browser back and forward", async ({
		page,
	}) => {
		await signIn(page);
		await page.goto("/projects/demo/product");
		await page.getByRole("link", { name: "Fact Lock" }).click();
		await expect(page).toHaveURL(/\/projects\/demo\/fact-lock$/);

		await page.goBack();
		await expect(page).toHaveURL(/\/projects\/demo\/product$/);
		await page.goForward();
		await expect(page).toHaveURL(/\/projects\/demo\/fact-lock$/);
	});

	test("keeps the protected shell after refresh", async ({ page }) => {
		await signIn(page);
		await page.goto("/products");
		await page.reload();

		await expect(page).toHaveURL(/\/products$/);
		await expect(
			page.getByText("Sản phẩm", { exact: true }).first(),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Thông báo" })).toBeVisible();
	});
});

async function signIn(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.locator("form").getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
}

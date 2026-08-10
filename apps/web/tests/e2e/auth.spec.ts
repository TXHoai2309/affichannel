import { expect, test } from "@playwright/test";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;
const fixedAccountName = process.env.E2E_AUTH_NAME ?? "Fixed Member";

test.describe("AFF-US-001 authentication", () => {
	test("redirects unauthenticated users away from the dashboard", async ({
		page,
	}) => {
		await page.goto("/dashboard");

		await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
	});

	test("does not expose public sign-up", async ({ page, request }) => {
		await page.goto("/login");

		await expect(page.getByText(/sign up|đăng ký/i)).toHaveCount(0);

		const response = await request.post("/api/auth/sign-up/email", {
			data: {
				name: "Rejected Public User",
				email: `blocked-${Date.now()}@example.invalid`,
				password: "NotARealPassword123!",
			},
		});

		expect(response.ok()).toBe(false);
	});

	test("shows a neutral message for invalid credentials", async ({ page }) => {
		await page.goto("/login");
		await page.getByLabel("Email").fill("invalid@example.invalid");
		await page.getByLabel("Mật khẩu").fill("NotARealPassword123!");
		await page.locator("form").getByRole("button", { name: "Đăng nhập" }).click();

		await expect(page.locator("p[role=alert]")).toHaveText(
			"Email hoặc mật khẩu không đúng.",
		);
		await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
	});

	test("keeps the fixed account session across refresh and supports logout", async ({
		page,
	}) => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);

		await page.goto("/login");
		await page.getByLabel("Email").fill(fixedAccountEmail as string);
		await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
		await page.locator("form").getByRole("button", { name: "Đăng nhập" }).click();

		await expect(page).toHaveURL(/\/dashboard/);
		await page.reload();
		await expect(page).toHaveURL(/\/dashboard/);

		await page.getByRole("button", { name: fixedAccountName }).click();
		await page.getByRole("menuitem", { name: "Đăng xuất" }).click();
		await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
	});
});

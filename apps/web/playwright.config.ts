import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(__dirname, ".env"),
});

const e2eEmail = process.env.E2E_AUTH_EMAIL?.trim();
const e2ePassword = process.env.E2E_AUTH_PASSWORD?.trim();

if (process.env.CI && (!e2eEmail || !e2ePassword)) {
	throw new Error(
		"E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD are required for authenticated Playwright tests in CI.",
	);
}

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	expect: {
		timeout: 5_000,
	},
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? "line" : "list",
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3002",
		trace: "retain-on-failure",
	},
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: "pnpm dev",
				url: "http://localhost:3002",
				reuseExistingServer: !process.env.CI,
				timeout: 120_000,
			},
});

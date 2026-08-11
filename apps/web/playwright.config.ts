import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(__dirname, ".env"),
});

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

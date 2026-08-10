import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	expect: {
		timeout: 5_000,
	},
	fullyParallel: true,
	reporter: process.env.CI ? "line" : "list",
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
		trace: "retain-on-failure",
	},
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: "pnpm dev",
				url: "http://localhost:3001",
				reuseExistingServer: !process.env.CI,
				timeout: 120_000,
			},
});

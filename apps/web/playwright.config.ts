import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

if (process.env.AFFICHANNEL_ISOLATED_TEST_ENV !== "1") {
	dotenv.config({
		path: resolve(__dirname, ".env"),
	});
}

if (process.env.E2E_BASE_URL?.trim()) {
	throw new Error(
		"E2E_BASE_URL is disabled: authenticated E2E must start its own deterministic server.",
	);
}

// Authenticated E2E must never call paid TTS. Playwright owns the server,
// forces a non-production environment, and passes this explicit test-only flag
// through the child process environment.
Object.assign(process.env, {
	NODE_ENV: "development",
	VOICE_AUDIO_STORAGE_PROVIDER: "local",
	VOICE_AUDIO_LOCAL_ROOT: ".data/voice-audio-e2e",
});
process.env.AFFICHANNEL_E2E_TTS_DETERMINISTIC = "1";

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
		timeout: 30_000,
	},
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? "line" : "list",
	use: {
		baseURL: "http://localhost:3002",
		trace: "retain-on-failure",
	},
	webServer: {
		// Build once with production semantics, then serve the isolated bundle in
		// development mode so the deterministic provider remains available.
		command:
			'set "NODE_ENV=production"&& pnpm exec next build && set "NODE_ENV=development"&& pnpm exec next start --port 3002',
		url: "http://localhost:3002",
		reuseExistingServer: false,
		timeout: 180_000,
	},
});

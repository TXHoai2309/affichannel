import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
	AFFICHANNEL_E2E_TTS_DETERMINISTIC: "0" as "0" | "1",
	NODE_ENV: "development" as "development" | "test" | "production",
	TTS_APIKEY_FUN_API_KEY: undefined as string | undefined,
	TTS_APIKEY_FUN_BASE_URL: undefined as string | undefined,
	TTS_DEFAULT_PROVIDER: "apikeyfun",
	TTS_PREVIEW_TIMEOUT_MS: 30_000,
}));

vi.mock("@affichannel/env/server", () => ({ env: mockEnv }));

async function loadRegistry() {
	return await import(
		"../../../../../packages/api/src/providers/tts/tts-provider-registry"
	);
}

async function loadProviderTypes() {
	return await Promise.all([
		import(
			"../../../../../packages/api/src/providers/tts/apikeyfun-tts-provider"
		),
		import(
			"../../../../../packages/api/src/providers/tts/deterministic-tts-provider"
		),
	]);
}

describe("TTS deterministic provider safety", () => {
	it.each(["development", "test"] as const)(
		"resolves deterministic provider in %s with explicit flag",
		async (nodeEnv) => {
			vi.resetModules();
			mockEnv.NODE_ENV = nodeEnv;
			mockEnv.AFFICHANNEL_E2E_TTS_DETERMINISTIC = "1";

			const [[, { DeterministicTtsProvider }], { resolveTtsProvider }] =
				await Promise.all([loadProviderTypes(), loadRegistry()]);
			const provider = resolveTtsProvider();

			expect(provider).toBeInstanceOf(DeterministicTtsProvider);
		},
	);

	it("fails closed in production when the deterministic flag is present", async () => {
		vi.resetModules();
		mockEnv.NODE_ENV = "production";
		mockEnv.AFFICHANNEL_E2E_TTS_DETERMINISTIC = "1";
		mockEnv.TTS_APIKEY_FUN_API_KEY = "production-key-is-not-used";

		const [providerTypes, { resolveTtsProvider }] = await Promise.all([
			loadProviderTypes(),
			loadRegistry(),
		]);
		const provider = resolveTtsProvider();

		expect(provider).toBeUndefined();
		expect(provider).not.toBeInstanceOf(
			providerTypes[1].DeterministicTtsProvider,
		);
	});
});

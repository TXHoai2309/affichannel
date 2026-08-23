/**
 * Configure integration-test environment from the explicit disposable DB
 * variable. Integration suites must never infer a database from app config.
 */
export const INTEGRATION_TEST_RUNTIME_DEFAULTS = Object.freeze({
	SKIP_ENV_VALIDATION: "1",
	TEXT_AI_DEFAULT_PROVIDER: "apikeyfun",
	TEXT_AI_DEFAULT_MODEL: "claude-sonnet-4-6",
	TEXT_AI_TIMEOUT_MS: "120000",
	TEXT_AI_MAX_OUTPUT_TOKENS: "8192",
	TTS_DEFAULT_PROVIDER: "apikeyfun",
	TTS_PREVIEW_TIMEOUT_MS: "30000",
	TTS_PREVIEW_MAX_CHARS: "500",
	VOICE_AUDIO_STORAGE_PROVIDER: "local",
	VOICE_SEGMENT_MAX_CHARS: "4000",
	VOICE_SEGMENT_MAX_AUDIO_BYTES: "10485760",
	VOICE_SEGMENT_TIMEOUT_MS: "60000",
	VOICE_SEGMENT_PENDING_LEASE_MS: "300000",
	AFFICHANNEL_LIVE_AI_SMOKE: "0",
	AFFICHANNEL_LIVE_TTS_SMOKE: "0",
	AFFICHANNEL_E2E_TTS_DETERMINISTIC: "0",
});

export function configureIntegrationEnvironment(): void {
	const testDatabaseUrl = process.env.AFFICHANNEL_M1_TEST_DATABASE_URL?.trim();
	if (!testDatabaseUrl) {
		throw new Error(
			"REFUSED: set AFFICHANNEL_M1_TEST_DATABASE_URL to an approved disposable/test database.",
		);
	}
	if (
		process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM !==
		"DISPOSABLE_DB_CONFIRMED"
	) {
		throw new Error(
			"REFUSED: AFFICHANNEL_M1_TEST_DATABASE_CONFIRM must equal DISPOSABLE_DB_CONFIRMED.",
		);
	}

	delete process.env.AFF_US008_DATABASE_URL;
	delete process.env.APIKEY_FUN_API_KEY;
	delete process.env.TTS_APIKEY_FUN_API_KEY;
	delete process.env.R2_ENDPOINT;
	delete process.env.R2_BUCKET;
	delete process.env.R2_ACCESS_KEY_ID;
	delete process.env.R2_SECRET_ACCESS_KEY;

	for (const [key, value] of Object.entries(
		INTEGRATION_TEST_RUNTIME_DEFAULTS,
	)) {
		process.env[key] = value;
	}
	process.env.DATABASE_URL = testDatabaseUrl;
	process.env.DATABASE_URL_DIRECT = testDatabaseUrl;
	process.env.NODE_ENV = "test";
}

/**
 * Configure integration-test environment from the explicit disposable DB
 * variable. Integration suites must never infer a database from app config.
 */
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

	process.env.DATABASE_URL = testDatabaseUrl;
	process.env.DATABASE_URL_DIRECT = testDatabaseUrl;
	process.env.NODE_ENV = "test";
}

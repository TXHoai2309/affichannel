const TEST_DATABASE_URL_ENV = "AFFICHANNEL_BACKFILL_TEST_DATABASE_URL";
const TEST_DATABASE_CONFIRM_ENV = "AFFICHANNEL_BACKFILL_TEST_DATABASE_CONFIRM";
const TEST_DATABASE_CONFIRM_VALUE = "DISPOSABLE_BACKFILL_TEST_DB_CONFIRMED";

export type BackfillTestDatabaseAuthority = {
	url: string;
	host: string;
};

export function requireBackfillTestDatabaseAuthority(): BackfillTestDatabaseAuthority {
	const url = process.env[TEST_DATABASE_URL_ENV]?.trim();
	if (!url) {
		throw new Error(
			`REFUSED: ${TEST_DATABASE_URL_ENV} is required for disposable fixture mutation.`,
		);
	}
	if (process.env[TEST_DATABASE_CONFIRM_ENV] !== TEST_DATABASE_CONFIRM_VALUE) {
		throw new Error(
			`REFUSED: ${TEST_DATABASE_CONFIRM_ENV} must equal ${TEST_DATABASE_CONFIRM_VALUE}.`,
		);
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`REFUSED: ${TEST_DATABASE_URL_ENV} is not a valid URL.`);
	}
	if (
		!["postgres:", "postgresql:"].includes(parsed.protocol) ||
		!parsed.hostname ||
		parsed.pathname === "/"
	) {
		throw new Error(
			`REFUSED: ${TEST_DATABASE_URL_ENV} must identify an explicit PostgreSQL database.`,
		);
	}
	return { url, host: parsed.host };
}

const URL_ENV = "AFFICHANNEL_E2E_TEST_DATABASE_URL";
const CONFIRM_ENV = "AFFICHANNEL_E2E_TEST_DATABASE_CONFIRM";
const CONFIRM_VALUE = "DISPOSABLE_E2E_TEST_DB_CONFIRMED";

export type E2ETestDatabaseAuthority = Readonly<{
	url: string;
	host: string;
	database: string;
}>;

export function requireE2ETestDatabaseAuthority(
	environment: NodeJS.ProcessEnv = process.env,
): E2ETestDatabaseAuthority {
	const url = environment[URL_ENV]?.trim();
	if (!url) {
		throw new Error(
			`REFUSED: ${URL_ENV} is required; no application or remote database fallback is allowed.`,
		);
	}
	if (environment[CONFIRM_ENV] !== CONFIRM_VALUE) {
		throw new Error(`REFUSED: ${CONFIRM_ENV} must equal ${CONFIRM_VALUE}.`);
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`REFUSED: ${URL_ENV} is not a valid URL.`);
	}
	if (
		!["postgres:", "postgresql:"].includes(parsed.protocol) ||
		parsed.hostname !== "127.0.0.1" ||
		parsed.pathname.length <= 1
	) {
		throw new Error(
			`REFUSED: ${URL_ENV} must identify a loopback PostgreSQL database at 127.0.0.1.`,
		);
	}

	return {
		url,
		host: parsed.host,
		database: decodeURIComponent(parsed.pathname.slice(1)),
	};
}

export const E2E_TEST_DATABASE_CONFIRMATION = CONFIRM_VALUE;

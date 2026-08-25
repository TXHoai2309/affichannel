const URL_ENV = "AFFICHANNEL_M5_TEST_DATABASE_URL";
const CONFIRM_ENV = "AFFICHANNEL_M5_TEST_DATABASE_CONFIRM";
const CONFIRM_VALUE = "DISPOSABLE_M5_TEST_DB_CONFIRMED";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type M5TestDatabaseAuthority = { url: string; host: string };

export function requireM5TestDatabaseAuthority(): M5TestDatabaseAuthority {
	const url = process.env[URL_ENV]?.trim();
	if (!url) {
		throw new Error(
			`REFUSED: ${URL_ENV} is required; no application/preflight database fallback is allowed.`,
		);
	}
	if (process.env[CONFIRM_ENV] !== CONFIRM_VALUE) {
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
		!LOOPBACK_HOSTS.has(parsed.hostname) ||
		parsed.pathname === "/"
	) {
		throw new Error(
			`REFUSED: ${URL_ENV} must identify an explicit loopback PostgreSQL database.`,
		);
	}
	return { url, host: parsed.host };
}

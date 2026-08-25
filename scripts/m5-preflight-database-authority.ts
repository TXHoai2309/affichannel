const DATABASE_URL_ENV = "AFFICHANNEL_M5_PREFLIGHT_DATABASE_URL";
const DATABASE_CONFIRM_ENV = "AFFICHANNEL_M5_PREFLIGHT_DATABASE_CONFIRM";
const DATABASE_CONFIRM_VALUE = "M5_PREFLIGHT_READ_ONLY_CONFIRMED";

export type M5PreflightDatabaseAuthority = {
	url: string;
	host: string;
};

export function requireM5PreflightDatabaseAuthority(): M5PreflightDatabaseAuthority {
	const url = process.env[DATABASE_URL_ENV]?.trim();
	if (!url) {
		throw new Error(
			`REFUSED: ${DATABASE_URL_ENV} is required; no application database fallback is allowed.`,
		);
	}
	if (process.env[DATABASE_CONFIRM_ENV] !== DATABASE_CONFIRM_VALUE) {
		throw new Error(
			`REFUSED: ${DATABASE_CONFIRM_ENV} must equal ${DATABASE_CONFIRM_VALUE}.`,
		);
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`REFUSED: ${DATABASE_URL_ENV} is not a valid URL.`);
	}
	if (
		!["postgres:", "postgresql:"].includes(parsed.protocol) ||
		!parsed.hostname ||
		parsed.pathname === "/"
	) {
		throw new Error(
			`REFUSED: ${DATABASE_URL_ENV} must identify an explicit PostgreSQL database.`,
		);
	}
	return { url, host: parsed.host };
}

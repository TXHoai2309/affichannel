const URL_ENV = "AFFICHANNEL_M5_MIGRATION_DATABASE_URL";
const CONFIRM_ENV = "AFFICHANNEL_M5_MIGRATION_DATABASE_CONFIRM";
const CONFIRM_VALUE = "M5_APPLY_0018_CONFIRMED";

export type M5MigrationDatabaseAuthority = {
	url: string;
	host: string;
};

export function requireM5MigrationDatabaseAuthority(
	environment: NodeJS.ProcessEnv = process.env,
): M5MigrationDatabaseAuthority {
	const url = environment[URL_ENV]?.trim();
	if (!url) {
		throw new Error(
			`REFUSED: ${URL_ENV} is required; no database fallback is allowed.`,
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
		!parsed.hostname ||
		parsed.pathname === "/"
	) {
		throw new Error(
			`REFUSED: ${URL_ENV} must identify an explicit PostgreSQL database.`,
		);
	}
	if (parsed.hostname.toLowerCase().includes("-pooler")) {
		throw new Error("M5_DIRECT_MIGRATION_AUTHORITY_REQUIRED");
	}
	return { url, host: parsed.host };
}

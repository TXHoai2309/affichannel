import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
	path: "../../apps/web/.env",
	override: true,
});

const disposableTestDatabaseUrl =
	process.env.AFFICHANNEL_M1_TEST_DATABASE_URL?.trim();
if (
	disposableTestDatabaseUrl &&
	process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM !== "DISPOSABLE_DB_CONFIRMED"
) {
	throw new Error(
		"REFUSED: AFFICHANNEL_M1_TEST_DATABASE_CONFIRM must equal DISPOSABLE_DB_CONFIRMED when AFFICHANNEL_M1_TEST_DATABASE_URL is present.",
	);
}

export default defineConfig({
	schema: "./src/schema",
	out: "./src/migrations",
	dialect: "postgresql",
	dbCredentials: {
		// Neon migrations require the direct connection. Runtime queries use the
		// pooled DATABASE_URL from packages/db/src/index.ts.
		url:
			disposableTestDatabaseUrl ||
			process.env.DATABASE_URL_DIRECT ||
			process.env.DATABASE_URL ||
			"",
	},
});

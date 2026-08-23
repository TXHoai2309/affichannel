import { env } from "@affichannel/env/server";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";

import { createNodePostgresPool } from "./node-postgres-test-adapter";
import * as schema from "./schema";

export * from "./schema";

const M1_TEST_DATABASE_CONFIRM_VALUE = "DISPOSABLE_DB_CONFIRMED";

function resolveM1TestDatabaseUrl(): string | undefined {
	const testDatabaseUrl = process.env.AFFICHANNEL_M1_TEST_DATABASE_URL?.trim();
	if (!testDatabaseUrl) return undefined;

	if (
		process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM !==
		M1_TEST_DATABASE_CONFIRM_VALUE
	) {
		throw new Error(
			"REFUSED: AFFICHANNEL_M1_TEST_DATABASE_CONFIRM must equal DISPOSABLE_DB_CONFIRMED when AFFICHANNEL_M1_TEST_DATABASE_URL is present.",
		);
	}

	return process.env.NODE_ENV === "test" ? testDatabaseUrl : undefined;
}

function createNeonDb() {
	const pool = new NeonPool({ connectionString: env.DATABASE_URL });
	return drizzleNeon(pool, { schema });
}

type Database = ReturnType<typeof createNeonDb>;

export function createDb(): Database {
	const testDatabaseUrl = resolveM1TestDatabaseUrl();
	if (testDatabaseUrl) {
		const pool = createNodePostgresPool(testDatabaseUrl);
		return drizzleNodePostgres(pool, { schema }) as unknown as Database;
	}

	return createNeonDb();
}

export const db = createDb();

import { env } from "@affichannel/env/server";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

export * from "./schema";

export function createDb() {
	const pool = new Pool({ connectionString: env.DATABASE_URL });
	return drizzle(pool, { schema });
}

export const db = createDb();

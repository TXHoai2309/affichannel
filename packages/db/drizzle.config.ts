import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
	path: "../../apps/web/.env",
	override: true,
});

export default defineConfig({
	schema: "./src/schema",
	out: "./src/migrations",
	dialect: "postgresql",
	dbCredentials: {
		// Neon migrations require the direct connection. Runtime queries use the
		// pooled DATABASE_URL from packages/db/src/index.ts.
		url: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || "",
	},
});

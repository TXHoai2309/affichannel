import { createEnv } from "@t3-oss/env-core";
import dotenv from "dotenv";
import { z } from "zod";

// Next loads the app env file in development, but inherited shell variables can
// otherwise win. When a local .env is present, keep app and migration runtime on
// the same database. Hosted deployments have no local file, so their env stays.
dotenv.config({ override: true });

function getVercelOrigin() {
	const vercelUrl =
		process.env.VERCEL_ENV === "production"
			? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
			: (process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL);
	if (!vercelUrl) return undefined;
	return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
}

const vercelOrigin = getVercelOrigin();

const runtimeEnv = {
	...process.env,
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? vercelOrigin,
	CORS_ORIGIN: process.env.CORS_ORIGIN ?? vercelOrigin,
};

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		DATABASE_URL_DIRECT: z.string().min(1).optional(),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		TEXT_AI_DEFAULT_PROVIDER: z.string().trim().min(1).default("apikeyfun"),
		TEXT_AI_DEFAULT_MODEL: z
			.string()
			.trim()
			.min(1)
			.default("claude-sonnet-4-6"),
		TEXT_AI_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(1_000)
			.max(900_000)
			.default(120_000),
		TEXT_AI_MAX_OUTPUT_TOKENS: z.coerce
			.number()
			.int()
			.min(256)
			.max(64_000)
			.default(8_192),
		APIKEY_FUN_API_KEY: z.string().trim().min(1).optional(),
		APIKEY_FUN_BASE_URL: z.url().optional(),
		APIKEY_FUN_PRICING_VERSION: z.string().trim().min(1).optional(),
		APIKEY_FUN_PRICING_CURRENCY: z
			.string()
			.regex(/^[A-Z]{3}$/)
			.optional(),
		APIKEY_FUN_INPUT_PRICE_MICROS_PER_MILLION: z
			.string()
			.regex(/^\d+$/)
			.optional(),
		APIKEY_FUN_OUTPUT_PRICE_MICROS_PER_MILLION: z
			.string()
			.regex(/^\d+$/)
			.optional(),
		APIKEY_FUN_ESTIMATED_OUTPUT_TOKENS: z.coerce
			.number()
			.int()
			.min(1)
			.max(64_000)
			.optional(),
	},
	runtimeEnv: runtimeEnv,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});

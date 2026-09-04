import { createEnv } from "@t3-oss/env-core";
import dotenv from "dotenv";
import { z } from "zod";

import { shouldLoadLocalDotenv } from "./dotenv-policy";

// Next loads the app env file in development, but inherited shell variables can
// otherwise win. When a local .env is present, keep app and migration runtime on
// the same database. Hosted deployments have no local file, so their env stays.
const inheritedDeterministicTtsFlag =
	process.env.AFFICHANNEL_E2E_TTS_DETERMINISTIC;
if (shouldLoadLocalDotenv()) {
	dotenv.config({ override: true });
}
if (inheritedDeterministicTtsFlag !== undefined) {
	process.env.AFFICHANNEL_E2E_TTS_DETERMINISTIC = inheritedDeterministicTtsFlag;
}

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
		TTS_DEFAULT_PROVIDER: z.string().trim().min(1).default("apikeyfun"),
		TTS_APIKEY_FUN_API_KEY: z.string().trim().min(1).optional(),
		TTS_APIKEY_FUN_BASE_URL: z.url().optional(),
		TTS_PREVIEW_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.max(900_000)
			.default(30_000),
		TTS_PREVIEW_MAX_CHARS: z.coerce
			.number()
			.int()
			.positive()
			.max(2_000)
			.default(500),
		VOICE_AUDIO_STORAGE_PROVIDER: z.enum(["local", "r2"]).default("local"),
		VOICE_AUDIO_LOCAL_ROOT: z
			.string()
			.trim()
			.min(1)
			.default(".data/voice-audio"),
		VOICE_SEGMENT_MAX_CHARS: z.coerce
			.number()
			.int()
			.positive()
			.max(10_000)
			.default(4_000),
		VOICE_SEGMENT_MAX_AUDIO_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.max(100 * 1024 * 1024)
			.default(10 * 1024 * 1024),
		VOICE_SEGMENT_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.max(900_000)
			.default(60_000),
		VOICE_SEGMENT_PENDING_LEASE_MS: z.coerce
			.number()
			.int()
			.positive()
			.max(86_400_000)
			.default(5 * 60_000),
		MEDIA_STORAGE_PROVIDER: z.enum(["local", "r2"]).default("local"),
		MEDIA_LOCAL_ROOT: z.string().trim().min(1).default(".data/media-library"),
		MEDIA_R2_ENDPOINT: z.url().optional(),
		MEDIA_R2_BUCKET: z.string().trim().min(1).optional(),
		MEDIA_R2_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
		MEDIA_R2_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
		MEDIA_UPLOAD_TTL_MS: z.coerce
			.number()
			.int()
			.positive()
			.max(86_400_000)
			.default(15 * 60_000),
		MEDIA_DOWNLOAD_TTL_MS: z.coerce
			.number()
			.int()
			.positive()
			.max(3_600_000)
			.default(5 * 60_000),
		MEDIA_IMAGE_MAX_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.max(500 * 1024 * 1024)
			.default(10 * 1024 * 1024),
		MEDIA_VIDEO_MAX_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.max(2 * 1024 * 1024 * 1024)
			.default(100 * 1024 * 1024),
		MEDIA_AUDIO_MAX_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.max(500 * 1024 * 1024)
			.default(10 * 1024 * 1024),
		R2_ENDPOINT: z.url().optional(),
		R2_BUCKET: z.string().trim().min(1).optional(),
		R2_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
		R2_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
		AFFICHANNEL_LIVE_TTS_SMOKE: z.enum(["0", "1"]).default("0"),
		AFFICHANNEL_E2E_TTS_DETERMINISTIC: z.enum(["0", "1"]).default("0"),
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

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import {
	E2E_AUTH_EMAIL,
	E2E_AUTH_PASSWORD,
	ensureDisposableE2EAccount,
} from "./bootstrap-e2e-disposable.ts";
import { requireE2ETestDatabaseAuthority } from "./e2e-test-database-authority.ts";

const MIGRATIONS_FOLDER = resolve(process.cwd(), "packages/db/src/migrations");
const AUTH_SECRET = "affichannel-cr-c-isolated-test-secret-2026-only";
const PLAYWRIGHT_ARGS = [
	"--filter",
	"web",
	"exec",
	"playwright",
	"test",
	"tests/e2e/script-studio.spec.ts",
] as const;

type MigrationJournal = {
	entries: Array<{ tag: string; idx: number }>;
};

function rowsOf<T>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	if (result && typeof result === "object" && "rows" in result) {
		const rows = (result as { rows?: unknown }).rows;
		return Array.isArray(rows) ? (rows as T[]) : [];
	}
	return [];
}

async function readMigrationJournal(): Promise<MigrationJournal> {
	return JSON.parse(
		await readFile(resolve(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
	) as MigrationJournal;
}

function redact(value: string, databaseUrl: string): string {
	const redacted = databaseUrl
		? value.replaceAll(databaseUrl, "[REDACTED_E2E_TEST_DATABASE_URL]")
		: value;
	return redacted
		.replaceAll(AUTH_SECRET, "[REDACTED_E2E_TEST_SECRET]")
		.replaceAll(E2E_AUTH_PASSWORD, "[REDACTED_E2E_TEST_PASSWORD]")
		.replace(
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
			"[REDACTED_ID]",
		)
		.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/giu, "[REDACTED_POSTGRES_URL]");
}

function createIsolatedChildEnvironment(
	databaseUrl: string,
): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	const removedKeys = [
		"DATABASE_URL",
		"DATABASE_URL_DIRECT",
		"AFFICHANNEL_E2E_TEST_DATABASE_URL",
		"AFFICHANNEL_E2E_TEST_DATABASE_CONFIRM",
		"AFFICHANNEL_M1_TEST_DATABASE_URL",
		"AFFICHANNEL_M1_TEST_DATABASE_CONFIRM",
		"AFFICHANNEL_BACKFILL_DATABASE_URL",
		"AFFICHANNEL_BACKFILL_DATABASE_CONFIRM",
		"AFFICHANNEL_BACKFILL_TEST_DATABASE_URL",
		"AFFICHANNEL_BACKFILL_TEST_DATABASE_CONFIRM",
		"AFFICHANNEL_CLAIM_MANIFEST_TEST_DATABASE_URL",
		"AFFICHANNEL_CLAIM_MANIFEST_TEST_DATABASE_CONFIRM",
		"AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_URL",
		"AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_CONFIRM",
		"AFF_US008_DATABASE_URL",
		"APIKEY_FUN_API_KEY",
		"APIKEY_FUN_BASE_URL",
		"TTS_APIKEY_FUN_API_KEY",
		"TTS_APIKEY_FUN_BASE_URL",
		"R2_ENDPOINT",
		"R2_BUCKET",
		"R2_ACCESS_KEY_ID",
		"R2_SECRET_ACCESS_KEY",
		"VERCEL_URL",
		"VERCEL_PROJECT_PRODUCTION_URL",
		"VERCEL_ENV",
		"E2E_BASE_URL",
	];
	for (const key of removedKeys) delete environment[key];
	for (const key of Object.keys(environment)) {
		if (
			/(?:DATABASE_URL|APIKEY_FUN|TTS_APIKEY_FUN|R2_|VERCEL_|E2E_BASE_URL)/u.test(
				key,
			)
		) {
			delete environment[key];
		}
	}

	return {
		...environment,
		NODE_ENV: "development",
		AFFICHANNEL_ISOLATED_TEST_ENV: "1",
		DATABASE_URL: databaseUrl,
		DATABASE_URL_DIRECT: databaseUrl,
		BETTER_AUTH_URL: "http://localhost:3002",
		CORS_ORIGIN: "http://localhost:3002",
		BETTER_AUTH_SECRET: AUTH_SECRET,
		E2E_AUTH_EMAIL,
		E2E_AUTH_PASSWORD,
		VOICE_AUDIO_STORAGE_PROVIDER: "local",
		VOICE_AUDIO_LOCAL_ROOT: ".data/voice-audio-e2e",
		AFFICHANNEL_E2E_TTS_DETERMINISTIC: "1",
		AFFICHANNEL_LIVE_TTS_SMOKE: "0",
		AFFICHANNEL_LIVE_AI_SMOKE: "0",
		TEXT_AI_DEFAULT_PROVIDER: "deterministic",
		TEXT_AI_DEFAULT_MODEL: "cr-c-e2e-deterministic",
		TTS_DEFAULT_PROVIDER: "apikeyfun",
		TTS_PREVIEW_TIMEOUT_MS: "30000",
		TTS_PREVIEW_MAX_CHARS: "500",
		VOICE_SEGMENT_MAX_CHARS: "4000",
		VOICE_SEGMENT_MAX_AUDIO_BYTES: "10485760",
		VOICE_SEGMENT_TIMEOUT_MS: "60000",
		VOICE_SEGMENT_PENDING_LEASE_MS: "300000",
	};
}

type PnpmInvocation = {
	command: string;
	args: string[];
};

function resolvePnpmInvocation(): PnpmInvocation {
	const packageManagerScript = process.env.npm_execpath?.trim();
	if (packageManagerScript) {
		return {
			command: process.execPath,
			args: [packageManagerScript, ...PLAYWRIGHT_ARGS],
		};
	}
	if (process.platform === "win32") {
		return {
			command: process.env.ComSpec ?? "cmd.exe",
			args: ["/d", "/s", "/c", `pnpm ${PLAYWRIGHT_ARGS.join(" ")}`],
		};
	}
	return { command: "pnpm", args: [...PLAYWRIGHT_ARGS] };
}

async function applyCurrentMigrations(databaseUrl: string): Promise<void> {
	const journal = await readMigrationJournal();
	const pool = createNodePostgresPool(databaseUrl);
	const database = drizzle(pool);
	try {
		await database.execute(sql.raw("select 1"));
		await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
		const rows = rowsOf<{ count: number | string }>(
			await database.execute(
				sql.raw(
					"select count(*)::int as count from drizzle.__drizzle_migrations",
				),
			),
		);
		const count = Number(rows[0]?.count);
		if (count !== journal.entries.length) {
			throw new Error(
				`E2E migration validation failed: expected ${journal.entries.length} migrations, found ${count}.`,
			);
		}
		console.log(
			`E2E disposable migrations: PASS (${count}; latest=${journal.entries.at(-1)?.tag ?? "unknown"})`,
		);
	} finally {
		await pool.end();
	}
}

async function runPlaywright(
	databaseUrl: string,
	environment: NodeJS.ProcessEnv,
): Promise<void> {
	const invocation = resolvePnpmInvocation();
	const child = spawn(invocation.command, invocation.args, {
		cwd: process.cwd(),
		env: environment,
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
	child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

	await new Promise<void>((resolve, reject) => {
		child.once("error", (error) => {
			reject(
				new Error(
					`E2E Playwright spawn failed: ${redact(error.message, databaseUrl)}`,
				),
			);
		});
		child.once("close", (status, signal) => {
			const stdout = redact(
				Buffer.concat(stdoutChunks).toString("utf8"),
				databaseUrl,
			);
			const stderr = redact(
				Buffer.concat(stderrChunks).toString("utf8"),
				databaseUrl,
			);
			if (stdout.trim()) console.log(stdout.trimEnd());
			if (stderr.trim()) console.error(stderr.trimEnd());
			if (status !== 0) {
				reject(
					new Error(
						`E2E Playwright failed with exit status ${status ?? "null"}; signal=${signal ?? "none"}.`,
					),
				);
				return;
			}
			resolve();
		});
	});
}

async function main(): Promise<void> {
	const authority = requireE2ETestDatabaseAuthority();
	console.log(
		`E2E authority: PASS (host=${authority.host}; database=${authority.database}; loopback=127.0.0.1)`,
	);
	await applyCurrentMigrations(authority.url);

	const childEnvironment = createIsolatedChildEnvironment(authority.url);
	Object.assign(process.env, childEnvironment);
	const account = await ensureDisposableE2EAccount();
	console.log(
		`E2E account bootstrap: PASS (email=${account.email}; workspace=${account.workspaceId})`,
	);

	await runPlaywright(authority.url, childEnvironment);
	console.log(
		"E2E disposable validation: PASS (isolated env=YES; local voice=YES; live provider calls=0)",
	);
}

try {
	await main();
} catch (error) {
	const authorityUrl = process.env.AFFICHANNEL_E2E_TEST_DATABASE_URL ?? "";
	console.error(
		error instanceof Error
			? redact(error.message, authorityUrl)
			: "E2E disposable validation failed.",
	);
	process.exitCode = 1;
}

import { spawnSync } from "node:child_process";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { Pool } from "../packages/db/node_modules/@neondatabase/serverless/index.mjs";

const TEST_DATABASE_ENV = "AFFICHANNEL_M1_TEST_DATABASE_URL";
const MIGRATIONS_FOLDER = resolve(process.cwd(), "packages/db/src/migrations");
const M1_LAST_MIGRATION_INDEX = 16;
const GOLDEN_SUITES = [
	["project-auth", "scripts/test-project-authorization.ts"],
	["dashboard", "scripts/test-dashboard-overview.ts"],
	["script-generation", "scripts/test-script-generation-foundation.ts"],
	["script-version", "scripts/test-script-version-foundation.ts"],
	["fact-lock", "scripts/test-fact-lock.ts"],
	["voice-config", "scripts/test-voice-config.ts"],
	["voice-preview", "scripts/test-voice-preview.ts"],
	["voice-segment", "scripts/test-voice-segment-foundation.ts"],
	["voice-segment-runtime", "scripts/test-voice-segment-runtime.ts"],
] as const;

type MigrationJournal = {
	version: string;
	dialect: string;
	entries: Array<{
		idx: number;
		version: string;
		when: number;
		tag: string;
		breakpoints: boolean;
	}>;
};

function rowsOf<T>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	if (result && typeof result === "object" && "rows" in result) {
		const rows = (result as { rows?: unknown }).rows;
		return Array.isArray(rows) ? (rows as T[]) : [];
	}
	return [];
}

function requireTestDatabaseUrl(): string {
	const url = process.env[TEST_DATABASE_ENV]?.trim();
	if (!url) {
		throw new Error(
			`REFUSED: ${TEST_DATABASE_ENV} is required. The M1 validation path never reads apps/web/.env or DATABASE_URL.`,
		);
	}
	return url;
}

async function createPreM1MigrationFolder(): Promise<string> {
	const journalPath = join(MIGRATIONS_FOLDER, "meta", "_journal.json");
	const journal = JSON.parse(
		await readFile(journalPath, "utf8"),
	) as MigrationJournal;
	const entries = journal.entries.filter(
		(entry) => entry.idx <= M1_LAST_MIGRATION_INDEX,
	);
	if (entries.length !== M1_LAST_MIGRATION_INDEX + 1) {
		throw new Error(
			`Expected migrations 0000 through 0016, found ${entries.length} entries.`,
		);
	}

	const temporaryFolder = await mkdtemp(
		join(tmpdir(), "affichannel-m1-migrations-"),
	);
	await mkdir(join(temporaryFolder, "meta"), { recursive: true });
	await writeFile(
		join(temporaryFolder, "meta", "_journal.json"),
		JSON.stringify({ ...journal, entries }, null, 2),
		"utf8",
	);
	for (const entry of entries) {
		await copyFile(
			join(MIGRATIONS_FOLDER, `${entry.tag}.sql`),
			join(temporaryFolder, `${entry.tag}.sql`),
		);
	}
	return temporaryFolder;
}

async function assertMigrationCount(
	database: ReturnType<typeof drizzle>,
	expected: number,
	label: string,
): Promise<void> {
	const rows = rowsOf<{ count: number | string }>(
		await database.execute(
			sql.raw(
				"select count(*)::int as count from drizzle.__drizzle_migrations",
			),
		),
	);
	const count = Number(rows[0]?.count);
	if (count !== expected) {
		throw new Error(
			`${label}: expected ${expected} applied migrations, found ${count}.`,
		);
	}
}

async function applyM1Migrations(testDatabaseUrl: string): Promise<void> {
	const beforeM1Folder = await createPreM1MigrationFolder();
	const pool = new Pool({ connectionString: testDatabaseUrl });
	const database = drizzle(pool);
	try {
		await migrate(database, { migrationsFolder: beforeM1Folder });
		await assertMigrationCount(database, 17, "Migration state 0016");
		console.log("Migration state 0016: PASS");

		await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
		await assertMigrationCount(database, 18, "Migration 0017 apply");
		console.log("Migration 0017 apply: PASS");
	} finally {
		await pool.end();
		await rm(beforeM1Folder, { recursive: true, force: true });
	}
}

function childEnvironment(testDatabaseUrl: string): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	delete environment.DATABASE_URL;
	delete environment.DATABASE_URL_DIRECT;
	delete environment.AFF_US008_DATABASE_URL;
	environment[TEST_DATABASE_ENV] = testDatabaseUrl;
	environment.SKIP_ENV_VALIDATION = "1";
	environment.NODE_ENV = "test";
	environment.AFFICHANNEL_LIVE_TTS_SMOKE = "0";
	environment.AFFICHANNEL_E2E_TTS_DETERMINISTIC = "0";
	return environment;
}

function runSuite(
	name: string,
	scriptPath: string,
	testDatabaseUrl: string,
): boolean {
	const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const result = spawnSync(command, ["exec", "tsx", scriptPath], {
		cwd: process.cwd(),
		env: childEnvironment(testDatabaseUrl),
		stdio: "inherit",
	});
	const passed = !result.error && result.status === 0;
	console.log(`Golden integration ${name}: ${passed ? "PASS" : "FAIL"}`);
	return passed;
}

async function main(): Promise<void> {
	const testDatabaseUrl = requireTestDatabaseUrl();
	console.log(
		`Using only ${TEST_DATABASE_ENV}; application .env and DATABASE_URL are excluded.`,
	);

	await applyM1Migrations(testDatabaseUrl);
	console.log("M1 DB harness: START");
	const m1Result = spawnSync(
		process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		["test:integration:project-channel-first-m1"],
		{
			cwd: process.cwd(),
			env: childEnvironment(testDatabaseUrl),
			stdio: "inherit",
		},
	);
	if (m1Result.error || m1Result.status !== 0) {
		throw new Error("M1 DB harness: FAIL");
	}
	console.log("M1 DB harness: PASS");

	const results = GOLDEN_SUITES.map(([name, scriptPath]) =>
		runSuite(name, scriptPath, testDatabaseUrl),
	);
	if (results.some((passed) => !passed)) {
		throw new Error("One or more golden integration suites failed.");
	}
}

try {
	await main();
	console.log("AFF-US-013 / M1 VALIDATION GATE: PASS");
} catch (error) {
	console.error(
		error instanceof Error ? error.message : "M1 validation gate failed.",
	);
	process.exitCode = 1;
}

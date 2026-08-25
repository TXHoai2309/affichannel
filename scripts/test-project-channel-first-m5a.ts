import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
	runDatabaseM5Preflight,
	runM5SchemaPostflight,
} from "../packages/db/src/m5-preflight.ts";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireM5TestDatabaseAuthority } from "./m5-test-database-authority.ts";

type Journal = {
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

const authority = requireM5TestDatabaseAuthority();
const migrationsRoot = resolve("packages/db/src/migrations");
const temporaryFolders: string[] = [];

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function migrationFolderThrough(lastIndex: number) {
	const journal = JSON.parse(
		await readFile(join(migrationsRoot, "meta", "_journal.json"), "utf8"),
	) as Journal;
	const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
	assert(
		entries.length === lastIndex + 1,
		`Expected migrations 0000 through ${lastIndex}.`,
	);
	const folder = await mkdtemp(join(tmpdir(), `affichannel-m5-${lastIndex}-`));
	temporaryFolders.push(folder);
	await mkdir(join(folder, "meta"), { recursive: true });
	await writeFile(
		join(folder, "meta", "_journal.json"),
		JSON.stringify({ ...journal, entries }, null, 2),
		"utf8",
	);
	for (const entry of entries) {
		await copyFile(
			join(migrationsRoot, `${entry.tag}.sql`),
			join(folder, `${entry.tag}.sql`),
		);
	}
	return folder;
}

async function resetDatabase(pool: ReturnType<typeof createNodePostgresPool>) {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
}

async function migrationCount(pool: ReturnType<typeof createNodePostgresPool>) {
	const result = await pool.query<{ count: number }>(
		"select count(*)::int as count from drizzle.__drizzle_migrations",
	);
	return result.rows[0]?.count ?? 0;
}

async function applyFolder(
	pool: ReturnType<typeof createNodePostgresPool>,
	folder: string,
) {
	await migrate(drizzle(pool), { migrationsFolder: folder });
}

async function seedOwners(pool: ReturnType<typeof createNodePostgresPool>) {
	const suffix = randomUUID();
	const workspaceId = `m5a-harness-workspace-${suffix}`;
	const userId = `m5a-harness-user-${suffix}`;
	const productId = randomUUID();
	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		"M5A harness",
	]);
	await pool.query(
		'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
		[userId, "M5A harness", `${userId}@example.test`],
	);
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspaceId, "M5A harness", userId],
	);
	return { workspaceId, userId, productId };
}

async function insertProject(
	pool: ReturnType<typeof createNodePostgresPool>,
	owner: Awaited<ReturnType<typeof seedOwners>>,
	identity: [string | null, string | null, string | null, number | null],
	productId: string | null = owner.productId,
) {
	const id = randomUUID();
	await pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key, created_by_user_id
		) values ($1, $2, 'M5A fixture', $3, $4, $5, $6, $7, 'product', $8)`,
		[id, owner.workspaceId, productId, ...identity, owner.userId],
	);
	return id;
}

function childEnvironment(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.DATABASE_URL;
	delete env.DATABASE_URL_DIRECT;
	delete env.AFF_US008_DATABASE_URL;
	delete env.AFFICHANNEL_BACKFILL_DATABASE_URL;
	delete env.APIKEY_FUN_API_KEY;
	delete env.TTS_APIKEY_FUN_API_KEY;
	env.NODE_ENV = "test";
	env.SKIP_ENV_VALIDATION = "1";
	env.AFFICHANNEL_M5_TEST_DATABASE_URL = authority.url;
	env.AFFICHANNEL_M5_TEST_DATABASE_CONFIRM = "DISPOSABLE_M5_TEST_DB_CONFIRMED";
	env.AFFICHANNEL_M1_TEST_DATABASE_URL = authority.url;
	env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
	env.AFFICHANNEL_LIVE_AI_SMOKE = "0";
	env.AFFICHANNEL_LIVE_TTS_SMOKE = "0";
	return env;
}

function runChild(label: string, script: string) {
	const result = spawnSync(process.execPath, ["--import", "tsx", script], {
		cwd: process.cwd(),
		env: childEnvironment(),
		encoding: "utf8",
		stdio: "pipe",
		windowsHide: true,
	});
	if (result.status !== 0) {
		const sanitized = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
			.replaceAll(authority.url, "[REDACTED_M5_TEST_DATABASE_URL]")
			.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/giu, "[REDACTED_POSTGRES_URL]");
		throw new Error(
			`${label} failed (exit ${result.status ?? "null"}).\n${sanitized}`,
		);
	}
	console.log(`${label}: PASS`);
}

const pool = createNodePostgresPool(authority.url);
try {
	const identity = await pool.query<{ database: string; schema: string }>(
		"select current_database() as database, current_schema() as schema",
	);
	console.log(
		`Disposable identity: database=${identity.rows[0]?.database}; host=${authority.host}; schema=${identity.rows[0]?.schema}`,
	);

	const through0016 = await migrationFolderThrough(16);
	const through0017 = await migrationFolderThrough(17);

	await resetDatabase(pool);
	await applyFolder(pool, through0016);
	assert((await migrationCount(pool)) === 17, "0016 migration count mismatch.");
	await applyFolder(pool, through0017);
	assert((await migrationCount(pool)) === 18, "0017 migration count mismatch.");
	runChild(
		"M5 code on pre-M5 schema / M3B",
		"scripts/test-project-channel-first-m3b.ts",
	);

	const dirtyOwner = await seedOwners(pool);
	await insertProject(pool, dirtyOwner, [null, null, null, null]);
	await insertProject(pool, dirtyOwner, ["AFFILIATE", null, null, null]);
	await insertProject(
		pool,
		dirtyOwner,
		["AFFILIATE", "SCRIPTED", "SCRIPTED_STANDARD", 1],
		null,
	);
	await insertProject(pool, dirtyOwner, [
		"AFFILIATE",
		"SCRIPTED",
		"UNKNOWN_FORMAT",
		1,
	]);
	const dirty = await runDatabaseM5Preflight(pool, { batchSize: 2 });
	assert(
		!dirty.readyForM5,
		"Dirty M5 preflight must block migration orchestration.",
	);
	assert(
		dirty.summary.legacyAllNullIdentities === 1 &&
			dirty.summary.partialIdentities === 1 &&
			dirty.summary.affiliateMissingProduct === 1 &&
			dirty.summary.unknownUnsupportedContentFormat === 1,
		"Dirty M5 blocker taxonomy mismatch.",
	);
	console.log("Dirty preflight STOP: PASS");

	await resetDatabase(pool);
	await applyFolder(pool, through0017);
	const atomicOwner = await seedOwners(pool);
	await insertProject(pool, atomicOwner, ["AFFILIATE", null, null, null]);
	let migrationFailed = false;
	try {
		await applyFolder(pool, migrationsRoot);
	} catch {
		migrationFailed = true;
	}
	assert(migrationFailed, "Dirty direct M5 migration must fail.");
	const afterFailure = await pool.query<{
		columnName: string;
		nullable: string;
	}>(
		`select column_name as "columnName", is_nullable as nullable
		 from information_schema.columns
		 where table_name = 'project' and column_name = any($1::text[])`,
		[
			[
				"content_type",
				"creation_path",
				"content_format_key",
				"content_format_version",
			],
		],
	);
	assert(
		afterFailure.rows.every((column) => column.nullable === "YES"),
		"Failed migration must be atomic.",
	);
	console.log("Dirty direct migration atomic failure: PASS");

	await resetDatabase(pool);
	await applyFolder(pool, through0016);
	assert(
		(await migrationCount(pool)) === 17,
		"Clean path 0016 state mismatch.",
	);
	await applyFolder(pool, through0017);
	assert(
		(await migrationCount(pool)) === 18,
		"Clean path 0017 state mismatch.",
	);
	const cleanOwner = await seedOwners(pool);
	await insertProject(pool, cleanOwner, [
		"AFFILIATE",
		"SCRIPTED",
		"SCRIPTED_STANDARD",
		1,
	]);
	assert(
		(await runDatabaseM5Preflight(pool)).readyForM5,
		"Clean M5 preflight must pass.",
	);
	await applyFolder(pool, migrationsRoot);
	assert((await migrationCount(pool)) === 19, "M5 migration count mismatch.");
	const postflight = await runM5SchemaPostflight(pool);
	assert(postflight.ready, "M5 postflight must pass.");

	for (const identityTuple of [
		[null, null, null, null],
		["AFFILIATE", null, null, null],
	] as const) {
		let rejected = false;
		try {
			await insertProject(pool, cleanOwner, [...identityTuple]);
		} catch {
			rejected = true;
		}
		assert(rejected, "M5 DB must reject null or partial identity persistence.");
	}
	const futureId = await insertProject(
		pool,
		cleanOwner,
		["ORGANIC", "QUICK_IMAGE", "QUICK_IMAGE_STANDARD", 1],
		null,
	);
	assert(
		futureId,
		"Productless future-shaped DB fixture must remain possible.",
	);
	assert(
		(await runM5SchemaPostflight(pool)).ready,
		"Postflight must remain ready after productless canonical fixture.",
	);
	runChild(
		"M3B binary behavior on M5 schema",
		"scripts/test-project-channel-first-m5-compatibility.ts",
	);
	console.log("Clean 0016 -> 0017 -> M5 and postflight: PASS");
} finally {
	await pool.end();
	for (const folder of temporaryFolders)
		await rm(folder, { recursive: true, force: true });
}

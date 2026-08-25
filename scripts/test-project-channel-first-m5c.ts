import { randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireM5MigrationDatabaseAuthority } from "./m5-migration-database-authority.ts";
import {
	assertM5RepositoryMigrationSet,
	assertPreM5History,
	executeM5Enforcement,
} from "./m5-production-enforcement.ts";
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

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function expectRejected(
	action: () => unknown | Promise<unknown>,
	expected: string,
) {
	try {
		await action();
		throw new Error(`Expected refusal containing ${expected}.`);
	} catch (error) {
		assert(
			error instanceof Error && error.message.includes(expected),
			`Expected ${expected}, received ${String(error)}.`,
		);
	}
}

const authority = requireM5TestDatabaseAuthority();
const migrationsRoot = resolve("packages/db/src/migrations");
const temporaryFolders: string[] = [];

async function migrationFolderThrough(lastIndex: number) {
	const journal = JSON.parse(
		await readFile(join(migrationsRoot, "meta", "_journal.json"), "utf8"),
	) as Journal;
	const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
	const folder = await mkdtemp(join(tmpdir(), `affichannel-m5c-${lastIndex}-`));
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

async function createPost0018RepositoryFixture() {
	const folder = await mkdtemp(join(tmpdir(), "affichannel-m5c-repository-"));
	temporaryFolders.push(folder);
	await mkdir(join(folder, "meta"), { recursive: true });
	const journal = JSON.parse(
		await readFile(join(migrationsRoot, "meta", "_journal.json"), "utf8"),
	) as Journal;
	journal.entries.push({
		idx: 19,
		version: "7",
		when: 1787628473479,
		tag: "0019_forbidden",
		breakpoints: true,
	});
	await writeFile(
		join(folder, "meta", "_journal.json"),
		JSON.stringify(journal, null, 2),
		"utf8",
	);
	for (const name of await readdir(migrationsRoot)) {
		if (/^\d{4}_.+\.sql$/u.test(name))
			await copyFile(join(migrationsRoot, name), join(folder, name));
	}
	await writeFile(join(folder, "0019_forbidden.sql"), "select 1;", "utf8");
	return folder;
}

async function resetDatabase(pool: ReturnType<typeof createNodePostgresPool>) {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
}

async function seedCanonicalProject(
	pool: ReturnType<typeof createNodePostgresPool>,
	dirty = false,
) {
	const suffix = randomUUID();
	const workspaceId = `m5c-workspace-${suffix}`;
	const userId = `m5c-user-${suffix}`;
	const productId = randomUUID();
	await pool.query("insert into workspace (id, name) values ($1, 'M5C')", [
		workspaceId,
	]);
	await pool.query(
		"insert into \"user\" (id, name, email, email_verified) values ($1, 'M5C', $2, true)",
		[userId, `${userId}@example.test`],
	);
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, 'M5C', $3)",
		[productId, workspaceId, userId],
	);
	await pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key, created_by_user_id
		) values ($1, $2, 'M5C', $3, $4, $5, $6, $7, 'product', $8)`,
		[
			randomUUID(),
			workspaceId,
			productId,
			dirty ? null : "AFFILIATE",
			dirty ? null : "SCRIPTED",
			dirty ? null : "SCRIPTED_STANDARD",
			dirty ? null : 1,
			userId,
		],
	);
}

const pool = createNodePostgresPool(authority.url);
try {
	await expectRejected(
		() => requireM5MigrationDatabaseAuthority({}),
		"AFFICHANNEL_M5_MIGRATION_DATABASE_URL",
	);
	await expectRejected(
		() =>
			requireM5MigrationDatabaseAuthority({
				DATABASE_URL: `postgresql:${"//"}ignored/application`,
				DATABASE_URL_DIRECT: `postgresql:${"//"}ignored/direct`,
				AFFICHANNEL_M5_PREFLIGHT_DATABASE_URL: `postgresql:${"//"}ignored/preflight`,
			}),
		"AFFICHANNEL_M5_MIGRATION_DATABASE_URL",
	);
	await expectRejected(
		() =>
			requireM5MigrationDatabaseAuthority({
				AFFICHANNEL_M5_MIGRATION_DATABASE_URL: `postgresql:${"//"}localhost/disposable`,
				AFFICHANNEL_M5_MIGRATION_DATABASE_CONFIRM: "WRONG",
			}),
		"AFFICHANNEL_M5_MIGRATION_DATABASE_CONFIRM",
	);
	await expectRejected(
		() =>
			requireM5MigrationDatabaseAuthority({
				AFFICHANNEL_M5_MIGRATION_DATABASE_URL: `postgresql:${"//"}example-pooler.invalid/database`,
				AFFICHANNEL_M5_MIGRATION_DATABASE_CONFIRM: "M5_APPLY_0018_CONFIRMED",
			}),
		"M5_DIRECT_MIGRATION_AUTHORITY_REQUIRED",
	);
	await assertM5RepositoryMigrationSet(migrationsRoot);
	await expectRejected(
		async () =>
			assertM5RepositoryMigrationSet(await createPost0018RepositoryFixture()),
		"repository migration set",
	);
	await expectRejected(
		() => assertPreM5History({ count: 17, latestCreatedAt: 1787286551711 }),
		"migration history",
	);

	const through0017 = await migrationFolderThrough(17);
	await resetDatabase(pool);
	await migrate(drizzle(pool), { migrationsFolder: through0017 });
	await seedCanonicalProject(pool, true);
	await expectRejected(
		() => executeM5Enforcement(pool, migrationsRoot),
		"fresh M5 preflight",
	);

	await resetDatabase(pool);
	await migrate(drizzle(pool), { migrationsFolder: through0017 });
	await seedCanonicalProject(pool);
	const evidence = await executeM5Enforcement(pool, migrationsRoot);
	assert(evidence.postflight.ready, "Clean 0017 to 0018 postflight must pass.");
	assert(
		evidence.postSchema.product_id === "YES",
		"product_id must remain nullable.",
	);
	await expectRejected(
		() => executeM5Enforcement(pool, migrationsRoot),
		"PRODUCTION_SCHEMA_ALREADY_M5_ENFORCED",
	);
	console.log("M5C disposable guarded enforcement: PASS");
} finally {
	await pool.end();
	for (const folder of temporaryFolders)
		await rm(folder, { recursive: true, force: true });
}

import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import {
	runDatabaseM5Preflight,
	runM5SchemaPostflight,
} from "../packages/db/src/m5-preflight.ts";

export const M5_MIGRATION = Object.freeze({
	index: 18,
	tag: "0018_natural_speed",
	when: 1787628473478,
	preMigrationCount: 18,
	preMigrationLatestCreatedAt: 1787415718474,
	postMigrationCount: 19,
});

const EXPECTED_MIGRATION_SQL = `ALTER TABLE "project" ALTER COLUMN "content_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "creation_path" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "content_format_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "content_format_version" SET NOT NULL;`;

type MigrationJournal = {
	entries: Array<{ idx: number; tag: string; when: number }>;
};

export type M5SchemaState = Readonly<
	Record<
		| "content_type"
		| "creation_path"
		| "content_format_key"
		| "content_format_version"
		| "product_id",
		"YES" | "NO" | "MISSING"
	>
>;

export type M5MigrationHistoryState = {
	count: number;
	latestCreatedAt: number | null;
};

export async function assertM5RepositoryMigrationSet(migrationsFolder: string) {
	const journal = JSON.parse(
		await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
	) as MigrationJournal;
	const latest = journal.entries.at(-1);
	if (
		journal.entries.length !== M5_MIGRATION.postMigrationCount ||
		latest?.idx !== M5_MIGRATION.index ||
		latest.tag !== M5_MIGRATION.tag ||
		latest.when !== M5_MIGRATION.when
	) {
		throw new Error(
			"REFUSED: repository migration set is not exactly through 0018_natural_speed.",
		);
	}
	const sqlFiles = (await readdir(migrationsFolder))
		.filter((name) => /^\d{4}_.+\.sql$/u.test(name))
		.sort();
	if (
		sqlFiles.length !== M5_MIGRATION.postMigrationCount ||
		sqlFiles.at(-1) !== `${M5_MIGRATION.tag}.sql`
	) {
		throw new Error(
			"REFUSED: repository contains a missing or post-0018 SQL migration.",
		);
	}
	const migrationSql = await readFile(
		join(migrationsFolder, `${M5_MIGRATION.tag}.sql`),
		"utf8",
	);
	if (migrationSql.trim() !== EXPECTED_MIGRATION_SQL) {
		throw new Error(
			"REFUSED: migration 0018 SQL differs from the authorized contract.",
		);
	}
}

export function assertCleanPushedTxhHead(repositoryRoot: string): string {
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repositoryRoot,
			encoding: "utf8",
			windowsHide: true,
		}).trim();
	if (git("branch", "--show-current") !== "TXH") {
		throw new Error("REFUSED: M5C production apply requires branch TXH.");
	}
	if (git("status", "--porcelain", "--untracked-files=no")) {
		throw new Error(
			"REFUSED: M5C production apply requires a clean tracked working tree.",
		);
	}
	const head = git("rev-parse", "HEAD");
	if (head !== git("rev-parse", "origin/TXH")) {
		throw new Error("REFUSED: local HEAD must equal origin/TXH.");
	}
	return head;
}

export async function readM5SchemaState(pool: Pool): Promise<M5SchemaState> {
	const result = await pool.query<{
		columnName: keyof M5SchemaState;
		nullable: "YES" | "NO";
	}>(
		`select column_name as "columnName", is_nullable as nullable
		 from information_schema.columns
		 where table_schema = current_schema()
		   and table_name = 'project'
		   and column_name = any($1::text[])`,
		[
			[
				"content_type",
				"creation_path",
				"content_format_key",
				"content_format_version",
				"product_id",
			],
		],
	);
	const state = {
		content_type: "MISSING",
		creation_path: "MISSING",
		content_format_key: "MISSING",
		content_format_version: "MISSING",
		product_id: "MISSING",
	} as Record<keyof M5SchemaState, "YES" | "NO" | "MISSING">;
	for (const row of result.rows) state[row.columnName] = row.nullable;
	return state;
}

export async function readM5MigrationHistory(
	pool: Pool,
): Promise<M5MigrationHistoryState> {
	const result = await pool.query<{
		count: number;
		latestCreatedAt: string | null;
	}>(
		`select count(*)::int as count, max(created_at)::text as "latestCreatedAt"
		 from drizzle.__drizzle_migrations`,
	);
	return {
		count: result.rows[0]?.count ?? 0,
		latestCreatedAt:
			result.rows[0]?.latestCreatedAt === null ||
			result.rows[0]?.latestCreatedAt === undefined
				? null
				: Number(result.rows[0].latestCreatedAt),
	};
}

export function assertPreM5Schema(state: M5SchemaState) {
	const identities = [
		state.content_type,
		state.creation_path,
		state.content_format_key,
		state.content_format_version,
	];
	if (identities.every((value) => value === "NO")) {
		throw new Error("PRODUCTION_SCHEMA_ALREADY_M5_ENFORCED");
	}
	if (
		!identities.every((value) => value === "YES") ||
		state.product_id !== "YES"
	) {
		throw new Error(
			"REFUSED: production schema does not match the exact pre-M5 contract.",
		);
	}
}

export function assertPreM5History(state: M5MigrationHistoryState) {
	if (
		state.count !== M5_MIGRATION.preMigrationCount ||
		state.latestCreatedAt !== M5_MIGRATION.preMigrationLatestCreatedAt
	) {
		throw new Error(
			"REFUSED: production migration history is not exactly through 0017.",
		);
	}
}

export type M5EnforcementEvidence = {
	preflight: Awaited<ReturnType<typeof runDatabaseM5Preflight>>;
	preSchema: M5SchemaState;
	preHistory: M5MigrationHistoryState;
	postSchema: M5SchemaState;
	postHistory: M5MigrationHistoryState;
	postflight: Awaited<ReturnType<typeof runM5SchemaPostflight>>;
};

export async function executeM5Enforcement(
	pool: Pool,
	migrationsFolder: string,
): Promise<M5EnforcementEvidence> {
	const preflight = await runDatabaseM5Preflight(pool);
	if (
		!preflight.readyForM5 ||
		preflight.summary.canonicalCompleteIdentities !==
			preflight.summary.totalProjects
	) {
		throw new Error("REFUSED: fresh M5 preflight found production blockers.");
	}
	const preSchema = await readM5SchemaState(pool);
	assertPreM5Schema(preSchema);
	const preHistory = await readM5MigrationHistory(pool);
	assertPreM5History(preHistory);

	await migrate(drizzle(pool), { migrationsFolder });

	const postSchema = await readM5SchemaState(pool);
	const postHistory = await readM5MigrationHistory(pool);
	const postflight = await runM5SchemaPostflight(pool);
	if (
		!postflight.ready ||
		postSchema.content_type !== "NO" ||
		postSchema.creation_path !== "NO" ||
		postSchema.content_format_key !== "NO" ||
		postSchema.content_format_version !== "NO" ||
		postSchema.product_id !== "YES" ||
		postHistory.count !== M5_MIGRATION.postMigrationCount ||
		postHistory.latestCreatedAt !== M5_MIGRATION.when
	) {
		throw new Error("M5C_POSTFLIGHT_FAILED");
	}
	return {
		preflight,
		preSchema,
		preHistory,
		postSchema,
		postHistory,
		postflight,
	};
}

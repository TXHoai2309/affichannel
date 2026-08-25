import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireM5MigrationDatabaseAuthority } from "./m5-migration-database-authority.ts";
import {
	assertCleanPushedTxhHead,
	assertM5RepositoryMigrationSet,
	executeM5Enforcement,
} from "./m5-production-enforcement.ts";

const repositoryRoot = resolve(process.cwd());
const migrationsFolder = resolve(repositoryRoot, "packages/db/src/migrations");

async function main() {
	await assertM5RepositoryMigrationSet(migrationsFolder);
	const head = assertCleanPushedTxhHead(repositoryRoot);
	const authority = requireM5MigrationDatabaseAuthority();
	const runDirectory = await mkdtemp(join(tmpdir(), "affichannel-m5c-"));
	const pool = createNodePostgresPool(authority.url);
	try {
		const identity = await pool.query<{
			databaseName: string;
			databaseUser: string;
			schemaName: string;
		}>(`select current_database() as "databaseName",
			current_user as "databaseUser", current_schema() as "schemaName"`);
		const databaseIdentity = {
			database: identity.rows[0]?.databaseName,
			user: identity.rows[0]?.databaseUser,
			schema: identity.rows[0]?.schemaName,
			host: authority.host,
		};
		console.log(
			`M5C database identity: database=${databaseIdentity.database}; host=${databaseIdentity.host}; schema=${databaseIdentity.schema}; user=${databaseIdentity.user}`,
		);
		const evidence = await executeM5Enforcement(pool, migrationsFolder);
		await mkdir(runDirectory, { recursive: true });
		await writeFile(
			join(runDirectory, "summary.json"),
			`${JSON.stringify(
				{
					contractVersion: "DOMAIN-EVOLUTION-M5C-v1",
					runId: randomUUID(),
					status: "completed",
					createdAt: new Date().toISOString(),
					branch: "TXH",
					head,
					databaseIdentity,
					preflight: {
						summary: evidence.preflight.summary,
						blockers: evidence.preflight.blockers,
						readyForM5: evidence.preflight.readyForM5,
					},
					preSchema: evidence.preSchema,
					preHistory: evidence.preHistory,
					postSchema: evidence.postSchema,
					postHistory: evidence.postHistory,
					postflight: {
						m5SchemaEnforced: evidence.postflight.m5SchemaEnforced,
						productIdNullable: evidence.postflight.productIdNullable,
						retainedConstraints: evidence.postflight.retainedConstraints,
						retainedIndexes: evidence.postflight.retainedIndexes,
						summary: evidence.postflight.preflight.summary,
						ready: evidence.postflight.ready,
					},
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
		console.log(`M5C production enforcement: PASS; output=${runDirectory}`);
	} finally {
		await pool.end();
	}
}

main().catch((error: unknown) => {
	console.error(
		error instanceof Error ? error.message : "M5C enforcement failed.",
	);
	process.exitCode = 1;
});

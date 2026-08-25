import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runDatabaseM5Preflight } from "../packages/db/src/m5-preflight.ts";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireM5PreflightDatabaseAuthority } from "./m5-preflight-database-authority.ts";

function outputRoot(args: string[]): string | undefined {
	const index = args.indexOf("--output-dir");
	if (index === -1) return undefined;
	const value = args[index + 1]?.trim();
	if (!value) throw new Error("REFUSED: --output-dir requires a path.");
	return resolve(value);
}

async function main() {
	const authority = requireM5PreflightDatabaseAuthority();
	const root = outputRoot(process.argv.slice(2)) ?? tmpdir();
	await mkdir(root, { recursive: true });
	const runDirectory = await mkdtemp(join(root, "affichannel-m5-preflight-"));
	const pool = createNodePostgresPool(authority.url);
	try {
		const identity = await pool.query<{
			databaseName: string;
			databaseUser: string;
			schemaName: string;
		}>(`
			select current_database() as "databaseName",
				current_user as "databaseUser",
				current_schema() as "schemaName"
		`);
		const databaseIdentity = {
			database: identity.rows[0]?.databaseName,
			user: identity.rows[0]?.databaseUser,
			schema: identity.rows[0]?.schemaName,
			host: authority.host,
		};
		console.log(
			`Database identity: database=${databaseIdentity.database}; host=${databaseIdentity.host}; schema=${databaseIdentity.schema}; user=${databaseIdentity.user}`,
		);
		const result = await runDatabaseM5Preflight(pool);
		await writeFile(
			join(runDirectory, "summary.json"),
			`${JSON.stringify(
				{
					contractVersion: "DOMAIN-EVOLUTION-M5-v1",
					runId: randomUUID(),
					mode: "read-only-preflight",
					status: result.readyForM5 ? "ready" : "blocked",
					createdAt: new Date().toISOString(),
					databaseIdentity,
					...result,
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
		console.log(
			`M5 preflight: ${result.readyForM5 ? "PASS" : "BLOCKED"}; output=${runDirectory}`,
		);
		if (!result.readyForM5) process.exitCode = 2;
	} finally {
		await pool.end();
	}
}

main().catch((error: unknown) => {
	console.error(
		error instanceof Error ? error.message : "M5 preflight failed.",
	);
	process.exitCode = 1;
});

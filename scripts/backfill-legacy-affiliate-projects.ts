import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	appendFile,
	mkdir,
	mkdtemp,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	CONTENT_FORMAT_DEFAULTS,
	classifyLegacyProject,
	INITIAL_CONTENT_FORMAT_REGISTRY,
	validateContentFormatRegistry,
} from "@affichannel/core";
import {
	type LegacyProjectInventoryRow,
	scanLegacyProjectInventoryBatch,
} from "../packages/db/src/legacy-affiliate-inventory.ts";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";

const DATABASE_URL_ENV = "AFFICHANNEL_BACKFILL_DATABASE_URL";
const DATABASE_CONFIRM_ENV = "AFFICHANNEL_BACKFILL_DATABASE_CONFIRM";
const DATABASE_CONFIRM_VALUE = "BACKFILL_DRY_RUN_CONFIRMED";
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 10_000;
const CONTRACT_VERSION = "AFF-US-016-M2A-v1";

type CliOptions = {
	batchSize: number;
	outputRoot?: string;
	testFailAfterBatch?: number;
};

type DatabaseAuthority = {
	url: string;
	host: string;
};

type InventoryCounts = {
	totalScanned: number;
	legacyCandidates: number;
	alreadyCanonical: number;
	exceptions: number;
	updated: number;
	skipped: number;
	failed: number;
};

type SanitizedDatabaseIdentity = {
	database: string;
	host: string;
	schema: string;
	user: string;
};

function parsePositiveInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_BATCH_SIZE) {
		throw new Error(
			`REFUSED: ${flag} must be an integer from 1 through ${MAX_BATCH_SIZE}.`,
		);
	}
	return parsed;
}

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = { batchSize: DEFAULT_BATCH_SIZE };
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--apply") {
			throw new Error(
				"REFUSED: --apply is not available in AFF-US-016 M2A. This command is dry-run only.",
			);
		}
		if (argument === "--dry-run") continue;
		if (argument === "--batch-size") {
			const value = args[index + 1];
			if (!value) throw new Error("REFUSED: --batch-size requires a value.");
			options.batchSize = parsePositiveInteger(value, "--batch-size");
			index += 1;
			continue;
		}
		if (argument === "--output-dir") {
			const value = args[index + 1]?.trim();
			if (!value) throw new Error("REFUSED: --output-dir requires a value.");
			options.outputRoot = resolve(value);
			index += 1;
			continue;
		}
		if (
			argument === "--test-fail-after-batch" &&
			process.env.NODE_ENV === "test"
		) {
			const value = args[index + 1];
			if (!value) {
				throw new Error("REFUSED: --test-fail-after-batch requires a value.");
			}
			options.testFailAfterBatch = parsePositiveInteger(
				value,
				"--test-fail-after-batch",
			);
			index += 1;
			continue;
		}
		throw new Error(`REFUSED: unknown argument ${argument ?? "<missing>"}.`);
	}
	return options;
}

function requireDatabaseAuthority(): DatabaseAuthority {
	const url = process.env[DATABASE_URL_ENV]?.trim();
	if (!url) {
		throw new Error(
			`REFUSED: ${DATABASE_URL_ENV} is required. No application DB variable or .env fallback is allowed.`,
		);
	}
	if (process.env[DATABASE_CONFIRM_ENV] !== DATABASE_CONFIRM_VALUE) {
		throw new Error(
			`REFUSED: ${DATABASE_CONFIRM_ENV} must equal ${DATABASE_CONFIRM_VALUE}.`,
		);
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`REFUSED: ${DATABASE_URL_ENV} is not a valid URL.`);
	}
	if (
		!["postgres:", "postgresql:"].includes(parsed.protocol) ||
		!parsed.hostname ||
		parsed.pathname === "/"
	) {
		throw new Error(
			`REFUSED: ${DATABASE_URL_ENV} must identify an explicit PostgreSQL database.`,
		);
	}
	return { url, host: parsed.host };
}

function validateRegistry(): void {
	const validation = validateContentFormatRegistry(
		INITIAL_CONTENT_FORMAT_REGISTRY,
		CONTENT_FORMAT_DEFAULTS,
	);
	if (!validation.success) {
		throw new Error(
			`REFUSED: canonical ContentFormat registry is invalid: ${validation.issues.join(", ")}.`,
		);
	}
}

async function createRunDirectory(
	options: CliOptions,
	runId: string,
): Promise<string> {
	if (!options.outputRoot) {
		return mkdtemp(join(tmpdir(), "affichannel-m2a-dry-run-"));
	}
	await mkdir(options.outputRoot, { recursive: true });
	await access(options.outputRoot, constants.W_OK);
	const runDirectory = join(options.outputRoot, `affichannel-m2a-${runId}`);
	await mkdir(runDirectory, { recursive: false });
	await access(runDirectory, constants.W_OK);
	return runDirectory;
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readDatabaseIdentity(
	pool: ReturnType<typeof createNodePostgresPool>,
	host: string,
): Promise<SanitizedDatabaseIdentity> {
	const client = await pool.connect();
	try {
		await client.query("begin transaction read only");
		const result = await client.query<{
			database: string;
			user: string;
			schema: string;
		}>(`
			select
				current_database() as database,
				current_user as "user",
				current_schema() as schema
		`);
		await client.query("commit");
		const identity = result.rows[0];
		if (!identity?.database || !identity.user || !identity.schema) {
			throw new Error("REFUSED: database identity preflight was incomplete.");
		}
		return { ...identity, host };
	} catch (error) {
		await client.query("rollback").catch(() => undefined);
		throw error;
	} finally {
		client.release();
	}
}

function exceptionRecord(row: LegacyProjectInventoryRow, reasonCode: string) {
	return {
		projectId: row.id,
		workspaceId: row.workspaceId,
		reasonCode,
		contentType: row.contentType,
		creationPath: row.creationPath,
		contentFormatKey: row.contentFormatKey,
		contentFormatVersion: row.contentFormatVersion,
		hasProduct: row.hasProduct,
	};
}

function sanitizedMessage(error: unknown, databaseUrl?: string): string {
	const message = error instanceof Error ? error.message : String(error);
	const withoutExactUrl = databaseUrl
		? message.replaceAll(databaseUrl, "[REDACTED_DATABASE_URL]")
		: message;
	return withoutExactUrl.replace(
		/postgres(?:ql)?:\/\/[^\s'"`]+/giu,
		"[REDACTED_POSTGRES_URL]",
	);
}

async function writeJsonBestEffort(
	path: string,
	value: unknown,
	databaseUrl: string,
): Promise<void> {
	try {
		await writeJson(path, value);
	} catch (error) {
		console.error(
			`Could not finalize ${path}: ${sanitizedMessage(error, databaseUrl)}`,
		);
	}
}

async function runDryRun(options: CliOptions): Promise<void> {
	validateRegistry();
	const authority = requireDatabaseAuthority();
	const runId = randomUUID();
	const startedAt = new Date().toISOString();
	const runDirectory = await createRunDirectory(options, runId);
	const paths = {
		run: join(runDirectory, "run.json"),
		checkpoint: join(runDirectory, "checkpoint.json"),
		summary: join(runDirectory, "summary.json"),
		exceptions: join(runDirectory, "exceptions.jsonl"),
	};
	const counts: InventoryCounts = {
		totalScanned: 0,
		legacyCandidates: 0,
		alreadyCanonical: 0,
		exceptions: 0,
		updated: 0,
		skipped: 0,
		failed: 0,
	};
	let cursor: string | null = null;
	let batchNumber = 0;
	let databaseIdentity: SanitizedDatabaseIdentity | undefined;
	let completed = false;

	const pool = createNodePostgresPool(authority.url);
	try {
		await writeFile(paths.exceptions, "", "utf8");
		await writeJson(paths.run, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: "dry-run",
			status: "starting",
			startedAt,
			batchSize: options.batchSize,
			outputDirectory: runDirectory,
		});
		await writeJson(paths.checkpoint, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: "dry-run",
			batchNumber,
			batchSize: options.batchSize,
			lastProjectId: cursor,
			counts,
			updatedAt: startedAt,
		});
		databaseIdentity = await readDatabaseIdentity(pool, authority.host);
		console.log(
			`Database identity: database=${databaseIdentity.database}; host=${databaseIdentity.host}; schema=${databaseIdentity.schema}; user=${databaseIdentity.user}`,
		);
		await writeJson(paths.run, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: "dry-run",
			status: "running",
			startedAt,
			batchSize: options.batchSize,
			outputDirectory: runDirectory,
			databaseIdentity,
		});

		while (true) {
			const rows = await scanLegacyProjectInventoryBatch(pool, {
				cursor,
				batchSize: options.batchSize,
			});
			if (rows.length === 0) break;
			batchNumber += 1;
			for (const row of rows) {
				const classification = classifyLegacyProject(row);
				counts.totalScanned += 1;
				if (classification.kind === "candidate") {
					counts.legacyCandidates += 1;
				} else if (classification.kind === "canonical") {
					counts.alreadyCanonical += 1;
				} else {
					counts.exceptions += 1;
					await appendFile(
						paths.exceptions,
						`${JSON.stringify(exceptionRecord(row, classification.reasonCode))}\n`,
						"utf8",
					);
				}
			}
			cursor = rows.at(-1)?.id ?? cursor;
			await writeJson(paths.checkpoint, {
				runId,
				contractVersion: CONTRACT_VERSION,
				mode: "dry-run",
				batchNumber,
				batchSize: options.batchSize,
				lastProjectId: cursor,
				counts,
				updatedAt: new Date().toISOString(),
			});
			console.log(
				`Batch ${batchNumber}: scanned=${counts.totalScanned}; candidates=${counts.legacyCandidates}; canonical=${counts.alreadyCanonical}; exceptions=${counts.exceptions}`,
			);
			if (
				options.testFailAfterBatch !== undefined &&
				options.testFailAfterBatch === batchNumber
			) {
				throw new Error("Injected M2A dry-run failure after checkpoint.");
			}
			if (rows.length < options.batchSize) break;
		}

		const finishedAt = new Date().toISOString();
		await writeJson(paths.summary, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: "dry-run",
			status: "completed",
			startedAt,
			finishedAt,
			databaseIdentity,
			...counts,
		});
		await writeJson(paths.run, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: "dry-run",
			status: "completed",
			startedAt,
			finishedAt,
			batchSize: options.batchSize,
			outputDirectory: runDirectory,
			databaseIdentity,
			batchNumber,
			lastProjectId: cursor,
			counts,
		});
		completed = true;
		console.log(`Dry-run complete: output=${runDirectory}`);
		console.log(
			`Summary: scanned=${counts.totalScanned}; candidates=${counts.legacyCandidates}; canonical=${counts.alreadyCanonical}; exceptions=${counts.exceptions}; updated=0`,
		);
	} catch (error) {
		counts.failed = Math.max(1, counts.failed + 1);
		const finishedAt = new Date().toISOString();
		const errorMessage = sanitizedMessage(error, authority.url);
		await writeJsonBestEffort(
			paths.checkpoint,
			{
				runId,
				contractVersion: CONTRACT_VERSION,
				mode: "dry-run",
				status: "failed",
				batchNumber,
				batchSize: options.batchSize,
				lastProjectId: cursor,
				counts,
				updatedAt: finishedAt,
			},
			authority.url,
		);
		await writeJsonBestEffort(
			paths.summary,
			{
				runId,
				contractVersion: CONTRACT_VERSION,
				mode: "dry-run",
				status: "failed",
				startedAt,
				finishedAt,
				databaseIdentity,
				...counts,
			},
			authority.url,
		);
		await writeJsonBestEffort(
			paths.run,
			{
				runId,
				contractVersion: CONTRACT_VERSION,
				mode: "dry-run",
				status: "failed",
				startedAt,
				finishedAt,
				batchSize: options.batchSize,
				outputDirectory: runDirectory,
				databaseIdentity,
				batchNumber,
				lastProjectId: cursor,
				counts,
				error: { message: errorMessage },
			},
			authority.url,
		);
		throw error;
	} finally {
		try {
			await pool.end();
		} catch (cleanupError) {
			const cleanupContext = completed
				? "Completed run artifacts remain completed."
				: "Run failure evidence was preserved.";
			console.error(
				`Database pool cleanup failed: ${sanitizedMessage(cleanupError, authority.url)} ${cleanupContext}`,
			);
		}
	}
}

try {
	const options = parseArgs(process.argv.slice(2));
	await runDryRun(options);
} catch (error) {
	console.error(sanitizedMessage(error));
	process.exitCode = 1;
}

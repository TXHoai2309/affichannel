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
import { fileURLToPath } from "node:url";
import {
	CONTENT_FORMAT_DEFAULTS,
	classifyLegacyProject,
	INITIAL_CONTENT_FORMAT_REGISTRY,
	validateContentFormatRegistry,
} from "@affichannel/core";
import {
	applyLegacyAffiliateCandidateBatch,
	type LegacyProjectInventoryRow,
	scanLegacyProjectInventoryBatch,
} from "../packages/db/src/legacy-affiliate-inventory.ts";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";

const DATABASE_URL_ENV = "AFFICHANNEL_BACKFILL_DATABASE_URL";
const DATABASE_CONFIRM_ENV = "AFFICHANNEL_BACKFILL_DATABASE_CONFIRM";
const DRY_RUN_CONFIRMATION = "BACKFILL_DRY_RUN_CONFIRMED";
const APPLY_CONFIRMATIONS = {
	disposable: "DISPOSABLE_BACKFILL_DB_CONFIRMED",
	production: "PRODUCTION_BACKFILL_DB_CONFIRMED",
} as const;
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 10_000;
const CONTRACT_VERSION = "AFF-US-016-M2B-v1";

type BackfillMode = "dry-run" | "apply";
type ApplyTarget = keyof typeof APPLY_CONFIRMATIONS;

export type BackfillCliOptions = {
	mode: BackfillMode;
	target?: ApplyTarget;
	batchSize: number;
	outputRoot?: string;
	testFailAfterBatch?: number;
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

export type BackfillTestHooks = {
	beforeApplyBatch?: (input: {
		batchNumber: number;
		candidateIds: string[];
	}) => Promise<void>;
};

function isApplyTarget(value: unknown): value is ApplyTarget {
	return value === "disposable" || value === "production";
}

function validateExecutionInvariants(options: BackfillCliOptions): void {
	if (options.mode !== "dry-run" && options.mode !== "apply") {
		throw new Error("REFUSED: execution mode must equal dry-run or apply.");
	}
	if (options.mode === "apply") {
		if (!isApplyTarget(options.target)) {
			throw new Error(
				"REFUSED: apply execution requires target disposable or production.",
			);
		}
		if (
			typeof options.outputRoot !== "string" ||
			options.outputRoot.trim().length === 0
		) {
			throw new Error(
				"REFUSED: apply execution requires an explicit outputRoot.",
			);
		}
	} else if (options.target !== undefined) {
		throw new Error(
			"REFUSED: dry-run execution cannot specify an apply target.",
		);
	}
	if (
		options.testFailAfterBatch !== undefined &&
		process.env.NODE_ENV !== "test"
	) {
		throw new Error(
			"REFUSED: testFailAfterBatch is available only when NODE_ENV=test.",
		);
	}
}

function parsePositiveInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_BATCH_SIZE) {
		throw new Error(
			`REFUSED: ${flag} must be an integer from 1 through ${MAX_BATCH_SIZE}.`,
		);
	}
	return parsed;
}

export function parseBackfillArgs(args: string[]): BackfillCliOptions {
	const options: BackfillCliOptions = {
		mode: "dry-run",
		batchSize: DEFAULT_BATCH_SIZE,
	};
	let explicitMode: BackfillMode | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--apply" || argument === "--dry-run") {
			const mode = argument === "--apply" ? "apply" : "dry-run";
			if (explicitMode && explicitMode !== mode) {
				throw new Error("REFUSED: choose exactly one of --dry-run or --apply.");
			}
			explicitMode = mode;
			options.mode = mode;
			continue;
		}
		if (argument === "--target") {
			const value = args[index + 1];
			if (value !== "disposable" && value !== "production") {
				throw new Error(
					"REFUSED: --target must equal disposable or production.",
				);
			}
			options.target = value;
			index += 1;
			continue;
		}
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
			if (!value)
				throw new Error("REFUSED: --test-fail-after-batch requires a value.");
			options.testFailAfterBatch = parsePositiveInteger(
				value,
				"--test-fail-after-batch",
			);
			index += 1;
			continue;
		}
		throw new Error(`REFUSED: unknown argument ${argument ?? "<missing>"}.`);
	}
	if (options.mode === "apply") {
		if (!options.target)
			throw new Error("REFUSED: --apply requires an explicit --target.");
		if (!options.outputRoot)
			throw new Error("REFUSED: --apply requires an explicit --output-dir.");
	} else if (options.target) {
		throw new Error("REFUSED: --target is only valid with --apply.");
	}
	return options;
}

function requireDatabaseAuthority(options: BackfillCliOptions) {
	const url = process.env[DATABASE_URL_ENV]?.trim();
	if (!url) {
		throw new Error(
			`REFUSED: ${DATABASE_URL_ENV} is required. No application, M1, fixture-test, or .env fallback is allowed.`,
		);
	}
	const expected =
		options.mode === "dry-run"
			? DRY_RUN_CONFIRMATION
			: isApplyTarget(options.target)
				? APPLY_CONFIRMATIONS[options.target]
				: undefined;
	if (!expected) {
		throw new Error(
			"REFUSED: no exact database confirmation exists for this execution target.",
		);
	}
	const confirmation = process.env[DATABASE_CONFIRM_ENV]?.trim();
	if (!confirmation) {
		throw new Error(`REFUSED: ${DATABASE_CONFIRM_ENV} is required.`);
	}
	if (confirmation !== expected) {
		throw new Error(
			`REFUSED: ${DATABASE_CONFIRM_ENV} must equal ${expected} for ${options.mode}${options.target ? ` target ${options.target}` : ""}.`,
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
	const normalizedHostname = parsed.hostname
		.toLowerCase()
		.replace(/^\[(.*)\]$/u, "$1");
	if (
		options.mode === "apply" &&
		options.target === "disposable" &&
		!new Set(["localhost", "127.0.0.1", "::1"]).has(normalizedHostname)
	) {
		throw new Error(
			"REFUSED: disposable apply target requires a local loopback PostgreSQL host.",
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
	options: BackfillCliOptions,
	runId: string,
): Promise<string> {
	if (!options.outputRoot)
		return mkdtemp(join(tmpdir(), "affichannel-m2a-dry-run-"));
	await mkdir(options.outputRoot, { recursive: true });
	await access(options.outputRoot, constants.W_OK);
	const prefix =
		options.mode === "apply" ? "affichannel-m2b-" : "affichannel-m2a-";
	const runDirectory = join(options.outputRoot, `${prefix}${runId}`);
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
			select current_database() as database, current_user as "user", current_schema() as schema
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

export async function runLegacyAffiliateBackfill(
	options: BackfillCliOptions,
	hooks: BackfillTestHooks = {},
): Promise<{ runDirectory: string; counts: InventoryCounts }> {
	validateExecutionInvariants(options);
	validateRegistry();
	const authority = requireDatabaseAuthority(options);
	const runId = randomUUID();
	const startedAt = new Date().toISOString();
	const runDirectory = await createRunDirectory(options, runId);
	const paths = {
		run: join(runDirectory, "run.json"),
		checkpoint: join(runDirectory, "checkpoint.json"),
		summary: join(runDirectory, "summary.json"),
		exceptions: join(runDirectory, "exceptions.jsonl"),
		skips: join(runDirectory, "skips.jsonl"),
	};
	const target = options.target ?? null;
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

	// All evidence files are made writable before the pool or mutation path exists.
	try {
		await writeFile(paths.exceptions, "", "utf8");
		await writeFile(paths.skips, "", "utf8");
		await writeJson(paths.run, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: options.mode,
			target,
			status: "starting",
			startedAt,
			batchSize: options.batchSize,
			outputDirectory: runDirectory,
		});
		await writeJson(paths.checkpoint, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: options.mode,
			target,
			status: "starting",
			batchNumber,
			batchSize: options.batchSize,
			lastProjectId: cursor,
			counts,
			updatedAt: startedAt,
		});
		await writeJson(paths.summary, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: options.mode,
			target,
			status: "starting",
			startedAt,
			...counts,
		});
	} catch (error) {
		counts.failed = 1;
		const finishedAt = new Date().toISOString();
		await writeJsonBestEffort(
			paths.checkpoint,
			{
				runId,
				contractVersion: CONTRACT_VERSION,
				mode: options.mode,
				target,
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
				mode: options.mode,
				target,
				status: "failed",
				startedAt,
				finishedAt,
				...counts,
			},
			authority.url,
		);
		await writeJsonBestEffort(
			paths.run,
			{
				runId,
				contractVersion: CONTRACT_VERSION,
				mode: options.mode,
				target,
				status: "failed",
				startedAt,
				finishedAt,
				batchSize: options.batchSize,
				outputDirectory: runDirectory,
				batchNumber,
				lastProjectId: cursor,
				counts,
				error: { message: sanitizedMessage(error, authority.url) },
			},
			authority.url,
		);
		throw error;
	}

	const pool = createNodePostgresPool(authority.url);
	try {
		databaseIdentity = await readDatabaseIdentity(pool, authority.host);
		console.log(
			`Database identity: database=${databaseIdentity.database}; host=${databaseIdentity.host}; schema=${databaseIdentity.schema}; user=${databaseIdentity.user}`,
		);
		await writeJson(paths.run, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: options.mode,
			target,
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
			const candidateIds: string[] = [];
			for (const row of rows) {
				const classification = classifyLegacyProject(row);
				counts.totalScanned += 1;
				if (classification.kind === "candidate") {
					counts.legacyCandidates += 1;
					candidateIds.push(row.id);
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

			if (options.mode === "apply" && candidateIds.length > 0) {
				await hooks.beforeApplyBatch?.({ batchNumber, candidateIds });
				const result = await applyLegacyAffiliateCandidateBatch(
					pool,
					candidateIds,
				);
				counts.updated += result.updatedProjectIds.length;
				counts.skipped += result.skippedProjectIds.length;
				for (const projectId of result.skippedProjectIds) {
					await appendFile(
						paths.skips,
						`${JSON.stringify({ projectId, reasonCode: "CONCURRENT_STATE_CHANGE" })}\n`,
						"utf8",
					);
				}
			}

			cursor = rows.at(-1)?.id ?? cursor;
			await writeJson(paths.checkpoint, {
				runId,
				contractVersion: CONTRACT_VERSION,
				mode: options.mode,
				target,
				status: "running",
				batchNumber,
				batchSize: options.batchSize,
				lastProjectId: cursor,
				counts,
				updatedAt: new Date().toISOString(),
			});
			console.log(
				`Batch ${batchNumber}: scanned=${counts.totalScanned}; candidates=${counts.legacyCandidates}; canonical=${counts.alreadyCanonical}; exceptions=${counts.exceptions}; updated=${counts.updated}; skipped=${counts.skipped}`,
			);
			if (options.testFailAfterBatch === batchNumber) {
				throw new Error(
					`Injected ${options.mode} failure after committed batch.`,
				);
			}
			if (rows.length < options.batchSize) break;
		}

		const finishedAt = new Date().toISOString();
		await writeJson(paths.checkpoint, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: options.mode,
			target,
			status: "completed",
			batchNumber,
			batchSize: options.batchSize,
			lastProjectId: cursor,
			counts,
			updatedAt: finishedAt,
		});
		await writeJson(paths.summary, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: options.mode,
			target,
			status: "completed",
			startedAt,
			finishedAt,
			databaseIdentity,
			...counts,
		});
		await writeJson(paths.run, {
			runId,
			contractVersion: CONTRACT_VERSION,
			mode: options.mode,
			target,
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
		console.log(`${options.mode} complete: output=${runDirectory}`);
		return { runDirectory, counts };
	} catch (error) {
		counts.failed = Math.max(1, counts.failed + 1);
		const finishedAt = new Date().toISOString();
		const errorMessage = sanitizedMessage(error, authority.url);
		await writeJsonBestEffort(
			paths.checkpoint,
			{
				runId,
				contractVersion: CONTRACT_VERSION,
				mode: options.mode,
				target,
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
				mode: options.mode,
				target,
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
				mode: options.mode,
				target,
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
			const context = completed
				? "Completed run artifacts remain completed."
				: "Run failure evidence was preserved.";
			console.error(
				`Database pool cleanup failed: ${sanitizedMessage(cleanupError, authority.url)} ${context}`,
			);
		}
	}
}

async function main(): Promise<void> {
	try {
		await runLegacyAffiliateBackfill(parseBackfillArgs(process.argv.slice(2)));
	} catch (error) {
		console.error(sanitizedMessage(error));
		process.exitCode = 1;
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
	await main();
}

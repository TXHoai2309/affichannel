import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";

const databaseUrl = process.env.AFFICHANNEL_BACKFILL_DATABASE_URL?.trim();
if (!databaseUrl) {
	throw new Error(
		"NOT RUN: AFFICHANNEL_BACKFILL_DATABASE_URL is required for the disposable M2A integration test.",
	);
}
if (
	process.env.AFFICHANNEL_BACKFILL_DATABASE_CONFIRM !==
	"BACKFILL_DRY_RUN_CONFIRMED"
) {
	throw new Error(
		"NOT RUN: AFFICHANNEL_BACKFILL_DATABASE_CONFIRM must equal BACKFILL_DRY_RUN_CONFIRMED.",
	);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const tsxCli = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
const commandScript = resolve(
	process.cwd(),
	"scripts/backfill-legacy-affiliate-projects.ts",
);

function runCli(args: string[], environment: NodeJS.ProcessEnv = process.env) {
	return spawnSync(process.execPath, [tsxCli, commandScript, ...args], {
		cwd: process.cwd(),
		env: environment,
		encoding: "utf8",
		stdio: "pipe",
		windowsHide: true,
	});
}

const missingAuthorityEnvironment = { ...process.env };
delete missingAuthorityEnvironment.AFFICHANNEL_BACKFILL_DATABASE_URL;
delete missingAuthorityEnvironment.AFFICHANNEL_BACKFILL_DATABASE_CONFIRM;
missingAuthorityEnvironment.DATABASE_URL = databaseUrl;
missingAuthorityEnvironment.DATABASE_URL_DIRECT = databaseUrl;
missingAuthorityEnvironment.AFFICHANNEL_M1_TEST_DATABASE_URL = databaseUrl;
const missingAuthority = runCli(["--dry-run"], missingAuthorityEnvironment);
assert(
	missingAuthority.status !== 0 &&
		missingAuthority.stderr.includes(
			"AFFICHANNEL_BACKFILL_DATABASE_URL is required",
		),
	"Dry-run accepted application or M1 database authority fallback.",
);

const unavailableApply = runCli(["--apply"], missingAuthorityEnvironment);
assert(
	unavailableApply.status !== 0 &&
		unavailableApply.stderr.includes("--apply is not available"),
	"M2A did not refuse --apply before database authority resolution.",
);

const wrongConfirmationEnvironment = {
	...process.env,
	AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
	AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "WRONG_CONFIRMATION",
};
const wrongConfirmation = runCli(["--dry-run"], wrongConfirmationEnvironment);
assert(
	wrongConfirmation.status !== 0 &&
		wrongConfirmation.stderr.includes("must equal BACKFILL_DRY_RUN_CONFIRMED"),
	"M2A dry-run accepted an incorrect database confirmation.",
);

const pool = createNodePostgresPool(databaseUrl);
const outputRoot = await mkdtemp(
	join(tmpdir(), "affichannel-m2a-test-output-"),
);
const workspaceId = randomUUID();
const userId = randomUUID();
const productId = randomUUID();
const projectIds = {
	candidate: randomUUID(),
	productless: randomUUID(),
	canonical: randomUUID(),
	partial: randomUUID(),
	unknownFormat: randomUUID(),
	affiliateProductMissing: randomUUID(),
	formatPathMismatch: randomUUID(),
};

try {
	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		"AFF-US-016 M2A Workspace",
	]);
	await pool.query(
		`insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)`,
		[userId, "AFF-US-016 M2A User", `${userId}@example.test`],
	);
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspaceId, "AFF-US-016 M2A Product", userId],
	);

	const insertProject = async (input: {
		id: string;
		productId: string | null;
		contentType?: string | null;
		creationPath?: string | null;
		contentFormatKey?: string | null;
		contentFormatVersion?: number | null;
	}) => {
		await pool.query(
			`
				insert into project (
					id, workspace_id, name, product_id,
					content_type, creation_path,
					content_format_key, content_format_version,
					current_step_key, created_by_user_id
				) values ($1, $2, $3, $4, $5, $6, $7, $8, 'product', $9)
			`,
			[
				input.id,
				workspaceId,
				`AFF-US-016 M2A ${input.id}`,
				input.productId,
				input.contentType ?? null,
				input.creationPath ?? null,
				input.contentFormatKey ?? null,
				input.contentFormatVersion ?? null,
				userId,
			],
		);
	};

	await insertProject({ id: projectIds.candidate, productId });
	await insertProject({ id: projectIds.productless, productId: null });
	await insertProject({
		id: projectIds.canonical,
		productId,
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
	});
	await insertProject({
		id: projectIds.partial,
		productId,
		contentType: "AFFILIATE",
	});
	await insertProject({
		id: projectIds.unknownFormat,
		productId,
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormatKey: "UNKNOWN_FORMAT",
		contentFormatVersion: 1,
	});
	await insertProject({
		id: projectIds.affiliateProductMissing,
		productId: null,
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
	});
	await insertProject({
		id: projectIds.formatPathMismatch,
		productId,
		contentType: "AFFILIATE",
		creationPath: "QUICK_IMAGE",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
	});

	const before = await pool.query<{
		createdAt: Date;
		updatedAt: Date;
		contentType: string | null;
	}>(
		`select created_at as "createdAt", updated_at as "updatedAt", content_type as "contentType" from project where id = $1`,
		[projectIds.candidate],
	);

	const result = runCli([
		"--dry-run",
		"--batch-size",
		"2",
		"--output-dir",
		outputRoot,
	]);
	assert(
		result.status === 0,
		`M2A dry-run failed:\n${result.stdout}\n${result.stderr}`,
	);
	assert(
		result.stdout.includes("Database identity:") &&
			!result.stdout.includes(databaseUrl),
		"Dry-run identity output was missing or leaked the database URL.",
	);

	const runDirectories = await readdir(outputRoot);
	assert(
		runDirectories.length === 1,
		"Dry-run did not create one run-owned directory.",
	);
	const runDirectory = join(outputRoot, runDirectories[0] ?? "missing");
	const summary = JSON.parse(
		await readFile(join(runDirectory, "summary.json"), "utf8"),
	) as Record<string, unknown>;
	const run = JSON.parse(
		await readFile(join(runDirectory, "run.json"), "utf8"),
	) as Record<string, unknown>;
	const checkpoint = JSON.parse(
		await readFile(join(runDirectory, "checkpoint.json"), "utf8"),
	) as Record<string, unknown>;
	const exceptionLines = (
		await readFile(join(runDirectory, "exceptions.jsonl"), "utf8")
	)
		.trim()
		.split("\n")
		.filter(Boolean)
		.map(
			(line) => JSON.parse(line) as { projectId: string; reasonCode: string },
		);
	const reasonsByProject = new Map(
		exceptionLines.map((record) => [record.projectId, record.reasonCode]),
	);

	assert(
		Number(summary.totalScanned) >= 7,
		"Dry-run did not scan all fixtures.",
	);
	assert(Number(summary.legacyCandidates) >= 1, "Candidate count is missing.");
	assert(Number(summary.alreadyCanonical) >= 1, "Canonical count is missing.");
	assert(Number(summary.updated) === 0, "M2A dry-run reported mutations.");
	assert(run.status === "completed", "Run metadata was not completed.");
	assert(checkpoint.mode === "dry-run", "Checkpoint mode is not dry-run.");
	assert(
		reasonsByProject.get(projectIds.productless) ===
			"LEGACY_PROJECT_WITHOUT_PRODUCT",
		"Productless reason is incorrect.",
	);
	assert(
		reasonsByProject.get(projectIds.partial) === "PARTIAL_CHANNEL_FIRST_FIELDS",
		"Partial identity reason is incorrect.",
	);
	assert(
		reasonsByProject.get(projectIds.unknownFormat) ===
			"INVALID_CONTENT_FORMAT_REF",
		"Unknown format reason is incorrect.",
	);
	assert(
		reasonsByProject.get(projectIds.affiliateProductMissing) ===
			"AFFILIATE_PRODUCT_MISSING",
		"Affiliate Product reason is incorrect.",
	);
	assert(
		reasonsByProject.get(projectIds.formatPathMismatch) ===
			"CONTENT_FORMAT_CREATION_PATH_MISMATCH",
		"Format/path mismatch reason is incorrect.",
	);

	const after = await pool.query<{
		createdAt: Date;
		updatedAt: Date;
		contentType: string | null;
	}>(
		`select created_at as "createdAt", updated_at as "updatedAt", content_type as "contentType" from project where id = $1`,
		[projectIds.candidate],
	);
	assert(
		before.rows[0]?.createdAt.getTime() ===
			after.rows[0]?.createdAt.getTime() &&
			before.rows[0]?.updatedAt.getTime() ===
				after.rows[0]?.updatedAt.getTime() &&
			after.rows[0]?.contentType === null,
		"Dry-run mutated candidate identity or audit timestamps.",
	);

	console.log(
		"AFF-US-016 M2A dry-run integration passed: fail-closed authority, apply refusal, keyset inventory, reports, precedence and zero mutation.",
	);
} finally {
	await pool.query("delete from project where workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("delete from product where workspace_id = $1", [
		workspaceId,
	]);
	await pool.query(`delete from "user" where id = $1`, [userId]);
	await pool.query("delete from workspace where id = $1", [workspaceId]);
	await pool.end();
	await rm(outputRoot, { recursive: true, force: true });
}

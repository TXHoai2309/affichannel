import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireBackfillTestDatabaseAuthority } from "./backfill-test-database-authority.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const tsxCli = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
const commandScript = resolve(
	process.cwd(),
	"scripts/backfill-legacy-affiliate-projects.ts",
);

function runCli(args: string[], environment: NodeJS.ProcessEnv) {
	return spawnSync(process.execPath, [tsxCli, commandScript, ...args], {
		cwd: process.cwd(),
		env: environment,
		encoding: "utf8",
		stdio: "pipe",
		windowsHide: true,
	});
}

const authorityEnvironmentKeys = [
	"AFFICHANNEL_BACKFILL_TEST_DATABASE_URL",
	"AFFICHANNEL_BACKFILL_TEST_DATABASE_CONFIRM",
	"AFFICHANNEL_BACKFILL_DATABASE_URL",
	"AFFICHANNEL_BACKFILL_DATABASE_CONFIRM",
	"DATABASE_URL",
	"DATABASE_URL_DIRECT",
	"AFFICHANNEL_M1_TEST_DATABASE_URL",
	"AFFICHANNEL_M1_TEST_DATABASE_CONFIRM",
] as const;

function withAuthorityEnvironment<T>(
	environment: NodeJS.ProcessEnv,
	action: () => T,
): T {
	const previous = Object.fromEntries(
		authorityEnvironmentKeys.map((key) => [key, process.env[key]]),
	);
	for (const key of authorityEnvironmentKeys) delete process.env[key];
	Object.assign(process.env, environment);
	try {
		return action();
	} finally {
		for (const key of authorityEnvironmentKeys) {
			const value = previous[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

const testAuthority = requireBackfillTestDatabaseAuthority();
const databaseUrl = testAuthority.url;

function expectFixtureAuthorityRefused(
	environment: NodeJS.ProcessEnv,
	label: string,
) {
	const refused = withAuthorityEnvironment(environment, () => {
		try {
			requireBackfillTestDatabaseAuthority();
			return false;
		} catch {
			return true;
		}
	});
	assert(refused, `${label} authorized destructive integration fixtures.`);
}

expectFixtureAuthorityRefused({}, "Missing test authority");
expectFixtureAuthorityRefused(
	{
		AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
		AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "BACKFILL_DRY_RUN_CONFIRMED",
	},
	"Production backfill authority",
);
expectFixtureAuthorityRefused({ DATABASE_URL: databaseUrl }, "DATABASE_URL");
expectFixtureAuthorityRefused(
	{ DATABASE_URL_DIRECT: databaseUrl },
	"DATABASE_URL_DIRECT",
);
expectFixtureAuthorityRefused(
	{ AFFICHANNEL_M1_TEST_DATABASE_URL: databaseUrl },
	"M1 test authority",
);
expectFixtureAuthorityRefused(
	{
		AFFICHANNEL_BACKFILL_TEST_DATABASE_URL: databaseUrl,
		AFFICHANNEL_BACKFILL_TEST_DATABASE_CONFIRM: "WRONG_CONFIRMATION",
	},
	"Incorrect test confirmation",
);

const dryRunEnvironment = {
	...process.env,
	NODE_ENV: "test",
	AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
	AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "BACKFILL_DRY_RUN_CONFIRMED",
};

for (const [label, fallbackEnvironment] of [
	["DATABASE_URL", { DATABASE_URL: databaseUrl }],
	["DATABASE_URL_DIRECT", { DATABASE_URL_DIRECT: databaseUrl }],
	["M1 test URL", { AFFICHANNEL_M1_TEST_DATABASE_URL: databaseUrl }],
] as const) {
	const environment = { ...process.env, ...fallbackEnvironment };
	delete environment.AFFICHANNEL_BACKFILL_DATABASE_URL;
	delete environment.AFFICHANNEL_BACKFILL_DATABASE_CONFIRM;
	const fallbackResult = runCli(["--dry-run"], environment);
	assert(
		fallbackResult.status !== 0 &&
			fallbackResult.stderr.includes(
				"AFFICHANNEL_BACKFILL_DATABASE_URL is required",
			),
		`Backfill command accepted ${label} fallback.`,
	);
}

const unavailableApplyEnvironment = { ...process.env };
delete unavailableApplyEnvironment.AFFICHANNEL_BACKFILL_DATABASE_URL;
delete unavailableApplyEnvironment.AFFICHANNEL_BACKFILL_DATABASE_CONFIRM;
const unavailableApply = runCli(["--apply"], unavailableApplyEnvironment);
assert(
	unavailableApply.status !== 0 &&
		unavailableApply.stderr.includes("--apply is not available"),
	"M2A did not refuse --apply before database authority resolution.",
);

const wrongConfirmationEnvironment = {
	...dryRunEnvironment,
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
const failureOutputRoot = await mkdtemp(
	join(tmpdir(), "affichannel-m2a-test-failure-output-"),
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

	const result = runCli(
		["--dry-run", "--batch-size", "2", "--output-dir", outputRoot],
		dryRunEnvironment,
	);
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

	const failedResult = runCli(
		[
			"--dry-run",
			"--batch-size",
			"2",
			"--output-dir",
			failureOutputRoot,
			"--test-fail-after-batch",
			"1",
		],
		dryRunEnvironment,
	);
	assert(
		failedResult.status !== 0,
		"Injected dry-run failure unexpectedly passed.",
	);
	const failureRunDirectories = await readdir(failureOutputRoot);
	assert(
		failureRunDirectories.length === 1,
		"Failed dry-run did not retain one run-owned directory.",
	);
	const failureRunDirectory = join(
		failureOutputRoot,
		failureRunDirectories[0] ?? "missing",
	);
	const failedRunText = await readFile(
		join(failureRunDirectory, "run.json"),
		"utf8",
	);
	const failedSummaryText = await readFile(
		join(failureRunDirectory, "summary.json"),
		"utf8",
	);
	const failedCheckpointText = await readFile(
		join(failureRunDirectory, "checkpoint.json"),
		"utf8",
	);
	const failedRun = JSON.parse(failedRunText) as Record<string, unknown>;
	const failedSummary = JSON.parse(failedSummaryText) as Record<
		string,
		unknown
	>;
	const failedCheckpoint = JSON.parse(failedCheckpointText) as Record<
		string,
		unknown
	>;
	assert(
		failedRun.status === "failed",
		"run.json was not finalized as failed.",
	);
	assert(
		failedSummary.status === "failed" &&
			Number(failedSummary.updated) === 0 &&
			Number(failedSummary.failed) >= 1,
		"summary.json does not contain failed zero-mutation evidence.",
	);
	assert(
		failedCheckpoint.status === "failed" &&
			Number(failedCheckpoint.batchNumber) >= 1,
		"Final failure checkpoint was not retained.",
	);
	const failureEvidence = [
		failedRunText,
		failedSummaryText,
		failedCheckpointText,
		failedResult.stdout,
		failedResult.stderr,
	].join("\n");
	const parsedDatabaseUrl = new URL(databaseUrl);
	const credentialAuthority = `${parsedDatabaseUrl.username}:${parsedDatabaseUrl.password}@`;
	assert(
		!failureEvidence.includes(databaseUrl) &&
			!failureEvidence.includes(credentialAuthority) &&
			!/[?&](?:password|sslpassword)=[^&\s]+/iu.test(failureEvidence),
		"Failed-run evidence leaked database credentials.",
	);

	console.log(
		"AFF-US-016 M2A dry-run integration passed: separated disposable authority, fallback/apply refusal, keyset inventory, completed/failed reports, precedence and zero command mutation.",
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
	await rm(failureOutputRoot, { recursive: true, force: true });
}

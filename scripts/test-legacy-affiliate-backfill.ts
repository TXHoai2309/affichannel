import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import type { BackfillCliOptions } from "./backfill-legacy-affiliate-projects.ts";
import { runLegacyAffiliateBackfill } from "./backfill-legacy-affiliate-projects.ts";
import { requireBackfillTestDatabaseAuthority } from "./backfill-test-database-authority.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const testAuthority = requireBackfillTestDatabaseAuthority();
const databaseUrl = testAuthority.url;
const pool = createNodePostgresPool(databaseUrl);
const tsxCli = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
const commandScript = resolve(
	process.cwd(),
	"scripts/backfill-legacy-affiliate-projects.ts",
);
const outputRoots: string[] = [];
const APPLY_URL_ENV = "AFFICHANNEL_BACKFILL_DATABASE_URL";
const APPLY_CONFIRM_ENV = "AFFICHANNEL_BACKFILL_DATABASE_CONFIRM";

const authorityKeys = [
	"AFFICHANNEL_BACKFILL_DATABASE_URL",
	"AFFICHANNEL_BACKFILL_DATABASE_CONFIRM",
	"DATABASE_URL",
	"DATABASE_URL_DIRECT",
	"AFFICHANNEL_M1_TEST_DATABASE_URL",
	"AFFICHANNEL_BACKFILL_TEST_DATABASE_URL",
	"AFFICHANNEL_BACKFILL_TEST_DATABASE_CONFIRM",
] as const;

function cleanChildEnvironment(
	overrides: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	for (const key of authorityKeys) delete environment[key];
	return { ...environment, NODE_ENV: "test", ...overrides };
}

function runCli(args: string[], overrides: NodeJS.ProcessEnv) {
	return spawnSync(process.execPath, [tsxCli, commandScript, ...args], {
		cwd: process.cwd(),
		env: cleanChildEnvironment(overrides),
		encoding: "utf8",
		stdio: "pipe",
		windowsHide: true,
	});
}

async function withApplyAuthority<T>(action: () => Promise<T>): Promise<T> {
	const previousUrl = process.env[APPLY_URL_ENV];
	const previousConfirm = process.env[APPLY_CONFIRM_ENV];
	const previousNodeEnv = process.env.NODE_ENV;
	process.env[APPLY_URL_ENV] = databaseUrl;
	process.env[APPLY_CONFIRM_ENV] = "DISPOSABLE_BACKFILL_DB_CONFIRMED";
	process.env.NODE_ENV = "test";
	try {
		return await action();
	} finally {
		if (previousUrl === undefined) delete process.env[APPLY_URL_ENV];
		else process.env[APPLY_URL_ENV] = previousUrl;
		if (previousConfirm === undefined) delete process.env[APPLY_CONFIRM_ENV];
		else process.env[APPLY_CONFIRM_ENV] = previousConfirm;
		if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = previousNodeEnv;
	}
}

async function withExecutionEnvironment<T>(
	overrides: NodeJS.ProcessEnv,
	action: () => Promise<T>,
): Promise<T> {
	const previousUrl = process.env[APPLY_URL_ENV];
	const previousConfirm = process.env[APPLY_CONFIRM_ENV];
	const previousNodeEnv = process.env.NODE_ENV;
	delete process.env[APPLY_URL_ENV];
	delete process.env[APPLY_CONFIRM_ENV];
	for (const [key, value] of Object.entries(overrides)) {
		if (value !== undefined) process.env[key] = value;
	}
	try {
		return await action();
	} finally {
		if (previousUrl === undefined) delete process.env[APPLY_URL_ENV];
		else process.env[APPLY_URL_ENV] = previousUrl;
		if (previousConfirm === undefined) delete process.env[APPLY_CONFIRM_ENV];
		else process.env[APPLY_CONFIRM_ENV] = previousConfirm;
		if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = previousNodeEnv;
	}
}

async function expectDirectRefused(
	options: BackfillCliOptions,
	environment: NodeJS.ProcessEnv,
	expectedMessage: string,
): Promise<void> {
	let observed = "";
	await withExecutionEnvironment(environment, async () => {
		try {
			await runLegacyAffiliateBackfill(options);
		} catch (error) {
			observed = error instanceof Error ? error.message : String(error);
		}
	});
	assert(
		observed.includes(expectedMessage),
		`Direct invocation was not refused with ${expectedMessage}; observed=${observed || "none"}.`,
	);
}

async function newOutputRoot(label: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), `affichannel-m2b-${label}-`));
	outputRoots.push(root);
	return root;
}

async function readOnlyRunArtifact(outputRoot: string, file: string) {
	const directories = await readdir(outputRoot);
	assert(
		directories.length === 1,
		`${outputRoot} did not contain exactly one run directory.`,
	);
	return JSON.parse(
		await readFile(join(outputRoot, directories[0] ?? "missing", file), "utf8"),
	) as Record<string, unknown>;
}

const workspaceId = `m2b-w-${randomUUID()}`;
const userId = `m2b-u-${randomUUID()}`;
const productId = `m2b-p-${randomUUID()}`;

async function insertProject(input: {
	id: string;
	productId: string | null;
	contentType?: string | null;
	creationPath?: string | null;
	contentFormatKey?: string | null;
	contentFormatVersion?: number | null;
	currentStepKey?: string;
}) {
	await pool.query(
		`
			insert into project (
				id, workspace_id, name, product_id, content_type, creation_path,
				content_format_key, content_format_version, current_step_key,
				created_by_user_id, created_at, updated_at
			) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
				'2025-01-02T03:04:05.000Z', '2025-02-03T04:05:06.000Z')
		`,
		[
			input.id,
			workspaceId,
			`AFF-US-016 M2B ${input.id}`,
			input.productId,
			input.contentType ?? null,
			input.creationPath ?? null,
			input.contentFormatKey ?? null,
			input.contentFormatVersion ?? null,
			input.currentStepKey ?? "voice",
			userId,
		],
	);
}

async function projectState(id: string) {
	const result = await pool.query<{
		id: string;
		workspaceId: string;
		productId: string | null;
		contentType: string | null;
		creationPath: string | null;
		contentFormatKey: string | null;
		contentFormatVersion: number | null;
		currentStepKey: string;
		createdByUserId: string;
		createdAt: Date;
		updatedAt: Date;
	}>(
		`
			select id, workspace_id as "workspaceId", product_id as "productId",
				content_type as "contentType", creation_path as "creationPath",
				content_format_key as "contentFormatKey",
				content_format_version as "contentFormatVersion",
				current_step_key as "currentStepKey",
				created_by_user_id as "createdByUserId",
				created_at as "createdAt", updated_at as "updatedAt"
			from project where id = $1
		`,
		[id],
	);
	const row = result.rows[0];
	assert(row, `Project ${id} is missing.`);
	return row;
}

const disposableApplyArgs = (outputRoot: string) => [
	"--apply",
	"--target",
	"disposable",
	"--output-dir",
	outputRoot,
];

try {
	const existing = await pool.query<{ count: number }>(
		"select count(*)::int as count from project",
	);
	assert(
		existing.rows[0]?.count === 0,
		"REFUSED: disposable M2B test DB contains pre-existing Projects.",
	);
	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		"AFF-US-016 M2B Workspace",
	]);
	await pool.query(
		`insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)`,
		[userId, "AFF-US-016 M2B User", `${userId}@example.test`],
	);
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspaceId, "AFF-US-016 M2B Product", userId],
	);

	const authorityCandidate = `m2b-00-authority-${randomUUID()}`;
	await insertProject({ id: authorityCandidate, productId });
	const authorityBefore = await projectState(authorityCandidate);
	const refusalOutput = await newOutputRoot("refusal");
	for (const invalidBatchSize of [
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		10_001,
		1_000_000,
	]) {
		await expectDirectRefused(
			{
				mode: "apply",
				target: "disposable",
				batchSize: invalidBatchSize,
				outputRoot: refusalOutput,
			},
			{
				AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
				AFFICHANNEL_BACKFILL_DATABASE_CONFIRM:
					"DISPOSABLE_BACKFILL_DB_CONFIRMED",
				NODE_ENV: "test",
			},
			"batchSize must be a finite integer from 1 through 10000",
		);
	}
	for (const invalidFailureBatch of [0, -1, 1.5]) {
		await expectDirectRefused(
			{
				mode: "apply",
				target: "disposable",
				batchSize: 10,
				outputRoot: refusalOutput,
				testFailAfterBatch: invalidFailureBatch,
			},
			{
				AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
				AFFICHANNEL_BACKFILL_DATABASE_CONFIRM:
					"DISPOSABLE_BACKFILL_DB_CONFIRMED",
				NODE_ENV: "test",
			},
			"testFailAfterBatch must be a finite positive integer",
		);
	}
	await expectDirectRefused(
		{ mode: "apply", batchSize: 10 },
		{ AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl, NODE_ENV: "test" },
		"apply execution requires target",
	);
	await expectDirectRefused(
		{
			mode: "apply",
			batchSize: 10,
			outputRoot: refusalOutput,
		},
		{
			AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
			AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "DISPOSABLE_BACKFILL_DB_CONFIRMED",
			NODE_ENV: "test",
		},
		"apply execution requires target",
	);
	await expectDirectRefused(
		{ mode: "apply", target: "disposable", batchSize: 10 },
		{
			AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
			AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "DISPOSABLE_BACKFILL_DB_CONFIRMED",
			NODE_ENV: "test",
		},
		"explicit outputRoot",
	);
	await expectDirectRefused(
		{
			mode: "apply",
			target: "disposable",
			batchSize: 10,
			outputRoot: refusalOutput,
		},
		{ AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl, NODE_ENV: "test" },
		"AFFICHANNEL_BACKFILL_DATABASE_CONFIRM is required",
	);
	await expectDirectRefused(
		{
			mode: "apply",
			target: "disposable",
			batchSize: 10,
			outputRoot: refusalOutput,
		},
		{
			AFFICHANNEL_BACKFILL_DATABASE_URL:
				"postgresql://db.example.invalid/affichannel",
			AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "DISPOSABLE_BACKFILL_DB_CONFIRMED",
			NODE_ENV: "test",
		},
		"local loopback PostgreSQL host",
	);
	await expectDirectRefused(
		{
			mode: "apply",
			target: "disposable",
			batchSize: 10,
			outputRoot: refusalOutput,
			testFailAfterBatch: 1,
		},
		{
			AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
			AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "DISPOSABLE_BACKFILL_DB_CONFIRMED",
			NODE_ENV: "production",
		},
		"available only when NODE_ENV=test",
	);
	assert(
		(await readdir(refusalOutput)).length === 0,
		"A refused direct invocation prepared output or attempted execution.",
	);
	for (const validBatchSize of [1, 500, 10_000]) {
		const directDryRun = await withExecutionEnvironment(
			{
				AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
				AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "BACKFILL_DRY_RUN_CONFIRMED",
				NODE_ENV: "test",
			},
			() =>
				runLegacyAffiliateBackfill({
					mode: "dry-run",
					batchSize: validBatchSize,
				}),
		);
		await rm(directDryRun.runDirectory, { recursive: true, force: true });
	}
	const refusalCases: Array<[string, string[], NodeJS.ProcessEnv, string]> = [
		[
			"dry-run confirmation",
			disposableApplyArgs(refusalOutput),
			{
				AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
				AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "BACKFILL_DRY_RUN_CONFIRMED",
			},
			"DISPOSABLE_BACKFILL_DB_CONFIRMED",
		],
		[
			"production mismatch",
			disposableApplyArgs(refusalOutput),
			{
				AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
				AFFICHANNEL_BACKFILL_DATABASE_CONFIRM:
					"PRODUCTION_BACKFILL_DB_CONFIRMED",
			},
			"DISPOSABLE_BACKFILL_DB_CONFIRMED",
		],
		[
			"disposable mismatch",
			["--apply", "--target", "production", "--output-dir", refusalOutput],
			{
				AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
				AFFICHANNEL_BACKFILL_DATABASE_CONFIRM:
					"DISPOSABLE_BACKFILL_DB_CONFIRMED",
			},
			"PRODUCTION_BACKFILL_DB_CONFIRMED",
		],
		[
			"fixture confirmation",
			disposableApplyArgs(refusalOutput),
			{
				AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
				AFFICHANNEL_BACKFILL_DATABASE_CONFIRM:
					"DISPOSABLE_BACKFILL_TEST_DB_CONFIRMED",
			},
			"DISPOSABLE_BACKFILL_DB_CONFIRMED",
		],
		[
			"application URL",
			disposableApplyArgs(refusalOutput),
			{ DATABASE_URL: databaseUrl },
			"AFFICHANNEL_BACKFILL_DATABASE_URL is required",
		],
		[
			"direct URL",
			disposableApplyArgs(refusalOutput),
			{ DATABASE_URL_DIRECT: databaseUrl },
			"AFFICHANNEL_BACKFILL_DATABASE_URL is required",
		],
		[
			"M1 URL",
			disposableApplyArgs(refusalOutput),
			{ AFFICHANNEL_M1_TEST_DATABASE_URL: databaseUrl },
			"AFFICHANNEL_BACKFILL_DATABASE_URL is required",
		],
		[
			"fixture test URL",
			disposableApplyArgs(refusalOutput),
			{
				AFFICHANNEL_BACKFILL_TEST_DATABASE_URL: databaseUrl,
				AFFICHANNEL_BACKFILL_TEST_DATABASE_CONFIRM:
					"DISPOSABLE_BACKFILL_TEST_DB_CONFIRMED",
			},
			"AFFICHANNEL_BACKFILL_DATABASE_URL is required",
		],
	];
	for (const [label, args, environment, expected] of refusalCases) {
		const result = runCli(args, environment);
		assert(
			result.status !== 0 && result.stderr.includes(expected),
			`${label} authorized M2B apply.`,
		);
	}
	const missingOutput = runCli(["--apply", "--target", "disposable"], {
		AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
		AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "DISPOSABLE_BACKFILL_DB_CONFIRMED",
	});
	assert(
		missingOutput.status !== 0 &&
			missingOutput.stderr.includes("explicit --output-dir"),
		"Apply accepted a missing output directory.",
	);
	const fileAsOutput = join(
		await newOutputRoot("unwritable"),
		"not-a-directory",
	);
	await writeFile(fileAsOutput, "fixture", "utf8");
	const unwritable = runCli(disposableApplyArgs(fileAsOutput), {
		AFFICHANNEL_BACKFILL_DATABASE_URL: databaseUrl,
		AFFICHANNEL_BACKFILL_DATABASE_CONFIRM: "DISPOSABLE_BACKFILL_DB_CONFIRMED",
	});
	assert(
		unwritable.status !== 0,
		"Apply accepted a non-writable evidence path.",
	);
	const authorityAfter = await projectState(authorityCandidate);
	assert(
		authorityBefore.contentType === authorityAfter.contentType,
		"A refused apply mutated the candidate.",
	);

	await pool.query("delete from project where workspace_id = $1", [
		workspaceId,
	]);
	const candidateId = `m2b-10-candidate-${randomUUID()}`;
	const canonicalId = `m2b-11-canonical-${randomUUID()}`;
	const exceptionId = `m2b-12-exception-${randomUUID()}`;
	await insertProject({
		id: candidateId,
		productId,
		currentStepKey: "fact-lock",
	});
	await insertProject({
		id: canonicalId,
		productId,
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
	});
	await insertProject({ id: exceptionId, productId: null });
	const stepId = `m2b-step-${randomUUID()}`;
	await pool.query(
		"insert into project_step_status (id, project_id, step_key, status) values ($1, $2, 'fact-lock', 'completed')",
		[stepId, candidateId],
	);
	const before = await projectState(candidateId);
	const canonicalBefore = await projectState(canonicalId);
	const firstOutput = await newOutputRoot("first");
	const first = await withApplyAuthority(() =>
		runLegacyAffiliateBackfill({
			mode: "apply",
			target: "disposable",
			batchSize: 50,
			outputRoot: firstOutput,
		}),
	);
	assert(
		first.counts.updated === 1 && first.counts.exceptions === 1,
		"First apply counts are incorrect.",
	);
	const after = await projectState(candidateId);
	assert(
		after.contentType === "AFFILIATE" &&
			after.creationPath === "SCRIPTED" &&
			after.contentFormatKey === "SCRIPTED_STANDARD" &&
			after.contentFormatVersion === 1,
		"Candidate did not receive the exact canonical identity.",
	);
	assert(
		after.productId === before.productId &&
			after.currentStepKey === before.currentStepKey &&
			after.workspaceId === before.workspaceId &&
			after.createdByUserId === before.createdByUserId,
		"Apply changed preserved Project columns.",
	);
	assert(
		after.createdAt.getTime() === before.createdAt.getTime() &&
			after.updatedAt.getTime() === before.updatedAt.getTime(),
		"Apply changed Project timestamps.",
	);
	const stepAfter = await pool.query<{ id: string }>(
		"select id from project_step_status where project_id = $1",
		[candidateId],
	);
	assert(
		stepAfter.rows[0]?.id === stepId,
		"Apply changed historical Project step identity.",
	);
	const canonicalAfter = await projectState(canonicalId);
	assert(
		canonicalAfter.updatedAt.getTime() === canonicalBefore.updatedAt.getTime(),
		"Existing canonical Project was mutated.",
	);
	const exceptionAfter = await projectState(exceptionId);
	assert(exceptionAfter.contentType === null, "Exception Project was mutated.");
	const firstSummary = await readOnlyRunArtifact(firstOutput, "summary.json");
	assert(
		firstSummary.mode === "apply" &&
			firstSummary.target === "disposable" &&
			Number(firstSummary.updated) === 1,
		"First apply report is inaccurate.",
	);

	const secondOutput = await newOutputRoot("second");
	const second = await withApplyAuthority(() =>
		runLegacyAffiliateBackfill({
			mode: "apply",
			target: "disposable",
			batchSize: 50,
			outputRoot: secondOutput,
		}),
	);
	assert(
		second.counts.updated === 0,
		"Idempotent second apply performed a mutation.",
	);
	const afterSecond = await projectState(candidateId);
	assert(
		afterSecond.updatedAt.getTime() === before.updatedAt.getTime(),
		"Idempotent rerun changed updatedAt.",
	);

	await pool.query("delete from project where workspace_id = $1", [
		workspaceId,
	]);
	const raceId = `m2b-20-race-${randomUUID()}`;
	await insertProject({ id: raceId, productId });
	const raceOutput = await newOutputRoot("race");
	const race = await withApplyAuthority(() =>
		runLegacyAffiliateBackfill(
			{
				mode: "apply",
				target: "disposable",
				batchSize: 50,
				outputRoot: raceOutput,
			},
			{
				beforeApplyBatch: async ({ candidateIds }) => {
					if (candidateIds.includes(raceId))
						await pool.query(
							"update project set content_type = 'AFFILIATE' where id = $1",
							[raceId],
						);
				},
			},
		),
	);
	assert(
		race.counts.updated === 0 && race.counts.skipped === 1,
		"CAS race was not classified as a controlled skip.",
	);
	const raced = await projectState(raceId);
	assert(
		raced.contentType === "AFFILIATE" &&
			raced.creationPath === null &&
			raced.contentFormatKey === null,
		"CAS overwrote concurrent state.",
	);
	const skips = await readFile(join(race.runDirectory, "skips.jsonl"), "utf8");
	assert(
		skips.includes(raceId) && skips.includes("CONCURRENT_STATE_CHANGE"),
		"CAS skip evidence is missing.",
	);

	await pool.query("delete from project where workspace_id = $1", [
		workspaceId,
	]);
	const failFirstId = `m2b-30-a-${randomUUID()}`;
	const failSecondId = `m2b-30-b-${randomUUID()}`;
	await insertProject({ id: failFirstId, productId });
	await insertProject({ id: failSecondId, productId });
	const failBefore = await projectState(failFirstId);
	const failureOutput = await newOutputRoot("failure");
	let failureObserved = false;
	try {
		await withApplyAuthority(() =>
			runLegacyAffiliateBackfill({
				mode: "apply",
				target: "disposable",
				batchSize: 1,
				outputRoot: failureOutput,
				testFailAfterBatch: 1,
			}),
		);
	} catch (error) {
		failureObserved =
			error instanceof Error && error.message.includes("after committed batch");
	}
	assert(failureObserved, "Injected post-commit failure was not observed.");
	const failedFirst = await projectState(failFirstId);
	const failedSecond = await projectState(failSecondId);
	assert(
		failedFirst.contentType === "AFFILIATE" &&
			failedSecond.contentType === null,
		"Committed batch was lost or uncommitted batch was mutated.",
	);
	assert(
		failedFirst.updatedAt.getTime() === failBefore.updatedAt.getTime(),
		"Failed run changed updatedAt.",
	);
	const failedSummary = await readOnlyRunArtifact(
		failureOutput,
		"summary.json",
	);
	const failedCheckpoint = await readOnlyRunArtifact(
		failureOutput,
		"checkpoint.json",
	);
	assert(
		failedSummary.status === "failed" &&
			Number(failedSummary.updated) === 1 &&
			Number(failedSummary.failed) >= 1,
		"Failed summary did not preserve committed counts.",
	);
	assert(
		failedCheckpoint.status === "failed" &&
			failedCheckpoint.lastProjectId === failFirstId,
		"Failed checkpoint did not preserve the committed cursor.",
	);
	const resumeOutput = await newOutputRoot("resume");
	const resumed = await withApplyAuthority(() =>
		runLegacyAffiliateBackfill({
			mode: "apply",
			target: "disposable",
			batchSize: 50,
			outputRoot: resumeOutput,
		}),
	);
	assert(
		resumed.counts.updated === 1,
		"Rerun did not process exactly the remaining candidate.",
	);
	assert(
		(await projectState(failFirstId)).contentType === "AFFILIATE" &&
			(await projectState(failSecondId)).contentType === "AFFILIATE",
		"Rerun did not converge both candidates.",
	);

	console.log(
		"AFF-US-016 M2B integration passed: authority, evidence preflight, exact CAS, timestamps, exceptions, race skip, idempotency, committed failure and rerun.",
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
	for (const root of outputRoots)
		await rm(root, { recursive: true, force: true });
}

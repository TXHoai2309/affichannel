import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireBackfillTestDatabaseAuthority } from "./backfill-test-database-authority.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const testAuthority = requireBackfillTestDatabaseAuthority();
const databaseUrl = testAuthority.url;

// Every database consumer in this harness receives the same explicit
// disposable target. No application database variable is used as authority.
process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_LIVE_AI_SMOKE = "0";
process.env.AFFICHANNEL_LIVE_TTS_SMOKE = "0";
process.env.AFFICHANNEL_BACKFILL_DATABASE_URL = databaseUrl;
process.env.AFFICHANNEL_BACKFILL_DATABASE_CONFIRM =
	"BACKFILL_DRY_RUN_CONFIRMED";
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = databaseUrl;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM =
	"DISPOSABLE_DB_CONFIRMED";

const { runLegacyAffiliateBackfill } = await import(
	"./backfill-legacy-affiliate-projects.ts"
);
const { createProject, updateProject } = await import(
	"@affichannel/core/project/project-service"
);
const {
	createProjectInputSchema,
	updateProjectInputSchema,
} = await import("@affichannel/core/project/project-validation");
const { createProjectRepository } = await import(
	"../packages/api/src/services/project-repository.ts"
);

const pool = createNodePostgresPool(databaseUrl);
const outputDirectories: string[] = [];
const projectIds: string[] = [];
const exceptionProjectIds: string[] = [];

const workspaceId = `m2c-workspace-${randomUUID()}`;
const userId = `m2c-user-${randomUUID()}`;
const productId = randomUUID();
const actor = { workspaceId, userId };

type ProjectIdentityFixture = {
	contentType?: string | null;
	creationPath?: string | null;
	contentFormatKey?: string | null;
	contentFormatVersion?: number | null;
};

async function insertProject(input: {
	id: string;
	productId: string | null;
	identity?: ProjectIdentityFixture;
	currentStepKey?: string;
	createdAt?: string;
	updatedAt?: string;
}) {
	const identity = input.identity ?? {};
	await pool.query(
		`
			insert into project (
				id, workspace_id, name, product_id, content_type, creation_path,
				content_format_key, content_format_version, current_step_key,
				created_by_user_id, created_at, updated_at
			) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		`,
		[
			input.id,
			workspaceId,
			`AFF-US-016 M2C ${input.id}`,
			input.productId,
			identity.contentType ?? null,
			identity.creationPath ?? null,
			identity.contentFormatKey ?? null,
			identity.contentFormatVersion ?? null,
			input.currentStepKey ?? "voice",
			userId,
			input.createdAt ?? "2025-01-02T03:04:05.000Z",
			input.updatedAt ?? "2025-02-03T04:05:06.000Z",
		],
	);
	projectIds.push(input.id);
}

async function insertBrief(projectId: string, label: string) {
	await pool.query(
		`
			insert into content_brief
				(id, project_id, platform, goal, duration_seconds, angle)
			values ($1, $2, 'tiktok', $3, 30, $4)
		`,
		[randomUUID(), projectId, `M2C ${label} goal`, `M2C ${label} angle`],
	);
}

async function insertStep(projectId: string, stepKey: string, status: string) {
	const stepId = randomUUID();
	await pool.query(
		`insert into project_step_status (id, project_id, step_key, status)
		 values ($1, $2, $3, $4)`,
		[stepId, projectId, stepKey, status],
	);
	return stepId;
}

async function projectState(projectId: string) {
	const result = await pool.query<{
		id: string;
		workspaceId: string;
		productId: string | null;
		contentType: string | null;
		creationPath: string | null;
		contentFormatKey: string | null;
		contentFormatVersion: number | null;
		currentStepKey: string;
		createdAt: Date;
		updatedAt: Date;
	}>(
		`select
			 id, workspace_id as "workspaceId", product_id as "productId",
			 content_type as "contentType", creation_path as "creationPath",
			 content_format_key as "contentFormatKey",
			 content_format_version as "contentFormatVersion",
			 current_step_key as "currentStepKey",
			 created_at as "createdAt", updated_at as "updatedAt"
		 from project where id = $1`,
		[projectId],
	);
	const row = result.rows[0];
	assert(row, `Project ${projectId} is missing.`);
	return row;
}

async function stepState(projectId: string) {
	const result = await pool.query<{
		id: string;
		stepKey: string;
		status: string;
	}>(
		`select id, step_key as "stepKey", status
		 from project_step_status where project_id = $1 order by id`,
		[projectId],
	);
	return result.rows;
}

async function allNullCandidateCount() {
	const result = await pool.query<{ count: number }>(
		`select count(*)::int as count from project
		 where content_type is null
		   and creation_path is null
		   and content_format_key is null
		   and content_format_version is null
		   and product_id is not null`,
	);
	return result.rows[0]?.count ?? 0;
}

async function runOutputRoot(label: string) {
	const outputRoot = await mkdtemp(join(tmpdir(), `affichannel-m2c-${label}-`));
	outputDirectories.push(outputRoot);
	return outputRoot;
}

async function readJson(path: string) {
	return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function exceptionCounts(runDirectory: string) {
	const path = join(runDirectory, "exceptions.jsonl");
	const content = await readFile(path, "utf8");
	const counts: Record<string, number> = {};
	for (const line of content.split(/\r?\n/u).filter(Boolean)) {
		const record = JSON.parse(line) as { reasonCode?: string };
		const reasonCode = record.reasonCode ?? "UNKNOWN_EXCEPTION";
		counts[reasonCode] = (counts[reasonCode] ?? 0) + 1;
	}
	return counts;
}

async function cleanProject(projectId: string) {
	await pool.query("delete from project_step_status where project_id = $1", [
		projectId,
	]);
	await pool.query("delete from content_brief where project_id = $1", [
		projectId,
	]);
	await pool.query("delete from project where id = $1", [projectId]);
}

async function withDisposableApply<T>(action: () => Promise<T>) {
	const previousUrl = process.env.AFFICHANNEL_BACKFILL_DATABASE_URL;
	const previousConfirm = process.env.AFFICHANNEL_BACKFILL_DATABASE_CONFIRM;
	process.env.AFFICHANNEL_BACKFILL_DATABASE_URL = databaseUrl;
	process.env.AFFICHANNEL_BACKFILL_DATABASE_CONFIRM =
		"DISPOSABLE_BACKFILL_DB_CONFIRMED";
	try {
		return await action();
	} finally {
		if (previousUrl === undefined)
			delete process.env.AFFICHANNEL_BACKFILL_DATABASE_URL;
		else process.env.AFFICHANNEL_BACKFILL_DATABASE_URL = previousUrl;
		if (previousConfirm === undefined)
			delete process.env.AFFICHANNEL_BACKFILL_DATABASE_CONFIRM;
		else process.env.AFFICHANNEL_BACKFILL_DATABASE_CONFIRM = previousConfirm;
	}
}

try {
	const existing = await pool.query<{ count: number }>(
		"select count(*)::int as count from project",
	);
	assert(
		existing.rows[0]?.count === 0,
		"REFUSED: M2C disposable DB contains pre-existing Projects.",
	);

	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		"AFF-US-016 M2C Workspace",
	]);
	await pool.query(
		`insert into "user" (id, name, email, email_verified)
		 values ($1, $2, $3, true)`,
		[userId, "AFF-US-016 M2C User", `${userId}@example.test`],
	);
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspaceId, "AFF-US-016 M2C Product", userId],
	);

	// M3B no-new-null proof through the normal production service/repository.
	const repository = createProjectRepository();
	const legacyCreate = createProjectInputSchema.parse({
		name: "M2C M3B legacy create",
		productId,
		platform: "tiktok",
		goal: "M3B legacy create proof",
		durationSeconds: 30,
		angle: "M3B legacy create proof",
		description: undefined,
	});
	const createdLegacy = await createProject(repository, actor, legacyCreate);
	projectIds.push(createdLegacy.id);
	const createdLegacyState = await projectState(createdLegacy.id);
	assert(
		createdLegacyState.contentType === "AFFILIATE" &&
		createdLegacyState.creationPath === "SCRIPTED" &&
		createdLegacyState.contentFormatKey === "SCRIPTED_STANDARD" &&
		createdLegacyState.contentFormatVersion === 1,
		"M3B legacy create produced an all-null identity.",
	);

	const explicitCreate = createProjectInputSchema.parse({
		...legacyCreate,
		name: "M2C M3B explicit canonical create",
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
	});
	const createdCanonical = await createProject(
		repository,
		actor,
		explicitCreate,
	);
	projectIds.push(createdCanonical.id);
	const createdCanonicalState = await projectState(createdCanonical.id);
	assert(
		createdCanonicalState.contentType === "AFFILIATE" &&
		createdCanonicalState.creationPath === "SCRIPTED" &&
		createdCanonicalState.contentFormatKey === "SCRIPTED_STANDARD" &&
		createdCanonicalState.contentFormatVersion === 1,
		"M3B explicit canonical create did not persist complete identity.",
	);

	const beforeLegacyUpdateCount = await allNullCandidateCount();
	const legacyUpdate = updateProjectInputSchema.parse({
		...legacyCreate,
		id: createdCanonical.id,
		name: "M2C M3B legacy update",
	});
	await updateProject(repository, actor, legacyUpdate);
	const afterLegacyUpdateState = await projectState(createdCanonical.id);
	assert(
		afterLegacyUpdateState.contentType === "AFFILIATE" &&
			afterLegacyUpdateState.creationPath === "SCRIPTED" &&
			afterLegacyUpdateState.contentFormatKey === "SCRIPTED_STANDARD" &&
			afterLegacyUpdateState.contentFormatVersion === 1 &&
		(await allNullCandidateCount()) === beforeLegacyUpdateCount,
		"M3B update created an all-null identity.",
	);

	// M2C mixed rollout population.
	const candidateA = randomUUID();
	const candidateB = randomUUID();
	const canonicalId = randomUUID();
	await insertProject({
		id: candidateA,
		productId,
		currentStepKey: "fact-lock",
		createdAt: "2025-01-02T03:04:05.000Z",
		updatedAt: "2025-02-03T04:05:06.000Z",
	});
	await insertBrief(candidateA, "candidate A");
	const candidateStepId = await insertStep(candidateA, "fact-lock", "completed");
	await insertProject({
		id: candidateB,
		productId,
		currentStepKey: "voice",
		createdAt: "2025-03-02T03:04:05.000Z",
		updatedAt: "2025-04-03T04:05:06.000Z",
	});
	await insertBrief(candidateB, "candidate B");
	await insertStep(candidateB, "voice", "needs_review");
	await insertProject({
		id: canonicalId,
		productId,
		identity: {
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
		},
		currentStepKey: "completed",
		createdAt: "2025-05-02T03:04:05.000Z",
		updatedAt: "2025-06-03T04:05:06.000Z",
	});
	await insertBrief(canonicalId, "canonical");

	const candidateABefore = await projectState(candidateA);
	const candidateBBefore = await projectState(candidateB);
	const canonicalBefore = await projectState(canonicalId);
	const candidateStepsBefore = await stepState(candidateA);
	const candidateBStepsBefore = await stepState(candidateB);

	// Defensive DB-valid exception population for the initial inventory only.
	const exceptionIds = [
		{
			id: randomUUID(),
			productId: null,
			identity: {},
		},
		{
			id: randomUUID(),
			productId,
			identity: {
				contentType: "AFFILIATE",
				creationPath: "SCRIPTED",
				contentFormatKey: "UNKNOWN_FORMAT",
				contentFormatVersion: 1,
			},
		},
		{
			id: randomUUID(),
			productId,
			identity: {
				contentType: "AFFILIATE",
				creationPath: "QUICK_IMAGE",
				contentFormatKey: "SCRIPTED_STANDARD",
				contentFormatVersion: 1,
			},
		},
		{
			id: randomUUID(),
			productId,
			identity: { contentType: "AFFILIATE" },
		},
		{
			id: randomUUID(),
			productId: null,
			identity: {
				contentType: "AFFILIATE",
				creationPath: "SCRIPTED",
				contentFormatKey: "SCRIPTED_STANDARD",
				contentFormatVersion: 1,
			},
		},
	];
	for (const fixture of exceptionIds) {
		await insertProject(fixture);
		exceptionProjectIds.push(fixture.id);
	}

	const initialOutputRoot = await runOutputRoot("initial");
	const initial = await runLegacyAffiliateBackfill({
		mode: "dry-run",
		batchSize: 2,
		outputRoot: initialOutputRoot,
	});
	const initialSummary = await readJson(join(initial.runDirectory, "summary.json"));
	const initialExceptions = await exceptionCounts(initial.runDirectory);
	assert(
		initial.counts.legacyCandidates === 2,
		`Expected 2 initial candidates, got ${initial.counts.legacyCandidates}.`,
	);
	assert(
		initial.counts.exceptions === exceptionIds.length,
		"Initial exception inventory did not include all defensive fixtures.",
	);

	// Exceptions are operational blockers, not M2C repair targets. Remove only
	// this harness-owned defensive population before the readiness scan.
	for (const exceptionId of exceptionProjectIds) {
		await cleanProject(exceptionId);
	}

	const applyOutputRoot = await runOutputRoot("apply");
	const firstApply = await withDisposableApply(() =>
		runLegacyAffiliateBackfill({
			mode: "apply",
			target: "disposable",
			batchSize: 2,
			outputRoot: applyOutputRoot,
		}),
	);
	assert(
		firstApply.counts.updated === 2 && firstApply.counts.failed === 0,
		"M2C reconciliation did not update exactly the deterministic candidates.",
	);

	const candidateAAfter = await projectState(candidateA);
	const candidateBAfter = await projectState(candidateB);
	const canonicalAfter = await projectState(canonicalId);
	assert(
		candidateAAfter.contentType === "AFFILIATE" &&
		candidateAAfter.creationPath === "SCRIPTED" &&
		candidateAAfter.contentFormatKey === "SCRIPTED_STANDARD" &&
		candidateAAfter.contentFormatVersion === 1,
		"Candidate A was not canonicalized.",
	);
	assert(
		candidateBAfter.contentType === "AFFILIATE" &&
		candidateBAfter.creationPath === "SCRIPTED" &&
		candidateBAfter.contentFormatKey === "SCRIPTED_STANDARD" &&
		candidateBAfter.contentFormatVersion === 1,
		"Candidate B was not canonicalized.",
	);
	assert(
		candidateAAfter.id === candidateABefore.id &&
		candidateAAfter.productId === candidateABefore.productId &&
		candidateAAfter.currentStepKey === candidateABefore.currentStepKey &&
		candidateAAfter.createdAt.getTime() === candidateABefore.createdAt.getTime() &&
		candidateAAfter.updatedAt.getTime() === candidateABefore.updatedAt.getTime(),
		"Candidate A unrelated Project fields or timestamps changed.",
	);
	assert(
		candidateBAfter.id === candidateBBefore.id &&
		candidateBAfter.productId === candidateBBefore.productId &&
		candidateBAfter.currentStepKey === candidateBBefore.currentStepKey &&
		candidateBAfter.createdAt.getTime() === candidateBBefore.createdAt.getTime() &&
		candidateBAfter.updatedAt.getTime() === candidateBBefore.updatedAt.getTime(),
		"Candidate B unrelated Project fields or timestamps changed.",
	);
	assert(
		JSON.stringify(await stepState(candidateA)) ===
			JSON.stringify(candidateStepsBefore) &&
			JSON.stringify(await stepState(candidateB)) ===
				JSON.stringify(candidateBStepsBefore),
		"Historical Project step status identity changed.",
	);
	assert(
		JSON.stringify(canonicalAfter) === JSON.stringify(canonicalBefore),
		"Already canonical Project was mutated.",
	);

	const secondDryRunOutput = await runOutputRoot("second-dry-run");
	const secondDryRun = await runLegacyAffiliateBackfill({
		mode: "dry-run",
		batchSize: 2,
		outputRoot: secondDryRunOutput,
	});
	const secondExceptions = await exceptionCounts(secondDryRun.runDirectory);
	assert(
		secondDryRun.counts.legacyCandidates === 0 &&
		secondDryRun.counts.exceptions === 0,
		"Second full scan did not prove zero candidates and zero blockers.",
	);

	const secondApplyOutput = await runOutputRoot("second-apply");
	const secondApply = await withDisposableApply(() =>
		runLegacyAffiliateBackfill({
			mode: "apply",
			target: "disposable",
			batchSize: 2,
			outputRoot: secondApplyOutput,
		}),
	);
	assert(
		secondApply.counts.updated === 0 && secondApply.counts.failed === 0,
		"Second reconciliation apply was not idempotent.",
	);

	const finalOutputRoot = await runOutputRoot("final");
	const finalScan = await runLegacyAffiliateBackfill({
		mode: "dry-run",
		batchSize: 2,
		outputRoot: finalOutputRoot,
	});
	const finalExceptions = await exceptionCounts(finalScan.runDirectory);
	const remainingLegacyCandidates = finalScan.counts.legacyCandidates;
	const blockingExceptions = finalScan.counts.exceptions;
	const readyForM4 = remainingLegacyCandidates === 0 && blockingExceptions === 0;
	assert(readyForM4, "M2C zero-blocker readiness gate failed.");

	console.log(
		JSON.stringify(
			{
				m2c: {
					startsFromBeginning: true,
					initial: {
						...initial.counts,
						exceptionReasonCounts: initialExceptions,
					},
					initialSummary,
					firstApply: firstApply.counts,
					secondDryRun: {
						...secondDryRun.counts,
						exceptionReasonCounts: secondExceptions,
					},
					secondApply: secondApply.counts,
					final: {
						...finalScan.counts,
						exceptionReasonCounts: finalExceptions,
						remainingLegacyCandidates,
						blockingExceptions,
						readyForM4,
					},
				},
			},
			null,
			2,
		),
	);
	console.log("AFF-US-016 M2C reconciliation and zero-blocker gate passed.");
} finally {
	for (const projectId of [...new Set(projectIds)]) {
		await cleanProject(projectId).catch(() => undefined);
	}
	await pool
		.query("delete from product where id = $1 and workspace_id = $2", [
			productId,
			workspaceId,
		])
		.catch(() => undefined);
	await pool.query("delete from \"user\" where id = $1", [userId]).catch(() => undefined);
	await pool.query("delete from workspace where id = $1", [workspaceId]).catch(() => undefined);
	await pool.end();
	for (const outputDirectory of outputDirectories) {
		await rm(outputDirectory, { recursive: true, force: true }).catch(
			() => undefined,
		);
	}
}

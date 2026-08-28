import { createHash, randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import {
	canonicalizeJson,
	parseScriptClaimRefreshRunRecord,
	scriptClaimRefreshRunRecordSchema,
	scriptGenerationSections,
} from "@affichannel/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireScriptClaimRefreshTestDatabaseAuthority } from "./script-claim-refresh-test-database-authority.ts";

type Pool = ReturnType<typeof createNodePostgresPool>;
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

const authority = requireScriptClaimRefreshTestDatabaseAuthority();
process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
process.env.AFFICHANNEL_LIVE_AI_SMOKE = "0";
process.env.AFFICHANNEL_LIVE_TTS_SMOKE = "0";
for (const name of [
	"DATABASE_URL",
	"DATABASE_URL_DIRECT",
	"AFF_US008_DATABASE_URL",
	"AFFICHANNEL_BACKFILL_DATABASE_URL",
	"AFFICHANNEL_BACKFILL_TEST_DATABASE_URL",
	"APIKEY_FUN_API_KEY",
	"TTS_APIKEY_FUN_API_KEY",
]) {
	Reflect.deleteProperty(process.env, name);
}

const migrationsRoot = resolve("packages/db/src/migrations");
const temporaryFolders: string[] = [];
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

const {
	createOrReuseScriptClaimRefreshRun,
	getScriptClaimRefreshRunById,
	getScriptClaimRefreshRunByIdempotencyKey,
	ScriptClaimRefreshRepositoryError,
} = await import(
	"../packages/api/src/services/script-claim-refresh-repository.ts"
);

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
	if (actual !== expected) {
		throw new Error(
			`${message} (expected ${String(expected)}, got ${String(actual)}).`,
		);
	}
}

async function expectRejected(
	label: string,
	action: () => Promise<unknown>,
): Promise<unknown> {
	try {
		await action();
	} catch (error) {
		console.log(`${label}: REJECTED`);
		return error;
	}
	throw new Error(`${label} must reject.`);
}

async function expectRepositoryConflict(
	label: string,
	action: () => Promise<unknown>,
): Promise<void> {
	try {
		await action();
	} catch (error) {
		assert(
			error instanceof ScriptClaimRefreshRepositoryError &&
				error.code === "SCRIPT_CLAIM_REFRESH_IDEMPOTENCY_CONFLICT",
			`${label} must use the typed idempotency conflict.`,
		);
		assert(
			error.message === "SCRIPT_CLAIM_REFRESH_IDEMPOTENCY_CONFLICT",
			`${label} must not expose persisted payload or SQL details.`,
		);
		console.log(`${label}: SCRIPT_CLAIM_REFRESH_IDEMPOTENCY_CONFLICT`);
		return;
	}
	throw new Error(`${label} must fail closed.`);
}

async function migrationFolderThrough(lastIndex: number): Promise<string> {
	const journal = JSON.parse(
		await readFile(join(migrationsRoot, "meta", "_journal.json"), "utf8"),
	) as Journal;
	const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
	assert(
		entries.length === lastIndex + 1,
		`Expected migration journal entries through index ${lastIndex}.`,
	);
	const folder = await mkdtemp(
		join(tmpdir(), `affichannel-script-claim-refresh-${lastIndex}-`),
	);
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

async function resetDatabase(pool: Pool): Promise<void> {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
}

async function migrationCount(pool: Pool): Promise<number> {
	const result = await pool.query<{ count: number }>(
		"select count(*)::int as count from drizzle.__drizzle_migrations",
	);
	return result.rows[0]?.count ?? 0;
}

async function publicTables(pool: Pool): Promise<string[]> {
	const result = await pool.query<{ tableName: string }>(
		`select table_name as "tableName"
		 from information_schema.tables
		 where table_schema = 'public' and table_type = 'BASE TABLE'
		 order by table_name`,
	);
	return result.rows.map((row) => row.tableName);
}

function snapshot(label: string): ScriptVersionEditableSnapshot {
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-a", text: `Mở đầu ${label}.` },
			{ key: "hook-b", text: "Một lựa chọn âm thanh gọn nhẹ." },
			{ key: "hook-c", text: "Trải nghiệm mỗi ngày." },
		],
		selectedHookKey: "hook-a",
		voiceoverSegments: [
			{ key: "voice-a", text: `Thông tin ${label} được trình bày rõ ràng.` },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 15,
				visualDirection: "Cận cảnh sản phẩm",
				onScreenText: "Thông tin minh bạch.",
				voiceoverSegmentKeys: ["voice-a"],
			},
		],
		cta: { text: "Tìm hiểu thêm." },
		caption: `Nội dung ${label}.`,
		hashtags: ["#affichannel"],
		disclosure: "Nội dung thử nghiệm nội bộ.",
		claims: [
			{
				text: `Thông tin ${label}`,
				occurrence: { section: "hook", hookKey: "hook-a" },
			},
		],
		claimsSourceRevision: 1,
		claimsStatus: "current",
	};
}

type Fixture = Readonly<{
	workspaceId: string;
	userId: string;
	projectId: string;
	scriptVersionId: string;
	productId: string;
	generationId: string;
	snapshot: ScriptVersionEditableSnapshot;
}>;

async function seedFixture(pool: Pool, label: string): Promise<Fixture> {
	const suffix = randomUUID();
	const workspaceId = `claim-refresh-workspace-${label}-${suffix}`;
	const userId = `claim-refresh-user-${label}-${suffix}`;
	const productId = `claim-refresh-product-${label}-${suffix}`;
	const projectId = `claim-refresh-project-${label}-${suffix}`;
	const generationId = `claim-refresh-generation-${label}-${suffix}`;
	const scriptVersionId = `claim-refresh-script-${label}-${suffix}`;
	const sourceSnapshot = snapshot(label);

	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		`Script Claim Refresh ${label}`,
	]);
	await pool.query(
		'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
		[userId, `Script Claim Refresh ${label}`, `${userId}@example.test`],
	);
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspaceId, `Script Claim Refresh ${label}`, userId],
	);
	await pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key, created_by_user_id
		) values ($1, $2, $3, $4, 'AFFILIATE', 'SCRIPTED',
			'SCRIPTED_STANDARD', 1, 'content', $5)`,
		[
			projectId,
			workspaceId,
			`Script Claim Refresh ${label}`,
			productId,
			userId,
		],
	);
	await pool.query(
		`insert into script_generation (
			id, workspace_id, project_id, created_by_user_id, idempotency_key,
			request_hash, mode, provider, model, prompt_version, output_schema_version,
			input_snapshot_json, input_hash, prompt_hash, status, output_json,
			valid_sections, invalid_sections, finished_at
		) values (
			$1, $2, $3, $4, $5, $6, 'full', 'deterministic', 'offline-test',
			'script-prompt.v2', 'script-draft.v2', $7, $8, $9, 'completed', $10,
			$11, ARRAY[]::text[], now()
		)`,
		[
			generationId,
			workspaceId,
			projectId,
			userId,
			`claim-refresh-generation-${suffix}`,
			hash(`generation-request-${suffix}`),
			{ fixture: true, label },
			hash(`generation-input-${suffix}`),
			hash(`generation-prompt-${suffix}`),
			sourceSnapshot,
			[...scriptGenerationSections],
		],
	);
	await pool.query(
		`insert into script_version (
			id, workspace_id, project_id, source_generation_id, status,
			version_number, editable_snapshot_json, revision, created_by_user_id
		) values ($1, $2, $3, $4, 'draft', null, $5, 1, $6)`,
		[
			scriptVersionId,
			workspaceId,
			projectId,
			generationId,
			sourceSnapshot,
			userId,
		],
	);
	return {
		workspaceId,
		userId,
		projectId,
		scriptVersionId,
		productId,
		generationId,
		snapshot: sourceSnapshot,
	};
}

type RunInput = Parameters<typeof createOrReuseScriptClaimRefreshRun>[0];

function makeInput(fixture: Fixture, label: string): RunInput {
	const inputSnapshotJson = {
		inputVersion: "script-claim-refresh.v1",
		scriptVersionId: fixture.scriptVersionId,
		sourceScriptRevision: 1,
		sourceContentHash: hash(`source-content-${label}`),
		projection: {
			hook: "Mở đầu nội dung.",
			voiceover: ["Thông tin được trình bày rõ ràng."],
			scenes: [{ order: 1, onScreenText: "Thông tin minh bạch." }],
			cta: "Tìm hiểu thêm.",
			caption: "Nội dung thử nghiệm.",
		},
	};
	return {
		workspaceId: fixture.workspaceId,
		projectId: fixture.projectId,
		scriptVersionId: fixture.scriptVersionId,
		sourceScriptRevision: 1,
		idempotencyKey: `claim-refresh-${label}-${randomUUID()}`,
		requestHash: hash(`request-${label}`),
		inputSnapshotJson,
		inputHash: hash(canonicalizeJson(inputSnapshotJson)),
		sourceContentHash: inputSnapshotJson.sourceContentHash,
		promptHash: hash(`prompt-${label}`),
		provider: "deterministic-test",
		model: "offline-test-model",
		promptVersion: "script-claim-refresh-prompt.v1",
		outputSchemaVersion: "script-claim-refresh-output.v1",
		createdByUserId: fixture.userId,
	};
}

const rawRunColumns = [
	"id",
	"workspace_id",
	"project_id",
	"script_version_id",
	"source_script_revision",
	"idempotency_key",
	"request_hash",
	"input_snapshot_json",
	"input_hash",
	"source_content_hash",
	"prompt_hash",
	"provider",
	"model",
	"prompt_version",
	"output_schema_version",
	"status",
	"provider_request_id",
	"input_tokens",
	"output_tokens",
	"estimated_cost_micros",
	"actual_cost_micros",
	"currency",
	"error_code",
	"error_message",
	"execution_claimed_at",
	"created_by_user_id",
	"finished_at",
	"result_script_revision",
] as const;

async function insertRawRun(
	pool: Pool,
	input: RunInput,
	overrides: Record<string, unknown> = {},
): Promise<string> {
	const values: Record<string, unknown> = {
		id: `claim-refresh-raw-${randomUUID()}`,
		workspace_id: input.workspaceId,
		project_id: input.projectId,
		script_version_id: input.scriptVersionId,
		source_script_revision: input.sourceScriptRevision,
		idempotency_key: input.idempotencyKey,
		request_hash: input.requestHash,
		input_snapshot_json: input.inputSnapshotJson,
		input_hash: input.inputHash,
		source_content_hash: input.sourceContentHash,
		prompt_hash: input.promptHash,
		provider: input.provider,
		model: input.model,
		prompt_version: input.promptVersion,
		output_schema_version: input.outputSchemaVersion,
		status: "pending",
		provider_request_id: null,
		input_tokens: null,
		output_tokens: null,
		estimated_cost_micros: null,
		actual_cost_micros: null,
		currency: null,
		error_code: null,
		error_message: null,
		execution_claimed_at: null,
		created_by_user_id: input.createdByUserId,
		finished_at: null,
		result_script_revision: null,
		...overrides,
	};
	const placeholders = rawRunColumns.map((_, index) => `$${index + 1}`);
	await pool.query(
		`insert into script_claim_refresh_run (${rawRunColumns.join(", ")}) values (${placeholders.join(", ")})`,
		rawRunColumns.map((column) => values[column]),
	);
	return String(values.id);
}

async function runPureParserChecks(): Promise<void> {
	const fixtureRecord = {
		id: "parser-run",
		workspaceId: "parser-workspace",
		projectId: "parser-project",
		scriptVersionId: "parser-script",
		sourceScriptRevision: 1,
		idempotencyKey: "parser-key",
		requestHash: hash("parser-request"),
		inputSnapshotJson: { inputVersion: "script-claim-refresh.v1" },
		inputHash: hash("parser-input"),
		sourceContentHash: hash("parser-source"),
		promptHash: hash("parser-prompt"),
		provider: "deterministic-test",
		model: "offline-test-model",
		promptVersion: "script-claim-refresh-prompt.v1",
		outputSchemaVersion: "script-claim-refresh-output.v1",
		status: "completed" as const,
		providerRequestId: null,
		inputTokens: null,
		outputTokens: null,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: null,
		errorMessage: null,
		executionClaimedAt: null,
		createdByUserId: "parser-user",
		createdAt: new Date(),
		finishedAt: new Date(),
		resultScriptRevision: 2,
	};
	parseScriptClaimRefreshRunRecord(fixtureRecord);
	for (const [label, invalid] of [
		["invalid status", { ...fixtureRecord, status: "passed" }],
		[
			"uppercase hash",
			{ ...fixtureRecord, requestHash: hash("x").toUpperCase() },
		],
		["wrong result revision", { ...fixtureRecord, resultScriptRevision: 3 }],
		["completed without finishedAt", { ...fixtureRecord, finishedAt: null }],
		["error pair", { ...fixtureRecord, errorCode: "FAIL" }],
	] as const) {
		assert(
			!scriptClaimRefreshRunRecordSchema.safeParse(invalid).success,
			`${label} must be rejected by the persisted-row parser.`,
		);
	}
	console.log("Strict persisted-row parser invalid-state matrix: PASS");
}

async function runDatabaseConstraintChecks(
	pool: Pool,
	fixture: Fixture,
): Promise<void> {
	const variants: Array<[string, Record<string, unknown>]> = [
		["invalid status", { status: "passed" }],
		["zero source revision", { source_script_revision: 0 }],
		["uppercase request hash", { request_hash: hash("upper").toUpperCase() }],
		[
			"completed without result",
			{ status: "completed", finished_at: new Date() },
		],
		["pending with finishedAt", { finished_at: new Date() }],
		["partial error pair", { error_code: "FAIL" }],
		[
			"wrong result revision",
			{
				status: "completed",
				finished_at: new Date(),
				result_script_revision: 3,
			},
		],
		["negative input tokens", { input_tokens: -1 }],
		["invalid currency", { actual_cost_micros: 1, currency: "usd" }],
		["short idempotency key", { idempotency_key: "short" }],
	];
	for (const [label, overrides] of variants) {
		const input = makeInput(fixture, `constraint-${label}`);
		await expectRejected(label, () => insertRawRun(pool, input, overrides));
	}
	console.log("Database status/hash/revision constraint matrix: PASS");
}

async function runRepositoryChecks(
	pool: Pool,
	fixture: Fixture,
): Promise<void> {
	const base = makeInput(fixture, "repository-base");
	const first = await createOrReuseScriptClaimRefreshRun(base);
	assert(first.created, "First repository call must create a pending run.");
	assertEqual(first.run.status, "pending", "New run status");
	assertEqual(first.run.finishedAt, null, "New run finishedAt");
	assertEqual(first.run.resultScriptRevision, null, "New run result revision");
	assertEqual(
		first.run.executionClaimedAt,
		null,
		"CR-A must not claim execution",
	);
	const byId = await getScriptClaimRefreshRunById({
		workspaceId: fixture.workspaceId,
		id: first.run.id,
	});
	assert(byId?.id === first.run.id, "Read by id must return the created run.");
	const byKey = await getScriptClaimRefreshRunByIdempotencyKey({
		workspaceId: fixture.workspaceId,
		idempotencyKey: base.idempotencyKey,
	});
	assert(
		byKey?.id === first.run.id,
		"Read by idempotency key must return the created run.",
	);

	const sameKey = await createOrReuseScriptClaimRefreshRun({
		...base,
		createdByUserId: fixture.userId,
	});
	assert(
		!sameKey.created && sameKey.run.id === first.run.id,
		"Same key and semantic input must reuse.",
	);

	await expectRepositoryConflict("Same key with different request", () =>
		createOrReuseScriptClaimRefreshRun({
			...base,
			requestHash: hash("same-key-different-request"),
			inputHash: hash("same-key-different-input"),
			idempotencyKey: base.idempotencyKey,
		}),
	);

	const differentKey = await createOrReuseScriptClaimRefreshRun({
		...base,
		idempotencyKey: `claim-refresh-reuse-${randomUUID()}`,
	});
	assert(
		!differentKey.created && differentKey.run.id === first.run.id,
		"Different key and same pending semantic input must reuse.",
	);

	const distinct = await createOrReuseScriptClaimRefreshRun({
		...makeInput(fixture, "repository-distinct"),
		idempotencyKey: `claim-refresh-distinct-${randomUUID()}`,
	});
	assert(
		distinct.created && distinct.run.id !== first.run.id,
		"Different semantic hashes must create a distinct run.",
	);
	await expectRejected("Cross-scope parent identity", () =>
		createOrReuseScriptClaimRefreshRun({
			...makeInput(fixture, "cross-scope"),
			workspaceId: `wrong-workspace-${randomUUID()}`,
		}),
	);

	const concurrentInput = makeInput(fixture, "repository-concurrent");
	const concurrent = await Promise.all([
		createOrReuseScriptClaimRefreshRun(concurrentInput),
		createOrReuseScriptClaimRefreshRun({
			...concurrentInput,
			idempotencyKey: `claim-refresh-concurrent-${randomUUID()}`,
		}),
	]);
	assert(
		concurrent.filter((result) => result.created).length === 1 &&
			new Set(concurrent.map((result) => result.run.id)).size === 1,
		"Concurrent same-semantic requests must produce exactly one pending run.",
	);
	console.log("Repository idempotency/reuse/concurrency matrix: PASS");

	for (const [label, status, overrides] of [
		["claimed", "pending", { execution_claimed_at: new Date() }],
		[
			"completed",
			"completed",
			{ finished_at: new Date(), result_script_revision: 2 },
		],
		[
			"failed",
			"failed",
			{
				finished_at: new Date(),
				error_code: "PROVIDER_FAILED",
				error_message: "offline fixture failure",
			},
		],
		[
			"indeterminate",
			"indeterminate",
			{
				finished_at: new Date(),
				error_code: "UNKNOWN_PROVIDER_RESULT",
				error_message: "offline fixture uncertainty",
			},
		],
	] as const) {
		const input = makeInput(fixture, `terminal-${label}`);
		const id = await insertRawRun(pool, input, { status, ...overrides });
		const run = await getScriptClaimRefreshRunById({
			workspaceId: fixture.workspaceId,
			id,
		});
		assert(
			run?.status === status,
			`${label} status must round-trip through repository parsing.`,
		);
		if (status === "completed") {
			assert(
				run.resultScriptRevision === run.sourceScriptRevision + 1,
				"Completed result revision must be source plus one.",
			);
		}
	}
	console.log(
		"Pending-claimed/completed/failed/indeterminate read matrix: PASS",
	);
}

async function runForeignKeyChecks(
	pool: Pool,
	fixture: Fixture,
): Promise<void> {
	await expectRejected("Project delete RESTRICT", () =>
		pool.query("delete from project where id = $1", [fixture.projectId]),
	);
	await expectRejected("ScriptVersion delete RESTRICT", () =>
		pool.query("delete from script_version where id = $1", [
			fixture.scriptVersionId,
		]),
	);

	const dedicatedUserId = `claim-refresh-run-user-${randomUUID()}`;
	await pool.query(
		'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
		[
			dedicatedUserId,
			"Script Claim Refresh run user",
			`${dedicatedUserId}@example.test`,
		],
	);
	const dedicatedInput = {
		...makeInput(fixture, "dedicated-run-user"),
		createdByUserId: dedicatedUserId,
	};
	await createOrReuseScriptClaimRefreshRun(dedicatedInput);
	await expectRejected("CreatedByUser delete RESTRICT", () =>
		pool.query('delete from "user" where id = $1', [dedicatedUserId]),
	);
	console.log(
		"Workspace/Project/ScriptVersion/CreatedByUser FK behavior: PASS",
	);
}

async function runWorkspaceCascadeCheck(
	pool: Pool,
	unrelated: Fixture,
): Promise<void> {
	const cascade = await seedFixture(pool, "cascade");
	const input = makeInput(cascade, "cascade-run");
	const created = await createOrReuseScriptClaimRefreshRun(input);
	const before = await pool.query<{ count: number }>(
		"select count(*)::int as count from script_claim_refresh_run where id = $1",
		[created.run.id],
	);
	assertEqual(
		before.rows[0]?.count,
		1,
		"Cascade run must exist before workspace delete",
	);
	const unrelatedBefore = await pool.query<{ projects: number; runs: number }>(
		`select
			(select count(*)::int from project where workspace_id = $1) as projects,
			(select count(*)::int from script_claim_refresh_run where workspace_id = $1) as runs`,
		[unrelated.workspaceId],
	);
	const deleted = await pool.query<{ id: string }>(
		"delete from workspace where id = $1 returning id",
		[cascade.workspaceId],
	);
	assertEqual(deleted.rows.length, 1, "Cascade workspace delete result");
	const after = await pool.query<{ count: number }>(
		"select count(*)::int as count from script_claim_refresh_run where id = $1",
		[created.run.id],
	);
	assertEqual(
		after.rows[0]?.count,
		0,
		"Workspace CASCADE must remove Script Claim Refresh run",
	);
	const unrelatedAfter = await pool.query<{ projects: number; runs: number }>(
		`select
			(select count(*)::int from project where workspace_id = $1) as projects,
			(select count(*)::int from script_claim_refresh_run where workspace_id = $1) as runs`,
		[unrelated.workspaceId],
	);
	assert(
		unrelatedAfter.rows[0]?.projects === unrelatedBefore.rows[0]?.projects &&
			unrelatedAfter.rows[0]?.runs === unrelatedBefore.rows[0]?.runs,
		"Workspace CASCADE must preserve unrelated fixtures.",
	);
	console.log(
		"Workspace CASCADE removes refresh run and preserves unrelated fixture: PASS",
	);
}

async function runSchemaIntrospectionChecks(pool: Pool): Promise<void> {
	const columns = await pool.query<{
		columnName: string;
		isNullable: string;
	}>(
		`select column_name as "columnName", is_nullable as "isNullable"
		 from information_schema.columns
		 where table_schema = 'public' and table_name = 'script_claim_refresh_run'
		 order by ordinal_position`,
	);
	const byName = new Map(
		columns.rows.map((row) => [row.columnName, row.isNullable]),
	);
	for (const name of [
		"workspace_id",
		"project_id",
		"script_version_id",
		"source_script_revision",
		"idempotency_key",
		"request_hash",
		"input_snapshot_json",
		"input_hash",
		"source_content_hash",
		"prompt_hash",
		"provider",
		"model",
		"prompt_version",
		"output_schema_version",
		"status",
		"created_by_user_id",
	]) {
		assertEqual(byName.get(name), "NO", `${name} must be NOT NULL`);
	}
	const constraints = await pool.query<{
		constraintName: string;
		deleteRule: string;
	}>(
		`select tc.constraint_name as "constraintName", rc.delete_rule as "deleteRule"
		 from information_schema.table_constraints tc
		 join information_schema.referential_constraints rc
		   on rc.constraint_schema = tc.constraint_schema
		  and rc.constraint_name = tc.constraint_name
		 where tc.table_schema = 'public' and tc.table_name = 'script_claim_refresh_run'
		 order by tc.constraint_name`,
	);
	const rules = new Map(
		constraints.rows.map((row) => [row.constraintName, row.deleteRule]),
	);
	assert(
		[...rules.values()].includes("CASCADE") &&
			[...rules.values()].filter((rule) => rule === "RESTRICT").length >= 3,
		"Refresh run must retain workspace CASCADE and Project/ScriptVersion/User RESTRICT FKs.",
	);
	const indexes = await pool.query<{ indexName: string }>(
		`select indexname as "indexName" from pg_indexes
		 where schemaname = 'public' and tablename = 'script_claim_refresh_run'`,
	);
	const indexNames = new Set(indexes.rows.map((row) => row.indexName));
	for (const name of [
		"script_claim_refresh_idempotency_unique",
		"script_claim_refresh_pending_semantic_unique",
		"script_claim_refresh_project_history_idx",
		"script_claim_refresh_script_history_idx",
	]) {
		assert(indexNames.has(name), `${name} must be present.`);
	}
	console.log("Script Claim Refresh schema constraints/FKs/indexes: PASS");
}

const pool = createNodePostgresPool(authority.url);
try {
	const identity = await pool.query<{
		database: string;
		user: string;
		schema: string;
	}>(
		"select current_database() as database, current_user as user, current_schema() as schema",
	);
	console.log(
		`Disposable identity: database=${identity.rows[0]?.database}; host=${authority.host}; schema=${identity.rows[0]?.schema}; user=${identity.rows[0]?.user}`,
	);

	await runPureParserChecks();
	const through0020 = await migrationFolderThrough(20);
	await resetDatabase(pool);
	await migrate(drizzle(pool), { migrationsFolder: through0020 });
	assertEqual(await migrationCount(pool), 21, "Migration count through 0020");
	const beforeTables = await publicTables(pool);
	assert(
		!beforeTables.includes("script_claim_refresh_run"),
		"CR-A table must be absent before 0021.",
	);
	await migrate(drizzle(pool), { migrationsFolder: migrationsRoot });
	assertEqual(await migrationCount(pool), 22, "Migration count after 0021");
	const afterTables = await publicTables(pool);
	assert(
		afterTables.includes("script_claim_refresh_run") &&
			JSON.stringify(beforeTables) ===
				JSON.stringify(
					afterTables.filter((table) => table !== "script_claim_refresh_run"),
				),
		"0021 must add only script_claim_refresh_run among public tables.",
	);
	console.log("Migration 0020 -> 0021 and additive table evidence: PASS");
	await runSchemaIntrospectionChecks(pool);

	const fixture = await seedFixture(pool, "repository");
	const unrelated = await seedFixture(pool, "unrelated");
	await runDatabaseConstraintChecks(pool, fixture);
	await runRepositoryChecks(pool, fixture);
	await runForeignKeyChecks(pool, fixture);
	await runWorkspaceCascadeCheck(pool, unrelated);
	console.log(
		"Script Claim Refresh persistence/repository acceptance matrix: PASS",
	);
} finally {
	await pool.end();
	for (const folder of temporaryFolders) {
		await rm(folder, { recursive: true, force: true });
	}
}

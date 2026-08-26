import { randomUUID } from "node:crypto";
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
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireClaimManifestTestDatabaseAuthority } from "./claim-manifest-test-database-authority.ts";

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

type Fixtures = {
	workspaceId: string;
	secondWorkspaceId: string;
	userId: string;
	secondUserId: string;
	productId: string;
	projectId: string;
	secondProjectId: string;
	generationId: string;
	secondGenerationId: string;
	scriptVersionId: string;
	secondScriptVersionId: string;
	legacyPendingId: string;
	legacyPassedId: string;
	legacyClaimId: string;
	manifestId: string;
	secondManifestId: string;
	manifestFingerprint: string;
	secondManifestFingerprint: string;
	legacyRequestHash: string;
	manifestRequestHash: string;
	changedManifestRequestHash: string;
};

type PostMigrationRun = {
	id: string;
	workspaceId: string;
	projectId: string;
	scriptVersionId: string | null;
	sourceScriptRevision: number | null;
	inputMode: string | null;
	claimManifestId: string | null;
	claimManifestFingerprint: string | null;
	idempotencyKey: string;
	requestHash: string;
	status: "pending" | "passed";
	finishedAt: string | null;
	createdByUserId: string;
};

const authority = requireClaimManifestTestDatabaseAuthority();
const migrationsRoot = resolve("packages/db/src/migrations");
const temporaryFolders: string[] = [];

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function migrationFolderThrough(lastIndex: number): Promise<string> {
	const journal = JSON.parse(
		await readFile(join(migrationsRoot, "meta", "_journal.json"), "utf8"),
	) as Journal;
	const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
	assert(
		entries.length === lastIndex + 1,
		`Expected migrations 0000-${String(lastIndex).padStart(4, "0")}.`,
	);
	const folder = await mkdtemp(join(tmpdir(), "affichannel-us18b-"));
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

async function tableColumns(pool: Pool): Promise<unknown[]> {
	const result = await pool.query(
		`select table_name as "tableName", column_name as "columnName",
				is_nullable as "isNullable", data_type as "dataType"
		 from information_schema.columns
		 where table_schema = 'public'
		 order by table_name, ordinal_position`,
	);
	return result.rows;
}

function suffix(): string {
	return randomUUID().replaceAll("-", "");
}

function hashes() {
	return {
		legacy: "1".repeat(64),
		manifest: "2".repeat(64),
		changed: "3".repeat(64),
		input: "4".repeat(64),
		prompt: "5".repeat(64),
	};
}

async function seedLegacyGraph(pool: Pool): Promise<Fixtures> {
	const id = suffix();
	const fixtures: Fixtures = {
		workspaceId: `us18b-workspace-${id}`,
		secondWorkspaceId: `us18b-workspace-second-${id}`,
		userId: `us18b-user-${id}`,
		secondUserId: `us18b-user-second-${id}`,
		productId: `us18b-product-${id}`,
		projectId: `us18b-project-${id}`,
		secondProjectId: `us18b-project-second-${id}`,
		generationId: `us18b-generation-${id}`,
		secondGenerationId: `us18b-generation-second-${id}`,
		scriptVersionId: `us18b-script-${id}`,
		secondScriptVersionId: `us18b-script-second-${id}`,
		legacyPendingId: `us18b-legacy-pending-${id}`,
		legacyPassedId: `us18b-legacy-passed-${id}`,
		legacyClaimId: `us18b-legacy-claim-${id}`,
		manifestId: `us18b-manifest-${id}`,
		secondManifestId: `us18b-manifest-second-${id}`,
		manifestFingerprint: "a".repeat(64),
		secondManifestFingerprint: "b".repeat(64),
		legacyRequestHash: hashes().legacy,
		manifestRequestHash: hashes().manifest,
		changedManifestRequestHash: hashes().changed,
	};

	for (const [workspaceId, userId, label] of [
		[fixtures.workspaceId, fixtures.userId, "primary"],
		[fixtures.secondWorkspaceId, fixtures.secondUserId, "second"],
	] as const) {
		await pool.query("insert into workspace (id, name) values ($1, $2)", [
			workspaceId,
			`AFF-US-018 ${label}`,
		]);
		await pool.query(
			'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
			[userId, `AFF-US-018 ${label}`, `${userId}@example.test`],
		);
	}
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, 'US18B Product', $3)",
		[fixtures.productId, fixtures.workspaceId, fixtures.userId],
	);
	for (const [projectId, workspaceId, userId] of [
		[fixtures.projectId, fixtures.workspaceId, fixtures.userId],
		[
			fixtures.secondProjectId,
			fixtures.secondWorkspaceId,
			fixtures.secondUserId,
		],
	] as const) {
		await pool.query(
			`insert into project (
				id, workspace_id, name, product_id, content_type, creation_path,
				content_format_key, content_format_version, current_step_key,
				created_by_user_id
			) values ($1, $2, $3, $4, 'AFFILIATE', 'SCRIPTED', 'SCRIPTED_STANDARD', 1, 'fact-lock', $5)`,
			[
				projectId,
				workspaceId,
				`AFF-US-018 ${projectId}`,
				fixtures.productId,
				userId,
			],
		);
	}
	for (const [generationId, projectId, workspaceId, userId, label] of [
		[
			fixtures.generationId,
			fixtures.projectId,
			fixtures.workspaceId,
			fixtures.userId,
			"primary",
		],
		[
			fixtures.secondGenerationId,
			fixtures.secondProjectId,
			fixtures.secondWorkspaceId,
			fixtures.secondUserId,
			"second",
		],
	] as const) {
		await pool.query(
			`insert into script_generation (
				id, workspace_id, project_id, created_by_user_id, idempotency_key,
				request_hash, mode, provider, model, prompt_version,
				output_schema_version, input_snapshot_json, input_hash, prompt_hash, status
			) values ($1, $2, $3, $4, $5, $6, 'full', 'deterministic', 'test-model',
				'test-prompt-v1', 'test-output-v1', '{}'::jsonb, $7, $8, 'pending')`,
			[
				generationId,
				workspaceId,
				projectId,
				userId,
				`us18b-generation-${label}-${id}`,
				hashes().input,
				hashes().input,
				hashes().prompt,
			],
		);
	}
	for (const [
		scriptVersionId,
		projectId,
		generationId,
		workspaceId,
		userId,
	] of [
		[
			fixtures.scriptVersionId,
			fixtures.projectId,
			fixtures.generationId,
			fixtures.workspaceId,
			fixtures.userId,
		],
		[
			fixtures.secondScriptVersionId,
			fixtures.secondProjectId,
			fixtures.secondGenerationId,
			fixtures.secondWorkspaceId,
			fixtures.secondUserId,
		],
	] as const) {
		await pool.query(
			`insert into script_version (
				id, workspace_id, project_id, source_generation_id, status,
				editable_snapshot_json, revision, created_by_user_id
			) values ($1, $2, $3, $4, 'draft', '{}'::jsonb, 7, $5)`,
			[scriptVersionId, workspaceId, projectId, generationId, userId],
		);
	}

	const insertLegacyRun = async (
		runId: string,
		status: "pending" | "passed",
		idempotencyKey: string,
		requestHash: string,
	) => {
		await pool.query(
			`insert into fact_lock_run (
				id, workspace_id, project_id, script_version_id, source_script_revision,
				idempotency_key, request_hash, input_snapshot_json, input_hash, prompt_hash,
				provider, model, prompt_version, output_schema_version, status,
				created_by_user_id, finished_at
			) values ($1, $2, $3, $4, 7, $5, $6, '{}'::jsonb, $7, $8,
				'deterministic', 'test-model', 'test-prompt-v1', 'test-output-v1', $9, $10, $11)`,
			[
				runId,
				fixtures.workspaceId,
				fixtures.projectId,
				fixtures.scriptVersionId,
				idempotencyKey,
				requestHash,
				hashes().input,
				hashes().prompt,
				status,
				fixtures.userId,
				status === "pending" ? null : "2026-08-26T00:00:00.000Z",
			],
		);
	};
	await insertLegacyRun(
		fixtures.legacyPendingId,
		"pending",
		`us18b-legacy-pending-${id}`,
		fixtures.legacyRequestHash,
	);
	await insertLegacyRun(
		fixtures.legacyPassedId,
		"passed",
		`us18b-legacy-passed-${id}`,
		"6".repeat(64),
	);
	await pool.query(
		`insert into fact_lock_claim (
			id, workspace_id, run_id, claim_key, claim_text, occurrence_json,
			classification_status, review_status, reason, confidence, checked_at
		) values ($1, $2, $3, 'claim_legacy', 'Legacy claim',
			'{"section":"hook","hookKey":"hook-a"}'::jsonb,
			'SUPPORTED', 'AUTO_PASSED', 'Legacy fixture', 0.9, now())`,
		[fixtures.legacyClaimId, fixtures.workspaceId, fixtures.legacyPassedId],
	);
	return fixtures;
}

async function seedManifests(pool: Pool, fixtures: Fixtures): Promise<void> {
	await pool.query(
		`insert into claim_manifest (
			id, workspace_id, project_id, source_type, source_script_version_id,
			source_script_revision, source_snapshot_json, source_content_hash,
			product_id, schema_version, builder_version, claims_json, claim_count,
			is_empty, fingerprint, created_by_user_id
		) values ($1, $2, $3, 'SCRIPT_VERSION', $4, 7,
			$5::jsonb, $6, $7, 'claim-manifest.v1', 'claim-manifest-builder.v1',
			'[]'::jsonb, 0, true, $8, $9)`,
		[
			fixtures.manifestId,
			fixtures.workspaceId,
			fixtures.projectId,
			fixtures.scriptVersionId,
			JSON.stringify({
				sourceType: "SCRIPT_VERSION",
				scriptVersionId: fixtures.scriptVersionId,
				scriptVersionRevision: 7,
				claimsSourceRevision: 1,
				sourceContentHash: "c".repeat(64),
			}),
			"c".repeat(64),
			fixtures.productId,
			fixtures.manifestFingerprint,
			fixtures.userId,
		],
	);
	await pool.query(
		`insert into claim_manifest (
			id, workspace_id, project_id, source_type, source_snapshot_json,
			source_content_hash, schema_version, builder_version, claims_json,
			claim_count, is_empty, fingerprint, created_by_user_id
		) values ($1, $2, $3, 'NO_SCRIPT', $4::jsonb, $5,
			'claim-manifest.v1', 'claim-manifest-builder.v1', '[]'::jsonb,
			0, true, $6, $7)`,
		[
			fixtures.secondManifestId,
			fixtures.secondWorkspaceId,
			fixtures.secondProjectId,
			JSON.stringify({
				sourceType: "NO_SCRIPT",
				sourceSchemaVersion: "no-script.v1",
				sourceRevision: "1",
				elements: [],
			}),
			"d".repeat(64),
			fixtures.secondManifestFingerprint,
			fixtures.secondUserId,
		],
	);
}

function postRun(
	fixtures: Fixtures,
	overrides: Partial<PostMigrationRun> = {},
): PostMigrationRun {
	return {
		id: `us18b-run-${suffix()}`,
		workspaceId: fixtures.workspaceId,
		projectId: fixtures.projectId,
		scriptVersionId: fixtures.scriptVersionId,
		sourceScriptRevision: 7,
		inputMode: "MANIFEST_V1",
		claimManifestId: fixtures.manifestId,
		claimManifestFingerprint: fixtures.manifestFingerprint,
		idempotencyKey: `us18b-idempotency-${suffix()}`,
		requestHash: fixtures.manifestRequestHash,
		status: "passed",
		finishedAt: "2026-08-26T00:00:00.000Z",
		createdByUserId: fixtures.userId,
		...overrides,
	};
}

async function insertPostMigrationRun(
	pool: Pool,
	run: PostMigrationRun,
): Promise<void> {
	await pool.query(
		`insert into fact_lock_run (
			id, workspace_id, project_id, script_version_id, source_script_revision,
			input_mode, claim_manifest_id, claim_manifest_fingerprint,
			idempotency_key, request_hash, input_snapshot_json, input_hash, prompt_hash,
			provider, model, prompt_version, output_schema_version, status,
			created_by_user_id, finished_at
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}'::jsonb,
			$11, $12, 'deterministic', 'test-model', 'test-prompt-v1',
			'test-output-v1', $13, $14, $15)`,
		[
			run.id,
			run.workspaceId,
			run.projectId,
			run.scriptVersionId,
			run.sourceScriptRevision,
			run.inputMode,
			run.claimManifestId,
			run.claimManifestFingerprint,
			run.idempotencyKey,
			run.requestHash,
			hashes().input,
			hashes().prompt,
			run.status,
			run.createdByUserId,
			run.finishedAt,
		],
	);
}

async function expectRejected(
	label: string,
	action: () => Promise<unknown>,
): Promise<void> {
	try {
		await action();
	} catch {
		console.log(`${label}: REJECTED`);
		return;
	}
	throw new Error(`${label}: expected rejection.`);
}

async function assertLegacyRowsPreserved(
	pool: Pool,
	fixtures: Fixtures,
	beforeRows: unknown,
	beforeClaim: unknown,
): Promise<void> {
	const afterRows = await pool.query(
		`select id, status, script_version_id as "scriptVersionId",
			source_script_revision as "sourceScriptRevision", request_hash as "requestHash",
			input_snapshot_json as "inputSnapshotJson"
		 from fact_lock_run where id in ($1, $2) order by id`,
		[fixtures.legacyPendingId, fixtures.legacyPassedId],
	);
	assert(
		JSON.stringify(beforeRows) === JSON.stringify(afterRows.rows),
		"Legacy FactLockRun rows changed across migration 0020.",
	);
	const legacyShape = await pool.query(
		`select input_mode as "inputMode", claim_manifest_id as "claimManifestId",
			claim_manifest_fingerprint as "claimManifestFingerprint"
		 from fact_lock_run where id in ($1, $2)`,
		[fixtures.legacyPendingId, fixtures.legacyPassedId],
	);
	assert(
		legacyShape.rows.every(
			(row) =>
				row.inputMode === null &&
				row.claimManifestId === null &&
				row.claimManifestFingerprint === null,
		),
		"Legacy FactLockRun rows received Manifest fields.",
	);
	const afterClaim = await pool.query(
		`select id, run_id as "runId", claim_key as "claimKey", claim_text as "claimText",
			classification_status as "classificationStatus", review_status as "reviewStatus"
		 from fact_lock_claim where id = $1`,
		[fixtures.legacyClaimId],
	);
	assert(
		JSON.stringify(beforeClaim) === JSON.stringify(afterClaim.rows),
		"Legacy FactLockClaim data changed across migration 0020.",
	);
	console.log(
		"Legacy pending/completed FactLockRun and FactLockClaim rows preserved: PASS",
	);
}

async function assertConstraintAndIndexMatrix(pool: Pool): Promise<void> {
	const constraints = await pool.query<{ name: string; definition: string }>(
		`select conname as name, pg_get_constraintdef(oid) as definition
		 from pg_constraint where conrelid = 'public.fact_lock_run'::regclass`,
	);
	const constraintNames = new Set(constraints.rows.map((row) => row.name));
	for (const name of [
		"fact_lock_run_input_mode_check",
		"fact_lock_run_script_provenance_pair_check",
		"fact_lock_run_mode_shape_check",
		"fact_lock_run_manifest_fingerprint_check",
		"fact_lock_run_claim_manifest_id_claim_manifest_id_fk",
	]) {
		assert(
			constraintNames.has(name),
			`Missing FactLockRun constraint ${name}.`,
		);
	}
	const manifestFk = constraints.rows.find(
		(row) =>
			row.name === "fact_lock_run_claim_manifest_id_claim_manifest_id_fk",
	);
	assert(
		manifestFk?.definition.toLowerCase().includes("on delete restrict"),
		"Manifest FK must be ON DELETE RESTRICT.",
	);

	const indexes = await pool.query<{ name: string; definition: string }>(
		`select indexname as name, indexdef as definition from pg_indexes
		 where schemaname = 'public' and tablename = 'fact_lock_run'`,
	);
	const indexByName = new Map(
		indexes.rows.map((row) => [row.name, row.definition]),
	);
	const legacyIndex = indexByName.get("fact_lock_run_pending_scope_unique");
	const manifestIndex = indexByName.get(
		"fact_lock_run_manifest_pending_scope_unique",
	);
	assert(
		legacyIndex?.includes("source_script_revision"),
		"Legacy pending index shape missing.",
	);
	assert(
		legacyIndex?.includes("input_mode") && legacyIndex.includes("IS NULL"),
		"Legacy pending index is not mode-scoped.",
	);
	assert(
		manifestIndex?.includes("request_hash"),
		"Manifest pending index must use request_hash.",
	);
	assert(
		manifestIndex.includes("MANIFEST_V1"),
		"Manifest pending index is not mode-scoped.",
	);
	assert(
		indexByName.has("fact_lock_run_claim_manifest_idx"),
		"Manifest lookup index missing.",
	);
	console.log("FactLockRun mode checks, FK and pending indexes: PASS");
}

async function runInvalidFixtureMatrix(
	pool: Pool,
	fixtures: Fixtures,
): Promise<void> {
	const invalidCases: Array<[string, Partial<PostMigrationRun>]> = [
		["unknown input_mode", { inputMode: "FUTURE_MODE" }],
		[
			"legacy Manifest ID populated",
			{ inputMode: null, claimManifestId: fixtures.manifestId },
		],
		[
			"legacy Manifest fingerprint populated",
			{ inputMode: null, claimManifestFingerprint: "a".repeat(64) },
		],
		[
			"legacy ScriptVersion ID missing",
			{ inputMode: null, scriptVersionId: null },
		],
		[
			"legacy source revision missing",
			{ inputMode: null, sourceScriptRevision: null },
		],
		["Manifest ID missing", { claimManifestId: null }],
		["Manifest fingerprint missing", { claimManifestFingerprint: null }],
		[
			"Manifest malformed fingerprint",
			{ claimManifestFingerprint: "Z".repeat(64) },
		],
		[
			"partial Script provenance ID only",
			{ scriptVersionId: fixtures.scriptVersionId, sourceScriptRevision: null },
		],
		[
			"partial Script provenance revision only",
			{ scriptVersionId: null, sourceScriptRevision: 7 },
		],
		["source revision zero", { sourceScriptRevision: 0 }],
		[
			"unknown Manifest FK",
			{ claimManifestId: `missing-manifest-${suffix()}` },
		],
	];
	for (const [label, overrides] of invalidCases) {
		await expectRejected(label, () =>
			insertPostMigrationRun(pool, postRun(fixtures, overrides)),
		);
	}
	console.log("Invalid FactLockRun fixture matrix: PASS");
}

async function runPendingMatrix(pool: Pool, fixtures: Fixtures): Promise<void> {
	const manifestPending = postRun(fixtures, {
		status: "pending",
		finishedAt: null,
		idempotencyKey: `us18b-manifest-pending-${suffix()}`,
	});
	await insertPostMigrationRun(pool, manifestPending);
	await expectRejected("duplicate legacy pending semantic key", () =>
		insertPostMigrationRun(
			pool,
			postRun(fixtures, {
				inputMode: null,
				claimManifestId: null,
				claimManifestFingerprint: null,
				status: "pending",
				finishedAt: null,
				idempotencyKey: `us18b-legacy-duplicate-${suffix()}`,
				requestHash: "7".repeat(64),
			}),
		),
	);
	await expectRejected("duplicate MANIFEST_V1 pending requestHash", () =>
		insertPostMigrationRun(
			pool,
			postRun(fixtures, {
				status: "pending",
				finishedAt: null,
				idempotencyKey: `us18b-manifest-duplicate-${suffix()}`,
			}),
		),
	);
	await insertPostMigrationRun(
		pool,
		postRun(fixtures, {
			status: "pending",
			finishedAt: null,
			requestHash: fixtures.changedManifestRequestHash,
			idempotencyKey: `us18b-manifest-changed-${suffix()}`,
		}),
	);
	await insertPostMigrationRun(
		pool,
		postRun(fixtures, {
			workspaceId: fixtures.secondWorkspaceId,
			projectId: fixtures.secondProjectId,
			createdByUserId: fixtures.secondUserId,
			scriptVersionId: null,
			sourceScriptRevision: null,
			claimManifestId: fixtures.secondManifestId,
			claimManifestFingerprint: fixtures.secondManifestFingerprint,
			status: "pending",
			finishedAt: null,
			requestHash: fixtures.manifestRequestHash,
			idempotencyKey: `us18b-manifest-other-scope-${suffix()}`,
		}),
	);
	console.log(
		"Legacy/Manifest pending coexistence, changed requestHash and scoped uniqueness: PASS",
	);
}

async function main(): Promise<void> {
	const pool = createNodePostgresPool(authority.url);
	try {
		console.log(
			`Disposable identity: host=${authority.host}; database=local; schema=public`,
		);
		const through0019 = await migrationFolderThrough(19);
		await resetDatabase(pool);
		await migrate(drizzle(pool), { migrationsFolder: through0019 });
		assert(
			(await migrationCount(pool)) === 20,
			"Expected migration count 20 before 0020.",
		);
		const tablesBefore = await publicTables(pool);
		const columnsBefore = await tableColumns(pool);
		const fixtures = await seedLegacyGraph(pool);
		const legacyRowsBefore = await pool.query(
			`select id, status, script_version_id as "scriptVersionId",
				source_script_revision as "sourceScriptRevision", request_hash as "requestHash",
				input_snapshot_json as "inputSnapshotJson"
			 from fact_lock_run where id in ($1, $2) order by id`,
			[fixtures.legacyPendingId, fixtures.legacyPassedId],
		);
		const legacyClaimBefore = await pool.query(
			`select id, run_id as "runId", claim_key as "claimKey", claim_text as "claimText",
				classification_status as "classificationStatus", review_status as "reviewStatus"
			 from fact_lock_claim where id = $1`,
			[fixtures.legacyClaimId],
		);

		await migrate(drizzle(pool), { migrationsFolder: migrationsRoot });
		assert(
			(await migrationCount(pool)) === 21,
			"Expected migration count 21 after 0020.",
		);
		const tablesAfter = await publicTables(pool);
		const columnsAfter = await tableColumns(pool);
		assert(
			JSON.stringify(tablesBefore) === JSON.stringify(tablesAfter),
			"Migration 0020 changed the public table set.",
		);
		const unrelatedBefore = columnsBefore.filter(
			(row) => (row as { tableName: string }).tableName !== "fact_lock_run",
		);
		const unrelatedAfter = columnsAfter.filter(
			(row) => (row as { tableName: string }).tableName !== "fact_lock_run",
		);
		assert(
			JSON.stringify(unrelatedBefore) === JSON.stringify(unrelatedAfter),
			"Migration 0020 changed an unrelated table shape.",
		);
		console.log("Migration history 20 → 21; no unrelated schema drift: PASS");

		await assertLegacyRowsPreserved(
			pool,
			fixtures,
			legacyRowsBefore.rows,
			legacyClaimBefore.rows,
		);
		await seedManifests(pool, fixtures);
		await assertConstraintAndIndexMatrix(pool);

		await insertPostMigrationRun(
			pool,
			postRun(fixtures, {
				id: `us18b-manifest-completed-${suffix()}`,
				status: "passed",
				finishedAt: "2026-08-26T00:00:00.000Z",
				idempotencyKey: `us18b-manifest-completed-${suffix()}`,
			}),
		);
		await insertPostMigrationRun(
			pool,
			postRun(fixtures, {
				id: `us18b-manifest-no-script-schema-${suffix()}`,
				workspaceId: fixtures.secondWorkspaceId,
				projectId: fixtures.secondProjectId,
				createdByUserId: fixtures.secondUserId,
				scriptVersionId: null,
				sourceScriptRevision: null,
				claimManifestId: fixtures.secondManifestId,
				claimManifestFingerprint: fixtures.secondManifestFingerprint,
				requestHash: "8".repeat(64),
				idempotencyKey: `us18b-manifest-no-script-schema-${suffix()}`,
			}),
		);
		console.log("Valid legacy and MANIFEST_V1 row shapes: PASS");

		await runInvalidFixtureMatrix(pool, fixtures);
		await runPendingMatrix(pool, fixtures);
		await expectRejected("referenced Manifest delete RESTRICT", () =>
			pool.query("delete from claim_manifest where id = $1", [
				fixtures.manifestId,
			]),
		);
		const manifestStillExists = await pool.query(
			"select count(*)::int as count from claim_manifest where id = $1",
			[fixtures.manifestId],
		);
		assert(
			manifestStillExists.rows[0]?.count === 1,
			"Referenced Manifest was deleted.",
		);
		console.log("Manifest FK delete RESTRICT: PASS");
		console.log(
			"AFF-US-018 Phase 18B persistence migration/constraint checks: PASS",
		);
	} finally {
		await pool.end();
		for (const folder of temporaryFolders)
			await rm(folder, { recursive: true, force: true });
	}
}

await main();

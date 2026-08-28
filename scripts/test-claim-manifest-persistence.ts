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
import type {
	BuiltClaimManifest,
	ClaimManifestClaim,
	ClaimManifestSource,
	ScriptVersionEditableSnapshot,
} from "@affichannel/core";
import {
	buildClaimManifestFromScriptVersion,
	CLAIM_MANIFEST_BUILDER_VERSION,
	CLAIM_MANIFEST_SCHEMA_VERSION,
	claimManifestFingerprint,
	scriptGenerationSections,
	validateBuiltClaimManifest,
} from "@affichannel/core";
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

const authority = requireClaimManifestTestDatabaseAuthority();
const migrationsRoot = resolve("packages/db/src/migrations");
const temporaryFolders: string[] = [];
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
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
	throw new Error(`${label}: expected database rejection.`);
}

async function migrationFolderThrough(lastIndex: number): Promise<string> {
	const journal = JSON.parse(
		await readFile(join(migrationsRoot, "meta", "_journal.json"), "utf8"),
	) as Journal;
	const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
	assert(
		entries.length === lastIndex + 1,
		`Expected migrations 0000-${lastIndex}.`,
	);
	const folder = await mkdtemp(
		join(tmpdir(), `affichannel-claim-manifest-${lastIndex}-`),
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

function snapshot(): ScriptVersionEditableSnapshot {
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-a", text: "Pin dùng liên tục 20 giờ." },
			{ key: "hook-b", text: "Một lựa chọn âm thanh gọn nhẹ." },
			{ key: "hook-c", text: "Trải nghiệm nghe nhạc mỗi ngày." },
		],
		selectedHookKey: "hook-a",
		voiceoverSegments: [
			{ key: "voice-a", text: "Tai nghe hỗ trợ chống ồn chủ động." },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 15,
				visualDirection: "Cận cảnh sản phẩm",
				onScreenText: "Bảo hành chính hãng 12 tháng.",
				voiceoverSegmentKeys: ["voice-a"],
			},
		],
		cta: { text: "Mua ngay hôm nay." },
		caption: "Giá niêm yết 990.000đ.",
		hashtags: ["#tainghe"],
		disclosure: "Nội dung có liên kết affiliate.",
		claims: [
			{
				text: "Pin dùng liên tục 20 giờ",
				occurrence: { section: "hook", hookKey: "hook-a" },
			},
		],
		claimsSourceRevision: 1,
		claimsStatus: "current",
	};
}

type Owners = {
	workspaceId: string;
	userId: string;
	productId: string;
	projectId: string;
	productlessProjectId: string;
	generationId: string;
	scriptVersionId: string;
};

async function seedOwners(pool: Pool): Promise<Owners> {
	const suffix = randomUUID();
	const workspaceId = `claim-manifest-workspace-${suffix}`;
	const userId = `claim-manifest-user-${suffix}`;
	const productId = `claim-manifest-product-${suffix}`;
	const projectId = `claim-manifest-project-${suffix}`;
	const productlessProjectId = `claim-manifest-productless-${suffix}`;
	const generationId = `claim-manifest-generation-${suffix}`;
	const scriptVersionId = `claim-manifest-script-${suffix}`;
	const sourceSnapshot = snapshot();

	await pool.query(
		"insert into workspace (id, name) values ($1, 'ClaimManifest test')",
		[workspaceId],
	);
	await pool.query(
		'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
		[userId, "ClaimManifest test", `${userId}@example.test`],
	);
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, 'ClaimManifest product', $3)",
		[productId, workspaceId, userId],
	);
	for (const [id, linkedProduct] of [
		[projectId, productId],
		[productlessProjectId, null],
	] as const) {
		await pool.query(
			`insert into project (
				id, workspace_id, name, product_id, content_type, creation_path,
				content_format_key, content_format_version, current_step_key, created_by_user_id
			) values ($1, $2, 'ClaimManifest project', $3, 'AFFILIATE', 'SCRIPTED',
				'SCRIPTED_STANDARD', 1, 'content', $4)`,
			[id, workspaceId, linkedProduct, userId],
		);
	}
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
			`claim-manifest-${suffix}`,
			hash(`request-${suffix}`),
			JSON.stringify({ fixture: true }),
			hash(`input-${suffix}`),
			hash(`prompt-${suffix}`),
			JSON.stringify(sourceSnapshot),
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
			JSON.stringify(sourceSnapshot),
			userId,
		],
	);
	return {
		workspaceId,
		userId,
		productId,
		projectId,
		productlessProjectId,
		generationId,
		scriptVersionId,
	};
}

function manifestValues(
	manifest: BuiltClaimManifest,
	owners: Owners,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: `claim-manifest-${randomUUID()}`,
		workspace_id: manifest.workspaceId,
		project_id: manifest.projectId,
		source_type: manifest.source.sourceType,
		source_script_version_id:
			manifest.source.sourceType === "SCRIPT_VERSION"
				? manifest.source.scriptVersionId
				: null,
		source_script_revision:
			manifest.source.sourceType === "SCRIPT_VERSION"
				? manifest.source.scriptVersionRevision
				: null,
		source_snapshot_json: manifest.source,
		source_content_hash: manifest.source.sourceContentHash,
		product_id: manifest.productId,
		schema_version: manifest.schemaVersion,
		builder_version: manifest.builderVersion,
		claims_json: manifest.claims,
		claim_count: manifest.claimCount,
		is_empty: manifest.isEmpty,
		fingerprint: manifest.fingerprint,
		created_by_user_id: owners.userId,
		...overrides,
	};
}

const insertColumns = [
	"id",
	"workspace_id",
	"project_id",
	"source_type",
	"source_script_version_id",
	"source_script_revision",
	"source_snapshot_json",
	"source_content_hash",
	"product_id",
	"schema_version",
	"builder_version",
	"claims_json",
	"claim_count",
	"is_empty",
	"fingerprint",
	"created_by_user_id",
] as const;

async function insertManifest(
	pool: Pool,
	values: Record<string, unknown>,
): Promise<string> {
	const parameters = insertColumns.map((column) =>
		column === "source_snapshot_json" || column === "claims_json"
			? JSON.stringify(values[column])
			: values[column],
	);
	const placeholders = insertColumns.map((_, index) => `$${index + 1}`);
	const result = await pool.query<{ id: string }>(
		`insert into claim_manifest (${insertColumns.join(", ")})
		 values (${placeholders.join(", ")}) returning id`,
		parameters,
	);
	const id = result.rows[0]?.id;
	assert(id, "ClaimManifest insert did not return an ID.");
	return id;
}

async function noScriptManifest(
	workspaceId: string,
	projectId: string,
	productId: string | null,
): Promise<BuiltClaimManifest> {
	const source: ClaimManifestSource = {
		sourceType: "NO_SCRIPT",
		sourceSchemaVersion: "composition.v1",
		sourceRevision: "revision-1",
		elements: [],
		sourceContentHash: hash("no-script-source"),
	};
	const claims: ClaimManifestClaim[] = [];
	return {
		workspaceId,
		projectId,
		source,
		productId,
		schemaVersion: CLAIM_MANIFEST_SCHEMA_VERSION,
		builderVersion: CLAIM_MANIFEST_BUILDER_VERSION,
		claims,
		claimCount: 0,
		isEmpty: true,
		fingerprint: await claimManifestFingerprint({
			workspaceId,
			projectId,
			source,
			productId,
			claims,
		}),
	};
}

async function assertSchema(pool: Pool): Promise<void> {
	const columns = await pool.query<{
		columnName: string;
		dataType: string;
		nullable: string;
		defaultValue: string | null;
	}>(
		`select column_name as "columnName", data_type as "dataType",
			is_nullable as nullable, column_default as "defaultValue"
		 from information_schema.columns
		 where table_schema = 'public' and table_name = 'claim_manifest'
		 order by ordinal_position`,
	);
	assert(
		columns.rows.length === 17,
		"claim_manifest must have exactly 17 columns.",
	);
	const expectedTypes = new Map([
		["id", "text"],
		["workspace_id", "text"],
		["project_id", "text"],
		["source_type", "text"],
		["source_script_version_id", "text"],
		["source_script_revision", "integer"],
		["source_snapshot_json", "jsonb"],
		["source_content_hash", "text"],
		["product_id", "text"],
		["schema_version", "text"],
		["builder_version", "text"],
		["claims_json", "jsonb"],
		["claim_count", "integer"],
		["is_empty", "boolean"],
		["fingerprint", "text"],
		["created_by_user_id", "text"],
		["created_at", "timestamp with time zone"],
	]);
	for (const column of columns.rows)
		assert(
			expectedTypes.get(column.columnName) === column.dataType,
			`${column.columnName} type mismatch: ${column.dataType}.`,
		);
	const nullable = new Map(
		columns.rows.map((column) => [column.columnName, column.nullable]),
	);
	for (const column of [
		"source_script_version_id",
		"source_script_revision",
		"product_id",
	])
		assert(nullable.get(column) === "YES", `${column} must remain nullable.`);
	for (const column of columns.rows
		.map((item) => item.columnName)
		.filter(
			(name) =>
				![
					"source_script_version_id",
					"source_script_revision",
					"product_id",
				].includes(name),
		))
		assert(nullable.get(column) === "NO", `${column} must be NOT NULL.`);
	for (const columnName of ["schema_version", "builder_version"])
		assert(
			columns.rows.find((column) => column.columnName === columnName)
				?.defaultValue === null,
			`${columnName} must have no hidden DB default.`,
		);
	assert(
		columns.rows
			.find((column) => column.columnName === "created_at")
			?.defaultValue?.includes("now()"),
		"created_at must default to now().",
	);

	const projectColumns = await pool.query<{
		columnName: string;
		nullable: string;
	}>(
		`select column_name as "columnName", is_nullable as nullable
		 from information_schema.columns
		 where table_schema = 'public' and table_name = 'project'
		 and column_name = any($1::text[])`,
		[
			[
				"content_type",
				"creation_path",
				"content_format_key",
				"content_format_version",
				"product_id",
			],
		],
	);
	for (const column of projectColumns.rows) {
		if (column.columnName === "product_id")
			assert(
				column.nullable === "YES",
				"Project.product_id must remain nullable.",
			);
		else
			assert(
				column.nullable === "NO",
				`${column.columnName} must remain NOT NULL after M5.`,
			);
	}

	const constraints = await pool.query<{
		name: string;
		type: string;
		deleteType: string | null;
	}>(
		`select con.conname as name, con.contype as type, con.confdeltype as "deleteType"
		 from pg_constraint con
		 join pg_class rel on rel.oid = con.conrelid
		 join pg_namespace ns on ns.oid = rel.relnamespace
		 where ns.nspname = 'public' and rel.relname = 'claim_manifest'`,
	);
	const names = new Set(constraints.rows.map((constraint) => constraint.name));
	for (const name of [
		"claim_manifest_source_type_check",
		"claim_manifest_source_pair_check",
		"claim_manifest_source_snapshot_check",
		"claim_manifest_source_content_hash_check",
		"claim_manifest_schema_version_check",
		"claim_manifest_builder_version_check",
		"claim_manifest_claims_array_check",
		"claim_manifest_claim_count_check",
		"claim_manifest_claim_count_matches_check",
		"claim_manifest_is_empty_check",
		"claim_manifest_fingerprint_check",
	])
		assert(names.has(name), `Missing constraint ${name}.`);
	const fkDelete = new Map(
		constraints.rows
			.filter((row) => row.type === "f")
			.map((row) => [row.name, row.deleteType]),
	);
	assert(
		fkDelete.get("claim_manifest_workspace_id_workspace_id_fk") === "c",
		"Workspace FK must CASCADE.",
	);
	for (const name of [
		"claim_manifest_project_id_project_id_fk",
		"claim_manifest_source_script_version_id_script_version_id_fk",
		"claim_manifest_product_id_product_id_fk",
		"claim_manifest_created_by_user_id_user_id_fk",
	])
		assert(fkDelete.get(name) === "r", `${name} must RESTRICT.`);

	const indexes = await pool.query<{ name: string }>(
		`select indexname as name from pg_indexes
		 where schemaname = 'public' and tablename = 'claim_manifest'`,
	);
	const indexNames = new Set(indexes.rows.map((index) => index.name));
	for (const name of [
		"claim_manifest_scope_fingerprint_unique",
		"claim_manifest_project_history_idx",
		"claim_manifest_script_source_idx",
		"claim_manifest_product_id_idx",
	])
		assert(indexNames.has(name), `Missing index ${name}.`);
}

async function runConstraintMatrix(pool: Pool, owners: Owners): Promise<void> {
	const scriptManifest = await buildClaimManifestFromScriptVersion({
		workspaceId: owners.workspaceId,
		projectId: owners.projectId,
		productId: owners.productId,
		scriptVersionId: owners.scriptVersionId,
		scriptVersionRevision: 1,
		snapshot: snapshot(),
	});
	const validId = await insertManifest(
		pool,
		manifestValues(scriptManifest, owners),
	);
	assert(validId, "Valid Script Manifest must persist.");
	const persisted = await pool.query<{
		source: ClaimManifestSource;
		claims: ClaimManifestClaim[];
		claimCount: number;
		isEmpty: boolean;
		fingerprint: string;
	}>(
		`select source_snapshot_json as source, claims_json as claims,
			claim_count as "claimCount", is_empty as "isEmpty", fingerprint
		 from claim_manifest where id = $1`,
		[validId],
	);
	const roundTrip = await validateBuiltClaimManifest({
		...scriptManifest,
		source: persisted.rows[0]?.source,
		claims: persisted.rows[0]?.claims,
		claimCount: persisted.rows[0]?.claimCount,
		isEmpty: persisted.rows[0]?.isEmpty,
		fingerprint: persisted.rows[0]?.fingerprint,
	});
	assert(roundTrip.success, "Persisted domain round-trip must validate.");

	const productless = await noScriptManifest(
		owners.workspaceId,
		owners.productlessProjectId,
		null,
	);
	await insertManifest(pool, manifestValues(productless, owners));
	await insertManifest(
		pool,
		manifestValues(productless, owners, {
			id: `claim-manifest-builder-v2-${randomUUID()}`,
			builder_version: "claim-manifest-builder.v2",
			fingerprint: hash(`builder-v2-${randomUUID()}`),
		}),
	);
	await insertManifest(
		pool,
		manifestValues(productless, owners, {
			id: `claim-manifest-max-claims-${randomUUID()}`,
			claims_json: Array.from({ length: 64 }, () => ({})),
			claim_count: 64,
			is_empty: false,
			fingerprint: hash(`max-claims-${randomUUID()}`),
		}),
	);

	const variants: Array<[string, Record<string, unknown>]> = [
		["invalid source type", { source_type: "UNKNOWN" }],
		["script source missing ID", { source_script_version_id: null }],
		["script source missing revision", { source_script_revision: null }],
		["script source zero revision", { source_script_revision: 0 }],
		["script source negative revision", { source_script_revision: -1 }],
		["source snapshot non-object", { source_snapshot_json: [] }],
		[
			"source snapshot type mismatch",
			{
				source_snapshot_json: {
					...scriptManifest.source,
					sourceType: "NO_SCRIPT",
				},
			},
		],
		["malformed source hash", { source_content_hash: "A".repeat(64) }],
		["malformed fingerprint", { fingerprint: "z".repeat(64) }],
		["invalid schema version", { schema_version: "claim-manifest.v2" }],
		["invalid builder version", { builder_version: "builder.v1" }],
		["claims non-array", { claims_json: {} }],
		["negative claim count", { claim_count: -1 }],
		[
			"claim count over max",
			{ claim_count: 65, claims_json: Array.from({ length: 65 }, () => ({})) },
		],
		["claim count mismatch", { claim_count: 2 }],
		["empty flag mismatch", { is_empty: true }],
		["missing Workspace FK", { workspace_id: `missing-${randomUUID()}` }],
		["missing Project FK", { project_id: `missing-${randomUUID()}` }],
		[
			"missing ScriptVersion FK",
			{ source_script_version_id: `missing-${randomUUID()}` },
		],
		["missing Product FK", { product_id: `missing-${randomUUID()}` }],
		["missing user FK", { created_by_user_id: `missing-${randomUUID()}` }],
	];
	for (const [label, overrides] of variants) {
		await expectRejected(label, () =>
			insertManifest(
				pool,
				manifestValues(scriptManifest, owners, {
					id: `claim-manifest-invalid-${randomUUID()}`,
					fingerprint: hash(`${label}-${randomUUID()}`),
					...overrides,
				}),
			),
		);
	}
	await expectRejected("scoped duplicate fingerprint", () =>
		insertManifest(pool, manifestValues(scriptManifest, owners)),
	);

	for (const overrides of [
		{ source_script_version_id: owners.scriptVersionId },
		{ source_script_revision: 1 },
		{
			source_script_version_id: owners.scriptVersionId,
			source_script_revision: 1,
		},
	]) {
		await expectRejected("NO_SCRIPT populated dedicated pair", () =>
			insertManifest(
				pool,
				manifestValues(productless, owners, {
					id: `claim-manifest-invalid-no-script-${randomUUID()}`,
					fingerprint: hash(`no-script-invalid-${randomUUID()}`),
					...overrides,
				}),
			),
		);
	}

	const alternateProject = `claim-manifest-alternate-${randomUUID()}`;
	await pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key, created_by_user_id
		) values ($1, $2, 'Alternate scope', null, 'ORGANIC', 'SCRIPTED',
			'SCRIPTED_STANDARD', 1, 'content', $3)`,
		[alternateProject, owners.workspaceId, owners.userId],
	);
	await insertManifest(
		pool,
		manifestValues(productless, owners, {
			id: `claim-manifest-alternate-${randomUUID()}`,
			project_id: alternateProject,
		}),
	);

	for (const [label, query, parameters] of [
		[
			"Project delete RESTRICT",
			"delete from project where id = $1",
			[owners.projectId],
		],
		[
			"ScriptVersion delete RESTRICT",
			"delete from script_version where id = $1",
			[owners.scriptVersionId],
		],
		[
			"Product delete RESTRICT",
			"delete from product where id = $1",
			[owners.productId],
		],
		[
			"User delete RESTRICT",
			'delete from "user" where id = $1',
			[owners.userId],
		],
	] as const)
		await expectRejected(label, () => pool.query(query, parameters));
}

async function runWorkspaceCascadeBehavior(
	pool: Pool,
	unrelatedWorkspaceId: string,
): Promise<void> {
	const unrelatedBefore = await pool.query<{ count: number }>(
		"select count(*)::int as count from claim_manifest where workspace_id = $1",
		[unrelatedWorkspaceId],
	);
	const unrelatedManifestCount = unrelatedBefore.rows[0]?.count ?? 0;
	assert(
		unrelatedManifestCount > 0,
		"Unrelated fixture must contain ClaimManifest evidence before cascade test.",
	);

	const cascadeOwners = await seedOwners(pool);
	const cascadeManifest = await buildClaimManifestFromScriptVersion({
		workspaceId: cascadeOwners.workspaceId,
		projectId: cascadeOwners.projectId,
		productId: cascadeOwners.productId,
		scriptVersionId: cascadeOwners.scriptVersionId,
		scriptVersionRevision: 1,
		snapshot: snapshot(),
	});
	const cascadeManifestId = await insertManifest(
		pool,
		manifestValues(cascadeManifest, cascadeOwners),
	);
	const manifestBefore = await pool.query<{ count: number }>(
		"select count(*)::int as count from claim_manifest where id = $1",
		[cascadeManifestId],
	);
	assert(
		manifestBefore.rows[0]?.count === 1,
		"Cascade fixture ClaimManifest must exist before Workspace deletion.",
	);

	const deleted = await pool.query<{ id: string }>(
		"delete from workspace where id = $1 returning id",
		[cascadeOwners.workspaceId],
	);
	assert(
		deleted.rows.length === 1 &&
			deleted.rows[0]?.id === cascadeOwners.workspaceId,
		"Isolated Workspace delete must succeed exactly once.",
	);
	const manifestAfter = await pool.query<{ count: number }>(
		"select count(*)::int as count from claim_manifest where id = $1",
		[cascadeManifestId],
	);
	assert(
		manifestAfter.rows[0]?.count === 0,
		"Workspace CASCADE must delete its referenced ClaimManifest row.",
	);
	const unrelatedAfter = await pool.query<{
		workspaceCount: number;
		manifestCount: number;
	}>(
		`select
			(select count(*)::int from workspace where id = $1) as "workspaceCount",
			(select count(*)::int from claim_manifest where workspace_id = $1) as "manifestCount"`,
		[unrelatedWorkspaceId],
	);
	assert(
		unrelatedAfter.rows[0]?.workspaceCount === 1 &&
			unrelatedAfter.rows[0]?.manifestCount === unrelatedManifestCount,
		"Workspace CASCADE must preserve the unrelated fixture and its Manifests.",
	);
	console.log(
		"Workspace delete CASCADE removes ClaimManifest and preserves unrelated fixture: PASS",
	);
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

	const through0018 = await migrationFolderThrough(18);
	await resetDatabase(pool);
	await migrate(drizzle(pool), { migrationsFolder: through0018 });
	assert(
		(await migrationCount(pool)) === 19,
		"Pre-0019 migration count must be 19.",
	);
	const beforeTables = await publicTables(pool);
	assert(
		!beforeTables.includes("claim_manifest"),
		"claim_manifest must not exist through 0018.",
	);

	const through0020 = await migrationFolderThrough(20);
	await migrate(drizzle(pool), { migrationsFolder: through0020 });
	assert(
		(await migrationCount(pool)) === 21,
		"Post-0020 migration count must be 21.",
	);
	const afterTables = await publicTables(pool);
	assert(
		afterTables.includes("claim_manifest"),
		"claim_manifest must exist after 0019.",
	);
	assert(
		JSON.stringify(beforeTables) ===
			JSON.stringify(afterTables.filter((table) => table !== "claim_manifest")),
		"0019 must not add, remove, or rename any other public table.",
	);
	await assertSchema(pool);
	const owners = await seedOwners(pool);
	await runConstraintMatrix(pool, owners);
	await runWorkspaceCascadeBehavior(pool, owners.workspaceId);
	console.log(
		"ClaimManifest persistence migration/schema/constraint matrix: PASS",
	);
} finally {
	await pool.end();
	for (const folder of temporaryFolders)
		await rm(folder, { recursive: true, force: true });
}

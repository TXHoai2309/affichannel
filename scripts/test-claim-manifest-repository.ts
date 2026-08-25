import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
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
	canonicalizeJson,
	claimManifestFingerprint,
	scriptGenerationSections,
} from "@affichannel/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireClaimManifestTestDatabaseAuthority } from "./claim-manifest-test-database-authority.ts";

type Pool = ReturnType<typeof createNodePostgresPool>;

const authority = requireClaimManifestTestDatabaseAuthority();
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
	"APIKEY_FUN_API_KEY",
	"TTS_APIKEY_FUN_API_KEY",
])
	Reflect.deleteProperty(process.env, name);

const {
	ClaimManifestRepositoryError,
	createOrReuseClaimManifest,
	createOrReuseClaimManifestInTransaction,
	getClaimManifestById,
	listClaimManifestsForProject,
} = await import("../packages/api/src/services/claim-manifest-repository.ts");
const { db } = await import("@affichannel/db");

const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function expectRepositoryError(
	label: string,
	code:
		| "CLAIM_MANIFEST_INPUT_INVALID"
		| "CLAIM_MANIFEST_CONFLICT"
		| "CLAIM_MANIFEST_PERSISTED_DATA_INVALID",
	action: () => Promise<unknown>,
): Promise<void> {
	try {
		await action();
	} catch (error) {
		assert(
			error instanceof ClaimManifestRepositoryError && error.code === code,
			`${label} must fail with ${code}.`,
		);
		assert(
			error.message === code,
			`${label} must not expose SQL or semantic payload content.`,
		);
		console.log(`${label}: ${code}`);
		return;
	}
	throw new Error(`${label} must fail closed.`);
}

function snapshot(label: string): ScriptVersionEditableSnapshot {
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-a", text: `Pin ${label} dùng liên tục 20 giờ.` },
			{ key: "hook-b", text: "Một lựa chọn âm thanh gọn nhẹ." },
			{ key: "hook-c", text: "Trải nghiệm nghe nhạc mỗi ngày." },
		],
		selectedHookKey: "hook-a",
		voiceoverSegments: [
			{ key: "voice-a", text: `Tai nghe ${label} hỗ trợ chống ồn.` },
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
		caption: `Giá niêm yết ${label}.`,
		hashtags: ["#tainghe"],
		disclosure: "Nội dung có liên kết affiliate.",
		claims: [
			{
				text: `Pin ${label} dùng liên tục 20 giờ`,
				occurrence: { section: "hook", hookKey: "hook-a" },
			},
			{
				text: `Tai nghe ${label} hỗ trợ chống ồn`,
				occurrence: { section: "voiceover", segmentKey: "voice-a" },
			},
		],
		claimsSourceRevision: 1,
		claimsStatus: "current",
	};
}

type ScopeFixture = {
	workspaceId: string;
	userId: string;
	otherUserId: string;
	productId: string;
	projectId: string;
	otherProjectId: string;
	scriptVersionId: string;
	snapshot: ScriptVersionEditableSnapshot;
};

async function seedScope(pool: Pool, label: string): Promise<ScopeFixture> {
	const suffix = randomUUID();
	const workspaceId = `claim-repository-workspace-${label}-${suffix}`;
	const userId = `claim-repository-user-${label}-${suffix}`;
	const otherUserId = `claim-repository-other-user-${label}-${suffix}`;
	const productId = `claim-repository-product-${label}-${suffix}`;
	const projectId = `claim-repository-project-${label}-${suffix}`;
	const otherProjectId = `claim-repository-other-project-${label}-${suffix}`;
	const generationId = `claim-repository-generation-${label}-${suffix}`;
	const scriptVersionId = `claim-repository-script-${label}-${suffix}`;
	const sourceSnapshot = snapshot(label);

	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		`Claim repository ${label}`,
	]);
	for (const [id, name] of [
		[userId, `Claim repository creator ${label}`],
		[otherUserId, `Claim repository reuser ${label}`],
	]) {
		await pool.query(
			'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
			[id, name, `${id}@example.test`],
		);
	}
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspaceId, `Claim repository product ${label}`, userId],
	);
	for (const [id, product] of [
		[projectId, productId],
		[otherProjectId, null],
	] as const) {
		await pool.query(
			`insert into project (
				id, workspace_id, name, product_id, content_type, creation_path,
				content_format_key, content_format_version, current_step_key, created_by_user_id
			) values ($1, $2, $3, $4, $5, 'SCRIPTED', 'SCRIPTED_STANDARD', 1, 'content', $6)`,
			[
				id,
				workspaceId,
				`Claim repository project ${label}`,
				product,
				product ? "AFFILIATE" : "ORGANIC",
				userId,
			],
		);
	}
	await pool.query(
		`insert into script_generation (
			id, workspace_id, project_id, created_by_user_id, idempotency_key,
			request_hash, mode, provider, model, prompt_version, output_schema_version,
			input_snapshot_json, input_hash, prompt_hash, status, output_json,
			valid_sections, invalid_sections, finished_at
		) values ($1, $2, $3, $4, $5, $6, 'full', 'deterministic', 'offline-test',
			'script-prompt.v2', 'script-draft.v2', $7, $8, $9, 'completed', $10,
			$11, ARRAY[]::text[], now())`,
		[
			generationId,
			workspaceId,
			projectId,
			userId,
			`claim-repository-${label}-${suffix}`,
			hash(`request-${label}-${suffix}`),
			JSON.stringify({ fixture: true }),
			hash(`input-${label}-${suffix}`),
			hash(`prompt-${label}-${suffix}`),
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
		otherUserId,
		productId,
		projectId,
		otherProjectId,
		scriptVersionId,
		snapshot: sourceSnapshot,
	};
}

async function buildScriptManifest(
	fixture: ScopeFixture,
	overrideSnapshot: ScriptVersionEditableSnapshot = fixture.snapshot,
): Promise<BuiltClaimManifest> {
	return buildClaimManifestFromScriptVersion({
		workspaceId: fixture.workspaceId,
		projectId: fixture.projectId,
		productId: fixture.productId,
		scriptVersionId: fixture.scriptVersionId,
		scriptVersionRevision: 1,
		snapshot: overrideSnapshot,
	});
}

async function buildNoScriptManifest(
	fixture: ScopeFixture,
): Promise<BuiltClaimManifest> {
	const source: ClaimManifestSource = {
		sourceType: "NO_SCRIPT",
		sourceSchemaVersion: "composition.v1",
		sourceRevision: "revision-1",
		elements: [],
		sourceContentHash: hash(`no-script-${fixture.projectId}`),
	};
	const claims: ClaimManifestClaim[] = [];
	return {
		workspaceId: fixture.workspaceId,
		projectId: fixture.otherProjectId,
		source,
		productId: null,
		schemaVersion: CLAIM_MANIFEST_SCHEMA_VERSION,
		builderVersion: CLAIM_MANIFEST_BUILDER_VERSION,
		claims,
		claimCount: 0,
		isEmpty: true,
		fingerprint: await claimManifestFingerprint({
			workspaceId: fixture.workspaceId,
			projectId: fixture.otherProjectId,
			source,
			productId: null,
			claims,
		}),
	};
}

async function insertRawManifest(
	pool: Pool,
	input: {
		id: string;
		manifest: BuiltClaimManifest;
		createdByUserId: string;
		claims?: unknown[];
		claimCount?: number;
		isEmpty?: boolean;
		fingerprint?: string;
	},
): Promise<void> {
	const source = input.manifest.source;
	await pool.query(
		`insert into claim_manifest (
			id, workspace_id, project_id, source_type, source_script_version_id,
			source_script_revision, source_snapshot_json, source_content_hash,
			product_id, schema_version, builder_version, claims_json, claim_count,
			is_empty, fingerprint, created_by_user_id
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		[
			input.id,
			input.manifest.workspaceId,
			input.manifest.projectId,
			source.sourceType,
			source.sourceType === "SCRIPT_VERSION" ? source.scriptVersionId : null,
			source.sourceType === "SCRIPT_VERSION"
				? source.scriptVersionRevision
				: null,
			JSON.stringify(source),
			source.sourceContentHash,
			input.manifest.productId,
			input.manifest.schemaVersion,
			input.manifest.builderVersion,
			JSON.stringify(input.claims ?? input.manifest.claims),
			input.claimCount ?? input.manifest.claimCount,
			input.isEmpty ?? input.manifest.isEmpty,
			input.fingerprint ?? input.manifest.fingerprint,
			input.createdByUserId,
		],
	);
}

async function rowCount(
	pool: Pool,
	workspaceId: string,
	projectId: string,
	fingerprint: string,
): Promise<number> {
	const result = await pool.query<{ count: number }>(
		`select count(*)::int as count from claim_manifest
		 where workspace_id = $1 and project_id = $2 and fingerprint = $3`,
		[workspaceId, projectId, fingerprint],
	);
	return result.rows[0]?.count ?? 0;
}

async function assertHistoryDirection(input: {
	workspaceId: string;
	projectId: string;
	direction: "newest_first" | "oldest_first";
	expectedIds: string[];
}): Promise<void> {
	const seen: string[] = [];
	let cursor: { createdAt: string; id: string } | undefined;
	for (const [index, expectedId] of input.expectedIds.entries()) {
		const page = await listClaimManifestsForProject({
			workspaceId: input.workspaceId,
			projectId: input.projectId,
			direction: input.direction,
			limit: 1,
			cursor,
		});
		assert(page.items.length === 1, "History page must respect limit=1.");
		assert(
			page.items[0]?.id === expectedId,
			`${input.direction} history order or composite tie-break mismatch.`,
		);
		seen.push(expectedId);
		const moreResultsRemain = index < input.expectedIds.length - 1;
		assert(
			(page.nextCursor !== null) === moreResultsRemain,
			`${input.direction} terminal cursor semantics mismatch.`,
		);
		if (page.nextCursor) {
			assert(
				page.nextCursor.createdAt.includes(".123456"),
				"History cursor must preserve exact PostgreSQL microseconds.",
			);
			cursor = page.nextCursor;
		}
	}
	assert(
		new Set(seen).size === input.expectedIds.length,
		`${input.direction} history must not duplicate rows.`,
	);
	assert(
		canonicalizeJson(seen) === canonicalizeJson(input.expectedIds),
		`${input.direction} history must not skip rows.`,
	);
}

const pool = createNodePostgresPool(authority.url);
try {
	const identity = await pool.query<{ database: string; schema: string }>(
		"select current_database() as database, current_schema() as schema",
	);
	console.log(
		`Disposable identity: database=${identity.rows[0]?.database}; host=${authority.host}; schema=${identity.rows[0]?.schema}`,
	);
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	await migrate(drizzle(pool), {
		migrationsFolder: resolve("packages/db/src/migrations"),
	});

	const fixtureA = await seedScope(pool, "a");
	const fixtureB = await seedScope(pool, "b");
	const manifestA = await buildScriptManifest(fixtureA);
	const first = await createOrReuseClaimManifest({
		workspaceId: fixtureA.workspaceId,
		projectId: fixtureA.projectId,
		builtManifest: manifestA,
		createdByUserId: fixtureA.userId,
	});
	assert(first.created, "First semantic Manifest must be created.");
	assert(
		first.manifest.createdByUserId === fixtureA.userId,
		"Creator A must be persisted.",
	);
	assert(
		first.manifest.productId === fixtureA.productId,
		"Product ID must round-trip.",
	);
	assert(
		JSON.stringify(first.manifest.claims) === JSON.stringify(manifestA.claims),
		"Ordered claims must round-trip exactly.",
	);
	assert(
		first.manifest.fingerprint === manifestA.fingerprint,
		"Fingerprint must be byte-preserved.",
	);
	assert(
		first.manifest.source.sourceContentHash ===
			manifestA.source.sourceContentHash,
		"Source hash must be byte-preserved.",
	);

	const reused = await createOrReuseClaimManifest({
		workspaceId: fixtureA.workspaceId,
		projectId: fixtureA.projectId,
		builtManifest: manifestA,
		createdByUserId: fixtureA.otherUserId,
	});
	assert(!reused.created, "Sequential equivalent request must reuse.");
	assert(
		reused.manifest.id === first.manifest.id,
		"Sequential reuse must return the same ID.",
	);
	assert(
		reused.manifest.createdByUserId === fixtureA.userId,
		"Reuse must retain original creator A.",
	);
	assert(
		(await rowCount(
			pool,
			fixtureA.workspaceId,
			fixtureA.projectId,
			manifestA.fingerprint,
		)) === 1,
		"Sequential reuse must keep exactly one row.",
	);

	const raceSnapshot = structuredClone(fixtureA.snapshot);
	raceSnapshot.caption = "Concurrent semantic input.";
	const raceManifest = await buildScriptManifest(fixtureA, raceSnapshot);
	const raceResults = await Promise.all([
		createOrReuseClaimManifest({
			workspaceId: fixtureA.workspaceId,
			projectId: fixtureA.projectId,
			builtManifest: raceManifest,
			createdByUserId: fixtureA.userId,
		}),
		createOrReuseClaimManifest({
			workspaceId: fixtureA.workspaceId,
			projectId: fixtureA.projectId,
			builtManifest: raceManifest,
			createdByUserId: fixtureA.otherUserId,
		}),
	]);
	assert(
		new Set(raceResults.map((result) => result.manifest.id)).size === 1,
		"Concurrent callers must receive one ID.",
	);
	assert(
		raceResults.filter((result) => result.created).length === 1,
		"Exactly one concurrent caller must create.",
	);
	assert(
		(await rowCount(
			pool,
			fixtureA.workspaceId,
			fixtureA.projectId,
			raceManifest.fingerprint,
		)) === 1,
		"Concurrent reuse must create one DB row.",
	);
	const thirdSnapshot = structuredClone(fixtureA.snapshot);
	thirdSnapshot.caption = "Third history semantic input.";
	const thirdManifest = await buildScriptManifest(fixtureA, thirdSnapshot);
	const third = await createOrReuseClaimManifest({
		workspaceId: fixtureA.workspaceId,
		projectId: fixtureA.projectId,
		builtManifest: thirdManifest,
		createdByUserId: fixtureA.userId,
	});
	assert(third.created, "Third history Manifest must be created.");

	const readA = await getClaimManifestById({
		workspaceId: fixtureA.workspaceId,
		projectId: fixtureA.projectId,
		claimManifestId: first.manifest.id,
	});
	assert(
		readA?.id === first.manifest.id,
		"Correct scope must read Manifest A.",
	);
	assert(
		(await getClaimManifestById({
			workspaceId: fixtureB.workspaceId,
			projectId: fixtureB.projectId,
			claimManifestId: first.manifest.id,
		})) === null,
		"Wrong Workspace must be non-enumerating not-found.",
	);
	assert(
		(await getClaimManifestById({
			workspaceId: fixtureA.workspaceId,
			projectId: fixtureA.otherProjectId,
			claimManifestId: first.manifest.id,
		})) === null,
		"Wrong Project must be non-enumerating not-found.",
	);

	const noScript = await buildNoScriptManifest(fixtureB);
	const empty = await createOrReuseClaimManifest({
		workspaceId: fixtureB.workspaceId,
		projectId: fixtureB.otherProjectId,
		builtManifest: noScript,
		createdByUserId: fixtureB.userId,
	});
	const emptyReuse = await createOrReuseClaimManifest({
		workspaceId: fixtureB.workspaceId,
		projectId: fixtureB.otherProjectId,
		builtManifest: noScript,
		createdByUserId: fixtureB.otherUserId,
	});
	assert(
		empty.created &&
			!emptyReuse.created &&
			empty.manifest.id === emptyReuse.manifest.id &&
			empty.manifest.productId === null &&
			empty.manifest.claimCount === 0 &&
			empty.manifest.isEmpty &&
			empty.manifest.claims.length === 0 &&
			empty.manifest.source.sourceType === "NO_SCRIPT",
		"NO_SCRIPT productless empty Manifest must create and reuse exactly.",
	);
	for (const direction of ["oldest_first", "newest_first"] as const) {
		const singlePage = await listClaimManifestsForProject({
			workspaceId: fixtureB.workspaceId,
			projectId: fixtureB.otherProjectId,
			direction,
			limit: 5,
		});
		assert(
			singlePage.items.length === 1 && singlePage.nextCursor === null,
			`${direction} single-row history must have terminal null cursor.`,
		);
	}

	const collisionFixture = await seedScope(pool, "collision");
	const collisionManifest = await buildScriptManifest(collisionFixture);
	const corruptedClaims = collisionManifest.claims.map((claim, index) =>
		index === 0
			? { ...claim, claimText: `${claim.claimText} corrupted` }
			: claim,
	);
	const collisionId = `claim-manifest-collision-${randomUUID()}`;
	await insertRawManifest(pool, {
		id: collisionId,
		manifest: collisionManifest,
		createdByUserId: collisionFixture.userId,
		claims: corruptedClaims,
	});
	await expectRepositoryError(
		"same fingerprint non-equivalent payload",
		"CLAIM_MANIFEST_CONFLICT",
		() =>
			createOrReuseClaimManifest({
				workspaceId: collisionFixture.workspaceId,
				projectId: collisionFixture.projectId,
				builtManifest: collisionManifest,
				createdByUserId: collisionFixture.otherUserId,
			}),
	);
	assert(
		(await rowCount(
			pool,
			collisionFixture.workspaceId,
			collisionFixture.projectId,
			collisionManifest.fingerprint,
		)) === 1,
		"Collision must leave exactly one unchanged row.",
	);
	const collisionRow = await pool.query<{ claims: unknown }>(
		"select claims_json as claims from claim_manifest where id = $1",
		[collisionId],
	);
	assert(
		canonicalizeJson(collisionRow.rows[0]?.claims) ===
			canonicalizeJson(corruptedClaims),
		"Collision must not overwrite existing payload.",
	);

	const corruptId = `claim-manifest-corrupt-${randomUUID()}`;
	await insertRawManifest(pool, {
		id: corruptId,
		manifest: noScript,
		createdByUserId: fixtureB.userId,
		claims: [{}],
		claimCount: 1,
		isEmpty: false,
		fingerprint: hash(`corrupt-${randomUUID()}`),
	});
	await expectRepositoryError(
		"corrupted persisted row read",
		"CLAIM_MANIFEST_PERSISTED_DATA_INVALID",
		() =>
			getClaimManifestById({
				workspaceId: fixtureB.workspaceId,
				projectId: fixtureB.otherProjectId,
				claimManifestId: corruptId,
			}),
	);

	await expectRepositoryError(
		"contradictory create scope",
		"CLAIM_MANIFEST_INPUT_INVALID",
		() =>
			createOrReuseClaimManifest({
				workspaceId: fixtureB.workspaceId,
				projectId: fixtureA.projectId,
				builtManifest: manifestA,
				createdByUserId: fixtureA.userId,
			}),
	);

	const raceResult = raceResults[0];
	assert(raceResult, "Concurrent race must return a Manifest result.");
	const historyIds = [
		first.manifest.id,
		raceResult.manifest.id,
		third.manifest.id,
	];
	await pool.query(
		"update claim_manifest set created_at = '2026-08-25 12:34:56.123456+00'::timestamptz where id = any($1::text[])",
		[historyIds],
	);
	const ascendingIds = [...historyIds].sort((left, right) =>
		left.localeCompare(right),
	);
	await assertHistoryDirection({
		workspaceId: fixtureA.workspaceId,
		projectId: fixtureA.projectId,
		direction: "oldest_first",
		expectedIds: ascendingIds,
	});
	await assertHistoryDirection({
		workspaceId: fixtureA.workspaceId,
		projectId: fixtureA.projectId,
		direction: "newest_first",
		expectedIds: [...ascendingIds].reverse(),
	});

	const transactionFixture = await seedScope(pool, "transaction-bound");
	const transactionManifest = await buildScriptManifest(transactionFixture);
	const transactionBound = await db.transaction((transaction) =>
		createOrReuseClaimManifestInTransaction(transaction, {
			workspaceId: transactionFixture.workspaceId,
			projectId: transactionFixture.projectId,
			builtManifest: transactionManifest,
			createdByUserId: transactionFixture.userId,
		}),
	);
	assert(
		transactionBound.created &&
			transactionBound.manifest.fingerprint === transactionManifest.fingerprint,
		"Transaction-bound repository composition must create through the caller transaction.",
	);
	const rollbackFixture = await seedScope(pool, "transaction-rollback");
	const rollbackManifest = await buildScriptManifest(rollbackFixture);
	try {
		await db.transaction(async (transaction) => {
			await createOrReuseClaimManifestInTransaction(transaction, {
				workspaceId: rollbackFixture.workspaceId,
				projectId: rollbackFixture.projectId,
				builtManifest: rollbackManifest,
				createdByUserId: rollbackFixture.userId,
			});
			throw new Error("FORCED_CALLER_TRANSACTION_ROLLBACK");
		});
		throw new Error("Caller transaction rollback must reject.");
	} catch (error) {
		assert(
			error instanceof Error &&
				error.message === "FORCED_CALLER_TRANSACTION_ROLLBACK",
			"Transaction-bound repository must propagate the caller rollback.",
		);
	}
	assert(
		(await rowCount(
			pool,
			rollbackFixture.workspaceId,
			rollbackFixture.projectId,
			rollbackManifest.fingerprint,
		)) === 0,
		"Caller transaction rollback must leave no ClaimManifest row.",
	);

	console.log("New insert / sequential reuse / creator provenance: PASS");
	console.log(
		"Concurrent equivalent requests=2; rows=1; IDs=same; created flags=true,false; deadlock=NO; unique error exposed=NO",
	);
	console.log("Scoped ID reads and non-enumerating misses: PASS");
	console.log(
		"SCRIPT_VERSION + Product / NO_SCRIPT + null Product + empty: PASS",
	);
	console.log(
		"Same-fingerprint non-equivalent collision: CLAIM_MANIFEST_CONFLICT; existing row unchanged",
	);
	console.log("Corrupted persisted row: CLAIM_MANIFEST_PERSISTED_DATA_INVALID");
	console.log(
		"History lookahead/terminal cursor, both directions, same-timestamp tie-break, microseconds: PASS",
	);
	console.log(
		"Standalone + transaction-bound repository composition/rollback: PASS",
	);
} finally {
	await pool.end();
}

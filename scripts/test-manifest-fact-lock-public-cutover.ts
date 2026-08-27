import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();
process.env.TEXT_AI_DEFAULT_PROVIDER = "deterministic";
process.env.TEXT_AI_DEFAULT_MODEL = "manifest-cutover-test";

const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter.ts"
);
const { appRouter } = await import("../packages/api/src/routers/index.ts");
const { RPCHandler } = await import(
	"../packages/api/node_modules/@orpc/server/dist/adapters/fetch/index.mjs"
);
const { FactLockGate } = await import(
	"../packages/api/src/services/fact-lock-gate-service.ts"
);
const migrationsRoot = resolve("packages/db/src/migrations");

type Pool = ReturnType<typeof createNodePostgresPool>;
type Fixture = {
	userId: string;
	workspaceId: string;
	productId: string;
	projectId: string;
	scriptVersionId: string;
};

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function hash(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function snapshot(label: string, claims: boolean) {
	const factualText = `Sản phẩm ${label} có pin 20 giờ`;
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-a", text: `${factualText}.` },
			{ key: "hook-b", text: "Một lựa chọn gọn nhẹ cho ngày dài." },
			{ key: "hook-c", text: "Thiết kế phù hợp cho nhịp sống hằng ngày." },
		],
		selectedHookKey: "hook-a",
		voiceoverSegments: [{ key: "voice-a", text: `${factualText}.` }],
		scenes: [
			{
				order: 1,
				durationSeconds: 30,
				visualDirection: "Cận cảnh sản phẩm.",
				onScreenText: factualText,
				voiceoverSegmentKeys: ["voice-a"],
			},
		],
		cta: { text: "Xem thêm thông tin." },
		caption: `Đánh giá ${label}.`,
		hashtags: ["#review"],
		disclosure: "Nội dung có liên kết affiliate.",
		claims: claims
			? [
					{
						text: factualText,
						occurrence: { section: "hook", hookKey: "hook-a" },
					},
				]
			: [],
		claimsSourceRevision: 1,
		claimsStatus: "current",
	};
}

async function resetDatabase(pool: Pool) {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
}

async function seedFixture(
	pool: Pool,
	input: { label: string; claims: boolean },
): Promise<Fixture> {
	const id = randomUUID().replaceAll("-", "");
	const userId = `us18f-user-${input.label}-${id}`;
	const workspaceId = "internal";
	const productId = `us18f-product-${input.label}-${id}`;
	const projectId = `us18f-project-${input.label}-${id}`;
	const generationId = `us18f-generation-${input.label}-${id}`;
	const scriptVersionId = `us18f-script-${input.label}-${id}`;
	const memberId = `us18f-member-${input.label}-${id}`;
	const projectSnapshot = snapshot(input.label, input.claims);
	const allSections = [
		"hook",
		"voiceover",
		"scenes",
		"cta",
		"caption",
		"hashtags",
		"disclosure",
		"claims",
	];

	await pool.query(
		"insert into workspace (id, name) values ($1, $2) on conflict (id) do nothing",
		[workspaceId, "AffiChannel Internal"],
	);
	await pool.query(
		'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
		[userId, `US18F ${input.label}`, `${userId}@example.test`],
	);
	await pool.query(
		"insert into workspace_member (id, workspace_id, user_id) values ($1, $2, $3)",
		[memberId, workspaceId, userId],
	);
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspaceId, `US18F Product ${input.label}`, userId],
	);
	await pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key, created_by_user_id
		) values ($1, $2, $3, $4, 'AFFILIATE', 'SCRIPTED', 'SCRIPTED_STANDARD', 1, 'fact-lock', $5)`,
		[projectId, workspaceId, `US18F Project ${input.label}`, productId, userId],
	);
	await pool.query(
		`insert into script_generation (
			id, workspace_id, project_id, created_by_user_id, idempotency_key,
			request_hash, mode, provider, model, prompt_version, output_schema_version,
			input_snapshot_json, input_hash, prompt_hash, status, output_json,
			valid_sections, invalid_sections, finished_at
		) values ($1, $2, $3, $4, $5, $6, 'full', 'deterministic', 'manifest-cutover-test',
			'script-prompt.v2', 'script-draft.v2', $7, $8, $9, 'completed', $7, $10,
			ARRAY[]::text[], now())`,
		[
			generationId,
			workspaceId,
			projectId,
			userId,
			`us18f-generation-key-${id}`,
			hash(`generation-${id}`),
			JSON.stringify(projectSnapshot),
			hash(`input-${id}`),
			hash(`prompt-${id}`),
			allSections,
		],
	);
	await pool.query(
		`insert into script_version (
			id, workspace_id, project_id, source_generation_id, status, version_number,
			editable_snapshot_json, revision, created_by_user_id, saved_at
		) values ($1, $2, $3, $4, 'draft', null, $5, 1, $6, null)`,
		[
			scriptVersionId,
			workspaceId,
			projectId,
			generationId,
			JSON.stringify(projectSnapshot),
			userId,
		],
	);
	await pool.query(
		`insert into product_fact (
			id, workspace_id, product_id, revision, content, type, status,
			source_type, source_label, confirmed_at, created_by_user_id, updated_by_user_id
		) values ($1, $2, $3, 1, $4, 'feature', 'verified', 'official', 'Fixture source', '2026-08-20', $5, $5)`,
		[
			`us18f-fact-${input.label}-${id}`,
			workspaceId,
			productId,
			`Sản phẩm ${input.label} có pin 20 giờ`,
			userId,
		],
	);
	await pool.query(
		`insert into channel_settings (
			id, workspace_id, niche, target_audience, tone, content_pillar,
			default_cta, affiliate_disclosure, avoid_words, created_by_user_id, updated_by_user_id
		) values ($1, $2, 'review', 'người xem', 'thân thiện', 'sản phẩm',
			'Xem thêm', 'Nội dung có liên kết affiliate.', $3, $4, $4)
			 on conflict (workspace_id) do nothing`,
		[`us18f-settings-${id}`, workspaceId, [], userId],
	);
	await pool.query(
		`insert into output_rules (
			id, workspace_id, language, aspect_ratio, subtitle_safe_area,
			claim_limit, require_final_cta, created_by_user_id, updated_by_user_id
		) values ($1, $2, 'vi-VN', '9:16', 'standard', null, true, $3, $3)
			 on conflict (workspace_id) do nothing`,
		[`us18f-rules-${id}`, workspaceId, userId],
	);
	return { userId, workspaceId, productId, projectId, scriptVersionId };
}

type RpcResult = { status: number; value: unknown };

async function callRpc(
	handler: InstanceType<typeof RPCHandler>,
	path: string,
	userId: string,
	input: unknown,
): Promise<RpcResult> {
	const result = await handler.handle(
		new Request(`http://localhost/api/rpc/${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ json: input }),
		}),
		{
			prefix: "/api/rpc",
			context: { auth: null, session: { user: { id: userId } } },
		},
	);
	const response = result.response;
	assert(response, `RPC ${path} did not return a response.`);
	const body = await response.json();
	const value =
		body && typeof body === "object" && "json" in body
			? (body as { json: unknown }).json
			: body;
	return { status: response.status, value };
}

function objectValue(value: unknown): Record<string, unknown> {
	assert(value && typeof value === "object", "Expected an object RPC result.");
	return value as Record<string, unknown>;
}

async function main() {
	const pool = createNodePostgresPool(
		process.env.AFFICHANNEL_M1_TEST_DATABASE_URL as string,
	);
	const handler = new RPCHandler(appRouter);
	try {
		await resetDatabase(pool);
		await migrate(drizzle(pool), { migrationsFolder: migrationsRoot });
		const fixture = await seedFixture(pool, { label: "primary", claims: true });
		const zeroFixture = await seedFixture(pool, {
			label: "zero",
			claims: false,
		});

		const prepared = await callRpc(
			handler,
			"factLock/prepareManifest",
			fixture.userId,
			{
				projectId: fixture.projectId,
				scriptVersionId: fixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
			},
		);
		assert(
			prepared.status === 200,
			`Public Manifest preparation failed: ${prepared.status} ${JSON.stringify(prepared.value)}`,
		);
		const preparedValue = objectValue(prepared.value);
		assert(
			typeof preparedValue.claimManifestId === "string" &&
				typeof preparedValue.fingerprint === "string" &&
				preparedValue.created === true,
			"Public preparation did not return server-owned Manifest data.",
		);
		const manifestId = preparedValue.claimManifestId as string;

		const reused = await callRpc(
			handler,
			"factLock/prepareManifest",
			fixture.userId,
			{
				projectId: fixture.projectId,
				scriptVersionId: fixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
			},
		);
		assert(reused.status === 200, "Public Manifest reuse failed.");
		const reusedValue = objectValue(reused.value);
		assert(
			reusedValue.claimManifestId === manifestId && reusedValue.reused === true,
			"Repeated public preparation did not reuse the exact Manifest.",
		);

		const strictRejected = await callRpc(
			handler,
			"factLock/prepareManifest",
			fixture.userId,
			{
				projectId: fixture.projectId,
				scriptVersionId: fixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				claims: [],
			},
		);
		assert(
			strictRejected.status === 400,
			"Manifest API did not reject caller claims.",
		);

		const run = await callRpc(handler, "factLock/run", fixture.userId, {
			projectId: fixture.projectId,
			claimManifestId: manifestId,
			idempotencyKey: "us18f-public-run-001",
		});
		assert(run.status === 200, "Public Manifest Fact Lock run failed.");
		const runValue = objectValue(run.value);
		assert(
			runValue.inputMode === "MANIFEST_V1",
			"Public run did not use MANIFEST_V1.",
		);

		const runCount = await pool.query<{ count: string; legacy: string }>(
			`select count(*)::text as count,
				count(*) filter (where input_mode is null)::text as legacy
			 from fact_lock_run where project_id = $1`,
			[fixture.projectId],
		);
		assert(
			runCount.rows[0]?.count === "1" && runCount.rows[0]?.legacy === "0",
			"Public run created an unexpected legacy FactLockRun.",
		);

		const state = await callRpc(handler, "factLock/getState", fixture.userId, {
			projectId: fixture.projectId,
		});
		assert(state.status === 200, "Manifest Fact Lock state read failed.");
		const stateValue = objectValue(state.value);
		const latestRequest = objectValue(stateValue.latestRequest);
		assert(
			latestRequest.inputMode === "MANIFEST_V1" &&
				objectValue(latestRequest.claimManifest).id === manifestId,
			"Dual-mode state did not return the Manifest-authoritative projection.",
		);
		const gate = await FactLockGate.assertPassed(
			{ workspaceId: fixture.workspaceId, userId: fixture.userId },
			fixture.projectId,
		);
		assert(
			gate.allowed && gate.reason === "FACT_LOCK_PASSED",
			"Voice downstream gate did not accept Manifest pass.",
		);

		const claimBeforeApproval = await pool.query<{ id: string }>(
			"select id from fact_lock_claim where run_id = $1 order by claim_key limit 1",
			[runValue.id],
		);
		const claimId = claimBeforeApproval.rows[0]?.id;
		assert(claimId, "Public Manifest run did not persist a claim row.");
		const sourceBeforeApproval = await pool.query<{ snapshot: unknown }>(
			"select editable_snapshot_json as snapshot from script_version where id = $1",
			[fixture.scriptVersionId],
		);
		const manifestBeforeApproval = await pool.query<{
			fingerprint: string;
			claims: unknown;
		}>(
			"select fingerprint, claims_json as claims from claim_manifest where id = $1",
			[manifestId],
		);
		await pool.query(
			`update fact_lock_claim
			 set classification_status = 'NEEDS_REVIEW', review_status = 'UNRESOLVED',
				 reviewed_by_user_id = null, reviewed_at = null, review_note = null
			 where id = $1`,
			[claimId],
		);
		await pool.query(
			"update fact_lock_run set status = 'review_required' where id = $1",
			[runValue.id],
		);
		const approved = await callRpc(
			handler,
			"factLock/manualApprove",
			fixture.userId,
			{
				projectId: fixture.projectId,
				factLockRunId: runValue.id,
				claimId,
				scriptVersionId: fixture.scriptVersionId,
				baseRevision: 1,
				reviewNote: "Đã đối chiếu fixture Manifest.",
			},
		);
		assert(approved.status === 200, "Manifest manual approval failed.");
		const approvedModel = objectValue(approved.value);
		assert(
			objectValue(approvedModel.latestRequest).effectiveStatus === "passed",
			"Manifest manual approval did not recompute the aggregate pass.",
		);
		const sourceAfterApproval = await pool.query<{ snapshot: unknown }>(
			"select editable_snapshot_json as snapshot from script_version where id = $1",
			[fixture.scriptVersionId],
		);
		const manifestAfterApproval = await pool.query<{
			fingerprint: string;
			claims: unknown;
		}>(
			"select fingerprint, claims_json as claims from claim_manifest where id = $1",
			[manifestId],
		);
		assert(
			JSON.stringify(sourceBeforeApproval.rows[0]?.snapshot) ===
				JSON.stringify(sourceAfterApproval.rows[0]?.snapshot) &&
				manifestBeforeApproval.rows[0]?.fingerprint ===
					manifestAfterApproval.rows[0]?.fingerprint &&
				JSON.stringify(manifestBeforeApproval.rows[0]?.claims) ===
					JSON.stringify(manifestAfterApproval.rows[0]?.claims),
			"Manifest approval mutated ScriptVersion or ClaimManifest.",
		);

		const manifestSourceAction = await callRpc(
			handler,
			"factLock/editClaimSource",
			fixture.userId,
			{
				projectId: fixture.projectId,
				factLockRunId: runValue.id,
				claimId,
				scriptVersionId: fixture.scriptVersionId,
				baseRevision: 1,
				newText: "Không được phép sửa từ Manifest review.",
			},
		);
		assert(
			manifestSourceAction.status === 409,
			"Manifest source mutation was not rejected.",
		);

		const wrongScope = await callRpc(
			handler,
			"factLock/run",
			zeroFixture.userId,
			{
				projectId: zeroFixture.projectId,
				claimManifestId: manifestId,
				idempotencyKey: "us18f-wrong-scope-001",
			},
		);
		assert(wrongScope.status === 404, "Cross-project Manifest was enumerable.");

		const missingManifest = await callRpc(
			handler,
			"factLock/run",
			fixture.userId,
			{ projectId: fixture.projectId, idempotencyKey: "us18f-missing-001" },
		);
		assert(
			missingManifest.status === 400,
			"Public run accepted a missing Manifest ID.",
		);

		const zeroPrepared = await callRpc(
			handler,
			"factLock/prepareManifest",
			zeroFixture.userId,
			{
				projectId: zeroFixture.projectId,
				scriptVersionId: zeroFixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
			},
		);
		assert(
			zeroPrepared.status === 200,
			"Zero-claim public preparation failed.",
		);
		const zeroManifestId = objectValue(zeroPrepared.value)
			.claimManifestId as string;
		const zeroRun = await callRpc(handler, "factLock/run", zeroFixture.userId, {
			projectId: zeroFixture.projectId,
			claimManifestId: zeroManifestId,
			idempotencyKey: "us18f-zero-run-001",
		});
		assert(zeroRun.status === 200, "Zero-claim public run failed.");
		assert(
			objectValue(zeroRun.value).status === "passed" &&
				objectValue(zeroRun.value).inputMode === "MANIFEST_V1",
			"Zero-claim public run did not pass as MANIFEST_V1.",
		);
		const zeroGate = await FactLockGate.assertPassed(
			{ workspaceId: zeroFixture.workspaceId, userId: zeroFixture.userId },
			zeroFixture.projectId,
		);
		assert(
			zeroGate.allowed,
			"Zero-claim Manifest did not satisfy downstream gate.",
		);

		await pool.query("update script_version set revision = 2 where id = $1", [
			fixture.scriptVersionId,
		]);
		const staleRun = await callRpc(handler, "factLock/run", fixture.userId, {
			projectId: fixture.projectId,
			claimManifestId: manifestId,
			idempotencyKey: "us18f-stale-run-001",
		});
		assert(
			staleRun.status === 409,
			"Stale Manifest was not rejected before execution.",
		);

		console.log("AFF-US-018 public Manifest cutover: PASS");
	} finally {
		await pool.end();
	}
}

await main();

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import {
	canonicalizeJson,
	summarizeCurrentScriptVersionClaims,
} from "@affichannel/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type {
	TextProvider,
	TextProviderEstimate,
	TextProviderEstimateRequest,
	TextProviderRequest,
	TextProviderResult,
} from "../packages/api/src/providers/text/text-provider.ts";
import { TextProviderError } from "../packages/api/src/providers/text/text-provider.ts";
import { createNodePostgresPool } from "../packages/db/src/node-postgres-test-adapter.ts";
import { requireScriptClaimRefreshTestDatabaseAuthority } from "./script-claim-refresh-test-database-authority.ts";

const authority = requireScriptClaimRefreshTestDatabaseAuthority();
process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_SCRIPT_CLAIM_REFRESH_TEST_DATABASE_CONFIRM =
	"DISPOSABLE_SCRIPT_CLAIM_REFRESH_TEST_DB_CONFIRMED";
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
for (const name of [
	"DATABASE_URL",
	"DATABASE_URL_DIRECT",
	"AFF_US008_DATABASE_URL",
	"APIKEY_FUN_API_KEY",
	"TTS_APIKEY_FUN_API_KEY",
])
	Reflect.deleteProperty(process.env, name);

const migrationsRoot = resolve("packages/db/src/migrations");
const hash = (value: unknown) =>
	createHash("sha256").update(canonicalizeJson(value)).digest("hex");

function fixtureSnapshot(
	status: "current" | "stale",
): ScriptVersionEditableSnapshot {
	return {
		schemaVersion: "script-draft.v3",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook", text: "Một thói quen nhỏ cho ngày tốt hơn." },
			{ key: "alt", text: "Bắt đầu thật đơn giản." },
			{ key: "save", text: "Lưu lại để thử hôm nay." },
		],
		selectedHookKey: "hook",
		voiceoverSegments: [
			{ key: "intro", text: "Một thói quen nhỏ cho ngày tốt hơn." },
			{ key: "tip", text: "Bạn có thể bắt đầu từ một bước rất nhỏ." },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 15,
				visualDirection: "Minh họa thói quen",
				onScreenText: "Một bước nhỏ",
				voiceoverSegmentKeys: ["intro"],
			},
		],
		cta: { text: "Thử ngay hôm nay." },
		caption: "Một bước nhỏ cho ngày tốt hơn.",
		hashtags: ["#thoiquen"],
		disclosure: "",
		claims: [
			{
				text: "Một thói quen nhỏ cho ngày tốt hơn.",
				occurrence: { section: "hook", hookKey: "hook" },
				proposedSubject: "GENERAL",
				subject: { kind: "GENERAL" },
				subjectStatus: "NEEDS_CONFIRMATION",
				subjectSource: null,
			},
		],
		claimsSourceRevision: 1,
		claimsStatus: status,
	};
}

type Pool = ReturnType<typeof createNodePostgresPool>;
type Fixture = Readonly<{
	workspaceId: string;
	userId: string;
	projectId: string;
	scriptVersionId: string;
	snapshot: ScriptVersionEditableSnapshot;
}>;

async function resetDatabase(pool: Pool) {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	await migrate(drizzle(pool), { migrationsFolder: migrationsRoot });
}

async function seed(
	pool: Pool,
	label: string,
	status: "current" | "stale" = "stale",
) {
	const suffix = randomUUID();
	const workspaceId = `organic-refresh-workspace-${label}-${suffix}`;
	const userId = `organic-refresh-user-${label}-${suffix}`;
	const projectId = `organic-refresh-project-${label}-${suffix}`;
	const generationId = `organic-refresh-generation-${label}-${suffix}`;
	const scriptVersionId = `organic-refresh-script-${label}-${suffix}`;
	const snapshot = fixtureSnapshot(status);
	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		label,
	]);
	await pool.query(
		'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
		[userId, label, `${userId}@example.test`],
	);
	await pool.query(
		"insert into workspace_member (id, workspace_id, user_id) values ($1, $2, $3)",
		[`member-${suffix}`, workspaceId, userId],
	);
	await pool.query(
		`insert into project (id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key, created_by_user_id)
			values ($1, $2, $3, null, 'ORGANIC', 'SCRIPTED', 'SCRIPTED_STANDARD', 1, 'content', $4)`,
		[projectId, workspaceId, label, userId],
	);
	await pool.query(
		`insert into script_generation (id, workspace_id, project_id, created_by_user_id, idempotency_key,
			request_hash, mode, provider, model, prompt_version, output_schema_version,
			input_snapshot_json, input_hash, prompt_hash, status, output_json,
			valid_sections, invalid_sections, finished_at)
			values ($1, $2, $3, $4, $5, $6, 'full', 'deterministic', 'organic-test',
			'script-prompt.v3', 'script-draft.v3', $7, $8, $9, 'completed', $7,
			ARRAY['hook','voiceover','scenes','cta','caption','hashtags','disclosure','claims'], ARRAY[]::text[], now())`,
		[
			generationId,
			workspaceId,
			projectId,
			userId,
			`generation-${suffix}`,
			hash({ suffix }),
			snapshot,
			hash(snapshot),
			hash({ prompt: suffix }),
		],
	);
	await pool.query(
		`insert into script_version (id, workspace_id, project_id, source_generation_id, status,
			version_number, editable_snapshot_json, revision, created_by_user_id)
			values ($1, $2, $3, $4, 'draft', null, $5, 1, $6)`,
		[scriptVersionId, workspaceId, projectId, generationId, snapshot, userId],
	);
	await pool.query(
		`insert into ai_settings (id, workspace_id, text_provider, text_model, created_by_user_id, updated_by_user_id)
			values ($1, $2, 'deterministic', 'organic-test-model', $3, $3)`,
		[`ai-${suffix}`, workspaceId, userId],
	);
	return {
		workspaceId,
		userId,
		projectId,
		scriptVersionId,
		snapshot,
	} satisfies Fixture;
}

class Provider implements TextProvider {
	readonly name = "organic-claim-refresh-test";
	calls = 0;
	requests: TextProviderRequest[] = [];
	private readonly output: unknown;
	private readonly mode: "success" | "uncertain";
	private readonly beforeReturn?: () => Promise<void>;
	private gate: Promise<void> | null = null;
	private releaseGate: (() => void) | null = null;
	constructor(options: {
		output?: unknown;
		mode?: "success" | "uncertain";
		blocked?: boolean;
		beforeReturn?: () => Promise<void>;
	}) {
		this.output = options.output;
		this.mode = options.mode ?? "success";
		this.beforeReturn = options.beforeReturn;
		if (options.blocked)
			this.gate = new Promise(
				(resolvePromise) => (this.releaseGate = resolvePromise),
			);
	}
	release() {
		this.releaseGate?.();
		this.releaseGate = null;
		this.gate = null;
	}
	async estimateCost(
		_request: TextProviderEstimateRequest,
	): Promise<TextProviderEstimate> {
		return {
			estimatedCostMicros: BigInt(0),
			currency: "VND",
			inputTokens: 1,
			pricingBasis: "organic-test",
		};
	}
	async generate(request: TextProviderRequest): Promise<TextProviderResult> {
		this.calls += 1;
		this.requests.push(request);
		if (this.gate) await this.gate;
		if (this.beforeReturn) await this.beforeReturn();
		if (this.mode === "uncertain")
			throw new TextProviderError("AI_PROVIDER_UNCERTAIN", "uncertain");
		return {
			content: this.output,
			providerRequestId: `organic-${this.calls}`,
			inputTokens: 1,
			outputTokens: 1,
			estimatedCostMicros: BigInt(0),
			actualCostMicros: BigInt(0),
			currency: "VND",
		};
	}
}

const pool = createNodePostgresPool(authority.url);
const runtime = await import(
	"../packages/api/src/services/script-claim-refresh-service.ts"
);
try {
	await resetDatabase(pool);
	const output = (
		fixture: Fixture,
		proposedSubject: "GENERAL" | "PRODUCT",
		tip = false,
	) => ({
		claims: [
			{
				text: tip
					? fixture.snapshot.voiceoverSegments[1]?.text
					: fixture.snapshot.hookVariants[0]?.text,
				occurrence: tip
					? { section: "voiceover", segmentKey: "tip" }
					: { section: "hook", hookKey: "hook" },
				proposedSubject,
			},
		],
	});
	const actorFor = (fixture: Fixture) => ({
		workspaceId: fixture.workspaceId,
		userId: fixture.userId,
	});
	const readScript = async (fixture: Fixture) =>
		(
			await pool.query<{
				revision: number;
				snapshot: ScriptVersionEditableSnapshot;
			}>(
				"select revision, editable_snapshot_json as snapshot from script_version where id = $1",
				[fixture.scriptVersionId],
			)
		).rows[0];

	const current = await seed(pool, "current", "current");
	const currentProvider = new Provider({ output: { claims: [] } });
	const currentResult = await runtime.executeScriptClaimRefresh(
		{
			actor: actorFor(current),
			projectId: current.projectId,
			scriptVersionId: current.scriptVersionId,
			expectedScriptVersionRevision: 1,
			idempotencyKey: "organic-current-1",
		},
		{ provider: currentProvider },
	);
	assert.equal(currentResult.kind, "not_required");
	assert.equal(currentProvider.calls, 0);

	for (const [label, subject] of [
		["general", "GENERAL"],
		["product", "PRODUCT"],
	] as const) {
		const fixture = await seed(pool, label);
		const provider = new Provider({ output: output(fixture, subject) });
		const result = await runtime.executeScriptClaimRefresh(
			{
				actor: actorFor(fixture),
				projectId: fixture.projectId,
				scriptVersionId: fixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: `organic-${label}-1`,
			},
			{ provider },
		);
		assert.equal(result.kind, "completed");
		assert.equal(provider.calls, 1);
		if (result.kind === "completed") {
			assert.equal(result.run.promptVersion, "script-claim-refresh-prompt.v2");
			assert.equal(
				result.run.outputSchemaVersion,
				"script-claim-refresh-output.v2",
			);
			assert.equal(result.resultingScriptVersion.revision, 2);
			assert.equal(
				result.resultingScriptVersion.editableSnapshot.claimsStatus,
				"current",
			);
			assert.equal(
				result.resultingScriptVersion.editableSnapshot.claimsSourceRevision,
				2,
			);
			const claim = result.resultingScriptVersion.editableSnapshot.claims[0];
			assert.equal(
				"subjectStatus" in claim && claim.subjectStatus,
				"NEEDS_CONFIRMATION",
			);
			assert.equal("subjectSource" in claim && claim.subjectSource, null);
			assert.equal(
				"proposedSubject" in claim && claim.proposedSubject,
				subject,
			);
			assert.equal(
				summarizeCurrentScriptVersionClaims({
					contentType: "ORGANIC",
					creationPath: "SCRIPTED",
					currentScriptVersion: result.resultingScriptVersion,
				}).subjectResolution,
				"NEEDS_CONFIRMATION",
			);
		}
	}

	const mixed = await seed(pool, "mixed");
	const mixedProvider = new Provider({
		output: {
			claims: [
				output(mixed, "GENERAL").claims[0],
				output(mixed, "PRODUCT", true).claims[0],
			],
		},
	});
	const mixedResult = await runtime.executeScriptClaimRefresh(
		{
			actor: actorFor(mixed),
			projectId: mixed.projectId,
			scriptVersionId: mixed.scriptVersionId,
			expectedScriptVersionRevision: 1,
			idempotencyKey: "organic-mixed-1",
		},
		{ provider: mixedProvider },
	);
	assert.equal(mixedResult.kind, "completed");
	if (mixedResult.kind === "completed")
		assert.equal(
			mixedResult.resultingScriptVersion.editableSnapshot.claims.length,
			2,
		);

	const zero = await seed(pool, "zero");
	const zeroProvider = new Provider({ output: { claims: [] } });
	const zeroResult = await runtime.executeScriptClaimRefresh(
		{
			actor: actorFor(zero),
			projectId: zero.projectId,
			scriptVersionId: zero.scriptVersionId,
			expectedScriptVersionRevision: 1,
			idempotencyKey: "organic-zero-1",
		},
		{ provider: zeroProvider },
	);
	assert.equal(zeroResult.kind, "completed");
	if (zeroResult.kind === "completed") {
		assert.deepEqual(
			zeroResult.resultingScriptVersion.editableSnapshot.claims,
			[],
		);
		const zeroSummary = summarizeCurrentScriptVersionClaims({
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			currentScriptVersion: zeroResult.resultingScriptVersion,
		});
		assert.equal(zeroSummary.productClaimState, "NONE");
		assert.equal(zeroSummary.subjectResolution, "CONFIRMED");
	}

	const malformed = await seed(pool, "malformed");
	const malformedProvider = new Provider({
		output: {
			claims: [
				{
					text: malformed.snapshot.hookVariants[0]?.text,
					occurrence: { section: "hook", hookKey: "hook" },
					proposedSubject: "PRODUCT",
					subjectStatus: "CONFIRMED",
				},
			],
		},
	});
	const malformedResult = await runtime.executeScriptClaimRefresh(
		{
			actor: actorFor(malformed),
			projectId: malformed.projectId,
			scriptVersionId: malformed.scriptVersionId,
			expectedScriptVersionRevision: 1,
			idempotencyKey: "organic-malformed-1",
		},
		{ provider: malformedProvider },
	);
	assert.equal(malformedResult.kind, "failed");

	const uncertain = await seed(pool, "uncertain");
	const uncertainProvider = new Provider({ mode: "uncertain" });
	const uncertainResult = await runtime.executeScriptClaimRefresh(
		{
			actor: actorFor(uncertain),
			projectId: uncertain.projectId,
			scriptVersionId: uncertain.scriptVersionId,
			expectedScriptVersionRevision: 1,
			idempotencyKey: "organic-uncertain-1",
		},
		{ provider: uncertainProvider },
	);
	assert.equal(uncertainResult.kind, "indeterminate");

	const race = await seed(pool, "race");
	const raceProvider = new Provider({
		output: output(race, "GENERAL"),
		beforeReturn: async () => {
			await pool.query("update script_version set revision = 2 where id = $1", [
				race.scriptVersionId,
			]);
		},
	});
	const raceResult = await runtime.executeScriptClaimRefresh(
		{
			actor: actorFor(race),
			projectId: race.projectId,
			scriptVersionId: race.scriptVersionId,
			expectedScriptVersionRevision: 1,
			idempotencyKey: "organic-race-1",
		},
		{ provider: raceProvider },
	);
	assert.equal(raceResult.kind, "failed");
	if (raceResult.kind === "failed")
		assert.equal(
			raceResult.run.errorCode,
			"SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
		);

	const concurrent = await seed(pool, "concurrent");
	const concurrentProvider = new Provider({
		output: output(concurrent, "GENERAL"),
		blocked: true,
	});
	const base = {
		actor: actorFor(concurrent),
		projectId: concurrent.projectId,
		scriptVersionId: concurrent.scriptVersionId,
		expectedScriptVersionRevision: 1,
	};
	const first = runtime.executeScriptClaimRefresh(
		{ ...base, idempotencyKey: "organic-concurrent-a" },
		{ provider: concurrentProvider },
	);
	while (concurrentProvider.calls === 0)
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
	const second = await runtime.executeScriptClaimRefresh(
		{ ...base, idempotencyKey: "organic-concurrent-b" },
		{ provider: concurrentProvider },
	);
	assert.equal(second.kind, "pending");
	assert.equal(concurrentProvider.calls, 1);
	concurrentProvider.release();
	const firstResult = await first;
	assert.equal(firstResult.kind, "completed");

	// Restart simulation: prepare reads the already-persisted v2 pair and the
	// executor reconstructs the v2 prompt/validator from run metadata.
	const restart = await seed(pool, "restart");
	const prepared = await runtime.prepareScriptClaimRefresh({
		actor: actorFor(restart),
		projectId: restart.projectId,
		scriptVersionId: restart.scriptVersionId,
		expectedScriptVersionRevision: 1,
		idempotencyKey: "organic-restart-1",
	});
	assert.equal(prepared.kind, "prepared");
	if (prepared.kind === "prepared") {
		const restartProvider = new Provider({
			output: output(restart, "PRODUCT"),
		});
		const resumed = await runtime.executeScriptClaimRefresh(
			{
				actor: actorFor(restart),
				projectId: restart.projectId,
				scriptVersionId: restart.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: "organic-restart-1",
			},
			{ provider: restartProvider },
		);
		assert.equal(resumed.kind, "completed");
		assert.equal(
			restartProvider.requests[0]?.messages[1]?.content.includes(
				"proposedSubject",
			),
			true,
		);
	}

	const final = await readScript(zero);
	assert.equal(final?.revision, 2);
	console.log("Organic Claim Refresh v2 focused matrix: PASS");
} finally {
	await pool.end();
}

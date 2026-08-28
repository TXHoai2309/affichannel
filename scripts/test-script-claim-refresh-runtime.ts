import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
	buildScriptClaimRefreshSourceProjection,
	canonicalizeJson,
	SCRIPT_CLAIM_REFRESH_INPUT_VERSION,
	type ScriptVersionEditableSnapshot,
	validateScriptClaimRefreshProviderOutput,
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
]) {
	Reflect.deleteProperty(process.env, name);
}

const migrationsRoot = resolve("packages/db/src/migrations");
const hash = (value: string | unknown) =>
	createHash("sha256")
		.update(typeof value === "string" ? value : canonicalizeJson(value))
		.digest("hex");

const FROZEN_SOURCE_CONTENT_HASH =
	"4dfd77c2e3937b7cc64f351552625b5fc3c890152aff97c7c47092acbaaeac52";
const FROZEN_REQUEST_HASH =
	"61ae10dea61296eb1a6dfddaed7bfa1886e5a80822c926da26d237d42f7ed7ea";
const FROZEN_INPUT_HASH =
	"9278e1235c724541ab4df95ecc4c510330124692fddbf04b527abb3da0bd30d5";
const FROZEN_PROMPT_HASH =
	"1bff3cfb11fc3a465b244e045551aecc9041edc1f75d3066198b6c99398d5e33";

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

function textualSnapshot(snapshot: ScriptVersionEditableSnapshot) {
	return Object.fromEntries(
		Object.entries(snapshot).filter(
			([key]) =>
				key !== "claims" &&
				key !== "claimsStatus" &&
				key !== "claimsSourceRevision",
		),
	);
}

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
	const started = Date.now();
	return new Promise((resolvePromise, reject) => {
		const poll = () => {
			if (predicate()) return resolvePromise();
			if (Date.now() - started > timeoutMs)
				return reject(new Error("Timed out waiting for runtime condition."));
			setTimeout(poll, 10);
		};
		poll();
	});
}

const sourceSnapshot = (
	status: "current" | "stale" = "stale",
): ScriptVersionEditableSnapshot => ({
	schemaVersion: "script-draft.v2",
	language: "vi-VN",
	hookVariants: [
		{ key: "hook-a", text: "Pin này có thời lượng 20 giờ." },
		{ key: "hook-b", text: "Một lựa chọn gọn nhẹ." },
		{ key: "hook-c", text: "Trải nghiệm mỗi ngày." },
	],
	selectedHookKey: "hook-a",
	voiceoverSegments: [
		{ key: "voice-a", text: "Sản phẩm dùng pin 20 giờ." },
		{ key: "voice-b", text: "Thiết kế nhỏ gọn cho hành trình." },
	],
	scenes: [
		{
			order: 1,
			durationSeconds: 15,
			visualDirection: "Cận cảnh sản phẩm",
			onScreenText: "Pin 20 giờ",
			voiceoverSegmentKeys: ["voice-a"],
		},
		{
			order: 2,
			durationSeconds: 15,
			visualDirection: "Minh họa sử dụng",
			onScreenText: null,
			voiceoverSegmentKeys: ["voice-b"],
		},
	],
	cta: { text: "Tìm hiểu thêm." },
	caption: "Pin 20 giờ cho ngày dài.",
	hashtags: ["#affichannel"],
	disclosure: "Nội dung thử nghiệm nội bộ.",
	claims:
		status === "current"
			? [
					{
						text: "Pin này có thời lượng 20 giờ.",
						occurrence: { section: "hook", hookKey: "hook-a" },
					},
				]
			: [
					{
						text: "Pin này có thời lượng 20 giờ.",
						occurrence: { section: "hook", hookKey: "hook-a" },
					},
					{
						text: "Thiết kế nhỏ gọn cho hành trình.",
						occurrence: { section: "voiceover", segmentKey: "voice-b" },
					},
				],
	claimsSourceRevision: 1,
	claimsStatus: status,
});

type Fixture = Readonly<{
	workspaceId: string;
	userId: string;
	productId: string;
	projectId: string;
	generationId: string;
	scriptVersionId: string;
	snapshot: ScriptVersionEditableSnapshot;
}>;

type Pool = ReturnType<typeof createNodePostgresPool>;

async function resetDatabase(pool: Pool): Promise<void> {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	await migrate(drizzle(pool), { migrationsFolder: migrationsRoot });
}

async function seedFixture(
	pool: Pool,
	label: string,
	status: "current" | "stale" = "stale",
): Promise<Fixture> {
	const suffix = randomUUID();
	const workspaceId = `claim-refresh-runtime-workspace-${label}-${suffix}`;
	const userId = `claim-refresh-runtime-user-${label}-${suffix}`;
	const productId = `claim-refresh-runtime-product-${label}-${suffix}`;
	const projectId = `claim-refresh-runtime-project-${label}-${suffix}`;
	const generationId = `claim-refresh-runtime-generation-${label}-${suffix}`;
	const scriptVersionId = `claim-refresh-runtime-script-${label}-${suffix}`;
	const snapshot = sourceSnapshot(status);
	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		`Claim Refresh Runtime ${label}`,
	]);
	await pool.query(
		'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
		[userId, `Claim Refresh Runtime ${label}`, `${userId}@example.test`],
	);
	await pool.query(
		"insert into workspace_member (id, workspace_id, user_id) values ($1, $2, $3)",
		[`member-${suffix}`, workspaceId, userId],
	);
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspaceId, `Runtime Product ${label}`, userId],
	);
	await pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key, created_by_user_id
		) values ($1, $2, $3, $4, 'AFFILIATE', 'SCRIPTED',
			'SCRIPTED_STANDARD', 1, 'content', $5)`,
		[projectId, workspaceId, `Runtime Project ${label}`, productId, userId],
	);
	await pool.query(
		`insert into script_generation (
			id, workspace_id, project_id, created_by_user_id, idempotency_key,
			request_hash, mode, provider, model, prompt_version, output_schema_version,
			input_snapshot_json, input_hash, prompt_hash, status, output_json,
			valid_sections, invalid_sections, finished_at
		) values ($1, $2, $3, $4, $5, $6, 'full', 'deterministic', 'offline-test',
			'script-prompt.v2', 'script-draft.v2', $7, $8, $9, 'completed', $10,
			ARRAY['hook','voiceover','scenes','cta','caption','hashtags','disclosure','claims'], ARRAY[]::text[], now())`,
		[
			generationId,
			workspaceId,
			projectId,
			userId,
			`runtime-generation-${suffix}`,
			hash(`runtime-generation-request-${suffix}`),
			{ fixture: true },
			hash(`runtime-generation-input-${suffix}`),
			hash(`runtime-generation-prompt-${suffix}`),
			snapshot,
		],
	);
	await pool.query(
		`insert into script_version (
			id, workspace_id, project_id, source_generation_id, status,
			version_number, editable_snapshot_json, revision, created_by_user_id
		) values ($1, $2, $3, $4, 'draft', null, $5, 1, $6)`,
		[scriptVersionId, workspaceId, projectId, generationId, snapshot, userId],
	);
	await pool.query(
		`insert into ai_settings (
			id, workspace_id, text_provider, text_model, created_by_user_id, updated_by_user_id
		) values ($1, $2, 'deterministic', 'offline-test-model', $3, $3)`,
		[`ai-${suffix}`, workspaceId, userId],
	);
	return {
		workspaceId,
		userId,
		productId,
		projectId,
		generationId,
		scriptVersionId,
		snapshot,
	};
}

function validProviderClaims(snapshot: ScriptVersionEditableSnapshot) {
	return [
		{
			text: snapshot.voiceoverSegments[0]?.text ?? "",
			occurrence: { section: "voiceover" as const, segmentKey: "voice-a" },
		},
		{
			text: snapshot.hookVariants[0]?.text ?? "",
			occurrence: { section: "hook" as const, hookKey: "hook-a" },
		},
	];
}

class MockClaimRefreshProvider implements TextProvider {
	readonly name = "deterministic-claim-refresh-test";
	calls = 0;
	readonly requests: TextProviderRequest[] = [];
	private readonly output: unknown;
	private readonly mode: "success" | "uncertain" | "definitive";
	private readonly beforeReturn?: () => Promise<void>;
	private releasePromise: Promise<void> | null = null;
	private releaseResolve: (() => void) | null = null;

	constructor(options: {
		output?: unknown;
		mode?: "success" | "uncertain" | "definitive";
		blocked?: boolean;
		beforeReturn?: () => Promise<void>;
	}) {
		this.output = options.output;
		this.mode = options.mode ?? "success";
		this.beforeReturn = options.beforeReturn;
		if (options.blocked) this.block();
	}

	block(): void {
		this.releasePromise = new Promise((resolvePromise) => {
			this.releaseResolve = resolvePromise;
		});
	}

	release(): void {
		this.releaseResolve?.();
		this.releaseResolve = null;
		this.releasePromise = null;
	}

	async estimateCost(
		_request: TextProviderEstimateRequest,
	): Promise<TextProviderEstimate> {
		return {
			estimatedCostMicros: BigInt(0),
			currency: "VND",
			inputTokens: 1,
			pricingBasis: "deterministic-claim-refresh-test",
		};
	}

	async generate(request: TextProviderRequest): Promise<TextProviderResult> {
		this.calls += 1;
		this.requests.push(request);
		if (this.releasePromise) await this.releasePromise;
		if (this.beforeReturn) await this.beforeReturn();
		if (this.mode === "uncertain")
			throw new TextProviderError(
				"AI_PROVIDER_UNCERTAIN",
				"deterministic uncertain provider",
			);
		if (this.mode === "definitive")
			throw new TextProviderError(
				"AI_PROVIDER_ERROR",
				"deterministic definitive provider failure",
			);
		return {
			content: this.output,
			providerRequestId: `runtime-provider-${this.calls}`,
			inputTokens: 11,
			outputTokens: 7,
			estimatedCostMicros: BigInt(13),
			actualCostMicros: BigInt(17),
			currency: "VND",
		};
	}
}

type Runtime =
	typeof import("../packages/api/src/services/script-claim-refresh-service.ts");

const runtime = (await import(
	"../packages/api/src/services/script-claim-refresh-service.ts"
)) as Runtime;
const repository = (await import(
	"../packages/api/src/services/script-claim-refresh-repository.ts"
)) as typeof import("../packages/api/src/services/script-claim-refresh-repository.ts");

async function readScript(pool: Pool, fixture: Fixture) {
	const result = await pool.query<{
		revision: number;
		editableSnapshotJson: ScriptVersionEditableSnapshot;
	}>(
		`select revision, editable_snapshot_json as "editableSnapshotJson"
		 from script_version where id = $1 and workspace_id = $2`,
		[fixture.scriptVersionId, fixture.workspaceId],
	);
	return result.rows[0];
}

async function readRunCount(pool: Pool, fixture: Fixture): Promise<number> {
	const result = await pool.query<{ count: number }>(
		"select count(*)::int as count from script_claim_refresh_run where workspace_id = $1 and project_id = $2",
		[fixture.workspaceId, fixture.projectId],
	);
	return result.rows[0]?.count ?? 0;
}

async function main(): Promise<void> {
	const pool = createNodePostgresPool(authority.url);
	try {
		await resetDatabase(pool);
		console.log(
			`Disposable identity: host=${authority.host}; database=local; schema=public`,
		);

		const baseline = sourceSnapshot("stale");
		const baselineProjection =
			buildScriptClaimRefreshSourceProjection(baseline);
		const baselineInput = {
			inputVersion: SCRIPT_CLAIM_REFRESH_INPUT_VERSION,
			scriptVersionId: "vector-script",
			sourceScriptRevision: 3,
			sourceContentHash: hash(baselineProjection),
			source: baselineProjection,
		};
		const baselinePrompt = await import(
			"../packages/api/src/services/script-claim-refresh-prompt.ts"
		);
		const prompt = baselinePrompt.renderScriptClaimRefreshPrompt(baselineInput);
		const baselineRequestHash = hash({
			inputVersion: SCRIPT_CLAIM_REFRESH_INPUT_VERSION,
			scriptVersionId: "vector-script",
			sourceScriptRevision: 3,
			sourceContentHash: hash(baselineProjection),
		});
		const baselinePromptHash = hash(
			baselinePrompt.canonicalScriptClaimRefreshPrompt(prompt),
		);
		assertEqual(
			hash(baselineProjection),
			FROZEN_SOURCE_CONTENT_HASH,
			"Frozen sourceContentHash",
		);
		assertEqual(baselineRequestHash, FROZEN_REQUEST_HASH, "Frozen requestHash");
		assertEqual(hash(baselineInput), FROZEN_INPUT_HASH, "Frozen inputHash");
		assertEqual(baselinePromptHash, FROZEN_PROMPT_HASH, "Frozen promptHash");
		assertEqual(
			JSON.stringify(Object.keys(baselineProjection)),
			JSON.stringify(["selectedHook", "voiceover", "scenes", "cta", "caption"]),
			"Source projection field allowlist",
		);
		const reversedValidation = validateScriptClaimRefreshProviderOutput(
			{ claims: validProviderClaims(baseline) },
			baselineProjection,
		);
		assert(
			reversedValidation.success,
			"Grounded reversed output must validate.",
		);
		if (reversedValidation.success) {
			assertEqual(
				reversedValidation.claims[0]?.occurrence.section,
				"hook",
				"Candidates must be ordered by source occurrence",
			);
		}
		const malformedValidation = validateScriptClaimRefreshProviderOutput(
			{ claims: "not-an-array" },
			baselineProjection,
		);
		assert(
			!malformedValidation.success &&
				malformedValidation.issueCodes.includes("MALFORMED_OUTPUT"),
			"Malformed provider output must be rejected",
		);
		const invalidLocatorValidation = validateScriptClaimRefreshProviderOutput(
			{
				claims: [
					{
						text: "Pin này có thời lượng 20 giờ.",
						occurrence: { section: "hook", hookKey: "missing-hook" },
					},
				],
			},
			baselineProjection,
		);
		assert(
			!invalidLocatorValidation.success &&
				invalidLocatorValidation.issueCodes.includes("INVALID_LOCATOR"),
			"Invalid provider locator must be rejected",
		);
		console.log("Deterministic source/request/input/prompt hash vectors: PASS");

		const fixture = await seedFixture(pool, "happy");
		const actor = { workspaceId: fixture.workspaceId, userId: fixture.userId };
		const before = await readScript(pool, fixture);
		assert(before, "Happy fixture ScriptVersion must exist.");
		const provider = new MockClaimRefreshProvider({
			output: { claims: validProviderClaims(fixture.snapshot) },
		});
		const completed = await runtime.executeScriptClaimRefresh(
			{
				actor,
				projectId: fixture.projectId,
				scriptVersionId: fixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: "runtime-happy-001",
			},
			{ provider },
		);
		assertEqual(completed.kind, "completed", "Happy refresh must complete");
		assertEqual(provider.calls, 1, "Happy refresh must call provider once");
		if (completed.kind !== "completed") throw new Error("Expected completion.");
		assertEqual(completed.run.sourceScriptRevision, 1, "Run source revision");
		assertEqual(completed.run.resultScriptRevision, 2, "Run result revision");
		assertEqual(
			completed.resultingScriptVersion.revision,
			2,
			"ScriptVersion revision must increment R to R+1",
		);
		assertEqual(
			completed.resultingScriptVersion.editableSnapshot.claimsStatus,
			"current",
			"Claims must become current only after apply",
		);
		assertEqual(
			completed.resultingScriptVersion.editableSnapshot.claimsSourceRevision,
			2,
			"claimsSourceRevision must equal R+1",
		);
		assert(
			completed.resultingScriptVersion.editableSnapshot.claims.some(
				(claim) =>
					claim.occurrence.section === "voiceover" &&
					claim.occurrence.segmentKey === "voice-a",
			) &&
				!completed.resultingScriptVersion.editableSnapshot.claims.some(
					(claim) =>
						claim.occurrence.section === "voiceover" &&
						claim.occurrence.segmentKey === "voice-b",
				),
			"Refresh must add new claims and remove stale claims",
		);
		const after = await readScript(pool, fixture);
		assert(after, "Completed ScriptVersion must remain readable.");
		const beforeContent = textualSnapshot(before.editableSnapshotJson);
		const afterContent = textualSnapshot(after.editableSnapshotJson);
		assertEqual(
			canonicalizeJson(afterContent),
			canonicalizeJson(beforeContent),
			"Script textual fields must remain unchanged",
		);
		assert(
			!Object.hasOwn(completed.run.inputSnapshotJson as object, "claims") &&
				!Object.hasOwn(
					completed.run.inputSnapshotJson as object,
					"productFacts",
				),
			"Refresh input snapshot must exclude existing claims and Product Facts.",
		);
		assertEqual(
			provider.requests[0]?.operation,
			"script-claim-refresh",
			"Provider operation",
		);
		console.log(
			"Happy path, pinned input, R→R+1 CAS and no textual mutation: PASS",
		);

		const currentFixture = await seedFixture(pool, "current", "current");
		const currentProvider = new MockClaimRefreshProvider({
			output: { claims: [] },
		});
		const currentResult = await runtime.executeScriptClaimRefresh(
			{
				actor: {
					workspaceId: currentFixture.workspaceId,
					userId: currentFixture.userId,
				},
				projectId: currentFixture.projectId,
				scriptVersionId: currentFixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: "runtime-current-001",
			},
			{ provider: currentProvider },
		);
		assertEqual(
			currentResult.kind,
			"not_required",
			"Current claims must no-op",
		);
		assertEqual(currentProvider.calls, 0, "Current claims provider calls");
		assertEqual(
			await readRunCount(pool, currentFixture),
			0,
			"Current claims run count",
		);
		console.log(
			"Already-current claims: no provider call and no new run: PASS",
		);

		const mismatchFixture = await seedFixture(pool, "mismatch");
		const mismatchProvider = new MockClaimRefreshProvider({
			output: {
				claims: [
					{
						text: "Không có trong Script.",
						occurrence: { section: "hook", hookKey: "hook-a" },
					},
				],
			},
		});
		const mismatch = await runtime.executeScriptClaimRefresh(
			{
				actor: {
					workspaceId: mismatchFixture.workspaceId,
					userId: mismatchFixture.userId,
				},
				projectId: mismatchFixture.projectId,
				scriptVersionId: mismatchFixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: "runtime-mismatch-001",
			},
			{ provider: mismatchProvider },
		);
		assertEqual(mismatch.kind, "failed", "Mismatch must fail");
		if (mismatch.kind !== "failed")
			throw new Error("Expected mismatch failure.");
		assertEqual(
			mismatch.run.errorCode,
			"SCRIPT_CLAIM_REFRESH_PROVIDER_RESULT_MISMATCH",
			"Mismatch code",
		);
		assertEqual(
			(await readScript(pool, mismatchFixture))?.revision,
			1,
			"Mismatch must not mutate ScriptVersion",
		);
		console.log(
			"Malformed/ungrounded provider result: failed without Script mutation: PASS",
		);

		const uncertainFixture = await seedFixture(pool, "uncertain");
		const uncertainProvider = new MockClaimRefreshProvider({
			mode: "uncertain",
		});
		const uncertain = await runtime.executeScriptClaimRefresh(
			{
				actor: {
					workspaceId: uncertainFixture.workspaceId,
					userId: uncertainFixture.userId,
				},
				projectId: uncertainFixture.projectId,
				scriptVersionId: uncertainFixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: "runtime-uncertain-001",
			},
			{ provider: uncertainProvider },
		);
		assertEqual(uncertain.kind, "indeterminate", "Uncertain provider state");
		assertEqual(uncertainProvider.calls, 1, "Uncertain provider call count");
		const uncertainRetry = await runtime.executeScriptClaimRefresh(
			{
				actor: {
					workspaceId: uncertainFixture.workspaceId,
					userId: uncertainFixture.userId,
				},
				projectId: uncertainFixture.projectId,
				scriptVersionId: uncertainFixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: "runtime-uncertain-001",
			},
			{ provider: uncertainProvider },
		);
		assertEqual(
			uncertainRetry.kind,
			"indeterminate",
			"Indeterminate retry result",
		);
		assertEqual(uncertainProvider.calls, 1, "No automatic paid retry");
		assertEqual(
			(await readScript(pool, uncertainFixture))?.revision,
			1,
			"Uncertain must leave claims stale",
		);
		console.log(
			"Uncertain provider: indeterminate, stale claims, no automatic retry: PASS",
		);

		const definitiveFixture = await seedFixture(pool, "definitive");
		const definitiveProvider = new MockClaimRefreshProvider({
			mode: "definitive",
		});
		const definitive = await runtime.executeScriptClaimRefresh(
			{
				actor: {
					workspaceId: definitiveFixture.workspaceId,
					userId: definitiveFixture.userId,
				},
				projectId: definitiveFixture.projectId,
				scriptVersionId: definitiveFixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: "runtime-definitive-001",
			},
			{ provider: definitiveProvider },
		);
		assertEqual(definitive.kind, "failed", "Definitive provider failure");
		assertEqual(
			(await readScript(pool, definitiveFixture))?.revision,
			1,
			"Definitive failure mutation",
		);
		console.log(
			"Definitive provider failure: failed without Script mutation: PASS",
		);

		const concurrencyFixture = await seedFixture(pool, "concurrency");
		const concurrencyProvider = new MockClaimRefreshProvider({
			output: { claims: validProviderClaims(concurrencyFixture.snapshot) },
			blocked: true,
		});
		const requestBase = {
			actor: {
				workspaceId: concurrencyFixture.workspaceId,
				userId: concurrencyFixture.userId,
			},
			projectId: concurrencyFixture.projectId,
			scriptVersionId: concurrencyFixture.scriptVersionId,
			expectedScriptVersionRevision: 1,
		};
		const first = runtime.executeScriptClaimRefresh(
			{ ...requestBase, idempotencyKey: "runtime-concurrency-a" },
			{ provider: concurrencyProvider },
		);
		await waitFor(() => concurrencyProvider.calls === 1);
		const second = runtime.executeScriptClaimRefresh(
			{ ...requestBase, idempotencyKey: "runtime-concurrency-b" },
			{ provider: concurrencyProvider },
		);
		const settledSecond = await Promise.race([
			second.then(() => true),
			new Promise<boolean>((resolvePromise) =>
				setTimeout(() => resolvePromise(false), 100),
			),
		]);
		assertEqual(
			settledSecond,
			true,
			"Concurrent loser must not call provider or block on winner",
		);
		concurrencyProvider.release();
		const [firstResult, secondResult] = await Promise.all([first, second]);
		assertEqual(concurrencyProvider.calls, 1, "Concurrent provider calls");
		assertEqual(
			await readRunCount(pool, concurrencyFixture),
			1,
			"Concurrent semantic pending rows",
		);
		assertEqual(
			(await readScript(pool, concurrencyFixture))?.revision,
			2,
			"Concurrent revision increment",
		);
		assert(
			firstResult.kind === "completed" &&
				secondResult.kind === "pending" &&
				firstResult.run.id === secondResult.run.id,
			"Concurrent callers must converge on one semantic run.",
		);
		const convergedRun = await repository.getScriptClaimRefreshRunById({
			workspaceId: concurrencyFixture.workspaceId,
			id: firstResult.run.id,
		});
		assert(convergedRun, "Concurrent semantic run must remain readable.");
		assertEqual(
			convergedRun.status,
			"completed",
			"Concurrent run terminal state",
		);
		console.log(
			"Concurrent different idempotency keys: one pending row, one claim winner, one provider call: PASS",
		);

		const sameKeyFixture = await seedFixture(pool, "same-key");
		const sameKeyProvider = new MockClaimRefreshProvider({
			output: { claims: validProviderClaims(sameKeyFixture.snapshot) },
		});
		const sameKeyRequest = {
			actor: {
				workspaceId: sameKeyFixture.workspaceId,
				userId: sameKeyFixture.userId,
			},
			projectId: sameKeyFixture.projectId,
			scriptVersionId: sameKeyFixture.scriptVersionId,
			expectedScriptVersionRevision: 1,
			idempotencyKey: "runtime-same-key",
		};
		const sameKeyResults = await Promise.all([
			runtime.executeScriptClaimRefresh(sameKeyRequest, {
				provider: sameKeyProvider,
			}),
			runtime.executeScriptClaimRefresh(sameKeyRequest, {
				provider: sameKeyProvider,
			}),
		]);
		assertEqual(sameKeyProvider.calls, 1, "Same-key provider calls");
		assertEqual(
			await readRunCount(pool, sameKeyFixture),
			1,
			"Same-key run count",
		);
		assert(
			sameKeyResults.every(
				(item) =>
					item.kind === "completed" ||
					item.kind === "pending" ||
					item.kind === "not_required",
			),
			"Same-key callers must converge without an error",
		);
		console.log(
			"Concurrent same idempotency key: one row and one provider call: PASS",
		);

		const raceFixture = await seedFixture(pool, "source-race");
		const editedSnapshot = {
			...raceFixture.snapshot,
			voiceoverSegments: raceFixture.snapshot.voiceoverSegments.map(
				(segment) =>
					segment.key === "voice-a"
						? { ...segment, text: "Nội dung mới do người dùng sửa." }
						: segment,
			),
			claimsStatus: "stale" as const,
		};
		const raceProvider = new MockClaimRefreshProvider({
			output: { claims: validProviderClaims(raceFixture.snapshot) },
			beforeReturn: async () => {
				await pool.query(
					"update script_version set editable_snapshot_json = $1, revision = 2, updated_at = now() where id = $2",
					[editedSnapshot, raceFixture.scriptVersionId],
				);
			},
		});
		const raceResult = await runtime.executeScriptClaimRefresh(
			{
				actor: {
					workspaceId: raceFixture.workspaceId,
					userId: raceFixture.userId,
				},
				projectId: raceFixture.projectId,
				scriptVersionId: raceFixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: "runtime-source-race",
			},
			{ provider: raceProvider },
		);
		assertEqual(raceResult.kind, "failed", "Source race must fail");
		if (raceResult.kind !== "failed")
			throw new Error("Expected source race failure.");
		assertEqual(
			raceResult.run.errorCode,
			"SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
			"Source race code",
		);
		const racedScript = await readScript(pool, raceFixture);
		assertEqual(
			racedScript?.revision,
			2,
			"Source race preserves newer revision",
		);
		assertEqual(
			racedScript?.editableSnapshotJson.voiceoverSegments[0]?.text,
			"Nội dung mới do người dùng sửa.",
			"Source race preserves newer text",
		);
		console.log(
			"Source edit during provider call: failed CAS, no overwrite, no retry: PASS",
		);

		const staleFixture = await seedFixture(pool, "stale-claimed");
		const stalePrepared = await runtime.prepareScriptClaimRefresh({
			actor: {
				workspaceId: staleFixture.workspaceId,
				userId: staleFixture.userId,
			},
			projectId: staleFixture.projectId,
			scriptVersionId: staleFixture.scriptVersionId,
			expectedScriptVersionRevision: 1,
			idempotencyKey: "runtime-stale-claimed",
		});
		assert(stalePrepared.kind === "prepared", "Stale fixture must prepare");
		if (stalePrepared.kind !== "prepared" || !stalePrepared.run.id)
			throw new Error("Prepared stale run missing.");
		const claimed = await repository.claimScriptClaimRefreshExecution({
			workspaceId: staleFixture.workspaceId,
			id: stalePrepared.run.id,
		});
		assert(claimed.owner, "Stale fixture must acquire execution claim");
		const staleClaimedAt = new Date(Date.now() - 10 * 60 * 1000);
		await pool.query(
			"update script_claim_refresh_run set execution_claimed_at = $2 where id = $1",
			[stalePrepared.run.id, staleClaimedAt],
		);
		const staleProbe = await repository.claimScriptClaimRefreshExecution({
			workspaceId: staleFixture.workspaceId,
			id: stalePrepared.run.id,
		});
		assert(
			!staleProbe.owner && staleProbe.stale,
			"Stale claimed probe must refuse ownership as stale.",
		);
		const staleProvider = new MockClaimRefreshProvider({
			output: { claims: [] },
		});
		const staleResult = await runtime.executeScriptClaimRefresh(
			{
				actor: {
					workspaceId: staleFixture.workspaceId,
					userId: staleFixture.userId,
				},
				projectId: staleFixture.projectId,
				scriptVersionId: staleFixture.scriptVersionId,
				expectedScriptVersionRevision: 1,
				idempotencyKey: "runtime-stale-claimed",
			},
			{ provider: staleProvider },
		);
		assertEqual(staleResult.kind, "indeterminate", "Stale claimed run");
		assertEqual(staleProvider.calls, 0, "Stale claimed provider calls");
		console.log(
			"Stale claimed pending: indeterminate without provider retry: PASS",
		);

		const doubleFinalize =
			await runtime.finalizeScriptClaimRefreshAsIndeterminate({
				workspaceId: fixture.workspaceId,
				runId: completed.run.id,
				executionClaimedAt: completed.run.executionClaimedAt as Date,
			});
		assertEqual(
			doubleFinalize.status,
			"completed",
			"Double finalize must preserve terminal run",
		);
		assertEqual(
			(await readScript(pool, fixture))?.revision,
			2,
			"Double finalize revision",
		);
		console.log(
			"Double finalize: one terminal transition and one revision increment: PASS",
		);

		console.log("AFF-US-018 CR-B provider/runtime/CAS acceptance matrix: PASS");
	} finally {
		await pool.end();
	}
}

await main();

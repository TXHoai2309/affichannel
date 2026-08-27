import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ClaimManifest } from "@affichannel/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter.ts"
);
const {
	FACT_LOCK_MANIFEST_INPUT_VERSION,
	FACT_LOCK_MANIFEST_PROMPT_VERSION,
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	canonicalizeJson,
	computeZeroClaimManifestRequestHash,
	sha256Hex,
} = await import("@affichannel/core");
const { createClaimManifestFromScriptVersion } = await import(
	"../packages/api/src/services/claim-manifest-service.ts"
);
const { executeManifestFactLock, finalizeManifestFactLockRun } = await import(
	"../packages/api/src/services/fact-lock-manifest-service.ts"
);
const { getFactLockState } = await import(
	"../packages/api/src/services/fact-lock-service.ts"
);
const { FactLockGate } = await import(
	"../packages/api/src/services/fact-lock-gate-service.ts"
);
const { FactLockError } = await import(
	"../packages/core/src/fact-lock/errors.ts"
);
const { renderManifestFactLockPrompt } = await import(
	"../packages/api/src/services/fact-lock-manifest-prompt.ts"
);
const { TextProviderError } = await import(
	"../packages/api/src/providers/text/text-provider.ts"
);

type Pool = ReturnType<typeof createNodePostgresPool>;
type Actor = { workspaceId: string; userId: string };
type WorkspaceFixture = Actor & { otherUserId: string };
type ProjectFixture = WorkspaceFixture & {
	productId: string;
	projectId: string;
	scriptVersionId: string;
	snapshot: Record<string, unknown>;
};
type ProviderResult = {
	content: unknown;
	providerRequestId: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	estimatedCostMicros: bigint | null;
	actualCostMicros: bigint | null;
	currency: string | null;
};

const migrationsRoot = resolve("packages/db/src/migrations");
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function expectCode(action: () => Promise<unknown>, code: string) {
	await action().then(
		() => {
			throw new Error(`Expected ${code}.`);
		},
		(error) => {
			assert(
				error instanceof FactLockError && error.code === code,
				`Expected ${code}, received ${error?.code ?? error}.`,
			);
		},
	);
}

async function resetDatabase(pool: Pool) {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
}

function suffix() {
	return randomUUID().replaceAll("-", "");
}

function scriptSnapshot(
	label: string,
	claims: number,
): Record<string, unknown> {
	const firstClaim = `Sản phẩm ${label} có pin 20 giờ`;
	const secondClaim = `Sản phẩm ${label} nặng 500 gram`;
	const claimValues = [firstClaim, secondClaim].slice(0, claims);
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-a", text: `${firstClaim}.` },
			{ key: "hook-b", text: "Một lựa chọn gọn nhẹ cho ngày dài." },
			{ key: "hook-c", text: "Thiết kế phù hợp cho nhịp sống hằng ngày." },
		],
		selectedHookKey: "hook-a",
		voiceoverSegments: [{ key: "voice-a", text: `${firstClaim}.` }],
		scenes: [
			{
				order: 1,
				durationSeconds: 30,
				visualDirection: "Cận cảnh sản phẩm.",
				onScreenText: `${secondClaim}.`,
				voiceoverSegmentKeys: ["voice-a"],
			},
		],
		cta: { text: "Xem thêm thông tin." },
		caption: `Đánh giá ${label}.`,
		hashtags: ["#review"],
		disclosure: "Nội dung có liên kết affiliate.",
		claims: claimValues.map((text, index) => ({
			text,
			occurrence:
				index === 0
					? { section: "hook", hookKey: "hook-a" }
					: { section: "scene", sceneOrder: 1 },
		})),
		claimsSourceRevision: 1,
		claimsStatus: "current",
	};
}

async function seedWorkspace(
	pool: Pool,
	label: string,
): Promise<WorkspaceFixture> {
	const id = suffix();
	const workspaceId = `us18d-workspace-${label}-${id}`;
	const userId = `us18d-user-${label}-${id}`;
	const otherUserId = `us18d-other-${label}-${id}`;
	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		`US18D ${label}`,
	]);
	for (const [userIdValue, userLabel] of [
		[userId, "primary"],
		[otherUserId, "other"],
	] as const) {
		await pool.query(
			'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
			[userIdValue, `US18D ${userLabel}`, `${userIdValue}@example.test`],
		);
		await pool.query(
			"insert into workspace_member (id, workspace_id, user_id) values ($1, $2, $3)",
			[`us18d-member-${suffix()}`, workspaceId, userIdValue],
		);
	}
	return { workspaceId, userId, otherUserId };
}

async function seedProduct(
	pool: Pool,
	workspace: WorkspaceFixture,
): Promise<string> {
	const productId = `us18d-product-${suffix()}`;
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspace.workspaceId, "US18D Product", workspace.userId],
	);
	return productId;
}

async function ensureRuntimeSettings(pool: Pool, workspace: WorkspaceFixture) {
	await pool.query(
		`insert into channel_settings (
			id, workspace_id, niche, target_audience, tone, content_pillar,
			default_cta, affiliate_disclosure, avoid_words, created_by_user_id,
			updated_by_user_id
		) values ($1, $2, 'review', 'người xem', 'thân thiện', 'sản phẩm',
			'Xem thêm', 'Nội dung có liên kết affiliate.', $3, $4, $4)
		 on conflict (workspace_id) do nothing`,
		[`us18d-settings-${suffix()}`, workspace.workspaceId, [], workspace.userId],
	);
	await pool.query(
		`insert into output_rules (
			id, workspace_id, language, aspect_ratio, subtitle_safe_area,
			claim_limit, require_final_cta, created_by_user_id, updated_by_user_id
		) values ($1, $2, 'vi-VN', '9:16', 'standard', null, true, $3, $3)
		 on conflict (workspace_id) do nothing`,
		[`us18d-rules-${suffix()}`, workspace.workspaceId, workspace.userId],
	);
	await pool.query(
		`insert into ai_settings (
			id, workspace_id, text_provider, text_model, created_by_user_id,
			updated_by_user_id
		) values ($1, $2, 'fixture-manifest-provider', 'fixture-manifest-model', $3, $3)
		 on conflict (workspace_id) do update set
		 text_provider = excluded.text_provider, text_model = excluded.text_model`,
		[`us18d-ai-${suffix()}`, workspace.workspaceId, workspace.userId],
	);
}

async function seedScriptVersion(input: {
	pool: Pool;
	workspace: WorkspaceFixture;
	projectId: string;
	label: string;
	snapshot: Record<string, unknown>;
}) {
	const generationId = `us18d-generation-${input.label}-${suffix()}`;
	const scriptVersionId = `us18d-script-${input.label}-${suffix()}`;
	await input.pool.query(
		`insert into script_generation (
			id, workspace_id, project_id, created_by_user_id, idempotency_key,
			request_hash, mode, provider, model, prompt_version, output_schema_version,
			input_snapshot_json, input_hash, prompt_hash, status, output_json,
			valid_sections, invalid_sections, finished_at
		) values ($1, $2, $3, $4, $5, $6, 'full', 'deterministic', 'us18d-fixture',
			'script-prompt.v2', 'script-draft.v2', $7, $8, $9, 'completed', $7,
			$10, ARRAY[]::text[], now())`,
		[
			generationId,
			input.workspace.workspaceId,
			input.projectId,
			input.workspace.userId,
			`us18d-generation-key-${suffix()}`,
			hash(`${input.label}-${suffix()}`),
			JSON.stringify(input.snapshot),
			hash(`${input.label}-input-${suffix()}`),
			hash(`${input.label}-prompt-${suffix()}`),
			[
				"hook",
				"voiceover",
				"scenes",
				"cta",
				"caption",
				"hashtags",
				"disclosure",
				"claims",
			],
		],
	);
	await input.pool.query(
		`insert into script_version (
			id, workspace_id, project_id, source_generation_id, status, version_number,
			editable_snapshot_json, revision, created_by_user_id
		) values ($1, $2, $3, $4, 'draft', null, $5, 1, $6)`,
		[
			scriptVersionId,
			input.workspace.workspaceId,
			input.projectId,
			generationId,
			JSON.stringify(input.snapshot),
			input.workspace.userId,
		],
	);
	return scriptVersionId;
}

async function seedProject(input: {
	pool: Pool;
	workspace: WorkspaceFixture;
	productId: string;
	label: string;
	claims?: number;
}): Promise<ProjectFixture> {
	const projectId = `us18d-project-${input.label}-${suffix()}`;
	const snapshot = scriptSnapshot(input.label, input.claims ?? 2);
	await input.pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key,
			created_by_user_id
		) values ($1, $2, $3, $4, 'AFFILIATE', 'SCRIPTED',
			'SCRIPTED_STANDARD', 1, 'fact-lock', $5)`,
		[
			projectId,
			input.workspace.workspaceId,
			`US18D ${input.label}`,
			input.productId,
			input.workspace.userId,
		],
	);
	const scriptVersionId = await seedScriptVersion({
		pool: input.pool,
		workspace: input.workspace,
		projectId,
		label: input.label,
		snapshot,
	});
	for (const [index, factId] of ["z", "a"].entries()) {
		if ((input.claims ?? 2) === 0) break;
		await input.pool.query(
			`insert into product_fact (
				id, workspace_id, product_id, revision, content, type, status,
				source_type, source_label, confirmed_at, created_by_user_id,
				updated_by_user_id
			) values ($1, $2, $3, 1, $4, 'feature', 'verified', 'official',
				'Fixture source', '2026-08-20', $5, $5)`,
			[
				`us18d-fact-${factId}-${input.label}-${suffix()}`,
				input.workspace.workspaceId,
				input.productId,
				`US18D ${input.label} fact ${factId} ${index}`,
				input.workspace.userId,
			],
		);
	}
	return {
		...input.workspace,
		productId: input.productId,
		projectId,
		scriptVersionId,
		snapshot,
	};
}

async function createManifest(
	actor: Actor,
	projectFixture: ProjectFixture,
): Promise<ClaimManifest> {
	return (
		await createClaimManifestFromScriptVersion({
			actor,
			projectId: projectFixture.projectId,
			scriptVersionId: projectFixture.scriptVersionId,
			expectedScriptVersionRevision: 1,
		})
	).manifest;
}

async function productFacts(pool: Pool, productId: string) {
	const rows = await pool.query<{
		id: string;
		revision: number;
		content: string;
	}>(
		"select id, revision, content from product_fact where product_id = $1 order by id",
		[productId],
	);
	return rows.rows;
}

function validResult(manifest: ClaimManifest, factIds: string[]) {
	return {
		schemaVersion: FACT_LOCK_OUTPUT_SCHEMA_VERSION,
		claims: manifest.claims.map((claim, index) => ({
			claimKey: claim.claimKey,
			classificationStatus: "SUPPORTED",
			reason: "Fixture Product Fact verifies the Manifest claim.",
			confidence: 1,
			suggestionText: null,
			factMappings: [
				{
					factId: factIds[index % factIds.length],
					relation: "supports",
				},
			],
		})),
	};
}

function legacyReadSnapshot(projectFixture: ProjectFixture) {
	return {
		snapshotVersion: "fact-lock-input.v1",
		scriptVersion: {
			id: projectFixture.scriptVersionId,
			revision: 1,
			snapshot: projectFixture.snapshot,
		},
		productFacts: [],
		policy: {
			avoidWords: [],
			affiliateDisclosure: "Nội dung có liên kết affiliate.",
			language: "vi-VN",
		},
		outputRules: {
			language: "vi-VN",
			aspectRatio: "9:16",
			subtitleSafeArea: "standard",
			claimLimit: null,
			requireFinalCta: true,
		},
	};
}

function providerResult(content: unknown): ProviderResult {
	return {
		content,
		providerRequestId: "fixture-request-18d",
		inputTokens: 12,
		outputTokens: 20,
		estimatedCostMicros: 100n,
		actualCostMicros: 100n,
		currency: "USD",
	};
}

function fakeProvider(input: {
	content: unknown;
	calls?: { count: number; requests: unknown[] };
	onGenerate?: (request: unknown) => Promise<void>;
}): import("../packages/api/src/providers/text/text-provider.ts").TextProvider {
	return {
		name: "fake-manifest-provider",
		estimateCost: async () => {
			throw new Error(
				"Manifest runtime must not call estimateCost separately.",
			);
		},
		generate: async (request) => {
			if (input.calls) {
				input.calls.count += 1;
				input.calls.requests.push(request);
			}
			await input.onGenerate?.(request);
			return providerResult(input.content);
		},
	};
}

async function runPromptContractTests() {
	const claim = {
		claimKey: "claim-a",
		claimText: "Pin dùng 20 giờ",
		locator: {
			sourceType: "SCRIPT_VERSION" as const,
			occurrence: { section: "hook" as const, hookKey: "hook-a" },
		},
		sourceTextHash: "a".repeat(64),
	};
	const productFact = {
		id: "fact-a",
		revision: 3,
		content: "Pin dùng 20 giờ trong điều kiện thử nghiệm.",
		type: "feature" as const,
		status: "verified" as const,
		assessment: {
			verification: "verified" as const,
			evidence: "complete" as const,
			freshness: "fresh" as const,
			freshnessReason: "confirmed",
		},
		source: {
			type: "official",
			label: "Fixture",
			url: null,
			confirmedAt: "2026-08-20",
			expiresAt: null,
		},
	};
	const input = {
		claims: [claim],
		productFacts: [productFact],
		policy: {
			maxClaims: 10,
			allowedStatuses: [
				"SUPPORTED",
				"NEEDS_REVIEW",
				"UNSUPPORTED",
				"PROHIBITED",
			],
			requireEvidence: true,
		},
		outputRules: {
			language: "vi-VN",
			aspectRatio: "9:16",
			subtitleSafeArea: "standard",
			claimLimit: 10,
			requireFinalCta: true,
		},
	};
	const first = renderManifestFactLockPrompt(input);
	const second = renderManifestFactLockPrompt(input);
	assert(
		(await sha256Hex(first)) === (await sha256Hex(second)),
		"Identical Manifest prompt inputs must have a deterministic hash.",
	);
	assert(
		first.promptVersion === FACT_LOCK_MANIFEST_PROMPT_VERSION &&
			first.untrustedInputData.includes(FACT_LOCK_MANIFEST_INPUT_VERSION) &&
			first.outputSchema.includes(FACT_LOCK_OUTPUT_SCHEMA_VERSION),
		"Manifest prompt must pin input, prompt and output versions.",
	);
	assert(
		first.trustedInstructions.includes("inventory duy nhất") &&
			first.trustedInstructions.includes("một verdict cho mỗi claimKey") &&
			first.trustedInstructions.includes("Không được thêm claim") &&
			first.trustedInstructions.includes("Product Facts được cung cấp") &&
			!first.untrustedInputData.includes("scriptVersion.snapshot"),
		"Prompt must use only the supplied ordered Manifest/Facts payload.",
	);
	assert(
		(await sha256Hex({
			...first,
			untrustedInputData: first.untrustedInputData.replace(
				"Pin dùng 20 giờ",
				"Pin dùng 21 giờ",
			),
		})) !== (await sha256Hex(first)),
		"Claim text changes must change the prompt hash.",
	);
	assert(
		(await sha256Hex({
			...first,
			untrustedInputData: first.untrustedInputData.replace(
				"Pin dùng 20 giờ trong điều kiện thử nghiệm.",
				"Pin dùng 21 giờ trong điều kiện thử nghiệm.",
			),
		})) !== (await sha256Hex(first)),
		"Product Fact content changes must change the prompt hash.",
	);
	assert(
		(await sha256Hex({
			...first,
			promptVersion: "fact-lock-manifest-prompt.v2",
		})) !== (await sha256Hex(first)),
		"Prompt version changes must change the prompt hash.",
	);
	console.log("Manifest prompt contract matrix A-K: PASS");
}

async function count(pool: Pool, query: string, params: unknown[]) {
	const result = await pool.query<{ count: number }>(query, params);
	return result.rows[0]?.count ?? 0;
}

async function main() {
	await runPromptContractTests();
	const pool = createNodePostgresPool(
		process.env.AFFICHANNEL_M1_TEST_DATABASE_URL as string,
	);
	try {
		await resetDatabase(pool);
		await migrate(drizzle(pool), { migrationsFolder: migrationsRoot });
		const workspace = await seedWorkspace(pool, "runtime");
		await ensureRuntimeSettings(pool, workspace);
		const productId = await seedProduct(pool, workspace);

		const happyProject = await seedProject({
			pool,
			workspace,
			productId,
			label: "happy",
		});
		const happyManifest = await createManifest(workspace, happyProject);
		const facts = await productFacts(pool, productId);
		assert(facts.length === 2, "Expected two Product Facts.");
		const calls = { count: 0, requests: [] as unknown[] };
		const happy = await executeManifestFactLock(
			workspace,
			{
				projectId: happyProject.projectId,
				claimManifestId: happyManifest.id,
				idempotencyKey: "us18d-happy-001",
			},
			fakeProvider({
				content: validResult(
					happyManifest,
					facts.map((fact) => fact.id),
				),
				calls,
				onGenerate: async () => {
					const pending = await pool.query<{
						status: string;
						executionClaimedAt: Date | null;
					}>(
						`select status, execution_claimed_at as "executionClaimedAt"
						 from fact_lock_run where idempotency_key = 'us18d-happy-001'`,
					);
					assert(
						pending.rows[0]?.status === "pending" &&
							pending.rows[0]?.executionClaimedAt !== null,
						"Provider must run after the execution-claim transaction commits.",
					);
				},
			}),
		);
		assert(happy.status === "passed", "Valid Manifest run must pass.");
		assert(
			calls.count === 1 &&
				calls.requests.length === 1 &&
				happy.claims[0]?.claimKey === happyManifest.claims[0]?.claimKey &&
				happy.claims[1]?.claimKey === happyManifest.claims[1]?.claimKey,
			"Exactly one provider call and Manifest-order claims are required.",
		);
		const readState = await getFactLockState(workspace, happyProject.projectId);
		assert(
			readState.latestRequest?.inputMode === "MANIFEST_V1" &&
				readState.latestRequest.claimManifest?.id === happyManifest.id &&
				readState.latestRequest.claimManifest?.fingerprint ===
					happyManifest.fingerprint &&
				readState.latestRequest.claims
					.map((claim) => claim.claimKey)
					.join(",") ===
					happyManifest.claims.map((claim) => claim.claimKey).join(",") &&
				readState.latestRequest.claims.every(
					(claim, index) =>
						claim.claimText === happyManifest.claims[index]?.claimText &&
						JSON.stringify(claim.occurrence) ===
							JSON.stringify(happyManifest.claims[index]?.locator.occurrence),
				),
			"Manifest read must expose explicit mode, scoped identity and Manifest-order authority.",
		);
		const gate = await FactLockGate.evaluate(workspace, happyProject.projectId);
		assert(
			gate.allowed &&
				gate.reason === "FACT_LOCK_PASSED" &&
				gate.factLockRunId === happy.id,
			"Current Manifest PASS must be allowed by the downstream gate.",
		);
		await pool.query(
			`insert into fact_lock_run (
					id, workspace_id, project_id, script_version_id, source_script_revision,
					idempotency_key, request_hash, input_snapshot_json, input_hash, prompt_hash,
					provider, model, prompt_version, output_schema_version, status,
					created_by_user_id, created_at, finished_at
				) values ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9,
					'deterministic', 'legacy-read-fixture', 'fixture', 'fact-lock-output.v1',
					'passed', $10, now() + interval '1 minute', now() + interval '1 minute')`,
			[
				`us18d-legacy-read-${suffix()}`,
				workspace.workspaceId,
				happyProject.projectId,
				happyProject.scriptVersionId,
				`us18d-legacy-read-key-${suffix()}`,
				"a".repeat(64),
				JSON.stringify(legacyReadSnapshot(happyProject)),
				"b".repeat(64),
				"c".repeat(64),
				workspace.userId,
			],
		);
		const mixedState = await getFactLockState(
			workspace,
			happyProject.projectId,
		);
		assert(
			mixedState.latestRequest?.inputMode === "LEGACY" &&
				mixedState.latestRequest.claimManifest === null &&
				mixedState.latestApplicableRun?.inputMode === "LEGACY",
			"Latest request and applicable read must order mixed legacy/Manifest history together.",
		);
		await pool.query(
			"delete from fact_lock_run where idempotency_key like 'us18d-legacy-read-key-%'",
		);
		await pool.query(
			"update product_fact set revision = 2 where product_id = $1",
			[productId],
		);
		const staleFactsState = await getFactLockState(
			workspace,
			happyProject.projectId,
		);
		const staleFactsGate = await FactLockGate.evaluate(
			workspace,
			happyProject.projectId,
		);
		assert(
			staleFactsState.latestRequest?.effectiveStatus === "stale" &&
				staleFactsState.latestApplicableRun === null &&
				staleFactsGate.reason === "FACT_LOCK_STALE_FACTS",
			"Current Manifest run must become stale when a Product Fact revision changes.",
		);
		await pool.query(
			"update product_fact set revision = 1 where product_id = $1",
			[productId],
		);
		await pool.query("update script_version set revision = 2 where id = $1", [
			happyProject.scriptVersionId,
		]);
		const staleScriptState = await getFactLockState(
			workspace,
			happyProject.projectId,
		);
		const staleScriptGate = await FactLockGate.evaluate(
			workspace,
			happyProject.projectId,
		);
		assert(
			staleScriptState.latestRequest?.effectiveStatus === "stale" &&
				staleScriptState.latestApplicableRun === null &&
				staleScriptGate.reason === "FACT_LOCK_STALE_SCRIPT",
			"Historical Manifest run must remain readable but stale after ScriptVersion revision changes.",
		);
		await pool.query("update script_version set revision = 1 where id = $1", [
			happyProject.scriptVersionId,
		]);
		const replacementProductId = await seedProduct(pool, workspace);
		await pool.query("update project set product_id = $1 where id = $2", [
			replacementProductId,
			happyProject.projectId,
		]);
		const staleProductState = await getFactLockState(
			workspace,
			happyProject.projectId,
		);
		const staleProductGate = await FactLockGate.evaluate(
			workspace,
			happyProject.projectId,
		);
		assert(
			staleProductState.latestRequest?.effectiveStatus === "stale" &&
				staleProductState.latestApplicableRun === null &&
				!staleProductGate.allowed,
			"Historical Manifest run must remain readable but stale after Project Product changes.",
		);
		await pool.query("update project set product_id = $1 where id = $2", [
			productId,
			happyProject.projectId,
		]);
		await pool.query(
			"update project set content_type = 'ORGANIC' where id = $1",
			[happyProject.projectId],
		);
		const inactiveIdentityState = await getFactLockState(
			workspace,
			happyProject.projectId,
		);
		const inactiveIdentityGate = await FactLockGate.evaluate(
			workspace,
			happyProject.projectId,
		);
		assert(
			inactiveIdentityState.latestRequest?.effectiveStatus === "stale" &&
				inactiveIdentityState.latestApplicableRun === null &&
				inactiveIdentityGate.reason === "FACT_LOCK_STALE_SCRIPT",
			"Historical Manifest run must remain readable but stale after Project identity becomes inactive.",
		);
		await pool.query(
			"update project set content_type = 'AFFILIATE' where id = $1",
			[happyProject.projectId],
		);
		await pool.query(
			"update fact_lock_run set claim_manifest_fingerprint = $1 where id = $2",
			["a".repeat(64), happy.id],
		);
		await expectCode(
			() => getFactLockState(workspace, happyProject.projectId),
			"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
		);
		await pool.query(
			"update fact_lock_run set claim_manifest_fingerprint = $1 where id = $2",
			[happyManifest.fingerprint, happy.id],
		);
		const request = calls.requests[0] as {
			model: string;
			messages: { role: string; content: string }[];
		};
		assert(
			request.model === "fixture-manifest-model" &&
				request.messages[0]?.content.includes("Chỉ kiểm chứng") &&
				request.messages[2]?.content.includes(
					happyManifest.claims[0]?.claimKey ?? "",
				) &&
				request.messages[2]?.content.includes(facts[0]?.content ?? "") &&
				!request.messages[2]?.content.includes("scriptVersion.snapshot"),
			"Provider request must contain exact Manifest/Facts data and no Script extraction.",
		);
		assert(
			happy.promptHash ===
				(await sha256Hex(
					renderManifestFactLockPrompt({
						claims: happy.inputSnapshot.productFacts.length
							? happyManifest.claims
							: [],
						productFacts: happy.inputSnapshot.productFacts,
						policy: happy.inputSnapshot.policy as NonNullable<
							typeof happy.inputSnapshot.policy
						>,
						outputRules: happy.inputSnapshot.outputRules as NonNullable<
							typeof happy.inputSnapshot.outputRules
						>,
					}),
				)),
			"Persisted promptHash must match the exact Manifest prompt.",
		);
		assert(
			(await count(
				pool,
				"select count(*)::int as count from fact_lock_claim where run_id = $1",
				[happy.id],
			)) === happyManifest.claims.length &&
				(await count(
					pool,
					"select count(*)::int as count from fact_dependency where dependent_type = 'fact_lock' and dependent_id = $1",
					[happy.id],
				)) === facts.length,
			"Passed run must persist claims and all Product Fact dependencies.",
		);
		const scriptAfter = await pool.query<{ snapshot: string }>(
			"select editable_snapshot_json::text as snapshot from script_version where id = $1",
			[happyProject.scriptVersionId],
		);
		assert(
			canonicalizeJson(JSON.parse(scriptAfter.rows[0]?.snapshot ?? "null")) ===
				canonicalizeJson(happyProject.snapshot),
			"Manifest finalization must not mutate ScriptVersion claims.",
		);
		const happyRetry = await executeManifestFactLock(
			workspace,
			{
				projectId: happyProject.projectId,
				claimManifestId: happyManifest.id,
				idempotencyKey: "us18d-happy-001",
			},
			fakeProvider({ content: JSON.stringify({ unexpected: true }), calls }),
		);
		assert(
			happyRetry.id === happy.id && calls.count === 1,
			"Terminal idempotency retry must reuse without a provider call.",
		);
		console.log(
			"Manifest happy path, exact prompt, dependencies and retry: PASS",
		);

		const reverseProject = await seedProject({
			pool,
			workspace,
			productId,
			label: "reverse",
		});
		const reverseManifest = await createManifest(workspace, reverseProject);
		const reverseOutput = validResult(
			reverseManifest,
			facts.map((fact) => fact.id),
		);
		reverseOutput.claims.reverse();
		const reverse = await executeManifestFactLock(
			workspace,
			{
				projectId: reverseProject.projectId,
				claimManifestId: reverseManifest.id,
				idempotencyKey: "us18d-reverse-001",
			},
			fakeProvider({ content: reverseOutput }),
		);
		assert(
			reverse.status === "passed" &&
				reverse.claims.map((claim) => claim.claimKey).join() ===
					reverseManifest.claims.map((claim) => claim.claimKey).join(),
			"Provider output order must not override Manifest order.",
		);
		console.log("Manifest output canonicalization: PASS");

		const invalidCases = [
			{
				label: "missing",
				mutate: (output: ReturnType<typeof validResult>) => {
					output.claims.pop();
				},
			},
			{
				label: "extra",
				mutate: (output: ReturnType<typeof validResult>) => {
					output.claims.push({ ...output.claims[0], claimKey: "extra-key" });
				},
			},
			{
				label: "duplicate",
				mutate: (output: ReturnType<typeof validResult>) => {
					output.claims[1] = { ...output.claims[0] };
				},
			},
			{
				label: "unknown-fact",
				mutate: (output: ReturnType<typeof validResult>) => {
					output.claims[0].factMappings[0].factId = "unknown-fact";
				},
			},
			{
				label: "malformed",
				mutate: () => undefined,
				content: "not-json",
			},
		] as const;
		for (const testCase of invalidCases) {
			const fixture = await seedProject({
				pool,
				workspace,
				productId,
				label: `invalid-${testCase.label}`,
			});
			const manifest = await createManifest(workspace, fixture);
			const output = validResult(
				manifest,
				facts.map((fact) => fact.id),
			);
			testCase.mutate(output);
			const result = await executeManifestFactLock(
				workspace,
				{
					projectId: fixture.projectId,
					claimManifestId: manifest.id,
					idempotencyKey: `us18d-invalid-${testCase.label}`,
				},
				fakeProvider({ content: testCase.content ?? output }),
			);
			assert(
				result.status === "indeterminate" &&
					result.errorCode === "FACT_LOCK_PROVIDER_RESULT_MISMATCH" &&
					(await count(
						pool,
						"select count(*)::int as count from fact_lock_claim where run_id = $1",
						[result.id],
					)) === 0,
				`Invalid provider result ${testCase.label} must be indeterminate with no claims.`,
			);
		}
		console.log("Manifest strict result matrix and no-partial-claims: PASS");

		const uncertainFixture = await seedProject({
			pool,
			workspace,
			productId,
			label: "uncertain",
		});
		const uncertainManifest = await createManifest(workspace, uncertainFixture);
		const uncertainCalls = { count: 0, requests: [] as unknown[] };
		const uncertain = await executeManifestFactLock(
			workspace,
			{
				projectId: uncertainFixture.projectId,
				claimManifestId: uncertainManifest.id,
				idempotencyKey: "us18d-uncertain-001",
			},
			{
				...fakeProvider({ content: {}, calls: uncertainCalls }),
				generate: async () => {
					uncertainCalls.count += 1;
					throw new TextProviderError("AI_TIMEOUT_UNCERTAIN");
				},
			},
		);
		const uncertainRetry = await executeManifestFactLock(
			workspace,
			{
				projectId: uncertainFixture.projectId,
				claimManifestId: uncertainManifest.id,
				idempotencyKey: "us18d-uncertain-001",
			},
			fakeProvider({ content: {}, calls: uncertainCalls }),
		);
		assert(
			uncertain.status === "indeterminate" &&
				uncertainRetry.id === uncertain.id &&
				uncertainCalls.count === 1,
			"Uncertain provider failure must not auto-retry or create claims.",
		);
		const failedFixture = await seedProject({
			pool,
			workspace,
			productId,
			label: "failed",
		});
		const failedManifest = await createManifest(workspace, failedFixture);
		const failed = await executeManifestFactLock(
			workspace,
			{
				projectId: failedFixture.projectId,
				claimManifestId: failedManifest.id,
				idempotencyKey: "us18d-failed-001",
			},
			{
				...fakeProvider({ content: {} }),
				generate: async () => {
					throw new TextProviderError("AI_PROVIDER_ERROR");
				},
			},
		);
		assert(
			failed.status === "failed" &&
				(await count(
					pool,
					"select count(*)::int as count from fact_dependency where dependent_type = 'fact_lock' and dependent_id = $1 and detached_at is null and invalidated_at is null",
					[failed.id],
				)) === 0,
			"Definitive provider failure must fail and detach dependencies.",
		);
		console.log("Manifest provider uncertain/definitive error policy: PASS");

		const concurrencyProject = await seedProject({
			pool,
			workspace,
			productId,
			label: "concurrency",
		});
		const concurrencyManifest = await createManifest(
			workspace,
			concurrencyProject,
		);
		let releaseProvider!: () => void;
		const providerReleased = new Promise<void>((resolvePromise) => {
			releaseProvider = resolvePromise;
		});
		let providerStarted!: () => void;
		const providerStartedPromise = new Promise<void>((resolvePromise) => {
			providerStarted = resolvePromise;
		});
		const concurrencyCalls = { count: 0, requests: [] as unknown[] };
		const heldProvider = {
			...fakeProvider({
				content: validResult(
					concurrencyManifest,
					facts.map((fact) => fact.id),
				),
				calls: concurrencyCalls,
			}),
			generate: async (
				request: Parameters<
					import("../packages/api/src/providers/text/text-provider.ts").TextProvider["generate"]
				>[0],
			) => {
				concurrencyCalls.count += 1;
				concurrencyCalls.requests.push(request);
				providerStarted();
				await providerReleased;
				return providerResult(
					validResult(
						concurrencyManifest,
						facts.map((fact) => fact.id),
					),
				);
			},
		};
		const firstExecution = executeManifestFactLock(
			workspace,
			{
				projectId: concurrencyProject.projectId,
				claimManifestId: concurrencyManifest.id,
				idempotencyKey: "us18d-concurrency-a",
			},
			heldProvider,
		);
		await providerStartedPromise;
		const secondExecution = await executeManifestFactLock(
			workspace,
			{
				projectId: concurrencyProject.projectId,
				claimManifestId: concurrencyManifest.id,
				idempotencyKey: "us18d-concurrency-b",
			},
			fakeProvider({ content: {} }),
		);
		assert(
			secondExecution.status === "pending" && concurrencyCalls.count === 1,
			"Concurrent semantic duplicate must have one pending execution owner.",
		);
		releaseProvider();
		const firstResult = await firstExecution;
		assert(firstResult.status === "passed", "Concurrency owner must finalize.");
		console.log("Manifest semantic pending concurrency: PASS");

		const casProject = await seedProject({
			pool,
			workspace,
			productId,
			label: "cas",
		});
		const casManifest = await createManifest(workspace, casProject);
		let releaseCas!: () => void;
		const casRelease = new Promise<void>((resolvePromise) => {
			releaseCas = resolvePromise;
		});
		let casStarted!: () => void;
		const casStartedPromise = new Promise<void>((resolvePromise) => {
			casStarted = resolvePromise;
		});
		const casProvider = {
			...fakeProvider({
				content: validResult(
					casManifest,
					facts.map((fact) => fact.id),
				),
			}),
			generate: async () => {
				casStarted();
				await casRelease;
				return providerResult(
					validResult(
						casManifest,
						facts.map((fact) => fact.id),
					),
				);
			},
		};
		const casExecution = executeManifestFactLock(
			workspace,
			{
				projectId: casProject.projectId,
				claimManifestId: casManifest.id,
				idempotencyKey: "us18d-cas-001",
			},
			casProvider,
		);
		await casStartedPromise;
		const casRow = await pool.query<{
			id: string;
			executionClaimedAt: Date;
		}>(
			`select id, execution_claimed_at as "executionClaimedAt"
			 from fact_lock_run where project_id = $1 and input_mode = 'MANIFEST_V1'`,
			[casProject.projectId],
		);
		const casRun = casRow.rows[0];
		assert(casRun, "Expected claimed CAS fixture run.");
		const manualFinalize = await finalizeManifestFactLockRun(workspace, {
			runId: casRun.id,
			expectedExecutionClaimedAt: casRun.executionClaimedAt,
			outcome: {
				kind: "success",
				result: providerResult(
					validResult(
						casManifest,
						facts.map((fact) => fact.id),
					),
				),
			},
		});
		releaseCas();
		const casResult = await casExecution;
		assert(
			manualFinalize.status === "passed" &&
				casResult.status === "passed" &&
				(await count(
					pool,
					"select count(*)::int as count from fact_lock_claim where run_id = $1",
					[casRun.id],
				)) === casManifest.claims.length,
			"CAS double-finalize must persist one terminal claim set.",
		);
		console.log("Manifest finalize CAS and duplicate finalizer: PASS");

		const staleProject = await seedProject({
			pool,
			workspace,
			productId,
			label: "stale",
		});
		const staleManifest = await createManifest(workspace, staleProject);
		let releaseStale!: () => void;
		const staleRelease = new Promise<void>((resolvePromise) => {
			releaseStale = resolvePromise;
		});
		let staleStarted!: () => void;
		const staleStartedPromise = new Promise<void>((resolvePromise) => {
			staleStarted = resolvePromise;
		});
		let staleCalls = 0;
		const staleProvider = {
			...fakeProvider({ content: {} }),
			generate: async () => {
				staleCalls += 1;
				staleStarted();
				await staleRelease;
				return providerResult(
					validResult(
						staleManifest,
						facts.map((fact) => fact.id),
					),
				);
			},
		};
		const staleExecution = executeManifestFactLock(
			workspace,
			{
				projectId: staleProject.projectId,
				claimManifestId: staleManifest.id,
				idempotencyKey: "us18d-stale-001",
			},
			staleProvider,
		);
		await staleStartedPromise;
		await pool.query(
			"update fact_lock_run set execution_claimed_at = date_trunc('milliseconds', now() - interval '10 minutes') where project_id = $1",
			[staleProject.projectId],
		);
		const staleSecond = await executeManifestFactLock(
			workspace,
			{
				projectId: staleProject.projectId,
				claimManifestId: staleManifest.id,
				idempotencyKey: "us18d-stale-002",
			},
			fakeProvider({ content: {} }),
		);
		releaseStale();
		await staleExecution;
		assert(
			staleSecond.status === "indeterminate" && staleCalls === 1,
			"Stale pending must become indeterminate without a paid retry.",
		);
		console.log("Manifest stale pending policy: PASS");

		const zeroProject = await seedProject({
			pool,
			workspace,
			productId,
			label: "zero",
			claims: 0,
		});
		const zeroManifest = await createManifest(workspace, zeroProject);
		const zeroCalls = { count: 0, requests: [] as unknown[] };
		const zero = await executeManifestFactLock(
			workspace,
			{
				projectId: zeroProject.projectId,
				claimManifestId: zeroManifest.id,
				idempotencyKey: "us18d-zero-001",
			},
			{
				...fakeProvider({ content: "provider-must-not-run", calls: zeroCalls }),
				generate: async () => {
					throw new Error("Zero-claim provider call is forbidden.");
				},
			},
		);
		assert(
			zero.status === "passed" &&
				zeroCalls.count === 0 &&
				zero.inputSnapshot.zeroClaim?.providerRequired === false &&
				zero.requestHash ===
					(await computeZeroClaimManifestRequestHash({
						claimManifestFingerprint: zeroManifest.fingerprint,
					})) &&
				(await count(
					pool,
					"select count(*)::int as count from fact_lock_claim where run_id = $1",
					[zero.id],
				)) === 0,
			"Zero-claim must retain the deterministic no-provider path.",
		);
		const zeroReadState = await getFactLockState(
			workspace,
			zeroProject.projectId,
		);
		const zeroGate = await FactLockGate.evaluate(
			workspace,
			zeroProject.projectId,
		);
		assert(
			zeroReadState.latestRequest?.inputMode === "MANIFEST_V1" &&
				zeroReadState.latestRequest.claimManifest?.id === zeroManifest.id &&
				zeroReadState.latestRequest.facts.length === 0 &&
				zeroReadState.latestRequest.claims.length === 0 &&
				zeroGate.allowed &&
				zeroGate.reason === "FACT_LOCK_PASSED",
			"Current zero-claim Manifest must be readable and pass the downstream gate.",
		);
		console.log("Zero-claim no-provider regression: PASS");

		console.log("Provider calls are fake/offline; live provider calls: 0");
		console.log(
			"AFF-US-018 Phase 18D runtime + Phase 18E read/gate checks: PASS",
		);
	} finally {
		await pool.end();
	}
}

await main();

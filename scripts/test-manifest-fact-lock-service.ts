import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter.ts"
);
const {
	buildClaimManifestFromScriptVersion,
	computeFactLockZeroClaimPolicyHash,
	computeManifestFactLockInputHash,
	computeManifestRequestHash,
	computeProductFactsFingerprint,
	computeZeroClaimManifestRequestHash,
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	FACT_LOCK_ZERO_CLAIM_MODEL,
	FACT_LOCK_ZERO_CLAIM_PROVIDER,
	FACT_LOCK_ZERO_CLAIM_PROMPT_VERSION,
	factLockZeroClaimPolicyProjection,
	sha256Hex,
	scriptGenerationSections,
} = await import("@affichannel/core");
const { db } = await import("@affichannel/db");
const { FactLockError } = await import("@affichannel/core/fact-lock/errors");
const { getClaimManifestByIdInTransaction } = await import(
	"../packages/api/src/services/claim-manifest-repository.ts"
);
const { createClaimManifestFromScriptVersion } = await import(
	"../packages/api/src/services/claim-manifest-service.ts"
);
const {
	finalizeFactLockRun,
	getFactLockState,
	mutateFactLockClaimSourceAndRefresh,
	prepareFactLockRun,
	recordFactLockEstimate,
} = await import("../packages/api/src/services/fact-lock-service.ts");
const { prepareManifestFactLock } = await import(
	"../packages/api/src/services/fact-lock-manifest-service.ts"
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

const migrationsRoot = resolve("packages/db/src/migrations");
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

async function expectCode(
	action: () => Promise<unknown>,
	code: string,
): Promise<void> {
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

function suffix() {
	return randomUUID().replaceAll("-", "");
}

function scriptSnapshot(
	label: string,
	claims: number,
): Record<string, unknown> {
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
		claims: Array.from({ length: claims }, () => ({
			text: factualText,
			occurrence: { section: "hook", hookKey: "hook-a" },
		})),
		claimsSourceRevision: 1,
		claimsStatus: "current",
	};
}

async function resetDatabase(pool: Pool) {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
}

async function seedWorkspace(
	pool: Pool,
	label: string,
): Promise<WorkspaceFixture> {
	const id = suffix();
	const workspaceId = `us18c-workspace-${label}-${id}`;
	const userId = `us18c-user-${label}-${id}`;
	const otherUserId = `us18c-other-${label}-${id}`;
	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		`US18C ${label}`,
	]);
	for (const [userIdValue, userLabel] of [
		[userId, "primary"],
		[otherUserId, "other"],
	] as const) {
		await pool.query(
			'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
			[userIdValue, `US18C ${userLabel}`, `${userIdValue}@example.test`],
		);
		await pool.query(
			"insert into workspace_member (id, workspace_id, user_id) values ($1, $2, $3)",
			[`us18c-member-${suffix()}`, workspaceId, userIdValue],
		);
	}
	return { workspaceId, userId, otherUserId };
}

async function seedProduct(
	pool: Pool,
	workspace: WorkspaceFixture,
	label: string,
): Promise<string> {
	const productId = `us18c-product-${label}-${suffix()}`;
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[
			productId,
			workspace.workspaceId,
			`US18C Product ${label}`,
			workspace.userId,
		],
	);
	return productId;
}

async function ensurePolicy(pool: Pool, workspace: WorkspaceFixture) {
	await pool.query(
		`insert into channel_settings (
			id, workspace_id, niche, target_audience, tone, content_pillar,
			default_cta, affiliate_disclosure, avoid_words, created_by_user_id,
			updated_by_user_id
		) values ($1, $2, 'review', 'người xem', 'thân thiện', 'sản phẩm',
			'Xem thêm', 'Nội dung có liên kết affiliate.', $3, $4, $4)
		 on conflict (workspace_id) do nothing`,
		[`us18c-settings-${suffix()}`, workspace.workspaceId, [], workspace.userId],
	);
	await pool.query(
		`insert into output_rules (
			id, workspace_id, language, aspect_ratio, subtitle_safe_area,
			claim_limit, require_final_cta, created_by_user_id, updated_by_user_id
		) values ($1, $2, 'vi-VN', '9:16', 'standard', null, true, $3, $3)
		 on conflict (workspace_id) do nothing`,
		[`us18c-rules-${suffix()}`, workspace.workspaceId, workspace.userId],
	);
}

async function seedScriptVersion(input: {
	pool: Pool;
	workspace: WorkspaceFixture;
	projectId: string;
	label: string;
	snapshot: Record<string, unknown>;
	status?: "draft" | "saved";
	versionNumber?: number;
}) {
	const generationId = `us18c-generation-${input.label}-${suffix()}`;
	const scriptVersionId = `us18c-script-${input.label}-${suffix()}`;
	const generationHash = hash(`${input.label}-${suffix()}`);
	await input.pool.query(
		`insert into script_generation (
			id, workspace_id, project_id, created_by_user_id, idempotency_key,
			request_hash, mode, provider, model, prompt_version, output_schema_version,
			input_snapshot_json, input_hash, prompt_hash, status, output_json,
			valid_sections, invalid_sections, finished_at
		) values ($1, $2, $3, $4, $5, $6, 'full', 'deterministic', 'us18c-fixture',
			'script-prompt.v2', 'script-draft.v2', $7, $8, $9, 'completed', $7,
			$10, ARRAY[]::text[], now())`,
		[
			generationId,
			input.workspace.workspaceId,
			input.projectId,
			input.workspace.userId,
			`us18c-generation-${suffix()}`,
			generationHash,
			JSON.stringify(input.snapshot),
			hash(`${input.label}-input-${suffix()}`),
			hash(`${input.label}-prompt-${suffix()}`),
			[...scriptGenerationSections],
		],
	);
	const status = input.status ?? "draft";
	await input.pool.query(
		`insert into script_version (
			id, workspace_id, project_id, source_generation_id, status, version_number,
			editable_snapshot_json, revision, created_by_user_id, saved_at
		) values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9)`,
		[
			scriptVersionId,
			input.workspace.workspaceId,
			input.projectId,
			generationId,
			status,
			status === "saved" ? (input.versionNumber ?? 2) : null,
			JSON.stringify(input.snapshot),
			input.workspace.userId,
			status === "saved" ? new Date() : null,
		],
	);
	return scriptVersionId;
}

async function seedProject(input: {
	pool: Pool;
	workspace: WorkspaceFixture;
	label: string;
	productId: string | null;
	claims?: number;
	factCount?: number;
	contentType?: "AFFILIATE" | "ORGANIC";
	creationPath?: "SCRIPTED" | "QUICK_IMAGE" | "MEDIA_FIRST";
}): Promise<ProjectFixture> {
	const projectId = `us18c-project-${input.label}-${suffix()}`;
	const snapshot = scriptSnapshot(input.label, input.claims ?? 1);
	await ensurePolicy(input.pool, input.workspace);
	await input.pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key,
			created_by_user_id
		) values ($1, $2, $3, $4, $5, $6, 'SCRIPTED_STANDARD', 1, 'fact-lock', $7)`,
		[
			projectId,
			input.workspace.workspaceId,
			`US18C ${input.label}`,
			input.productId,
			input.contentType ?? "AFFILIATE",
			input.creationPath ?? "SCRIPTED",
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
	if (input.productId && (input.factCount ?? 2) > 0) {
		for (const [index, factId] of ["z", "a"].entries()) {
			if (index >= (input.factCount ?? 2)) break;
			await input.pool.query(
				`insert into product_fact (
					id, workspace_id, product_id, revision, content, type, status,
					source_type, source_label, confirmed_at, created_by_user_id,
					updated_by_user_id
				) values ($1, $2, $3, 1, $4, 'feature', 'verified', 'official',
					'Fixture source', '2026-08-20', $5, $5)`,
				[
					`us18c-fact-${factId}-${input.label}-${suffix()}`,
					input.workspace.workspaceId,
					input.productId,
					`US18C ${input.label} fact ${factId}`,
					input.workspace.userId,
				],
			);
		}
	}
	return {
		...input.workspace,
		productId: input.productId ?? "",
		projectId,
		scriptVersionId,
		snapshot,
	};
}

async function insertManifestRun(input: {
	pool: Pool;
	project: ProjectFixture;
	manifestId: string;
	manifestFingerprint: string;
	requestHash: string;
	inputHash: string;
	inputSnapshot: unknown;
	idempotencyKey: string;
}) {
	await input.pool.query(
		`insert into fact_lock_run (
			id, workspace_id, project_id, script_version_id, source_script_revision,
			input_mode, claim_manifest_id, claim_manifest_fingerprint,
			idempotency_key, request_hash, input_snapshot_json, input_hash, prompt_hash,
			provider, model, prompt_version, output_schema_version, status, created_by_user_id
		) values ($1, $2, $3, $4, 1, 'MANIFEST_V1', $5, $6, $7, $8, $9, $10,
			$11, 'fixture-provider', 'fixture-model', 'fixture-prompt-v1',
			'fact-lock-output.v1', 'pending', $12)`,
		[
			`us18c-manifest-run-${suffix()}`,
			input.project.workspaceId,
			input.project.projectId,
			input.project.scriptVersionId,
			input.manifestId,
			input.manifestFingerprint,
			input.idempotencyKey,
			input.requestHash,
			JSON.stringify(input.inputSnapshot),
			input.inputHash,
			hash(`fixture-prompt-${suffix()}`),
			input.project.userId,
		],
	);
}

async function insertWrongSourceManifest(
	pool: Pool,
	projectFixture: ProjectFixture,
	savedScriptVersionId: string,
) {
	const built = await buildClaimManifestFromScriptVersion({
		workspaceId: projectFixture.workspaceId,
		projectId: projectFixture.projectId,
		productId: projectFixture.productId,
		scriptVersionId: savedScriptVersionId,
		scriptVersionRevision: 1,
		snapshot: projectFixture.snapshot,
	});
	const manifestId = `us18c-wrong-source-manifest-${suffix()}`;
	await pool.query(
		`insert into claim_manifest (
			id, workspace_id, project_id, source_type, source_script_version_id,
			source_script_revision, source_snapshot_json, source_content_hash,
			product_id, schema_version, builder_version, claims_json, claim_count,
			is_empty, fingerprint, created_by_user_id
		) values ($1, $2, $3, 'SCRIPT_VERSION', $4, $5, $6, $7, $8, $9, $10,
			$11, $12, $13, $14, $15)`,
		[
			manifestId,
			projectFixture.workspaceId,
			projectFixture.projectId,
			savedScriptVersionId,
			1,
			JSON.stringify(built.source),
			built.source.sourceContentHash,
			projectFixture.productId,
			built.schemaVersion,
			built.builderVersion,
			JSON.stringify(built.claims),
			built.claimCount,
			built.isEmpty,
			built.fingerprint,
			projectFixture.userId,
		],
	);
	return { id: manifestId, fingerprint: built.fingerprint };
}

async function main() {
	const pool = createNodePostgresPool(
		process.env.AFFICHANNEL_M1_TEST_DATABASE_URL as string,
	);
	try {
		await resetDatabase(pool);
		await migrate(drizzle(pool), { migrationsFolder: migrationsRoot });

		const workspace = await seedWorkspace(pool, "primary");
		const productId = await seedProduct(pool, workspace, "primary");
		const primary = await seedProject({
			pool,
			workspace,
			label: "primary",
			productId,
			factCount: 2,
		});
		const manifestResult = await createClaimManifestFromScriptVersion({
			actor: workspace,
			projectId: primary.projectId,
			scriptVersionId: primary.scriptVersionId,
			expectedScriptVersionRevision: 1,
		});
		const manifest = manifestResult.manifest;

		const prepared = await prepareManifestFactLock({
			actor: workspace,
			projectId: primary.projectId,
			claimManifestId: manifest.id,
			idempotencyKey: "us18c-same-intent-001",
		});
		assert(
			prepared.kind === "prepared",
			"Current Manifest must produce a plan.",
		);
		assert(
			prepared.manifest.id === manifest.id &&
				prepared.inputSnapshot.claimManifest.id === manifest.id &&
				prepared.inputSnapshot.source.scriptVersionId ===
					primary.scriptVersionId,
			"Preparation must use the explicitly selected current Manifest/source.",
		);
		assert(
			prepared.inputSnapshot.productFactsFingerprint ===
				prepared.productFactsFingerprint,
			"Input snapshot must carry the exact Product Facts fingerprint.",
		);
		assert(
			prepared.productFactsFingerprint ===
				(await computeProductFactsFingerprint(prepared.productFacts)),
			"Product Facts fingerprint must use the Phase 18A helper.",
		);
		assert(
			prepared.requestHash ===
				(await computeManifestRequestHash({
					claimManifestFingerprint: manifest.fingerprint,
					productFactsFingerprint: prepared.productFactsFingerprint,
				})),
			"Manifest requestHash must use the Phase 18A helper.",
		);
		assert(
			!("claims" in prepared.inputSnapshot) &&
				prepared.inputSnapshot.inputMode === "MANIFEST_V1" &&
				prepared.inputSnapshot.inputVersion === "fact-lock.manifest.v1",
			"Input snapshot must reference the immutable Manifest without copying claims.",
		);
		const repeat = await prepareManifestFactLock({
			actor: workspace,
			projectId: primary.projectId,
			claimManifestId: manifest.id,
			idempotencyKey: "us18c-same-intent-002",
		});
		assert(
			repeat.kind === "prepared" &&
				repeat.requestHash === prepared.requestHash &&
				repeat.inputHash === prepared.inputHash,
			"Same semantic preparation must remain deterministic before persistence.",
		);
		const runCountBeforePersistence = await pool.query(
			"select count(*)::int as count from fact_lock_run where project_id = $1",
			[primary.projectId],
		);
		assert(
			runCountBeforePersistence.rows[0]?.count === 0,
			"Non-empty Phase 18C preparation must not create a pending row.",
		);

		await insertManifestRun({
			pool,
			project: primary,
			manifestId: manifest.id,
			manifestFingerprint: manifest.fingerprint,
			requestHash: prepared.requestHash,
			inputHash: prepared.inputHash,
			inputSnapshot: prepared.inputSnapshot,
			idempotencyKey: "us18c-existing-run-001",
		});
		const existing = await prepareManifestFactLock({
			actor: workspace,
			projectId: primary.projectId,
			claimManifestId: manifest.id,
			idempotencyKey: "us18c-existing-run-001",
		});
		assert(
			existing.kind === "existing",
			"Existing Manifest run must be reused.",
		);

		const factRow = await pool.query<{ id: string }>(
			"select id from product_fact where product_id = $1 order by id limit 1",
			[productId],
		);
		const changedFactId = factRow.rows[0]?.id;
		assert(changedFactId, "Expected a Product Fact fixture.");
		await pool.query(
			"update product_fact set revision = 2, content = content || ' changed' where id = $1",
			[changedFactId],
		);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: primary.projectId,
					claimManifestId: manifest.id,
					idempotencyKey: "us18c-existing-run-001",
				}),
			"FACT_LOCK_IDEMPOTENCY_CONFLICT",
		);

		const otherProductId = await seedProduct(pool, workspace, "replacement");
		await pool.query("update project set product_id = $1 where id = $2", [
			otherProductId,
			primary.projectId,
		]);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: primary.projectId,
					claimManifestId: manifest.id,
					idempotencyKey: "us18c-product-changed-001",
				}),
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
		);
		await pool.query("update project set product_id = $1 where id = $2", [
			productId,
			primary.projectId,
		]);

		await pool.query(
			"update project set content_type = 'ORGANIC' where id = $1",
			[primary.projectId],
		);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: primary.projectId,
					claimManifestId: manifest.id,
					idempotencyKey: "us18c-identity-changed-001",
				}),
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
		);
		await pool.query(
			"update project set content_type = 'AFFILIATE' where id = $1",
			[primary.projectId],
		);
		await pool.query(
			"update project set content_format_key = 'UNKNOWN_FORMAT' where id = $1",
			[primary.projectId],
		);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: primary.projectId,
					claimManifestId: manifest.id,
					idempotencyKey: "us18c-format-changed-001",
				}),
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
		);
		await pool.query(
			"update project set content_format_key = 'SCRIPTED_STANDARD' where id = $1",
			[primary.projectId],
		);

		await pool.query(
			"update claim_manifest set fingerprint = $1 where id = $2",
			["f".repeat(64), manifest.id],
		);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: primary.projectId,
					claimManifestId: manifest.id,
					idempotencyKey: "us18c-corrupt-manifest-001",
				}),
			"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
		);
		await pool.query(
			"update claim_manifest set fingerprint = $1 where id = $2",
			[manifest.fingerprint, manifest.id],
		);

		const savedScriptVersionId = await seedScriptVersion({
			pool,
			workspace,
			projectId: primary.projectId,
			label: "saved-source",
			snapshot: primary.snapshot,
			status: "saved",
			versionNumber: 2,
		});
		const wrongSource = await insertWrongSourceManifest(
			pool,
			primary,
			savedScriptVersionId,
		);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: primary.projectId,
					claimManifestId: wrongSource.id,
					idempotencyKey: "us18c-wrong-source-001",
				}),
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
		);

		const otherProject = await seedProject({
			pool,
			workspace,
			label: "other-project",
			productId,
			factCount: 1,
		});
		const otherManifest = (
			await createClaimManifestFromScriptVersion({
				actor: workspace,
				projectId: otherProject.projectId,
				scriptVersionId: otherProject.scriptVersionId,
				expectedScriptVersionRevision: 1,
			})
		).manifest;
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: primary.projectId,
					claimManifestId: otherManifest.id,
					idempotencyKey: "us18c-cross-project-001",
				}),
			"CLAIM_MANIFEST_NOT_FOUND",
		);
		const foreignWorkspace = await seedWorkspace(pool, "foreign");
		const foreignProduct = await seedProduct(pool, foreignWorkspace, "foreign");
		const foreignProject = await seedProject({
			pool,
			workspace: foreignWorkspace,
			label: "foreign",
			productId: foreignProduct,
			factCount: 1,
		});
		const foreignManifest = (
			await createClaimManifestFromScriptVersion({
				actor: foreignWorkspace,
				projectId: foreignProject.projectId,
				scriptVersionId: foreignProject.scriptVersionId,
				expectedScriptVersionRevision: 1,
			})
		).manifest;
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: primary.projectId,
					claimManifestId: foreignManifest.id,
					idempotencyKey: "us18c-cross-workspace-001",
				}),
			"CLAIM_MANIFEST_NOT_FOUND",
		);

		await pool.query("update script_version set revision = 2 where id = $1", [
			primary.scriptVersionId,
		]);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: primary.projectId,
					claimManifestId: manifest.id,
					idempotencyKey: "us18c-historical-001",
				}),
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
		);
		await pool.query("update script_version set revision = 1 where id = $1", [
			primary.scriptVersionId,
		]);

		const noFacts = await seedProject({
			pool,
			workspace,
			label: "no-facts",
			productId: await seedProduct(pool, workspace, "no-facts"),
			factCount: 0,
		});
		const noFactsManifest = (
			await createClaimManifestFromScriptVersion({
				actor: workspace,
				projectId: noFacts.projectId,
				scriptVersionId: noFacts.scriptVersionId,
				expectedScriptVersionRevision: 1,
			})
		).manifest;
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: noFacts.projectId,
					claimManifestId: noFactsManifest.id,
					idempotencyKey: "us18c-no-facts-001",
				}),
			"FACT_LOCK_NO_USABLE_FACTS",
		);

		const zeroProject = await seedProject({
			pool,
			workspace,
			label: "zero-claim",
			productId,
			claims: 0,
			factCount: 0,
		});
		const zeroManifest = (
			await createClaimManifestFromScriptVersion({
				actor: workspace,
				projectId: zeroProject.projectId,
				scriptVersionId: zeroProject.scriptVersionId,
				expectedScriptVersionRevision: 1,
			})
		).manifest;
		const zeroPrepared = await prepareManifestFactLock({
			actor: workspace,
			projectId: zeroProject.projectId,
			claimManifestId: zeroManifest.id,
			idempotencyKey: "us18c-zero-claim-001",
		});
		assert(
			zeroPrepared.kind === "existing" && zeroPrepared.zeroClaim,
			"Zero-claim must persist a completed internal run.",
		);
		assert(
			zeroPrepared.zeroClaim.providerRequired === false &&
				zeroPrepared.zeroClaim.dependenciesRequired === false &&
				zeroPrepared.zeroClaim.claimResults.length === 0 &&
				zeroPrepared.zeroClaim.status === "passed",
			"Zero-claim outcome must be PASS with no provider/dependency/claim work.",
		);
		const zeroRunCount = await pool.query(
			"select count(*)::int as count from fact_lock_run where project_id = $1",
			[zeroProject.projectId],
		);
		assert(
			zeroRunCount.rows[0]?.count === 1,
			"Zero-claim must persist exactly one run.",
		);
		assert(
			zeroPrepared.requestHash ===
				(await computeZeroClaimManifestRequestHash({
					claimManifestFingerprint: zeroManifest.fingerprint,
				})),
			"Zero-claim request hash must use the Phase 18A helper.",
		);
		const zeroRunRows = await pool.query<{
			status: string;
			scriptVersionId: string | null;
			sourceScriptRevision: number | null;
			inputMode: string | null;
			claimManifestId: string | null;
			claimManifestFingerprint: string | null;
			provider: string;
			model: string;
			promptVersion: string;
			outputSchemaVersion: string;
			promptHash: string;
			inputSnapshot: unknown;
			inputHash: string;
			providerRequestId: string | null;
			inputTokens: number | null;
			outputTokens: number | null;
			estimatedCostMicros: string | null;
			actualCostMicros: string | null;
			currency: string | null;
			errorCode: string | null;
			errorMessage: string | null;
			executionClaimedAt: Date | null;
			finishedAt: Date | null;
			createdByUserId: string;
		}>(
			`select status, input_mode as "inputMode",
				script_version_id as "scriptVersionId",
				source_script_revision as "sourceScriptRevision",
				claim_manifest_id as "claimManifestId",
				claim_manifest_fingerprint as "claimManifestFingerprint",
				provider, model, prompt_version as "promptVersion",
				output_schema_version as "outputSchemaVersion", prompt_hash as "promptHash",
				input_snapshot_json as "inputSnapshot", input_hash as "inputHash",
				provider_request_id as "providerRequestId", input_tokens as "inputTokens",
				output_tokens as "outputTokens", estimated_cost_micros::text as "estimatedCostMicros",
				actual_cost_micros::text as "actualCostMicros", currency,
				error_code as "errorCode", error_message as "errorMessage",
				execution_claimed_at as "executionClaimedAt", finished_at as "finishedAt",
				created_by_user_id as "createdByUserId"
			 from fact_lock_run where id = $1`,
			[zeroPrepared.run.id],
		);
		const zeroRun = zeroRunRows.rows[0];
		assert(zeroRun, "Expected persisted zero-claim run.");
		const expectedZeroClaimPolicyHash =
			"114bb75501611f257295d89c0ee72d03bceed2cf2400043a614b887122c496e4";
		assert(
			zeroRun.status === "passed" &&
				zeroRun.scriptVersionId === zeroProject.scriptVersionId &&
				zeroRun.sourceScriptRevision === 1 &&
				zeroRun.inputMode === "MANIFEST_V1" &&
				zeroRun.claimManifestId === zeroManifest.id &&
				zeroRun.claimManifestFingerprint === zeroManifest.fingerprint &&
				zeroRun.provider === FACT_LOCK_ZERO_CLAIM_PROVIDER &&
				zeroRun.model === FACT_LOCK_ZERO_CLAIM_MODEL &&
				zeroRun.promptVersion === FACT_LOCK_ZERO_CLAIM_PROMPT_VERSION &&
				zeroRun.outputSchemaVersion === FACT_LOCK_OUTPUT_SCHEMA_VERSION &&
				zeroRun.promptHash === expectedZeroClaimPolicyHash &&
				zeroRun.promptHash === (await computeFactLockZeroClaimPolicyHash()) &&
				zeroRun.providerRequestId === null &&
				zeroRun.inputTokens === null &&
				zeroRun.outputTokens === null &&
				zeroRun.estimatedCostMicros === null &&
				zeroRun.actualCostMicros === null &&
				zeroRun.currency === null &&
				zeroRun.errorCode === null &&
				zeroRun.errorMessage === null &&
				zeroRun.executionClaimedAt === null &&
				zeroRun.finishedAt !== null &&
				zeroRun.createdByUserId === workspace.userId,
			"Zero-claim run must use exact internal metadata and no paid telemetry.",
		);
		const zeroSnapshot = zeroRun.inputSnapshot as Record<string, unknown>;
		assert(
			zeroSnapshot.inputMode === "MANIFEST_V1" &&
				zeroSnapshot.inputVersion === "fact-lock.manifest.v1" &&
				(zeroSnapshot.claimManifest as Record<string, unknown>).id ===
					zeroManifest.id &&
				Array.isArray(zeroSnapshot.productFacts) &&
				(zeroSnapshot.productFacts as unknown[]).length === 0 &&
				zeroSnapshot.productFactsFingerprint === undefined &&
				(zeroSnapshot.zeroClaim as Record<string, unknown>).status === "passed",
			"Zero-claim input snapshot must contain no fake Product Facts.",
		);
		assert(
			zeroRun.inputHash ===
				(await computeManifestFactLockInputHash(zeroSnapshot)),
			"Persisted inputHash must hash the exact zero-claim snapshot.",
		);
		const zeroClaimCount = await pool.query(
			"select count(*)::int as count from fact_lock_claim where run_id = $1",
			[zeroPrepared.run.id],
		);
		const zeroDependencyCount = await pool.query(
			"select count(*)::int as count from fact_dependency where dependent_type = 'fact_lock' and dependent_id = $1",
			[zeroPrepared.run.id],
		);
		const zeroClaimFactCount = await pool.query(
			`select count(*)::int as count
			 from fact_lock_claim_fact mapping
			 join fact_lock_claim claim on claim.id = mapping.claim_id
			 where claim.run_id = $1`,
			[zeroPrepared.run.id],
		);
		assert(
			zeroClaimCount.rows[0]?.count === 0 &&
				zeroClaimFactCount.rows[0]?.count === 0 &&
				zeroDependencyCount.rows[0]?.count === 0,
			"Zero-claim must not create claims or Product Fact dependencies.",
		);
		await pool.query(
			"update claim_manifest set fingerprint = $1 where id = $2",
			["f".repeat(64), zeroManifest.id],
		);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: zeroProject.projectId,
					claimManifestId: zeroManifest.id,
					idempotencyKey: "us18c-zero-corrupt-001",
				}),
			"CLAIM_MANIFEST_FINGERPRINT_MISMATCH",
		);
		await pool.query(
			"update claim_manifest set fingerprint = $1 where id = $2",
			[zeroManifest.fingerprint, zeroManifest.id],
		);
		await pool.query("update script_version set revision = 2 where id = $1", [
			zeroProject.scriptVersionId,
		]);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: zeroProject.projectId,
					claimManifestId: zeroManifest.id,
					idempotencyKey: "us18c-zero-stale-001",
				}),
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
		);
		await pool.query("update script_version set revision = 1 where id = $1", [
			zeroProject.scriptVersionId,
		]);
		const zeroReplacementProductId = await seedProduct(
			pool,
			workspace,
			"zero-replacement",
		);
		await pool.query("update project set product_id = $1 where id = $2", [
			zeroReplacementProductId,
			zeroProject.projectId,
		]);
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: zeroProject.projectId,
					claimManifestId: zeroManifest.id,
					idempotencyKey: "us18c-zero-product-mismatch-001",
				}),
			"CLAIM_MANIFEST_NOT_EXECUTABLE",
		);
		await pool.query("update project set product_id = $1 where id = $2", [
			productId,
			zeroProject.projectId,
		]);
		const zeroRetry = await prepareManifestFactLock({
			actor: workspace,
			projectId: zeroProject.projectId,
			claimManifestId: zeroManifest.id,
			idempotencyKey: "us18c-zero-claim-001",
		});
		assert(
			zeroRetry.kind === "existing" &&
				zeroRetry.run.id === zeroPrepared.run.id &&
				zeroRetry.zeroClaim?.status === "passed",
			"Same zero-claim idempotency retry must reuse the same run.",
		);
		const changedPolicyHash = await sha256Hex({
			...factLockZeroClaimPolicyProjection(),
			promptVersion: "fact-lock-zero-claim.v2",
		});
		assert(
			changedPolicyHash !== expectedZeroClaimPolicyHash,
			"Changing zero-claim policy semantics must change policy hash.",
		);

		const zeroConflictProject = await seedProject({
			pool,
			workspace,
			label: "zero-conflict",
			productId,
			claims: 0,
			factCount: 0,
		});
		const zeroConflictManifest = (
			await createClaimManifestFromScriptVersion({
				actor: workspace,
				projectId: zeroConflictProject.projectId,
				scriptVersionId: zeroConflictProject.scriptVersionId,
				expectedScriptVersionRevision: 1,
			})
		).manifest;
		await expectCode(
			() =>
				prepareManifestFactLock({
					actor: workspace,
					projectId: zeroConflictProject.projectId,
					claimManifestId: zeroConflictManifest.id,
					idempotencyKey: "us18c-zero-claim-001",
				}),
			"FACT_LOCK_IDEMPOTENCY_CONFLICT",
		);

		const zeroConcurrentProject = await seedProject({
			pool,
			workspace,
			label: "zero-concurrent",
			productId,
			claims: 0,
			factCount: 0,
		});
		const zeroConcurrentManifest = (
			await createClaimManifestFromScriptVersion({
				actor: workspace,
				projectId: zeroConcurrentProject.projectId,
				scriptVersionId: zeroConcurrentProject.scriptVersionId,
				expectedScriptVersionRevision: 1,
			})
		).manifest;
		const [zeroConcurrentA, zeroConcurrentB] = await Promise.all([
			prepareManifestFactLock({
				actor: workspace,
				projectId: zeroConcurrentProject.projectId,
				claimManifestId: zeroConcurrentManifest.id,
				idempotencyKey: "us18c-zero-concurrent-001",
			}),
			prepareManifestFactLock({
				actor: workspace,
				projectId: zeroConcurrentProject.projectId,
				claimManifestId: zeroConcurrentManifest.id,
				idempotencyKey: "us18c-zero-concurrent-001",
			}),
		]);
		assert(
			zeroConcurrentA.kind === "existing" &&
				zeroConcurrentB.kind === "existing" &&
				zeroConcurrentA.run.id === zeroConcurrentB.run.id,
			"Concurrent same-key zero-claim requests must reuse one run.",
		);
		const zeroConcurrentCount = await pool.query(
			"select count(*)::int as count from fact_lock_run where project_id = $1",
			[zeroConcurrentProject.projectId],
		);
		assert(
			zeroConcurrentCount.rows[0]?.count === 1,
			"Concurrent zero-claim requests must create one row.",
		);

		const legacyStateBefore = await getFactLockState(
			workspace,
			primary.projectId,
		);
		assert(
			legacyStateBefore.latestRequest === null,
			"Legacy read state must ignore MANIFEST_V1 rows.",
		);
		const legacyConfig = {
			provider: "deterministic",
			model: "fact-lock-deterministic-v1",
			promptVersion: "fact-lock-prompt.v3" as const,
			outputSchemaVersion: "fact-lock-output.v1" as const,
		};
		await prepareFactLockRun(
			workspace,
			{
				projectId: primary.projectId,
				idempotencyKey: "us18c-legacy-pending-001",
			},
			legacyConfig,
		);
		await expectCode(
			() =>
				prepareFactLockRun(
					workspace,
					{
						projectId: primary.projectId,
						idempotencyKey: "us18c-legacy-pending-002",
					},
					legacyConfig,
				),
			"FACT_LOCK_ALREADY_PENDING",
		);

		const manifestRunRows = await pool.query<{
			id: string;
			status: string;
			executionClaimedAt: Date | null;
			estimatedCostMicros: string | null;
		}>(
			`select id, status, execution_claimed_at as "executionClaimedAt",
				estimated_cost_micros::text as "estimatedCostMicros"
			 from fact_lock_run where input_mode = 'MANIFEST_V1' and project_id = $1
			 order by created_at desc limit 1`,
			[primary.projectId],
		);
		const manifestRun = manifestRunRows.rows[0];
		assert(manifestRun, "Expected a persisted Manifest fixture run.");
		await expectCode(
			() =>
				recordFactLockEstimate(workspace, manifestRun.id, {
					estimatedCostMicros: BigInt(1),
					currency: "VND",
					inputTokens: 1,
					pricingBasis: "fixture",
				}),
			"FACT_LOCK_SCRIPT_NOT_READY",
		);
		await expectCode(
			() =>
				finalizeFactLockRun(workspace, {
					runId: manifestRun.id,
					outcome: { kind: "failure", code: "fixture" },
				}),
			"FACT_LOCK_SCRIPT_NOT_READY",
		);
		const manifestRunAfter = await pool.query<{ status: string }>(
			"select status from fact_lock_run where id = $1",
			[manifestRun.id],
		);
		assert(
			manifestRunAfter.rows[0]?.status === "pending",
			"Legacy functions must not mutate a MANIFEST_V1 row.",
		);
		const scriptBeforeMutationGuard = await pool.query<{ snapshot: string }>(
			"select editable_snapshot_json::text as snapshot from script_version where id = $1",
			[primary.scriptVersionId],
		);
		await expectCode(
			() =>
				mutateFactLockClaimSourceAndRefresh(
					workspace,
					{
						projectId: primary.projectId,
						factLockRunId: manifestRun.id,
						claimId: "not-used",
						scriptVersionId: primary.scriptVersionId,
						baseRevision: 1,
					},
					{ action: "delete" },
				),
			"FACT_LOCK_SCRIPT_NOT_READY",
		);
		const scriptAfterMutationGuard = await pool.query<{ snapshot: string }>(
			"select editable_snapshot_json::text as snapshot from script_version where id = $1",
			[primary.scriptVersionId],
		);
		assert(
			scriptAfterMutationGuard.rows[0]?.snapshot ===
				scriptBeforeMutationGuard.rows[0]?.snapshot,
			"Manifest source mutation must leave ScriptVersion unchanged.",
		);

		const preparedByTransaction = await db.transaction((transaction) =>
			getClaimManifestByIdInTransaction(transaction, {
				workspaceId: workspace.workspaceId,
				projectId: primary.projectId,
				claimManifestId: manifest.id,
			}),
		);
		assert(
			preparedByTransaction?.id === manifest.id,
			"Transaction-scoped repository read must remain available.",
		);

		console.log("Current explicit Manifest / scoped authorization: PASS");
		console.log("Current draft, Product, Product Facts and exact hashes: PASS");
		console.log(
			"Historical, wrong-source, Product/identity and integrity guards: PASS",
		);
		console.log("Cross-Project / cross-workspace non-enumerating lookup: PASS");
		console.log(
			"Zero-claim deterministic persistence, metadata, idempotency and race checks: PASS",
		);
		console.log("Legacy pending mode predicate and legacy-only guards: PASS");
		console.log(
			"Manifest row remains unchanged by legacy estimate/finalize/resolution: PASS",
		);
		console.log("Provider calls: 0");
		console.log("AFF-US-018 Phase 18C service preparation checks: PASS");
	} finally {
		await pool.end();
	}
}

await main();

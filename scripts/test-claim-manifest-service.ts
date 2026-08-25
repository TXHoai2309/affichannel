import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import {
	buildClaimManifestFromScriptVersion,
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

const { ClaimManifestServiceError, createClaimManifestFromScriptVersion } =
	await import("../packages/api/src/services/claim-manifest-service.ts");
const { ClaimManifestRepositoryError } = await import(
	"../packages/api/src/services/claim-manifest-repository.ts"
);

const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolvePromise) =>
		setTimeout(resolvePromise, milliseconds),
	);
}

function snapshot(label: string, claims = 2): ScriptVersionEditableSnapshot {
	const claimText = `Pin ${label} dùng liên tục 20 giờ`;
	const voiceClaimText = `Tai nghe ${label} hỗ trợ chống ồn`;
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-a", text: `${claimText}.` },
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
		claims: Array.from({ length: claims }, (_, index) => ({
			text: index % 2 === 0 ? claimText : voiceClaimText,
			occurrence:
				index % 2 === 0
					? ({ section: "hook", hookKey: "hook-a" } as const)
					: ({ section: "voiceover", segmentKey: "voice-a" } as const),
		})),
		claimsSourceRevision: 1,
		claimsStatus: "current",
	};
}

type WorkspaceFixture = {
	workspaceId: string;
	userId: string;
	otherUserId: string;
};

type ProjectFixture = WorkspaceFixture & {
	productId: string;
	projectId: string;
	scriptVersionId: string;
	revision: number;
	snapshot: ScriptVersionEditableSnapshot;
};

async function seedWorkspace(
	pool: Pool,
	label: string,
): Promise<WorkspaceFixture> {
	const suffix = randomUUID();
	const workspaceId = `claim-service-workspace-${label}-${suffix}`;
	const userId = `claim-service-user-${label}-${suffix}`;
	const otherUserId = `claim-service-user-other-${label}-${suffix}`;
	await pool.query("insert into workspace (id, name) values ($1, $2)", [
		workspaceId,
		`Claim service ${label}`,
	]);
	for (const [id, name] of [
		[userId, `Claim service user ${label}`],
		[otherUserId, `Claim service other user ${label}`],
	]) {
		await pool.query(
			'insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)',
			[id, name, `${id}@example.test`],
		);
		await pool.query(
			"insert into workspace_member (id, workspace_id, user_id) values ($1, $2, $3)",
			[`claim-service-member-${randomUUID()}`, workspaceId, id],
		);
	}
	return { workspaceId, userId, otherUserId };
}

async function seedProduct(
	pool: Pool,
	workspace: WorkspaceFixture,
	label: string,
): Promise<string> {
	const productId = `claim-service-product-${label}-${randomUUID()}`;
	await pool.query(
		"insert into product (id, workspace_id, name, created_by_user_id) values ($1, $2, $3, $4)",
		[productId, workspace.workspaceId, `Product ${label}`, workspace.userId],
	);
	return productId;
}

async function seedProject(input: {
	pool: Pool;
	workspace: WorkspaceFixture;
	label: string;
	productId: string | null;
	contentType?: "AFFILIATE" | "ORGANIC";
	creationPath?: "SCRIPTED" | "QUICK_IMAGE" | "MEDIA_FIRST";
}): Promise<string> {
	const projectId = `claim-service-project-${input.label}-${randomUUID()}`;
	await input.pool.query(
		`insert into project (
			id, workspace_id, name, product_id, content_type, creation_path,
			content_format_key, content_format_version, current_step_key, created_by_user_id
		) values ($1, $2, $3, $4, $5, $6, 'SCRIPTED_STANDARD', 1, 'content', $7)`,
		[
			projectId,
			input.workspace.workspaceId,
			`Project ${input.label}`,
			input.productId,
			input.contentType ?? "AFFILIATE",
			input.creationPath ?? "SCRIPTED",
			input.workspace.userId,
		],
	);
	return projectId;
}

async function seedScriptVersion(input: {
	pool: Pool;
	workspace: WorkspaceFixture;
	projectId: string;
	label: string;
	snapshot: unknown;
	revision?: number;
	status?: "draft" | "saved";
}): Promise<string> {
	const generationId = `claim-service-generation-${input.label}-${randomUUID()}`;
	const scriptVersionId = `claim-service-script-${input.label}-${randomUUID()}`;
	await input.pool.query(
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
			input.workspace.workspaceId,
			input.projectId,
			input.workspace.userId,
			`claim-service-${input.label}-${randomUUID()}`,
			hash(`request-${input.label}-${randomUUID()}`),
			JSON.stringify({ fixture: true }),
			hash(`input-${input.label}-${randomUUID()}`),
			hash(`prompt-${input.label}-${randomUUID()}`),
			JSON.stringify(input.snapshot),
			[...scriptGenerationSections],
		],
	);
	const status = input.status ?? "draft";
	await input.pool.query(
		`insert into script_version (
			id, workspace_id, project_id, source_generation_id, status,
			version_number, editable_snapshot_json, revision, created_by_user_id, saved_at
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			scriptVersionId,
			input.workspace.workspaceId,
			input.projectId,
			generationId,
			status,
			status === "saved" ? 1 : null,
			JSON.stringify(input.snapshot),
			input.revision ?? 1,
			input.workspace.userId,
			status === "saved" ? new Date() : null,
		],
	);
	return scriptVersionId;
}

async function seedValidProject(
	pool: Pool,
	label: string,
	claimCount = 2,
): Promise<ProjectFixture> {
	const workspace = await seedWorkspace(pool, label);
	const productId = await seedProduct(pool, workspace, label);
	const projectId = await seedProject({
		pool,
		workspace,
		label,
		productId,
	});
	const sourceSnapshot = snapshot(label, claimCount);
	const scriptVersionId = await seedScriptVersion({
		pool,
		workspace,
		projectId,
		label,
		snapshot: sourceSnapshot,
	});
	return {
		...workspace,
		productId,
		projectId,
		scriptVersionId,
		revision: 1,
		snapshot: sourceSnapshot,
	};
}

function serviceInput(fixture: ProjectFixture, userId = fixture.userId) {
	return {
		actor: { workspaceId: fixture.workspaceId, userId },
		projectId: fixture.projectId,
		scriptVersionId: fixture.scriptVersionId,
		expectedScriptVersionRevision: fixture.revision,
	};
}

async function expectServiceError(
	label: string,
	code:
		| "CLAIM_MANIFEST_PROJECT_NOT_FOUND"
		| "CLAIM_MANIFEST_SOURCE_NOT_FOUND"
		| "CLAIM_MANIFEST_SOURCE_REVISION_CONFLICT"
		| "CLAIM_MANIFEST_SOURCE_NOT_USABLE"
		| "CLAIM_MANIFEST_PRODUCT_REQUIRED"
		| "CLAIM_MANIFEST_CONTENT_FORMAT_UNSUPPORTED",
	action: () => Promise<unknown>,
): Promise<void> {
	try {
		await action();
	} catch (error) {
		assert(
			error instanceof ClaimManifestServiceError && error.code === code,
			`${label} must fail with ${code}.`,
		);
		assert(error.message === code, `${label} must not leak protected data.`);
		console.log(`${label}: ${code}`);
		return;
	}
	throw new Error(`${label} must fail closed.`);
}

async function manifestCount(pool: Pool, projectId: string): Promise<number> {
	const result = await pool.query<{ count: number }>(
		"select count(*)::int as count from claim_manifest where project_id = $1",
		[projectId],
	);
	return result.rows[0]?.count ?? 0;
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

	const happy = await seedValidProject(pool, "happy");
	const first = await createClaimManifestFromScriptVersion(serviceInput(happy));
	assert(first.created, "Happy path must create a Manifest.");
	assert(
		first.manifest.source.sourceType === "SCRIPT_VERSION" &&
			first.manifest.source.scriptVersionId === happy.scriptVersionId &&
			first.manifest.source.scriptVersionRevision === happy.revision,
		"Manifest must pin the exact requested ScriptVersion and revision.",
	);
	assert(
		first.manifest.productId === happy.productId,
		"Manifest must use the server-loaded current Project Product.",
	);
	const repeat = await createClaimManifestFromScriptVersion(
		serviceInput(happy),
	);
	assert(
		!repeat.created && repeat.manifest.id === first.manifest.id,
		"Exact repeat must reuse one Manifest row.",
	);
	const otherActor = await createClaimManifestFromScriptVersion(
		serviceInput(happy, happy.otherUserId),
	);
	assert(
		!otherActor.created &&
			otherActor.manifest.id === first.manifest.id &&
			otherActor.manifest.createdByUserId === happy.userId,
		"Authorized reuse must preserve first-creation provenance.",
	);

	const revisionMismatch = await seedValidProject(pool, "revision");
	await pool.query("update script_version set revision = 2 where id = $1", [
		revisionMismatch.scriptVersionId,
	]);
	await expectServiceError(
		"revision mismatch",
		"CLAIM_MANIFEST_SOURCE_REVISION_CONFLICT",
		() => createClaimManifestFromScriptVersion(serviceInput(revisionMismatch)),
	);
	assert(
		(await manifestCount(pool, revisionMismatch.projectId)) === 0,
		"Revision mismatch must not persist a Manifest.",
	);

	const pinned = await seedValidProject(pool, "pinned");
	const savedId = await seedScriptVersion({
		pool,
		workspace: pinned,
		projectId: pinned.projectId,
		label: "pinned-saved",
		snapshot: snapshot("pinned-saved"),
		revision: 2,
		status: "saved",
	});
	const pinnedResult = await createClaimManifestFromScriptVersion(
		serviceInput(pinned),
	);
	assert(
		pinnedResult.manifest.source.sourceType === "SCRIPT_VERSION" &&
			pinnedResult.manifest.source.scriptVersionId === pinned.scriptVersionId,
		"Service must not replace the explicit draft with another ScriptVersion.",
	);
	await expectServiceError(
		"saved history is not an active source",
		"CLAIM_MANIFEST_SOURCE_NOT_USABLE",
		() =>
			createClaimManifestFromScriptVersion({
				...serviceInput(pinned),
				scriptVersionId: savedId,
				expectedScriptVersionRevision: 2,
			}),
	);

	const scopeA = await seedValidProject(pool, "scope-a");
	const scopeB = await seedValidProject(pool, "scope-b");
	const sameWorkspaceProject = await seedProject({
		pool,
		workspace: scopeA,
		label: "scope-other-project",
		productId: scopeA.productId,
	});
	const sameWorkspaceSource = await seedScriptVersion({
		pool,
		workspace: scopeA,
		projectId: sameWorkspaceProject,
		label: "scope-other-project",
		snapshot: snapshot("scope-other-project"),
	});
	await expectServiceError(
		"cross-Project source injection",
		"CLAIM_MANIFEST_SOURCE_NOT_FOUND",
		() =>
			createClaimManifestFromScriptVersion({
				...serviceInput(scopeA),
				scriptVersionId: sameWorkspaceSource,
			}),
	);
	await expectServiceError(
		"cross-workspace source injection",
		"CLAIM_MANIFEST_SOURCE_NOT_FOUND",
		() =>
			createClaimManifestFromScriptVersion({
				...serviceInput(scopeA),
				scriptVersionId: scopeB.scriptVersionId,
			}),
	);
	await expectServiceError(
		"inaccessible Project",
		"CLAIM_MANIFEST_PROJECT_NOT_FOUND",
		() =>
			createClaimManifestFromScriptVersion({
				...serviceInput(scopeA),
				actor: {
					workspaceId: scopeB.workspaceId,
					userId: scopeB.userId,
				},
			}),
	);

	const unsupportedWorkspace = await seedWorkspace(pool, "unsupported");
	const unsupportedProduct = await seedProduct(
		pool,
		unsupportedWorkspace,
		"unsupported",
	);
	const unsupportedProject = await seedProject({
		pool,
		workspace: unsupportedWorkspace,
		label: "unsupported",
		productId: unsupportedProduct,
		contentType: "ORGANIC",
	});
	const unsupportedSource = await seedScriptVersion({
		pool,
		workspace: unsupportedWorkspace,
		projectId: unsupportedProject,
		label: "unsupported",
		snapshot: snapshot("unsupported"),
	});
	await expectServiceError(
		"inactive Project identity",
		"CLAIM_MANIFEST_CONTENT_FORMAT_UNSUPPORTED",
		() =>
			createClaimManifestFromScriptVersion({
				actor: {
					workspaceId: unsupportedWorkspace.workspaceId,
					userId: unsupportedWorkspace.userId,
				},
				projectId: unsupportedProject,
				scriptVersionId: unsupportedSource,
				expectedScriptVersionRevision: 1,
			}),
	);

	const noProductWorkspace = await seedWorkspace(pool, "no-product");
	const noProductProject = await seedProject({
		pool,
		workspace: noProductWorkspace,
		label: "no-product",
		productId: null,
	});
	const noProductSource = await seedScriptVersion({
		pool,
		workspace: noProductWorkspace,
		projectId: noProductProject,
		label: "no-product",
		snapshot: snapshot("no-product"),
	});
	await expectServiceError(
		"Affiliate Product missing",
		"CLAIM_MANIFEST_PRODUCT_REQUIRED",
		() =>
			createClaimManifestFromScriptVersion({
				actor: {
					workspaceId: noProductWorkspace.workspaceId,
					userId: noProductWorkspace.userId,
				},
				projectId: noProductProject,
				scriptVersionId: noProductSource,
				expectedScriptVersionRevision: 1,
			}),
	);

	const productScopeA = await seedWorkspace(pool, "product-scope-a");
	const productScopeB = await seedWorkspace(pool, "product-scope-b");
	const foreignProduct = await seedProduct(
		pool,
		productScopeB,
		"product-scope-foreign",
	);
	const productScopeProject = await seedProject({
		pool,
		workspace: productScopeA,
		label: "product-scope-a",
		productId: foreignProduct,
	});
	const productScopeSource = await seedScriptVersion({
		pool,
		workspace: productScopeA,
		projectId: productScopeProject,
		label: "product-scope-a",
		snapshot: snapshot("product-scope-a"),
	});
	await expectServiceError(
		"cross-workspace Product linkage",
		"CLAIM_MANIFEST_PRODUCT_REQUIRED",
		() =>
			createClaimManifestFromScriptVersion({
				actor: {
					workspaceId: productScopeA.workspaceId,
					userId: productScopeA.userId,
				},
				projectId: productScopeProject,
				scriptVersionId: productScopeSource,
				expectedScriptVersionRevision: 1,
			}),
	);

	for (const [label, unusableSnapshot] of [
		["stale", { ...snapshot("stale"), claimsStatus: "stale" as const }],
		["invalid", { schemaVersion: "script-draft.v2", claims: [] }],
	] as const) {
		const unusable = await seedValidProject(pool, `unusable-${label}`);
		await pool.query(
			"update script_version set editable_snapshot_json = $1 where id = $2",
			[JSON.stringify(unusableSnapshot), unusable.scriptVersionId],
		);
		await expectServiceError(
			`${label} source`,
			"CLAIM_MANIFEST_SOURCE_NOT_USABLE",
			() => createClaimManifestFromScriptVersion(serviceInput(unusable)),
		);
		assert(
			(await manifestCount(pool, unusable.projectId)) === 0,
			`${label} source must not become a fake empty Manifest.`,
		);
	}

	for (const claimCount of [0, 64]) {
		const boundary = await seedValidProject(
			pool,
			`claims-${claimCount}`,
			claimCount,
		);
		const result = await createClaimManifestFromScriptVersion(
			serviceInput(boundary),
		);
		assert(
			result.manifest.claimCount === claimCount &&
				result.manifest.isEmpty === (claimCount === 0),
			`Claim boundary ${claimCount} must persist exactly.`,
		);
	}
	const overLimit = await seedValidProject(pool, "claims-65", 65);
	await expectServiceError(
		"65 claims",
		"CLAIM_MANIFEST_SOURCE_NOT_USABLE",
		() => createClaimManifestFromScriptVersion(serviceInput(overLimit)),
	);
	assert(
		(await manifestCount(pool, overLimit.projectId)) === 0,
		"Over-limit source must not persist.",
	);

	const collision = await seedValidProject(pool, "collision");
	const builtCollision = await buildClaimManifestFromScriptVersion({
		workspaceId: collision.workspaceId,
		projectId: collision.projectId,
		productId: collision.productId,
		scriptVersionId: collision.scriptVersionId,
		scriptVersionRevision: collision.revision,
		snapshot: collision.snapshot,
	});
	const corruptedClaims = builtCollision.claims.map((claim, index) =>
		index === 0
			? { ...claim, claimText: `${claim.claimText} corrupted` }
			: claim,
	);
	await pool.query(
		`insert into claim_manifest (
			id, workspace_id, project_id, source_type, source_script_version_id,
			source_script_revision, source_snapshot_json, source_content_hash,
			product_id, schema_version, builder_version, claims_json, claim_count,
			is_empty, fingerprint, created_by_user_id
		) values ($1, $2, $3, 'SCRIPT_VERSION', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		[
			`claim-service-collision-${randomUUID()}`,
			collision.workspaceId,
			collision.projectId,
			collision.scriptVersionId,
			collision.revision,
			JSON.stringify(builtCollision.source),
			builtCollision.source.sourceContentHash,
			collision.productId,
			builtCollision.schemaVersion,
			builtCollision.builderVersion,
			JSON.stringify(corruptedClaims),
			builtCollision.claimCount,
			builtCollision.isEmpty,
			builtCollision.fingerprint,
			collision.userId,
		],
	);
	try {
		await createClaimManifestFromScriptVersion(serviceInput(collision));
		throw new Error("Repository collision must fail closed.");
	} catch (error) {
		assert(
			error instanceof ClaimManifestRepositoryError &&
				error.code === "CLAIM_MANIFEST_CONFLICT",
			"Repository collision must propagate a sanitized typed error.",
		);
	}
	assert(
		(await manifestCount(pool, collision.projectId)) === 1,
		"Repository failure must roll back without a partial second row.",
	);

	const sourceRace = await seedValidProject(pool, "source-race");
	const sourceRaceClient = await pool.connect();
	try {
		await sourceRaceClient.query("begin");
		await sourceRaceClient.query(
			"select id from script_version where id = $1 for update",
			[sourceRace.scriptVersionId],
		);
		const servicePromise = createClaimManifestFromScriptVersion(
			serviceInput(sourceRace),
		);
		await sleep(50);
		const changedSnapshot = snapshot("source-race-changed");
		await sourceRaceClient.query(
			"update script_version set revision = 2, editable_snapshot_json = $1 where id = $2",
			[JSON.stringify(changedSnapshot), sourceRace.scriptVersionId],
		);
		await sourceRaceClient.query("commit");
		await expectServiceError(
			"concurrent ScriptVersion mutation",
			"CLAIM_MANIFEST_SOURCE_REVISION_CONFLICT",
			() => servicePromise,
		);
	} finally {
		await sourceRaceClient.query("rollback").catch(() => undefined);
		sourceRaceClient.release();
	}
	assert(
		(await manifestCount(pool, sourceRace.projectId)) === 0,
		"Detected ScriptVersion race must not persist mixed provenance.",
	);

	const productRace = await seedValidProject(pool, "product-race");
	const replacementProduct = await seedProduct(
		pool,
		productRace,
		"replacement",
	);
	const productRaceClient = await pool.connect();
	let productRaceResult: Awaited<
		ReturnType<typeof createClaimManifestFromScriptVersion>
	>;
	try {
		await productRaceClient.query("begin");
		await productRaceClient.query(
			"select id from project where id = $1 for update",
			[productRace.projectId],
		);
		const servicePromise = createClaimManifestFromScriptVersion(
			serviceInput(productRace),
		);
		await sleep(50);
		await productRaceClient.query(
			"update project set product_id = $1 where id = $2",
			[replacementProduct, productRace.projectId],
		);
		await productRaceClient.query("commit");
		productRaceResult = await servicePromise;
	} finally {
		await productRaceClient.query("rollback").catch(() => undefined);
		productRaceClient.release();
	}
	assert(
		productRaceResult.manifest.productId === replacementProduct,
		"Project lock must make one call use one coherent current Product value.",
	);

	console.log("Happy create / exact reuse / creator provenance: PASS");
	console.log("Exact source pinning and draft-only usability: PASS");
	console.log("Workspace / Project / Product scope failures: PASS");
	console.log("Identity / Product / source usability boundaries: PASS");
	console.log("Claim count boundaries 0 / 64 / 65: PASS / PASS / REFUSED");
	console.log("Repository failure rollback: PASS");
	console.log("ScriptVersion revision TOCTOU: detected fail-closed");
	console.log("Project Product race: coherent current Product pinned");
	console.log("Provider calls: 0");
} finally {
	await pool.end();
}

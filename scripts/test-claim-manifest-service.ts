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

const {
	ClaimManifestServiceError,
	createClaimManifestFromScriptVersion,
	getClaimManifest,
	listClaimManifestsForProject,
} = await import("../packages/api/src/services/claim-manifest-service.ts");
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

async function waitForBlockedManifestInsert(pool: Pool): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const result = await pool.query<{ blocked: boolean }>(
			`select exists (
				select 1
				from pg_stat_activity
				where datname = current_database()
					and pid <> pg_backend_pid()
					and wait_event_type = 'Lock'
					and wait_event = 'advisory'
					and query ilike 'insert into %claim_manifest%'
			) as blocked`,
		);
		if (result.rows[0]?.blocked) return;
		await sleep(10);
	}
	throw new Error("Service did not reach the controlled manifest-insert gate.");
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
	const authorizedGet = await getClaimManifest({
		actor: { workspaceId: happy.workspaceId, userId: happy.userId },
		projectId: happy.projectId,
		claimManifestId: first.manifest.id,
	});
	assert(
		authorizedGet?.id === first.manifest.id,
		"Authorized application get must return the scoped Manifest.",
	);

	const replacementHappyProduct = await seedProduct(
		pool,
		happy,
		"happy-replacement",
	);
	const secondSnapshot = snapshot("happy-second");
	await pool.query("update project set product_id = $1 where id = $2", [
		replacementHappyProduct,
		happy.projectId,
	]);
	await pool.query(
		"update script_version set revision = 2, editable_snapshot_json = $1 where id = $2",
		[JSON.stringify(secondSnapshot), happy.scriptVersionId],
	);
	const second = await createClaimManifestFromScriptVersion({
		...serviceInput(happy),
		expectedScriptVersionRevision: 2,
	});
	const thirdSnapshot = snapshot("happy-third");
	await pool.query(
		"update script_version set revision = 3, editable_snapshot_json = $1 where id = $2",
		[JSON.stringify(thirdSnapshot), happy.scriptVersionId],
	);
	const third = await createClaimManifestFromScriptVersion({
		...serviceInput(happy),
		expectedScriptVersionRevision: 3,
	});
	assert(
		second.created && third.created,
		"Distinct exact source revisions must create history rows.",
	);

	const sameWorkspaceReadProject = await seedProject({
		pool,
		workspace: happy,
		label: "read-other-project",
		productId: replacementHappyProduct,
	});
	const sameWorkspaceReadSource = await seedScriptVersion({
		pool,
		workspace: happy,
		projectId: sameWorkspaceReadProject,
		label: "read-other-project",
		snapshot: snapshot("read-other-project"),
	});
	const sameWorkspaceOtherManifest = await createClaimManifestFromScriptVersion(
		{
			actor: { workspaceId: happy.workspaceId, userId: happy.userId },
			projectId: sameWorkspaceReadProject,
			scriptVersionId: sameWorkspaceReadSource,
			expectedScriptVersionRevision: 1,
		},
	);
	const foreignReadProject = await seedValidProject(pool, "read-foreign");
	const foreignManifest = await createClaimManifestFromScriptVersion(
		serviceInput(foreignReadProject),
	);

	await expectServiceError(
		"read Project in another workspace",
		"CLAIM_MANIFEST_PROJECT_NOT_FOUND",
		() =>
			getClaimManifest({
				actor: {
					workspaceId: foreignReadProject.workspaceId,
					userId: foreignReadProject.userId,
				},
				projectId: happy.projectId,
				claimManifestId: first.manifest.id,
			}),
	);
	assert(
		(await getClaimManifest({
			actor: { workspaceId: happy.workspaceId, userId: happy.userId },
			projectId: sameWorkspaceReadProject,
			claimManifestId: first.manifest.id,
		})) === null,
		"Wrong-Project Manifest read must be a non-enumerating null.",
	);
	assert(
		(await getClaimManifest({
			actor: { workspaceId: happy.workspaceId, userId: happy.userId },
			projectId: happy.projectId,
			claimManifestId: `missing-${randomUUID()}`,
		})) === null,
		"Missing Manifest read must use the same nullable semantics.",
	);

	const expectedHappyManifestIds = new Set([
		first.manifest.id,
		second.manifest.id,
		third.manifest.id,
	]);
	const authorizedList = await listClaimManifestsForProject({
		actor: { workspaceId: happy.workspaceId, userId: happy.userId },
		projectId: happy.projectId,
		direction: "oldest_first",
		limit: 10,
	});
	assert(
		authorizedList.items.length === 3 &&
			authorizedList.items.every((item) =>
				expectedHappyManifestIds.has(item.id),
			) &&
			!authorizedList.items.some(
				(item) =>
					item.id === sameWorkspaceOtherManifest.manifest.id ||
					item.id === foreignManifest.manifest.id,
			),
		"Authorized list must contain only the requested Project history.",
	);

	const pagedIds: string[] = [];
	let cursor: { createdAt: string; id: string } | undefined;
	for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
		const page = await listClaimManifestsForProject({
			actor: { workspaceId: happy.workspaceId, userId: happy.userId },
			projectId: happy.projectId,
			direction: "oldest_first",
			limit: 1,
			cursor,
		});
		assert(
			page.items.length === 1,
			"Application history page must honor limit.",
		);
		const item = page.items[0];
		assert(item, "Application history page must contain one item.");
		pagedIds.push(item.id);
		const morePagesRemain = pageNumber < 2;
		assert(
			(page.nextCursor !== null) === morePagesRemain,
			"Application history terminal cursor semantics must match repository semantics.",
		);
		cursor = page.nextCursor ?? undefined;
	}
	assert(
		new Set(pagedIds).size === 3 &&
			pagedIds.every((id) => expectedHappyManifestIds.has(id)),
		"Application pagination must not duplicate or skip Project history.",
	);

	await pool.query(
		"update project set product_id = null, content_type = 'ORGANIC', archived_at = now() where id = $1",
		[happy.projectId],
	);
	const historicalGet = await getClaimManifest({
		actor: { workspaceId: happy.workspaceId, userId: happy.userId },
		projectId: happy.projectId,
		claimManifestId: first.manifest.id,
	});
	const historicalList = await listClaimManifestsForProject({
		actor: { workspaceId: happy.workspaceId, userId: happy.userId },
		projectId: happy.projectId,
		direction: "newest_first",
		limit: 10,
	});
	assert(
		historicalGet?.id === first.manifest.id &&
			historicalList.items.length === 3,
		"Historical reads must ignore current write eligibility, Product, source revision, and archive state.",
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
	const unknownFormat = await seedValidProject(pool, "unknown-format");
	await pool.query(
		"update project set content_format_key = 'UNKNOWN_FORMAT' where id = $1",
		[unknownFormat.projectId],
	);
	await expectServiceError(
		"unknown ContentFormat",
		"CLAIM_MANIFEST_CONTENT_FORMAT_UNSUPPORTED",
		() => createClaimManifestFromScriptVersion(serviceInput(unknownFormat)),
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

	const currentOlderClaims = await seedValidProject(
		pool,
		"current-older-claims",
	);
	await pool.query("update script_version set revision = 2 where id = $1", [
		currentOlderClaims.scriptVersionId,
	]);
	const currentOlderClaimsResult = await createClaimManifestFromScriptVersion({
		...serviceInput(currentOlderClaims),
		expectedScriptVersionRevision: 2,
	});
	assert(
		currentOlderClaimsResult.manifest.source.sourceType === "SCRIPT_VERSION" &&
			currentOlderClaimsResult.manifest.source.scriptVersionRevision === 2 &&
			currentOlderClaimsResult.manifest.source.claimsSourceRevision === 1,
		"Current claims may legitimately originate before the current non-invalidating ScriptVersion revision.",
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

	const coherentRace = await seedValidProject(pool, "coherent-race");
	const replacementProduct = await seedProduct(
		pool,
		coherentRace,
		"replacement",
	);
	const advisoryLockKey = 170_017;
	await pool.query(`
		create function claim_manifest_service_test_gate() returns trigger
		language plpgsql as $$
		begin
			perform pg_advisory_xact_lock(${advisoryLockKey});
			return new;
		end
		$$;
		create trigger claim_manifest_service_test_gate
		before insert on claim_manifest
		for each row execute function claim_manifest_service_test_gate();
	`);
	const gateClient = await pool.connect();
	const mutationClient = await pool.connect();
	let coherentRaceResult:
		| Awaited<ReturnType<typeof createClaimManifestFromScriptVersion>>
		| undefined;
	try {
		await gateClient.query("select pg_advisory_lock($1)", [advisoryLockKey]);
		const servicePromise = createClaimManifestFromScriptVersion(
			serviceInput(coherentRace),
		);
		await waitForBlockedManifestInsert(pool);

		await mutationClient.query("begin");
		await mutationClient.query("set local lock_timeout = '100ms'");
		let sourceMutationBlocked = false;
		try {
			await mutationClient.query(
				"update script_version set revision = 2 where id = $1",
				[coherentRace.scriptVersionId],
			);
		} catch (error) {
			sourceMutationBlocked =
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "55P03";
		}
		await mutationClient.query("rollback");
		assert(
			sourceMutationBlocked,
			"Service must hold the exact ScriptVersion row lock through persistence.",
		);

		await mutationClient.query("begin");
		await mutationClient.query("set local lock_timeout = '100ms'");
		let productMutationBlocked = false;
		try {
			await mutationClient.query(
				"update project set product_id = $1 where id = $2",
				[replacementProduct, coherentRace.projectId],
			);
		} catch (error) {
			productMutationBlocked =
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "55P03";
		}
		await mutationClient.query("rollback");
		assert(
			productMutationBlocked,
			"Service must hold the Project product/identity row lock through persistence.",
		);

		await gateClient.query("select pg_advisory_unlock($1)", [advisoryLockKey]);
		coherentRaceResult = await servicePromise;
	} finally {
		await mutationClient.query("rollback").catch(() => undefined);
		await gateClient
			.query("select pg_advisory_unlock($1)", [advisoryLockKey])
			.catch(() => undefined);
		mutationClient.release();
		gateClient.release();
		await pool.query(
			"drop trigger if exists claim_manifest_service_test_gate on claim_manifest",
		);
		await pool.query(
			"drop function if exists claim_manifest_service_test_gate()",
		);
	}
	assert(
		coherentRaceResult !== undefined &&
			coherentRaceResult.manifest.source.sourceType === "SCRIPT_VERSION" &&
			coherentRaceResult.manifest.source.scriptVersionRevision ===
				coherentRace.revision &&
			coherentRaceResult.manifest.productId === coherentRace.productId,
		"Manifest must pin one coherent locked ScriptVersion revision and Project Product.",
	);

	console.log("Happy create / exact reuse / creator provenance: PASS");
	console.log("Authorized get/list and non-enumerating read scope: PASS");
	console.log("Application history pagination: PASS");
	console.log("Inactive/non-current/archived historical readability: PASS");
	console.log("Exact source pinning and draft-only usability: PASS");
	console.log("Workspace / Project / Product scope failures: PASS");
	console.log(
		"Identity / Product / source usability and claims-currentness boundaries: PASS",
	);
	console.log("Claim count boundaries 0 / 64 / 65: PASS / PASS / REFUSED");
	console.log("Repository failure rollback: PASS");
	console.log(
		"ScriptVersion + Project Product TOCTOU: row locks held through atomic persistence",
	);
	console.log("Provider calls: 0");
} finally {
	await pool.end();
}

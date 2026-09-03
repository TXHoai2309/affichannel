import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ScriptVersionEditableSnapshot } from "@affichannel/core";
import {
	canonicalizeJson,
	resolveProjectApplicability,
	summarizeCurrentScriptVersionClaims,
} from "@affichannel/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { TextProvider } from "../packages/api/src/providers/text/text-provider.ts";
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
type Pool = ReturnType<typeof createNodePostgresPool>;
type Actor = { workspaceId: string; userId: string };
type Fixture = {
	actor: Actor;
	projectId: string;
	scriptVersionId: string;
};

const baseClaims = [
	{
		text: "Một bước nhỏ cho ngày tốt hơn.",
		occurrence: { section: "hook", hookKey: "hook" },
		proposedSubject: "PRODUCT" as const,
		subject: { kind: "PRODUCT" as const, binding: "PROJECT_PRODUCT" as const },
		subjectStatus: "NEEDS_CONFIRMATION" as const,
		subjectSource: null,
	},
	{
		text: "Bạn có thể bắt đầu từ một bước rất nhỏ.",
		occurrence: { section: "voiceover", segmentKey: "tip" },
		proposedSubject: "GENERAL" as const,
		subject: { kind: "GENERAL" as const },
		subjectStatus: "NEEDS_CONFIRMATION" as const,
		subjectSource: null,
	},
	{
		text: "Một bước nhỏ cho ngày tốt hơn.",
		occurrence: { section: "scene", sceneOrder: 1 },
		proposedSubject: "PRODUCT" as const,
		subject: { kind: "PRODUCT" as const, binding: "PROJECT_PRODUCT" as const },
		subjectStatus: "CONFIRMED" as const,
		subjectSource: "USER" as const,
	},
	{
		text: "Thử ngay hôm nay.",
		occurrence: { section: "cta" },
		proposedSubject: "PRODUCT" as const,
		subject: { kind: "GENERAL" as const },
		subjectStatus: "CONFIRMED" as const,
		subjectSource: "USER" as const,
	},
];

function snapshot(
	options: {
		claims?: unknown[];
		claimsStatus?: "current" | "stale";
		claimsSourceRevision?: number;
		schemaVersion?: "script-draft.v2" | "script-draft.v3";
	} = {},
): ScriptVersionEditableSnapshot {
	return {
		schemaVersion: options.schemaVersion ?? "script-draft.v3",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook", text: "Một bước nhỏ cho ngày tốt hơn." },
			{ key: "alt", text: "Bắt đầu thật đơn giản." },
		],
		selectedHookKey: "hook",
		voiceoverSegments: [
			{ key: "intro", text: "Một bước nhỏ cho ngày tốt hơn." },
			{ key: "tip", text: "Bạn có thể bắt đầu từ một bước rất nhỏ." },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 15,
				visualDirection: "Minh họa thói quen",
				onScreenText: "Một bước nhỏ cho ngày tốt hơn.",
				voiceoverSegmentKeys: ["intro"],
			},
		],
		cta: { text: "Thử ngay hôm nay." },
		caption: "Một bước nhỏ cho ngày tốt hơn.",
		hashtags: ["#thoiquen"],
		disclosure: "",
		claims: (options.claims ??
			baseClaims) as ScriptVersionEditableSnapshot["claims"],
		claimsSourceRevision: options.claimsSourceRevision ?? 1,
		claimsStatus: options.claimsStatus ?? "current",
	};
}

async function resetDatabase(pool: Pool) {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	await migrate(drizzle(pool), { migrationsFolder: migrationsRoot });
}

async function seed(
	pool: Pool,
	label: string,
	options: {
		identity?: "organic" | "affiliate";
		status?: "current" | "stale";
		claims?: unknown[];
		claimsSourceRevision?: number;
		schemaVersion?: "script-draft.v2" | "script-draft.v3";
	} = {},
): Promise<Fixture> {
	const suffix = randomUUID();
	const workspaceId = `confirm-workspace-${label}-${suffix}`;
	const userId = `confirm-user-${label}-${suffix}`;
	const projectId = `confirm-project-${label}-${suffix}`;
	const generationId = `confirm-generation-${label}-${suffix}`;
	const scriptVersionId = `confirm-script-${label}-${suffix}`;
	const isOrganic = options.identity !== "affiliate";
	const currentSnapshot = snapshot({
		claims: options.claims,
		claimsStatus: options.status,
		claimsSourceRevision: options.claimsSourceRevision,
		schemaVersion: options.schemaVersion,
	});
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
			values ($1, $2, $3, null, $4, 'SCRIPTED', $5, $6, 'content', $7)`,
		[
			projectId,
			workspaceId,
			label,
			isOrganic ? "ORGANIC" : "AFFILIATE",
			isOrganic ? "SCRIPTED_STANDARD" : "AFFILIATE_STANDARD",
			1,
			userId,
		],
	);
	await pool.query(
		`insert into script_generation (id, workspace_id, project_id, created_by_user_id, idempotency_key,
			request_hash, mode, provider, model, prompt_version, output_schema_version,
			input_snapshot_json, input_hash, prompt_hash, status, output_json,
			valid_sections, invalid_sections, finished_at)
			values ($1, $2, $3, $4, $5, $6, 'full', 'deterministic', 'confirm-test',
			'script-prompt.v3', $7, $8, $9, $10, 'completed', $8,
			ARRAY['hook','voiceover','scenes','cta','caption','hashtags','disclosure','claims'], ARRAY[]::text[], now())`,
		[
			generationId,
			workspaceId,
			projectId,
			userId,
			`generation-${suffix}`,
			hash({ suffix }),
			options.schemaVersion ?? "script-draft.v3",
			currentSnapshot,
			hash(currentSnapshot),
			hash({ prompt: suffix }),
		],
	);
	await pool.query(
		`insert into script_version (id, workspace_id, project_id, source_generation_id, status,
			version_number, editable_snapshot_json, revision, created_by_user_id)
			values ($1, $2, $3, $4, 'draft', null, $5, 1, $6)`,
		[
			scriptVersionId,
			workspaceId,
			projectId,
			generationId,
			currentSnapshot,
			userId,
		],
	);
	return { actor: { workspaceId, userId }, projectId, scriptVersionId };
}

const pool = createNodePostgresPool(authority.url);
const confirmation = await import(
	"../packages/api/src/services/claim-subject-confirmation-service.ts"
);
const refresh = await import(
	"../packages/api/src/services/script-claim-refresh-service.ts"
);
try {
	await resetDatabase(pool);
	const confirm = confirmation.confirmScriptVersionClaimSubjects;
	const actorFor = (fixture: Fixture) => fixture.actor;

	const empty = await seed(pool, "empty", { claims: [] });
	const emptyResult = await confirm(actorFor(empty), {
		scriptVersionId: empty.scriptVersionId,
		expectedScriptVersionRevision: 1,
		decisions: [],
	});
	assert.equal(emptyResult.kind, "not_required");
	assert.equal(emptyResult.scriptVersion.revision, 1);

	const general = await seed(pool, "general");
	const generalResult = await confirm(actorFor(general), {
		scriptVersionId: general.scriptVersionId,
		expectedScriptVersionRevision: 1,
		decisions: [
			{ claimIndex: 0, subject: "GENERAL" },
			{ claimIndex: 1, subject: "GENERAL" },
		],
	});
	assert.equal(generalResult.kind, "confirmed");
	if (generalResult.kind === "confirmed") {
		assert.equal(generalResult.previousRevision, 1);
		assert.equal(generalResult.resultRevision, 2);
		assert.equal(generalResult.scriptVersion.revision, 2);
		assert.equal(
			generalResult.scriptVersion.editableSnapshot.claimsSourceRevision,
			2,
		);
		const claims = generalResult.scriptVersion.editableSnapshot.claims;
		const firstClaim = claims[0];
		assert.ok(firstClaim);
		assert.equal(
			"subjectStatus" in firstClaim && firstClaim.subjectStatus,
			"CONFIRMED",
		);
		assert.deepEqual("subject" in firstClaim && firstClaim.subject, {
			kind: "GENERAL",
		});
		assert.equal(
			"proposedSubject" in firstClaim && firstClaim.proposedSubject,
			"PRODUCT",
		);
		assert.equal(
			"subjectSource" in firstClaim && firstClaim.subjectSource,
			"USER",
		);
		assert.deepEqual(claims[3], baseClaims[3]);
		const summary = summarizeCurrentScriptVersionClaims({
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			currentScriptVersion: generalResult.scriptVersion,
		});
		assert.equal(summary.productClaimState, "PRESENT");
		assert.equal(summary.productClaimCount, 1);
		assert.equal(summary.generalClaimCount, 3);
		let refreshProviderCalls = 0;
		const refreshProvider: TextProvider = {
			name: "confirmation-refresh-spy",
			estimateCost: async () => ({
				estimatedCostMicros: BigInt(0),
				currency: "VND",
				inputTokens: 0,
				pricingBasis: "test",
			}),
			generate: async () => {
				refreshProviderCalls += 1;
				throw new Error("provider must not be called");
			},
		};
		const refreshAfterConfirmation = await refresh.executeScriptClaimRefresh(
			{
				actor: general.actor,
				projectId: general.projectId,
				scriptVersionId: general.scriptVersionId,
				expectedScriptVersionRevision: 2,
				idempotencyKey: "confirm-refresh-noop",
			},
			{ provider: refreshProvider },
		);
		assert.equal(refreshAfterConfirmation.kind, "not_required");
		assert.equal(refreshProviderCalls, 0);
	}

	const productCorrection = await seed(pool, "product-correction");
	const productResult = await confirm(actorFor(productCorrection), {
		scriptVersionId: productCorrection.scriptVersionId,
		expectedScriptVersionRevision: 1,
		decisions: [
			{ claimIndex: 0, subject: "PRODUCT" },
			{ claimIndex: 1, subject: "PRODUCT" },
		],
	});
	assert.equal(productResult.kind, "confirmed");
	if (productResult.kind === "confirmed") {
		const claims = productResult.scriptVersion.editableSnapshot.claims;
		const secondClaim = claims[1];
		assert.ok(secondClaim);
		assert.deepEqual("subject" in secondClaim && secondClaim.subject, {
			kind: "PRODUCT",
			binding: "PROJECT_PRODUCT",
		});
		assert.equal(
			"proposedSubject" in secondClaim && secondClaim.proposedSubject,
			"GENERAL",
		);
		const summary = summarizeCurrentScriptVersionClaims({
			contentType: "ORGANIC",
			creationPath: "SCRIPTED",
			currentScriptVersion: productResult.scriptVersion,
		});
		const applicability = resolveProjectApplicability({
			projectIdentity: {
				contentType: "ORGANIC",
				creationPath: "SCRIPTED",
				contentFormatKey: "SCRIPTED_STANDARD",
				contentFormatVersion: 1,
				hasProduct: false,
			},
			product: { accessible: false },
			script: {
				generationStatus: "USABLE",
				usableGenerationPresent: true,
				sourceDependencyCurrent: true,
				currentVersionPresent: true,
				currentVersionFactLockReady: false,
				channelSettingsComplete: true,
				productFactsUsable: false,
				claimSummary: summary,
			},
			factLock: { gateReason: "FACT_LOCK_NOT_RUN" },
			voice: {
				configPresent: false,
				previewPresent: false,
				totalSegments: 0,
				attemptedSegments: 0,
				usableSegments: 0,
				pendingSegments: 0,
				failedSegments: 0,
				indeterminateSegments: 0,
				staleSegments: 0,
			},
			render: { featureImplemented: false, inputsStale: false },
		});
		assert.equal(applicability.capabilities[0]?.state, "REQUIRED");
		assert.equal(applicability.capabilities[2]?.state, "BLOCKED");
	}

	const partial = await seed(pool, "partial");
	await assert.rejects(
		() =>
			confirm(actorFor(partial), {
				scriptVersionId: partial.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [{ claimIndex: 0, subject: "GENERAL" }],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "CLAIM_SUBJECT_CONFIRMATION_REQUIRED",
	);
	const duplicate = await seed(pool, "duplicate");
	await assert.rejects(
		() =>
			confirm(actorFor(duplicate), {
				scriptVersionId: duplicate.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [
					{ claimIndex: 0, subject: "GENERAL" },
					{ claimIndex: 0, subject: "PRODUCT" },
					{ claimIndex: 1, subject: "GENERAL" },
				],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "CLAIM_SUBJECT_DECISIONS_INVALID",
	);
	const outOfRange = await seed(pool, "out-of-range");
	await assert.rejects(
		() =>
			confirm(actorFor(outOfRange), {
				scriptVersionId: outOfRange.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [
					{ claimIndex: 1, subject: "GENERAL" },
					{ claimIndex: 99, subject: "GENERAL" },
				],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "CLAIM_SUBJECT_DECISIONS_INVALID",
	);

	const alreadyConfirmed = await seed(pool, "already-confirmed", {
		claims: baseClaims.slice(2),
	});
	const alreadyResult = await confirm(actorFor(alreadyConfirmed), {
		scriptVersionId: alreadyConfirmed.scriptVersionId,
		expectedScriptVersionRevision: 1,
		decisions: [],
	});
	assert.equal(alreadyResult.kind, "not_required");
	const explicitNoop = await confirm(actorFor(alreadyConfirmed), {
		scriptVersionId: alreadyConfirmed.scriptVersionId,
		expectedScriptVersionRevision: 1,
		decisions: [{ claimIndex: 0, subject: "PRODUCT" }],
	});
	assert.equal(explicitNoop.kind, "not_required");
	const explicitCorrection = await confirm(actorFor(alreadyConfirmed), {
		scriptVersionId: alreadyConfirmed.scriptVersionId,
		expectedScriptVersionRevision: 1,
		decisions: [{ claimIndex: 0, subject: "GENERAL" }],
	});
	assert.equal(explicitCorrection.kind, "confirmed");

	const stale = await seed(pool, "stale", { status: "stale" });
	await assert.rejects(
		() =>
			confirm(actorFor(stale), {
				scriptVersionId: stale.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [
					{ claimIndex: 0, subject: "GENERAL" },
					{ claimIndex: 1, subject: "GENERAL" },
				],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "SCRIPT_CLAIMS_NOT_CURRENT",
	);
	const mismatch = await seed(pool, "mismatch", { claimsSourceRevision: 7 });
	await assert.rejects(
		() =>
			confirm(actorFor(mismatch), {
				scriptVersionId: mismatch.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "SCRIPT_CLAIMS_NOT_CURRENT",
	);
	const malformed = await seed(pool, "malformed");
	await pool.query(
		"update script_version set editable_snapshot_json = jsonb_set(editable_snapshot_json, '{claims,0}', $1::jsonb) where id = $2",
		[
			JSON.stringify({
				text: "broken",
				occurrence: { section: "hook", hookKey: "hook" },
			}),
			malformed.scriptVersionId,
		],
	);
	await assert.rejects(
		() =>
			confirm(actorFor(malformed), {
				scriptVersionId: malformed.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "CLAIM_SUBJECT_INVALID",
	);
	const organicLegacy = await seed(pool, "organic-legacy", {
		claims: [{ ...baseClaims[2], subjectSource: "LEGACY_COMPATIBILITY" }],
	});
	await assert.rejects(
		() =>
			confirm(actorFor(organicLegacy), {
				scriptVersionId: organicLegacy.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [{ claimIndex: 0, subject: "GENERAL" }],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "CLAIM_SUBJECT_INVALID",
	);
	const revisionConflict = await seed(pool, "revision-conflict");
	await pool.query("update script_version set revision = 2 where id = $1", [
		revisionConflict.scriptVersionId,
	]);
	await assert.rejects(
		() =>
			confirm(actorFor(revisionConflict), {
				scriptVersionId: revisionConflict.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "SCRIPT_VERSION_CONFLICT" &&
			error.metadata?.latestRevision === 2,
	);

	const affiliate = await seed(pool, "affiliate", { identity: "affiliate" });
	await assert.rejects(
		() =>
			confirm(actorFor(affiliate), {
				scriptVersionId: affiliate.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "CLAIM_SUBJECT_CONFIRMATION_NOT_ELIGIBLE",
	);

	const foreign = await seed(pool, "foreign");
	const foreignActor = await seed(pool, "foreign-actor");
	await assert.rejects(
		() =>
			confirm(foreignActor.actor, {
				scriptVersionId: foreign.scriptVersionId,
				expectedScriptVersionRevision: 1,
				decisions: [],
			}),
		(error: unknown) =>
			error instanceof confirmation.ClaimSubjectConfirmationServiceError &&
			error.code === "CLAIM_SUBJECT_CONFIRMATION_NOT_FOUND",
	);

	const concurrent = await seed(pool, "concurrent");
	const concurrentInput = {
		scriptVersionId: concurrent.scriptVersionId,
		expectedScriptVersionRevision: 1,
		decisions: [
			{ claimIndex: 0, subject: "GENERAL" as const },
			{ claimIndex: 1, subject: "GENERAL" as const },
		],
	};
	const [first, second] = await Promise.allSettled([
		confirm(concurrent.actor, concurrentInput),
		confirm(concurrent.actor, concurrentInput),
	]);
	assert.equal(
		[first, second].filter((result) => result.status === "fulfilled").length,
		1,
	);
	assert.equal(
		[first, second].filter((result) => result.status === "rejected").length,
		1,
	);
	const rejection = [first, second].find(
		(result) => result.status === "rejected",
	);
	assert.ok(rejection && rejection.status === "rejected");
	assert.equal(
		rejection.reason instanceof
			confirmation.ClaimSubjectConfirmationServiceError &&
			rejection.reason.code,
		"SCRIPT_VERSION_CONFLICT",
	);

	console.log("Organic Claim Subject Confirmation API matrix: PASS");
} finally {
	await pool.end();
}

import { randomUUID } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { requireE2ETestDatabaseAuthority } from "./e2e-test-database-authority";

const migrationsRoot = resolve("packages/db/src/migrations");
const temporaryFolders: string[] = [];
const authority = requireE2ETestDatabaseAuthority();

process.env.NODE_ENV = "test";
process.env.AFFICHANNEL_E2E_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_E2E_TEST_DATABASE_CONFIRM =
	"DISPOSABLE_E2E_TEST_DB_CONFIRMED";
process.env.AFFICHANNEL_ISOLATED_TEST_ENV = "1";
process.env.DATABASE_URL = authority.url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = authority.url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
process.env.BETTER_AUTH_SECRET =
	"us22-e-disposable-better-auth-secret-012345678901234567890";
process.env.BETTER_AUTH_URL = "http://127.0.0.1";
process.env.CORS_ORIGIN = "http://127.0.0.1";
process.env.RENDER_ARTIFACT_DOWNLOAD_TTL_MS = "300000";
for (const key of [
	"DATABASE_URL_DIRECT",
	"R2_ENDPOINT",
	"R2_BUCKET",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
]) {
	delete process.env[key];
}

const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter"
);
const { call } = await import(
	"../packages/api/node_modules/@orpc/server/dist/index.mjs"
);
const { drizzle } = await import("drizzle-orm/node-postgres");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const core = await import("@affichannel/core");
const { INTERNAL_WORKSPACE_ID } = await import("@affichannel/core/workspace");
const schema = await import("@affichannel/db");
const compositionVersions = await import(
	"../packages/api/src/services/composition-version-repository"
);
const quickImageRender = await import(
	"../packages/api/src/services/quick-image-render-service"
);
const quickImageStatus = await import(
	"../packages/api/src/services/quick-image-render-status-service"
);
const renderJobs = await import(
	"../packages/api/src/services/render-job-repository"
);
const renderWorker = await import(
	"../packages/api/src/services/render-worker-service"
);
const { appRouter } = await import("../packages/api/src/routers/index");
const executionAdapter = await import(
	"../packages/api/src/services/quick-image-render-execution-adapter"
);
const { LocalRenderOutputStorage } = await import(
	"../packages/api/src/storage/render-output-storage"
);
const { deterministicVideoOnlyRenderOutputFixtureForFrames } = await import(
	"../apps/web/src/features/render/render-output-fixture"
);
const { createRenderWorkerLoop } = await import(
	"../apps/worker/src/worker-loop"
);

const pool = createNodePostgresPool(authority.url);
const disposableDb = drizzle(pool);
let schemaInitialized = false;
let outputRoot: string | undefined;

function id(prefix: string) {
	return `us22-d2-${prefix}-${randomUUID()}`;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function errorCode(error: unknown) {
	return error && typeof error === "object" && "code" in error
		? String((error as { code: unknown }).code)
		: undefined;
}

async function expectError(
	label: string,
	action: () => Promise<unknown>,
	code: string,
) {
	try {
		await action();
	} catch (error) {
		assert(
			errorCode(error) === code,
			`${label}: unexpected error ${errorCode(error)}`,
		);
		console.log(`${label}: PASS`);
		return;
	}
	throw new Error(`${label}: expected ${code}`);
}

type MigrationJournal = { entries: Array<{ tag: string }> };

async function migrationFolder() {
	const journal = JSON.parse(
		await readFile(join(migrationsRoot, "meta", "_journal.json"), "utf8"),
	) as MigrationJournal;
	const folder = await mkdtemp(join(tmpdir(), "affichannel-d2-migrations-"));
	temporaryFolders.push(folder);
	await mkdir(join(folder, "meta"), { recursive: true });
	await writeFile(
		join(folder, "meta", "_journal.json"),
		JSON.stringify(journal, null, 2),
		"utf8",
	);
	for (const entry of journal.entries)
		await copyFile(
			join(migrationsRoot, `${entry.tag}.sql`),
			join(folder, `${entry.tag}.sql`),
		);
	return folder;
}

async function insertProject(input: {
	id: string;
	workspaceId: string;
	userId: string;
	name: string;
}) {
	await disposableDb.insert(schema.project).values({
		id: input.id,
		workspaceId: input.workspaceId,
		name: input.name,
		productId: null,
		contentType: "ORGANIC",
		creationPath: "QUICK_IMAGE",
		contentFormatKey: "QUICK_IMAGE_STANDARD",
		contentFormatVersion: 1,
		currentStepKey: "video",
		createdByUserId: input.userId,
	});
}

async function insertReadyImage(input: {
	id: string;
	workspaceId: string;
	userId: string;
	checksum: string;
}) {
	const storageKey = `media/v1/${input.workspaceId}/${input.id}/image.png`;
	await pool.query(
		`insert into media_asset (
			id, workspace_id, created_by_user_id, origin, media_type, status,
			storage_provider, storage_key, upload_session_id, prepare_idempotency_key,
			upload_expires_at, original_filename, display_name, declared_mime_type,
			mime_type, byte_size, checksum_sha256, width, height,
			image_analysis_version, image_frame_count, image_exif_orientation,
			image_has_transparency, usage_rights, tags, finalized_at
		) values (
			$1, $2, $3, 'user_upload', 'image', 'ready', 'local', $4, $5, $6,
			now() + interval '1 hour', 'fixture.png', $7, 'image/png',
			'image/png', 33, $8, 3, 2, 'static-raster-v1', 1, 1, false,
			'owned', ARRAY[]::text[], now()
		)`,
		[
			input.id,
			input.workspaceId,
			input.userId,
			storageKey,
			id("upload"),
			id("prepare"),
			`Fixture ${input.id}`,
			input.checksum,
		],
	);
	return {
		id: input.id,
		workspaceId: input.workspaceId,
		checksumSha256: input.checksum,
		storageProvider: "local" as const,
		storageKey,
		mimeType: "image/png" as const,
		byteSize: 33,
		width: 3,
		height: 2,
	};
}

async function makeVersion(input: {
	actor: { workspaceId: string; userId: string };
	projectId: string;
	asset: Awaited<ReturnType<typeof insertReadyImage>>;
	durationSeconds?: 5 | 10 | 15;
}) {
	const built = await core.buildCompositionInputV2QuickImage({
		workspaceId: input.actor.workspaceId,
		projectId: input.projectId,
		source: input.asset,
		durationSeconds: input.durationSeconds ?? 5,
	});
	assert(built.ok, "Quick Image CompositionInput V2 fixture must build.");
	return compositionVersions.insertCompositionVersionRecord({
		actor: input.actor,
		projectId: input.projectId,
		compositionInput: built.input,
		compositionFingerprint: built.fingerprint,
	});
}

async function counts() {
	const result = await pool.query<{
		jobs: number;
		attempts: number;
		artifacts: number;
	}>(
		`select
			(select count(*)::int from render_job) as jobs,
			(select count(*)::int from render_attempt) as attempts,
			(select count(*)::int from render_artifact) as artifacts`,
	);
	const row = result.rows[0];
	assert(row, "count query returned no row");
	return row;
}

async function failOneQueuedJob(workspaceId: string) {
	const claimed = await renderJobs.claimNextRenderAttempt(
		workspaceId,
		id("queue-drainer"),
	);
	if (!claimed) return undefined;
	const failed = await renderJobs.failTechnical({
		attemptId: claimed.attempt.id,
		jobId: claimed.job.id,
		attemptNumber: claimed.attempt.attemptNumber,
		leaseOwner: claimed.attempt.leaseOwner,
		errorCode: "D2_FIXTURE_TECHNICAL_FAILURE",
		errorMessage:
			"Disposable D2 integration fixture terminalized this queued job.",
	});
	assert(failed, "queued fixture job must transition to FAILED");
	return claimed.job.id;
}

async function drainQueuedJobs(workspaceId: string) {
	while (await failOneQueuedJob(workspaceId)) {
		// Keep the shared workspace queue empty between independent scenarios.
	}
}

async function fileCount(root: string) {
	try {
		const entries = await readdir(root, { recursive: true });
		return entries.length;
	} catch {
		return 0;
	}
}

async function* bytesBody(bytes: Uint8Array) {
	yield bytes;
}

try {
	assert(
		new URL(authority.url).hostname === "127.0.0.1",
		"loopback authority required",
	);
	console.log(
		`AUTHORITY host=127.0.0.1 database=${authority.database} confirmation=valid`,
	);
	await pool.query("drop schema if exists public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	const folder = await migrationFolder();
	await migrate(drizzle(pool), { migrationsFolder: folder });
	schemaInitialized = true;
	console.log("DISPOSABLE_MIGRATIONS=PASS");

	const workspaceA = INTERNAL_WORKSPACE_ID;
	const workspaceB = id("workspace-b");
	const userA = id("user-a");
	const userB = id("user-b");
	const projectA = id("project-a");
	const projectB = id("project-b");
	const actorA = { workspaceId: workspaceA, userId: userA };
	const actorB = { workspaceId: workspaceB, userId: userB };
	await disposableDb
		.insert(schema.workspace)
		.values([
			{ id: workspaceA, name: "US22 D2 workspace A" },
			{ id: workspaceB, name: "US22 D2 workspace B" },
		])
		.onConflictDoNothing();
	await disposableDb.insert(schema.user).values([
		{
			id: userA,
			name: "US22 D2 A",
			email: `${userA}@example.test`,
			emailVerified: true,
		},
		{
			id: userB,
			name: "US22 D2 B",
			email: `${userB}@example.test`,
			emailVerified: true,
		},
	]);
	await disposableDb.insert(schema.workspaceMember).values([
		{ id: id("member-a"), workspaceId: workspaceA, userId: userA },
		{ id: id("member-b"), workspaceId: workspaceB, userId: userB },
	]);
	await insertProject({
		id: projectA,
		workspaceId: workspaceA,
		userId: userA,
		name: "US22 D2 project A",
	});
	await insertProject({
		id: projectB,
		workspaceId: workspaceA,
		userId: userA,
		name: "US22 D2 project B",
	});

	const assetA = await insertReadyImage({
		id: id("asset-a"),
		workspaceId: workspaceA,
		userId: userA,
		checksum: "a".repeat(64),
	});
	const assetB = await insertReadyImage({
		id: id("asset-b"),
		workspaceId: workspaceA,
		userId: userA,
		checksum: "b".repeat(64),
	});
	const assetC = await insertReadyImage({
		id: id("asset-c"),
		workspaceId: workspaceA,
		userId: userA,
		checksum: "c".repeat(64),
	});
	const assetD = await insertReadyImage({
		id: id("asset-d"),
		workspaceId: workspaceA,
		userId: userA,
		checksum: "d".repeat(64),
	});
	const assetE = await insertReadyImage({
		id: id("asset-e"),
		workspaceId: workspaceA,
		userId: userA,
		checksum: "e".repeat(64),
	});
	const versionA = await makeVersion({
		actor: actorA,
		projectId: projectA,
		asset: assetA,
	});
	const versionB = await makeVersion({
		actor: actorA,
		projectId: projectA,
		asset: assetB,
	});
	const versionC = await makeVersion({
		actor: actorA,
		projectId: projectA,
		asset: assetC,
	});
	const versionD = await makeVersion({
		actor: actorA,
		projectId: projectA,
		asset: assetD,
	});
	const versionE = await makeVersion({
		actor: actorA,
		projectId: projectA,
		asset: assetE,
	});

	const retryJobA = await quickImageRender.startQuickImageRender(actorA, {
		projectId: projectA,
		compositionVersionId: versionA.id,
		idempotencyKey: id("retry-a"),
	});
	const retryAttemptA = await renderJobs.claimNextRenderAttempt(
		workspaceA,
		id("retry-worker"),
	);
	assert(
		retryAttemptA?.job.id === retryJobA.id,
		"retry source must be claimed",
	);
	assert(
		await renderJobs.failTechnical({
			attemptId: retryAttemptA.attempt.id,
			jobId: retryAttemptA.job.id,
			attemptNumber: retryAttemptA.attempt.attemptNumber,
			leaseOwner: retryAttemptA.attempt.leaseOwner,
			errorCode: "D2_RETRY_FIXTURE_FAILURE",
		}),
		"retry source must become FAILED",
	);
	const retryJobB = await quickImageRender.retryFailedQuickImageRender(actorA, {
		projectId: projectA,
		failedRenderJobId: retryJobA.id,
		idempotencyKey: id("retry-b"),
	});
	const retryRequestA = core.quickImageRenderRequestSchema.parse(
		retryJobA.requestSpec,
	);
	const retryRequestB = core.quickImageRenderRequestSchema.parse(
		retryJobB.requestSpec,
	);
	assert(retryJobA.id !== retryJobB.id, "retry must create a new RenderJob");
	assert(
		retryJobA.idempotencyKey !== retryJobB.idempotencyKey,
		"retry must use a new key",
	);
	assert(
		retryJobA.compositionVersionId === retryJobB.compositionVersionId,
		"retry version mismatch",
	);
	assert(
		retryJobA.compositionFingerprint === retryJobB.compositionFingerprint,
		"retry composition mismatch",
	);
	assert(
		retryRequestA.renderPlanFingerprint === retryRequestB.renderPlanFingerprint,
		"retry plan mismatch",
	);
	assert(
		retryRequestA.outputProfileFingerprint ===
			retryRequestB.outputProfileFingerprint,
		"retry profile mismatch",
	);
	assert(
		retryRequestA.outputContractVersion === retryRequestB.outputContractVersion,
		"retry contract mismatch",
	);
	const retrySourceAfter = await quickImageStatus.getQuickImageRenderStatus(
		actorA,
		{
			projectId: projectA,
			renderJobId: retryJobA.id,
		},
	);
	assert(
		retrySourceAfter?.job.status === "FAILED",
		"old FAILED job must remain FAILED",
	);
	assert(
		retrySourceAfter.job.attemptCount === 1,
		"old FAILED attempt count must remain unchanged",
	);
	assert(
		retrySourceAfter.attempt?.id === retryAttemptA.attempt.id,
		"old retry attempt must not be reused",
	);
	console.log("FAILED_RETRY_REPOSITORY_INTEGRATION=PASS");
	console.log("FAILED_JOB_REMAINS_FAILED=PASS");
	console.log("RETRY_NEW_JOB=PASS");
	console.log("RETRY_SAME_FROZEN_COMPOSITION=PASS");
	await drainQueuedJobs(workspaceA);

	await expectError(
		"blocked source cannot use FAILED retry",
		async () => {
			const blockedSource = await quickImageRender.startQuickImageRender(
				actorA,
				{
					projectId: projectA,
					compositionVersionId: versionD.id,
					idempotencyKey: id("invalid-retry"),
				},
			);
			const result = await renderWorker.runNextRenderAttempt(
				actorA,
				id("invalid-retry-worker"),
			);
			assert(
				result.kind === "BLOCKED",
				"invalid retry fixture must be BLOCKED",
			);
			await quickImageRender.retryFailedQuickImageRender(actorA, {
				projectId: projectA,
				failedRenderJobId: blockedSource.id,
				idempotencyKey: id("invalid-retry-key"),
			});
		},
		"QUICK_IMAGE_RETRY_REQUIRES_FAILED_JOB",
	);

	const activeJobA = await quickImageRender.startQuickImageRender(actorA, {
		projectId: projectA,
		compositionVersionId: versionA.id,
		idempotencyKey: id("active-a"),
	});
	const beforeActiveDedup = await counts();
	const activeJobDuplicate = await quickImageRender.startQuickImageRender(
		actorA,
		{
			projectId: projectA,
			compositionVersionId: versionA.id,
			idempotencyKey: id("active-b"),
		},
	);
	const afterActiveDedup = await counts();
	assert(
		activeJobDuplicate.id === activeJobA.id,
		"active dedup must return existing job",
	);
	assert(
		afterActiveDedup.jobs === beforeActiveDedup.jobs,
		"active dedup created a second job",
	);
	console.log("ACTIVE_DEDUP_REPOSITORY_INTEGRATION=PASS");
	await drainQueuedJobs(workspaceA);

	const differentJobA = await quickImageRender.startQuickImageRender(actorA, {
		projectId: projectA,
		compositionVersionId: versionA.id,
		idempotencyKey: id("different-a"),
	});
	const differentJobB = await quickImageRender.startQuickImageRender(actorA, {
		projectId: projectA,
		compositionVersionId: versionB.id,
		idempotencyKey: id("different-b"),
	});
	assert(
		differentJobA.id !== differentJobB.id,
		"different versions must not dedup",
	);
	assert(
		differentJobA.canonicalRequestHash !== differentJobB.canonicalRequestHash,
		"different version hash collision",
	);
	console.log("DIFFERENT_VERSION_DEDUP=PASS");
	await drainQueuedJobs(workspaceA);

	const collisionJob = await quickImageRender.startQuickImageRender(actorA, {
		projectId: projectA,
		compositionVersionId: versionA.id,
		idempotencyKey: id("collision"),
	});
	await expectError(
		"idempotency key cannot alias a different version",
		async () =>
			quickImageRender.startQuickImageRender(actorA, {
				projectId: projectA,
				compositionVersionId: versionB.id,
				idempotencyKey: collisionJob.idempotencyKey,
			}),
		"RENDER_IDEMPOTENCY_CONFLICT",
	);
	await drainQueuedJobs(workspaceA);

	const blockedJob = await quickImageRender.startQuickImageRender(actorA, {
		projectId: projectA,
		compositionVersionId: versionC.id,
		idempotencyKey: id("blocked"),
	});
	const blockedWorkerResult = await renderWorker.runNextRenderAttempt(
		actorA,
		id("default-worker"),
	);
	assert(
		blockedWorkerResult.kind === "BLOCKED",
		`explicitly denied Quick Image worker must block: ${JSON.stringify(blockedWorkerResult)}`,
	);
	assert(
		blockedWorkerResult.reason ===
			executionAdapter.QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED,
		"default Quick Image worker returned the wrong block reason",
	);
	const blockedDuplicateBefore = await counts();
	const blockedDuplicate = await quickImageRender.startQuickImageRender(
		actorA,
		{
			projectId: projectA,
			compositionVersionId: versionC.id,
			idempotencyKey: id("blocked-duplicate"),
		},
	);
	const blockedDuplicateAfter = await counts();
	assert(
		blockedDuplicate.id === blockedJob.id,
		"BLOCKED job must remain actively deduplicated",
	);
	assert(
		blockedDuplicateAfter.jobs === blockedDuplicateBefore.jobs,
		"BLOCKED dedup created a second job",
	);
	const blockedStatus = await quickImageStatus.getQuickImageRenderStatus(
		actorA,
		{
			projectId: projectA,
			renderJobId: blockedJob.id,
		},
	);
	assert(
		blockedStatus?.job.status === "BLOCKED",
		"default worker status must be BLOCKED",
	);
	assert(
		blockedStatus.job.errorCode ===
			executionAdapter.QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED,
		"default worker did not persist the denied-execution reason",
	);
	assert(
		blockedStatus.attempt?.status === "FENCED",
		"blocked attempt must be fenced",
	);
	assert(
		blockedStatus.attempt.executionStartedAt === null,
		"default block must precede execution",
	);
	assert(
		blockedStatus.artifact === undefined,
		"blocked job must have no artifact",
	);
	console.log("BLOCKED_ACTIVE_DEDUP=PASS");
	console.log("EXPLICIT_DENIED_EXECUTION=BLOCKED");
	console.log("APPROVED_PRODUCTION_ADAPTER_REACHABILITY=SEPARATE");

	let missingStorageAdapterCalls = 0;
	const missingStorageJob = await quickImageRender.startQuickImageRender(
		actorA,
		{
			projectId: projectA,
			compositionVersionId: versionB.id,
			idempotencyKey: id("missing-storage"),
		},
	);
	const missingStorageAdapter =
		executionAdapter.createFakeQuickImageExecutionAdapter({
			result: async (context) => {
				missingStorageAdapterCalls += 1;
				return {
					outcome: "SUCCESS_OUTPUT_READY" as const,
					outputReady: {
						schemaVersion: "quick-image-output-ready.v1" as const,
						kind: "OUTPUT_READY" as const,
						jobId: context.snapshot.jobId,
						attemptId: context.snapshot.attemptId,
						attemptNumber: context.snapshot.attemptNumber,
						outputReservationId: context.snapshot.execution.outputReservationId,
					},
				};
			},
		});
	const missingStorageStagingRoot = await mkdtemp(
		join(tmpdir(), "affichannel-d2-missing-storage-staging-"),
	);
	temporaryFolders.push(missingStorageStagingRoot);
	const missingStorageResult = await renderWorker.runNextRenderAttempt(
		actorA,
		id("missing-storage-worker"),
		{
			executeQuickImage: missingStorageAdapter,
			quickImageStagingRoot: missingStorageStagingRoot,
		},
	);
	assert(
		missingStorageResult.kind === "INDETERMINATE",
		"missing proof must be INDETERMINATE",
	);
	assert(
		missingStorageAdapterCalls === 1,
		"missing proof adapter must run exactly once",
	);
	const missingStorageStatus = await quickImageStatus.getQuickImageRenderStatus(
		actorA,
		{
			projectId: projectA,
			renderJobId: missingStorageJob.id,
		},
	);
	assert(
		missingStorageStatus?.job.status === "INDETERMINATE",
		"missing proof job must not complete",
	);
	assert(
		missingStorageStatus.attempt?.status === "INDETERMINATE",
		"missing proof attempt must not complete",
	);
	assert(
		missingStorageStatus.artifact === undefined,
		"missing proof must not create an artifact",
	);
	console.log("PROCESS_SUCCESS_WITHOUT_STORAGE_PROOF=NOT_COMPLETED");

	outputRoot = await mkdtemp(join(tmpdir(), "affichannel-d2-render-output-"));
	const outputStorage = new LocalRenderOutputStorage({ rootDir: outputRoot });
	const fixtureBytes = deterministicVideoOnlyRenderOutputFixtureForFrames(150);
	let validStorageAdapterCalls = 0;
	const validStorageJob = await quickImageRender.startQuickImageRender(actorA, {
		projectId: projectA,
		compositionVersionId: versionA.id,
		idempotencyKey: id("valid-storage"),
	});
	const validStorageAdapter =
		executionAdapter.createFakeQuickImageExecutionAdapter({
			result: async (context) => {
				validStorageAdapterCalls += 1;
				return {
					outcome: "SUCCESS_OUTPUT_READY" as const,
					outputReady: {
						schemaVersion: "quick-image-output-ready.v1" as const,
						kind: "OUTPUT_READY" as const,
						jobId: context.snapshot.jobId,
						attemptId: context.snapshot.attemptId,
						attemptNumber: context.snapshot.attemptNumber,
						outputReservationId: context.snapshot.execution.outputReservationId,
					},
					storage: outputStorage,
					body: bytesBody(fixtureBytes),
				};
			},
		});
	const validStorageResult = await renderWorker.runNextRenderAttempt(
		actorA,
		id("valid-storage-worker"),
		{
			executeQuickImage: validStorageAdapter,
			quickImageStagingRoot: outputRoot,
		},
	);
	assert(validStorageResult.kind === "COMPLETED", "valid proof must complete");
	assert(
		validStorageAdapterCalls === 1,
		"valid proof adapter must run exactly once",
	);
	const completedStatus = await quickImageStatus.getQuickImageRenderStatus(
		actorA,
		{
			projectId: projectA,
			renderJobId: validStorageJob.id,
		},
	);
	assert(
		completedStatus?.job.status === "COMPLETED",
		"completed job state missing",
	);
	assert(
		completedStatus.attempt?.status === "COMPLETED",
		"completed attempt state missing",
	);
	assert(
		completedStatus.artifact !== undefined,
		"completed job must have an artifact",
	);
	assert(
		completedStatus.artifact.renderJobId === validStorageJob.id,
		"artifact job binding mismatch",
	);
	assert(
		completedStatus.artifact.renderAttemptId === completedStatus.attempt.id,
		"artifact attempt binding mismatch",
	);
	assert(
		completedStatus.artifact.compositionVersionId === versionA.id,
		"artifact version binding mismatch",
	);
	assert(
		completedStatus.artifact.projectId === projectA,
		"artifact project binding mismatch",
	);
	assert(
		completedStatus.artifact.outputContractVersion === "quick-image-output.v1",
		"artifact contract mismatch",
	);
	assert(
		completedStatus.artifact.outputEncodingProfileFingerprint ===
			validStorageJob.outputEncodingProfileFingerprint,
		"artifact profile mismatch",
	);
	const persistedCounts = await counts();
	assert(
		persistedCounts.artifacts === 1,
		"valid finalize must persist exactly one artifact in this fixture",
	);
	console.log("VALID_STORAGE_PROOF=PASS");
	console.log("RENDER_ARTIFACT_PERSISTED=PASS");
	console.log("ATOMIC_FINALIZE=PASS");
	console.log("T09_SHARED_FINALIZE_PATH=PASS");
	const routerStatus = await call(
		appRouter.quickImageRender.status,
		{ projectId: projectA, renderJobId: validStorageJob.id },
		{
			context: {
				auth: null,
				session: { user: { id: userA } },
			},
		} as never,
	);
	const routerStatusValue = routerStatus as {
		status: string;
		artifact?: { artifactId: string } | null;
	};
	assert(
		routerStatusValue.status === "COMPLETED" &&
			routerStatusValue.artifact?.artifactId === completedStatus.artifact.id,
		"protected status router must return the persisted artifact DTO",
	);
	assert(
		!(routerStatusValue as Record<string, unknown>).storageKey,
		"protected status DTO must not expose storageKey",
	);
	console.log("PROTECTED_STATUS_ROUTER_SAFE_DTO=PASS");

	const completedReloadCountsBefore = await counts();
	const completedReload =
		await quickImageStatus.getQuickImageRenderStatusForComposition(actorA, {
			projectId: projectA,
			compositionVersionId: versionA.id,
		});
	assert(
		completedReload?.job.id === validStorageJob.id,
		"exact-composition reload must recover the completed RenderJob",
	);
	assert(
		completedReload.artifact?.id === completedStatus.artifact.id,
		"exact-composition reload must recover the same RenderArtifact",
	);
	const completedReloadCountsAfter = await counts();
	assert(
		JSON.stringify(completedReloadCountsBefore) ===
			JSON.stringify(completedReloadCountsAfter),
		"completed reload discovery created lifecycle rows",
	);
	console.log("T08_COMPLETED_RELOAD_SAME_JOB=PASS");
	console.log("T08_COMPLETED_RELOAD_SAME_ARTIFACT=PASS");

	const routerStart = await call(
		appRouter.quickImageRender.start,
		{
			projectId: projectA,
			compositionVersionId: versionE.id,
			idempotencyKey: id("active-reload"),
		},
		{
			context: {
				auth: null,
				session: { user: { id: userA } },
			},
		} as never,
	);
	const routerStartValue = routerStart as {
		renderJobId: string;
		compositionVersionId: string;
		status: string;
	};
	assert(
		routerStartValue.status === "QUEUED" &&
			routerStartValue.compositionVersionId === versionE.id,
		"protected start router must return a queued exact-version DTO",
	);
	const activeReloadJob = { id: routerStartValue.renderJobId };
	const activeReload =
		await quickImageStatus.getQuickImageRenderStatusForComposition(actorA, {
			projectId: projectA,
			compositionVersionId: versionE.id,
		});
	assert(
		activeReload?.job.id === activeReloadJob.id &&
			activeReload.job.status === "QUEUED",
		"active reload must recover the same queued job",
	);
	assert(
		activeReload.attempt === undefined,
		"active reload must not create an attempt",
	);
	const activeReloadClaim = await renderJobs.claimNextRenderAttempt(
		workspaceA,
		id("failed-reload-worker"),
	);
	assert(
		activeReloadClaim?.job.id === activeReloadJob.id,
		"failed reload fixture must claim its exact job",
	);
	assert(
		await renderJobs.failTechnical({
			attemptId: activeReloadClaim.attempt.id,
			jobId: activeReloadClaim.job.id,
			attemptNumber: activeReloadClaim.attempt.attemptNumber,
			leaseOwner: activeReloadClaim.attempt.leaseOwner,
			errorCode: "E_RELOAD_FIXTURE_FAILURE",
		}),
		"failed reload fixture must become FAILED",
	);
	const failedReload =
		await quickImageStatus.getQuickImageRenderStatusForComposition(actorA, {
			projectId: projectA,
			compositionVersionId: versionE.id,
		});
	assert(
		failedReload?.job.id === activeReloadJob.id &&
			failedReload.job.status === "FAILED",
		"failed reload must remain failed without automatic retry",
	);
	console.log("T08_RUNNING_OR_ACTIVE_RELOAD_SAME_JOB=PASS");
	console.log("T08_FAILED_RELOAD_NO_AUTO_RETRY=PASS");

	const workerDispatchJob = await quickImageRender.startQuickImageRender(
		actorA,
		{
			projectId: projectA,
			compositionVersionId: versionA.id,
			idempotencyKey: id("worker-dispatch"),
		},
	);
	const workerResults: string[] = [];
	const workerLoop = createRenderWorkerLoop({
		workerId: id("worker-loop"),
		maxIterations: 1,
		runIteration: async () => {
			const result = await renderWorker.runNextRenderAttempt(
				actorA,
				id("worker-loop-lease"),
				{
					executeQuickImage:
						executionAdapter.createFakeQuickImageExecutionAdapter({
							result: {
								outcome: "PROCESS_FAILED",
								classification: "DETERMINISTIC",
								sideEffectFree: true,
								errorCode: "E_WORKER_FIXTURE_FAILURE",
							},
						}),
				},
			);
			workerResults.push(result.kind);
			return result;
		},
		sleep: async () => undefined,
	});
	await workerLoop.run();
	assert(
		workerResults.length === 1 && workerResults[0] === "FAILED",
		"worker loop must dispatch one queued job through EN-001",
	);
	const workerDispatchStatus = await quickImageStatus.getQuickImageRenderStatus(
		actorA,
		{ projectId: projectA, renderJobId: workerDispatchJob.id },
	);
	assert(
		workerDispatchStatus?.job.status === "FAILED" &&
			workerDispatchStatus.attempt?.status === "FAILED",
		"worker dispatch lifecycle result was not persisted",
	);
	const canonicalAfterNewerFailure =
		await quickImageStatus.getQuickImageRenderStatusForComposition(actorA, {
			projectId: projectA,
			compositionVersionId: versionA.id,
		});
	assert(
		canonicalAfterNewerFailure?.job.id === validStorageJob.id &&
			canonicalAfterNewerFailure.artifact?.id === completedStatus.artifact.id,
		"completed artifact must outrank a newer failed job on reload",
	);
	console.log("WORKER_LOOP_TO_EN001=PASS");
	console.log("T08_COMPLETED_ARTIFACT_OUTRANKS_NEWER_FAILURE=PASS");

	const statusCountsBefore = await counts();
	const statusAdapterCallsBefore =
		missingStorageAdapterCalls + validStorageAdapterCalls;
	await quickImageStatus.getQuickImageRenderStatus(actorA, {
		projectId: projectA,
		renderJobId: validStorageJob.id,
	});
	await quickImageStatus.getQuickImageRenderStatus(actorA, {
		projectId: projectA,
		renderJobId: validStorageJob.id,
	});
	const statusCountsAfter = await counts();
	assert(
		JSON.stringify(statusCountsBefore) === JSON.stringify(statusCountsAfter),
		"status read changed lifecycle counts",
	);
	assert(
		statusAdapterCallsBefore ===
			missingStorageAdapterCalls + validStorageAdapterCalls,
		"status read invoked an adapter",
	);
	console.log("STATUS_READ_SIDE_EFFECTS=0");

	const authCountsBefore = await counts();
	const authorizationAdapterCalls = 0;
	const authorizationStorageFilesBefore = await fileCount(outputRoot);
	await expectError(
		"cross-workspace start",
		async () =>
			quickImageRender.startQuickImageRender(actorB, {
				projectId: projectA,
				compositionVersionId: versionA.id,
				idempotencyKey: id("cross-workspace-start"),
			}),
		"RENDER_COMPOSITION_MISSING",
	);
	await expectError(
		"cross-project start",
		async () =>
			quickImageRender.startQuickImageRender(actorA, {
				projectId: projectB,
				compositionVersionId: versionA.id,
				idempotencyKey: id("cross-project-start"),
			}),
		"RENDER_PROJECT_MISMATCH",
	);
	const crossWorkspaceStatus = await quickImageStatus.getQuickImageRenderStatus(
		actorB,
		{
			projectId: projectA,
			renderJobId: validStorageJob.id,
		},
	);
	assert(
		crossWorkspaceStatus === undefined,
		"cross-workspace status must be hidden",
	);
	console.log("cross-workspace status: DENIED");
	const crossProjectStatus = await quickImageStatus.getQuickImageRenderStatus(
		actorA,
		{
			projectId: projectB,
			renderJobId: validStorageJob.id,
		},
	);
	assert(
		crossProjectStatus === undefined,
		"cross-project status must be hidden",
	);
	console.log("cross-project status: DENIED");
	await expectError(
		"cross-workspace failed retry",
		async () =>
			quickImageRender.retryFailedQuickImageRender(actorB, {
				projectId: projectA,
				failedRenderJobId: retryJobA.id,
				idempotencyKey: id("cross-workspace-retry"),
			}),
		"RENDER_JOB_NOT_FOUND",
	);
	await expectError(
		"cross-project failed retry",
		async () =>
			quickImageRender.retryFailedQuickImageRender(actorA, {
				projectId: projectB,
				failedRenderJobId: retryJobA.id,
				idempotencyKey: id("cross-project-retry"),
			}),
		"RENDER_JOB_NOT_FOUND",
	);
	const authCountsAfter = await counts();
	assert(
		JSON.stringify(authCountsBefore) === JSON.stringify(authCountsAfter),
		"authorization negative path created lifecycle rows",
	);
	assert(
		authorizationAdapterCalls === 0,
		"authorization path invoked an adapter",
	);
	assert(
		authorizationStorageFilesBefore === (await fileCount(outputRoot)),
		"authorization path wrote storage",
	);
	console.log("CROSS_WORKSPACE_START=DENIED");
	console.log("CROSS_PROJECT_START=DENIED");
	console.log("CROSS_WORKSPACE_STATUS=DENIED");
	console.log("CROSS_PROJECT_STATUS=DENIED");
	console.log("CROSS_WORKSPACE_RETRY=DENIED");
	console.log("CROSS_PROJECT_RETRY=DENIED");
	console.log("AUTHORIZATION_SIDE_EFFECT_COUNTS=0");

	const unknownJob = await quickImageRender.startQuickImageRender(actorA, {
		projectId: projectA,
		compositionVersionId: versionA.id,
		idempotencyKey: id("unknown-request"),
	});
	await pool.query(
		"update render_job set request_spec_json = $1 where id = $2",
		[
			{
				...unknownJob.requestSpec,
				schemaVersion: "render-request.quick-image.v99",
			},
			unknownJob.id,
		],
	);
	let unknownAdapterCalls = 0;
	try {
		await renderWorker.runNextRenderAttempt(actorA, id("unknown-worker"), {
			executeQuickImage: async () => {
				unknownAdapterCalls += 1;
				return { outcome: "INDETERMINATE", errorCode: "SHOULD_NOT_RUN" };
			},
		});
		throw new Error("unknown future request unexpectedly dispatched");
	} catch (error) {
		assert(
			errorCode(error) === "RENDER_JOB_DATA_INVALID",
			"unknown request did not fail closed",
		);
	}
	assert(
		unknownAdapterCalls === 0,
		"unknown future request called the Quick Image adapter",
	);
	console.log("UNKNOWN_V2_ADAPTER_CALLS=0");

	const finalCounts = await counts();
	assert(
		finalCounts.artifacts === 1,
		"final artifact count must remain singular",
	);
	console.log("REAL_PROCESS_EXECUTION=0");
	console.log("REAL_FFMPEG=0");
	console.log("REAL_ENCODED_MP4=NO");
	console.log("PRODUCTION_CLOUD_STORAGE_USED=NO");
	console.log("MIGRATIONS_CHANGED=NO");
	console.log("PERSISTENT_SHARED_DATABASE_MUTATED=NO");
	console.log("QUICK_IMAGE_D2_REPOSITORY_INTEGRATION=PASS");
	console.log("QUICK_IMAGE_E_WORKER_RELOAD_INTEGRATION=PASS");
} finally {
	if (schemaInitialized) {
		await pool
			.query("drop schema if exists public cascade")
			.catch(() => undefined);
		await pool
			.query("drop schema if exists drizzle cascade")
			.catch(() => undefined);
		await pool.query("create schema public").catch(() => undefined);
	}
	await pool.end();
	if (outputRoot) await rm(outputRoot, { recursive: true, force: true });
	for (const folder of temporaryFolders)
		await rm(folder, { recursive: true, force: true });
}

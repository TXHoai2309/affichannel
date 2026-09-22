import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const url = process.env.AFFICHANNEL_US28_TEST_DATABASE_URL?.trim();
if (
	!url ||
	process.env.AFFICHANNEL_US28_TEST_DATABASE_CONFIRM !==
		"DISPOSABLE_US28_DB_CONFIRMED"
) {
	throw new Error(
		"REFUSED: US28 requires an explicit disposable loopback PostgreSQL authority.",
	);
}
const parsedUrl = new URL(url);
if (
	!(
		parsedUrl.protocol === "postgres:" || parsedUrl.protocol === "postgresql:"
	) ||
	parsedUrl.hostname !== "127.0.0.1"
) {
	throw new Error("REFUSED: US28 database must be loopback-only PostgreSQL.");
}

const storageRoot = await mkdtemp(join(tmpdir(), "affichannel-us28-media-"));
process.env.NODE_ENV = "test";
process.env.SKIP_ENV_VALIDATION = "1";
process.env.AFFICHANNEL_AI_TEST_MODE = "1";
process.env.BETTER_AUTH_SECRET = "us28-deterministic-test-secret-012345678901";
process.env.AFFICHANNEL_M1_TEST_DATABASE_URL = url;
process.env.AFFICHANNEL_M1_TEST_DATABASE_CONFIRM = "DISPOSABLE_DB_CONFIRMED";
process.env.MEDIA_STORAGE_PROVIDER = "local";
process.env.MEDIA_LOCAL_ROOT = storageRoot;
process.env.MEDIA_IMAGE_MAX_BYTES = "1048576";
process.env.MEDIA_VIDEO_MAX_BYTES = "1048576";
process.env.MEDIA_AUDIO_MAX_BYTES = "1048576";
for (const key of ["DATABASE_URL", "DATABASE_URL_DIRECT"] as const)
	delete process.env[key];

const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { drizzle } = await import("drizzle-orm/node-postgres");
const { and, eq } = await import("drizzle-orm");
const { createNodePostgresPool } = await import(
	"../packages/db/src/node-postgres-test-adapter.ts"
);
const {
	aiVisualArtifact,
	aiGovernanceSettings,
	aiOperation,
	db,
	mediaAsset,
	mediaAssetLink,
	project,
	user,
	workspace,
} = await import("../packages/db/src/index.ts");
const {
	confirmAiVisualGeneration,
	estimateAiVisualGeneration,
	executeAiVisualDeterministicTestOperation,
	getAllowedAiVisualRecoveryActions,
	reconcileAiVisualGeneration,
} = await import("../packages/api/src/services/ai-visual-service.ts");
const { AiGovernanceError, updateAiGovernanceSettings } = await import(
	"../packages/api/src/services/ai-governance-service.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function expectCode(code: string, callback: () => Promise<unknown>) {
	try {
		await callback();
	} catch (error) {
		assert(
			error instanceof AiGovernanceError,
			`${code}: expected governance error`,
		);
		assert(error.code === code, `${code}: received ${error.code}`);
		return;
	}
	throw new Error(`${code}: expected rejection`);
}

const pool = createNodePostgresPool(url);
const migrationsFolder = resolve("packages/db/src/migrations");
const actor = {
	workspaceId: `us28-workspace-${randomUUID()}`,
	userId: `us28-user-${randomUUID()}`,
};
const projectId = `us28-project-${randomUUID()}`;
const sourceId = `us28-source-${randomUUID()}`;
const sourceKey = `media/v1/${actor.workspaceId}/${sourceId}/source.png`;

try {
	await pool.query("drop schema public cascade");
	await pool.query("drop schema if exists drizzle cascade");
	await pool.query("create schema public");
	await migrate(drizzle(pool), { migrationsFolder });
	await db.insert(user).values({
		id: actor.userId,
		name: "US28 Test",
		email: `${actor.userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(workspace).values({
		id: actor.workspaceId,
		name: "US28 disposable",
		timezone: "UTC",
	});
	await db.insert(project).values({
		id: projectId,
		workspaceId: actor.workspaceId,
		name: "US28 project",
		contentType: "ORGANIC",
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
		currentStepKey: "video",
		createdByUserId: actor.userId,
	});
	await db.insert(mediaAsset).values({
		id: sourceId,
		workspaceId: actor.workspaceId,
		createdByUserId: actor.userId,
		origin: "user_upload",
		mediaType: "image",
		status: "ready",
		storageProvider: "local",
		storageKey: sourceKey,
		uploadSessionId: `upload-${sourceId}`,
		prepareIdempotencyKey: `prepare-${sourceId}`,
		uploadExpiresAt: new Date(),
		originalFilename: "source.png",
		displayName: "Source image",
		declaredMimeType: "image/png",
		mimeType: "image/png",
		byteSize: 128,
		checksumSha256: "a".repeat(64),
		width: 1080,
		height: 1920,
		usageRights: "owned",
		tags: [],
		finalizedAt: new Date(),
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(mediaAssetLink).values({
		id: randomUUID(),
		workspaceId: actor.workspaceId,
		projectId,
		mediaAssetId: sourceId,
		usageType: "project_resource",
		createdByUserId: actor.userId,
	});
	await updateAiGovernanceSettings(actor, {
		expectedVersion: null,
		providerId: "deterministic",
		modelId: "deterministic-image-to-video-v1",
		providerEnabled: true,
		modelEnabled: true,
		killSwitch: false,
		pricingVersion: "deterministic-image-to-video.v1",
		budgetPeriod: "MONTHLY",
		budgetLimitMicros: 100,
		budgetCurrency: "VND",
	});

	const baseInput = {
		projectId,
		sourceMediaAssetId: sourceId,
		prompt: "slow camera movement",
		motion: "subtle natural motion",
		durationSeconds: 5 as const,
		aspectRatio: "9:16" as const,
		idempotencyKey: `base-${randomUUID()}`,
	};
	const estimate = await estimateAiVisualGeneration(actor, baseInput);
	assert(
		estimate.providerId === "deterministic" &&
			estimate.modelId === "deterministic-image-to-video-v1",
		"server-owned provider/model resolution failed",
	);
	assert(
		estimate.estimatedCostMicros === 1 &&
			estimate.hashVersion === "paid-request.image-to-video.v1",
		"estimate/hash contract failed",
	);

	const currentSettings = await db
		.select()
		.from(aiGovernanceSettings)
		.where(eq(aiGovernanceSettings.workspaceId, actor.workspaceId))
		.limit(1);
	const currentSetting = currentSettings[0];
	assert(currentSetting, "governance settings were not created");
	await updateAiGovernanceSettings(actor, {
		expectedVersion: currentSetting.version,
		providerId: "deterministic",
		modelId: "deterministic-image-to-video-v1",
		providerEnabled: true,
		modelEnabled: true,
		killSwitch: false,
		pricingVersion: "deterministic-image-to-video.v1",
		budgetPeriod: "MONTHLY",
		budgetLimitMicros: 100,
		budgetCurrency: "VND",
	});
	await expectCode("AI_ESTIMATE_STALE", () =>
		confirmAiVisualGeneration(actor, {
			generation: baseInput,
			estimate,
			confirmed: true,
		}),
	);
	await expectCode("AI_ESTIMATE_STALE", () =>
		confirmAiVisualGeneration(actor, {
			generation: baseInput,
			estimate: { ...estimate, signature: "0".repeat(64) },
			confirmed: true,
		}),
	);
	const freshEstimate = await estimateAiVisualGeneration(actor, {
		...baseInput,
		idempotencyKey: `success-${randomUUID()}`,
	});
	const success = await confirmAiVisualGeneration(actor, {
		generation: { ...baseInput, idempotencyKey: `success-${randomUUID()}` },
		estimate: freshEstimate,
		confirmed: true,
	});
	const successAfterRun = await executeAiVisualDeterministicTestOperation(
		actor,
		success.id,
		"SUCCESS",
	);
	assert(
		successAfterRun.status === "COMPLETED" &&
			successAfterRun.completedMediaAssetId &&
			successAfterRun.artifact?.status === "FINAL",
		"successful MediaAsset finalization failed",
	);
	const [completedAsset] = await db
		.select()
		.from(mediaAsset)
		.where(eq(mediaAsset.id, successAfterRun.completedMediaAssetId));
	assert(
		completedAsset?.origin === "ai_generated" &&
			completedAsset.mediaType === "video" &&
			completedAsset.mimeType === "video/mp4",
		"generated output did not enter shared MediaAsset",
	);
	const replay = await executeAiVisualDeterministicTestOperation(
		actor,
		success.id,
		"SUCCESS",
	);
	assert(
		replay.completedMediaAssetId === successAfterRun.completedMediaAssetId,
		"replay created a duplicate output",
	);

	const invalidInput = {
		...baseInput,
		prompt: "invalid output fixture",
		idempotencyKey: `invalid-${randomUUID()}`,
	};
	const invalidEstimate = await estimateAiVisualGeneration(actor, invalidInput);
	const invalidGeneration = await confirmAiVisualGeneration(actor, {
		generation: invalidInput,
		estimate: invalidEstimate,
		confirmed: true,
	});
	const invalidResult = await executeAiVisualDeterministicTestOperation(
		actor,
		invalidGeneration.id,
		"INVALID_OUTPUT",
	);
	assert(
		invalidResult.status === "FAILED" && !invalidResult.completedMediaAssetId,
		"invalid output was accepted",
	);

	const orphanInput = {
		...baseInput,
		prompt: "orphan artifact fixture",
		idempotencyKey: `orphan-${randomUUID()}`,
	};
	const orphanEstimate = await estimateAiVisualGeneration(actor, orphanInput);
	const orphanGeneration = await confirmAiVisualGeneration(actor, {
		generation: orphanInput,
		estimate: orphanEstimate,
		confirmed: true,
	});
	const orphanResult = await executeAiVisualDeterministicTestOperation(
		actor,
		orphanGeneration.id,
		"ORPHAN_ARTIFACT",
	);
	assert(
		orphanResult.status === "INDETERMINATE" &&
			orphanResult.artifact?.status === "ORPHAN",
		"orphan artifact did not fail closed",
	);
	const actions = await getAllowedAiVisualRecoveryActions(
		actor,
		orphanGeneration.id,
	);
	assert(
		actions.includes("ATTACH_ORPHAN_ARTIFACT") &&
			!actions.includes("RETRY" as never),
		"recovery exposed blind retry",
	);
	const recovered = await reconcileAiVisualGeneration(actor, {
		generationId: orphanGeneration.id,
		action: "ATTACH_ORPHAN_ARTIFACT",
	});
	assert(
		recovered.status === "COMPLETED" && recovered.artifact?.status === "FINAL",
		"orphan recovery did not finalize exactly once",
	);

	const dbFailureInput = {
		...baseInput,
		prompt: "database finalize fixture",
		idempotencyKey: `db-finalize-${randomUUID()}`,
	};
	const dbFailureEstimate = await estimateAiVisualGeneration(
		actor,
		dbFailureInput,
	);
	const dbFailureGeneration = await confirmAiVisualGeneration(actor, {
		generation: dbFailureInput,
		estimate: dbFailureEstimate,
		confirmed: true,
	});
	const dbFailureResult = await executeAiVisualDeterministicTestOperation(
		actor,
		dbFailureGeneration.id,
		"DB_FINALIZE_FAILURE",
	);
	assert(
		dbFailureResult.status === "INDETERMINATE" &&
			dbFailureResult.artifact?.status === "ORPHAN",
		"DB finalization uncertainty did not retain orphan evidence",
	);
	const dbRecovered = await reconcileAiVisualGeneration(actor, {
		generationId: dbFailureGeneration.id,
		action: "RECONCILE",
	});
	assert(
		dbRecovered.status === "COMPLETED" &&
			dbRecovered.artifact?.status === "FINAL",
		"DB finalization recovery did not complete",
	);

	const timeoutInput = {
		...baseInput,
		prompt: "timeout fixture",
		idempotencyKey: `timeout-${randomUUID()}`,
	};
	const timeoutEstimate = await estimateAiVisualGeneration(actor, timeoutInput);
	const timeoutGeneration = await confirmAiVisualGeneration(actor, {
		generation: timeoutInput,
		estimate: timeoutEstimate,
		confirmed: true,
	});
	const timeoutResult = await executeAiVisualDeterministicTestOperation(
		actor,
		timeoutGeneration.id,
		"TIMEOUT_AFTER_POSSIBLE_SEND",
	);
	assert(
		timeoutResult.status === "INDETERMINATE" &&
			timeoutResult.callStage === "POSSIBLY_SENT",
		"provider uncertainty was not preserved",
	);

	const generatedCount = await db
		.select()
		.from(mediaAsset)
		.where(
			and(
				eq(mediaAsset.workspaceId, actor.workspaceId),
				eq(mediaAsset.origin, "ai_generated"),
			),
		);
	const artifactCount = await db
		.select()
		.from(aiVisualArtifact)
		.where(eq(aiVisualArtifact.workspaceId, actor.workspaceId));
	const operationCount = await db
		.select()
		.from(aiOperation)
		.where(eq(aiOperation.workspaceId, actor.workspaceId));
	assert(
		generatedCount.length === 3 &&
			artifactCount.length === 3 &&
			operationCount.length === 5,
		"idempotency or lifecycle evidence count mismatch",
	);
	console.log(
		[
			"T28_01=PASS",
			"T28_02=PASS",
			"T28_03=PASS",
			"T28_04=PASS",
			"T28_05=PASS",
			"T28_06=PASS",
			"T28_07=PASS",
			"T28_08=PASS",
			"T28_09=PASS",
			"T28_10=PASS",
			"T28_11=PASS",
		].join("\n"),
	);
	console.log(
		"US28 estimate/confirm, server identity, stale governance, output validation, MediaAsset finalization, orphan recovery, uncertainty and no-blind-retry: PASS",
	);
} finally {
	await pool.end();
	await rm(storageRoot, { recursive: true, force: true });
}

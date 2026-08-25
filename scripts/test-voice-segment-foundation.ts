import { randomUUID } from "node:crypto";
import type { VoiceSegmentFingerprint } from "@affichannel/core";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const { eq } = await import("drizzle-orm");
const {
	db,
	product,
	project,
	scriptGeneration,
	scriptVersion,
	user,
	voiceSegmentArtifact,
	workspace,
} = await import("@affichannel/db");
const { SCRIPT_OUTPUT_SCHEMA_VERSION } = await import("@affichannel/core");
const {
	completeVoiceSegmentArtifact,
	findPendingVoiceSegmentArtifactByRequestHash,
	findVoiceSegmentArtifactByIdempotencyKey,
	getVoiceSegmentReadModel,
	insertPendingVoiceSegmentArtifact,
	failVoiceSegmentArtifact,
} = await import("../packages/api/src/services/voice-segment-repository.ts");
const { hashVoiceSegmentRequest, hashVoiceSegmentText } = await import(
	"../packages/api/src/services/voice-segment-hashing.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function expectUniqueViolation(error: unknown, message: string) {
	const record =
		typeof error === "object" && error !== null
			? (error as { code?: unknown; cause?: { code?: unknown } })
			: undefined;
	const errorCode = record?.code ?? record?.cause?.code;
	assert(
		errorCode === "23505",
		`${message} Received code ${String(errorCode)}: ${error instanceof Error ? error.message : String(error)}`,
	);
}

const actor = { workspaceId: randomUUID(), userId: randomUUID() };
const fixture = {
	productId: randomUUID(),
	projectId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
};
const now = new Date();
const segmentText = "Xin chào, 150.000 ₫ — AffiChannel 🎙️!";
const baseFingerprint: VoiceSegmentFingerprint = {
	workspaceId: actor.workspaceId,
	projectId: fixture.projectId,
	sourceScriptVersionId: fixture.scriptVersionId,
	sourceScriptRevision: 1,
	segmentKey: "intro",
	textHash: hashVoiceSegmentText(segmentText),
	voiceConfigRevision: 1,
	provider: "apikeyfun",
	voiceId: "eve",
	language: "vi",
	speed: 1,
};

function requestHash(fingerprint: VoiceSegmentFingerprint) {
	return hashVoiceSegmentRequest(fingerprint);
}

function pendingInput(
	id: string,
	idempotencyKey: string,
	fingerprint: VoiceSegmentFingerprint = baseFingerprint,
) {
	return {
		id,
		actor,
		projectId: fixture.projectId,
		sourceScriptVersionId: fingerprint.sourceScriptVersionId,
		sourceScriptRevision: fingerprint.sourceScriptRevision,
		segmentKey: fingerprint.segmentKey,
		segmentTextSnapshot: segmentText,
		textHash: fingerprint.textHash,
		voiceConfigRevision: fingerprint.voiceConfigRevision,
		provider: fingerprint.provider,
		voiceId: fingerprint.voiceId,
		language: fingerprint.language,
		speed: fingerprint.speed,
		idempotencyKey,
		requestHash: requestHash(fingerprint),
	};
}

try {
	await db.insert(workspace).values({
		id: actor.workspaceId,
		name: "AFF-US-012 Foundation Workspace",
	});
	await db.insert(user).values({
		id: actor.userId,
		name: "AFF-US-012 Foundation User",
		email: `${actor.userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(product).values({
		id: fixture.productId,
		workspaceId: actor.workspaceId,
		name: "AFF-US-012 Foundation Product",
		category: "Audio",
		createdByUserId: actor.userId,
	});
	await db.insert(project).values({
		id: fixture.projectId,
		workspaceId: actor.workspaceId,
		name: "AFF-US-012 Foundation Project",
		productId: fixture.productId,
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
		currentStepKey: "voice",
		createdByUserId: actor.userId,
	});
	await db.insert(scriptGeneration).values({
		id: fixture.generationId,
		workspaceId: actor.workspaceId,
		projectId: fixture.projectId,
		createdByUserId: actor.userId,
		idempotencyKey: `us012-foundation-${fixture.generationId}`,
		requestHash: "a".repeat(64),
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "us012-fixture",
		promptVersion: "us012-fixture",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshotJson: {},
		inputHash: "b".repeat(64),
		promptHash: "c".repeat(64),
		status: "completed",
		outputJson: {},
		validSections: [
			"hook",
			"voiceover",
			"scenes",
			"cta",
			"caption",
			"hashtags",
			"disclosure",
			"claims",
		],
		invalidSections: [],
		finishedAt: now,
		createdAt: now,
	});
	await db.insert(scriptVersion).values({
		id: fixture.scriptVersionId,
		workspaceId: actor.workspaceId,
		projectId: fixture.projectId,
		sourceGenerationId: fixture.generationId,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: {
			schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
			language: "vi-VN",
			voiceoverSegments: [{ key: "intro", text: segmentText }],
		},
		revision: 1,
		createdByUserId: actor.userId,
		createdAt: now,
		updatedAt: now,
		savedAt: null,
	});

	const first = await insertPendingVoiceSegmentArtifact(
		pendingInput(randomUUID(), `us012-idem-${randomUUID()}`),
	);
	const sameIdempotency = await findVoiceSegmentArtifactByIdempotencyKey(
		actor,
		first.idempotencyKey,
	);
	assert(
		sameIdempotency?.id === first.id,
		"Same idempotency key did not return the artifact.",
	);

	const pendingByRequest = await findPendingVoiceSegmentArtifactByRequestHash(
		actor,
		fixture.projectId,
		first.requestHash,
	);
	assert(
		pendingByRequest?.id === first.id,
		"Pending request lookup did not coalesce.",
	);

	try {
		await insertPendingVoiceSegmentArtifact(
			pendingInput(randomUUID(), `us012-idem-conflict-${randomUUID()}`),
		);
		throw new Error("Expected concurrent pending unique violation.");
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "Expected concurrent pending unique violation."
		)
			throw error;
		expectUniqueViolation(
			error,
			"Concurrent pending request was not protected.",
		);
	}

	const body = new Uint8Array([1, 2, 3]);
	const completed = await completeVoiceSegmentArtifact({
		actor,
		artifactId: first.id,
		providerRequestId: "foundation-request-1",
		storageProvider: "local",
		storageKey: `voice/v1/${actor.workspaceId}/${fixture.projectId}/${first.id}.mp3`,
		mimeType: "audio/mpeg",
		byteSize: body.byteLength,
		checksum: (
			await import("../packages/api/src/services/voice-segment-hashing.ts")
		).sha256Bytes(body),
		durationMs: 1_045,
	});
	assert(
		completed?.status === "completed",
		"Artifact did not finalize completed.",
	);

	const currentModel = await getVoiceSegmentReadModel(
		actor,
		fixture.projectId,
		"intro",
		baseFingerprint,
	);
	assert(
		currentModel.effectiveStatus === "completed",
		"Current artifact is not usable.",
	);
	assert(
		currentModel.latestUsableArtifact?.id === first.id,
		"Latest usable artifact is wrong.",
	);

	const staleModel = await getVoiceSegmentReadModel(
		actor,
		fixture.projectId,
		"intro",
		{
			...baseFingerprint,
			sourceScriptRevision: 2,
		},
	);
	assert(
		staleModel.effectiveStatus === "stale",
		"Revision mismatch was not stale.",
	);
	assert(
		staleModel.latestUsableArtifact === null,
		"Stale artifact was treated as current.",
	);

	const retry = await insertPendingVoiceSegmentArtifact(
		pendingInput(randomUUID(), `us012-retry-${randomUUID()}`),
	);
	await failVoiceSegmentArtifact({
		actor,
		artifactId: retry.id,
		status: "failed",
		errorCode: "TTS_STORAGE_FAILED",
	});
	const retryAgain = await insertPendingVoiceSegmentArtifact(
		pendingInput(randomUUID(), `us012-retry-again-${randomUUID()}`),
	);
	assert(
		retryAgain.id !== retry.id,
		"Failed retry did not create a new artifact.",
	);

	const crossWorkspace = await getVoiceSegmentReadModel(
		{ workspaceId: randomUUID(), userId: randomUUID() },
		fixture.projectId,
		"intro",
		baseFingerprint,
	);
	assert(
		crossWorkspace.latestRequest === null,
		"Cross-workspace read was not isolated.",
	);

	console.log(
		"AFF-US-012 Phase 1 foundation integration passed: schema constraints, workspace idempotency, pending coalescing, completion, current/stale read model, failed retry and cross-workspace isolation.",
	);
} finally {
	await db
		.delete(voiceSegmentArtifact)
		.where(eq(voiceSegmentArtifact.projectId, fixture.projectId));
	await db
		.delete(scriptVersion)
		.where(eq(scriptVersion.id, fixture.scriptVersionId));
	await db
		.delete(scriptGeneration)
		.where(eq(scriptGeneration.id, fixture.generationId));
	await db.delete(project).where(eq(project.id, fixture.projectId));
	await db.delete(product).where(eq(product.id, fixture.productId));
	await db.delete(user).where(eq(user.id, actor.userId));
	await db.delete(workspace).where(eq(workspace.id, actor.workspaceId));
}

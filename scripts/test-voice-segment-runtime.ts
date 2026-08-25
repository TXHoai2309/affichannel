import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	voiceConfig,
	voiceSegmentArtifact,
	workspace,
} = await import("@affichannel/db");
const { SCRIPT_OUTPUT_SCHEMA_VERSION } = await import("@affichannel/core");
const { generateVoiceSegment } = await import(
	"../packages/api/src/services/voice-segment-runtime-service.ts"
);
const { LocalVoiceAudioStorage } = await import(
	"../packages/api/src/storage/voice-audio-storage.ts"
);
const { hashVoiceSegmentRequest, hashVoiceSegmentText } = await import(
	"../packages/api/src/services/voice-segment-hashing.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const actor = { workspaceId: randomUUID(), userId: randomUUID() };
const fixture = {
	productId: randomUUID(),
	projectId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
};
const now = new Date();
const segmentText = "Xin chào, giá 150.000 ₫ — AffiChannel 🎙️!";
const prepared = {
	projectId: fixture.projectId,
	segmentKey: "intro",
	text: segmentText,
	fingerprint: {
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
	},
};

function mp3Fixture() {
	const frame = Uint8Array.from({ length: 417 }, (_, index) =>
		index === 0
			? 0xff
			: index === 1
				? 0xfb
				: index === 2
					? 0x90
					: index === 3
						? 0x64
						: 0,
	);
	const audio = new Uint8Array(frame.byteLength * 40);
	for (let index = 0; index < 40; index += 1) {
		audio.set(frame, index * frame.byteLength);
	}
	return audio;
}

let providerCallCount = 0;
const audio = mp3Fixture();
let resolveProviderStarted!: () => void;
const providerStarted = new Promise<void>((resolve) => {
	resolveProviderStarted = resolve;
});
let releaseProvider!: () => void;
const providerBarrier = new Promise<void>((resolve) => {
	releaseProvider = resolve;
});
const provider = {
	providerId: "apikeyfun",
	listVoices: () => [],
	preview: async () => ({
		audio,
		contentType: "audio/mpeg" as const,
		providerRequestId: null,
		latencyMs: 1,
	}),
	generateSegment: async (input: {
		text: string;
		voiceId: string;
		language: string;
		speed: number;
	}) => {
		assert(input.text === segmentText, "Runtime did not preserve server text.");
		assert(input.voiceId === "eve", "Runtime did not preserve server voice.");
		providerCallCount += 1;
		if (providerCallCount === 1) {
			resolveProviderStarted();
			await providerBarrier;
		}
		return {
			audio,
			contentType: "audio/mpeg" as const,
			providerRequestId: `runtime-provider-${providerCallCount}`,
			providerDurationMs: 999,
		};
	},
};

const storageRoot = await mkdtemp(join(tmpdir(), "affichannel-us012-runtime-"));
const storage = new LocalVoiceAudioStorage({ rootDir: storageRoot });
let beforeInsertCalls = 0;
let resolveBothBeforeInsert!: () => void;
const bothBeforeInsert = new Promise<void>((resolve) => {
	resolveBothBeforeInsert = resolve;
});
let releaseBeforeInsert!: () => void;
const beforeInsertBarrier = new Promise<void>((resolve) => {
	releaseBeforeInsert = resolve;
});
const dependencies = {
	provider,
	storage,
	prepare: async () => prepared,
	readCurrent: async () => prepared,
	assertFactLockPassed: async () => undefined,
	beforeInsert: async () => {
		beforeInsertCalls += 1;
		if (beforeInsertCalls === 2) resolveBothBeforeInsert();
		await beforeInsertBarrier;
	},
};

try {
	await db.insert(workspace).values({
		id: actor.workspaceId,
		name: "AFF-US-012 Runtime Workspace",
	});
	await db.insert(user).values({
		id: actor.userId,
		name: "AFF-US-012 Runtime User",
		email: `${actor.userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(product).values({
		id: fixture.productId,
		workspaceId: actor.workspaceId,
		name: "AFF-US-012 Runtime Product",
		category: "Audio",
		createdByUserId: actor.userId,
	});
	await db.insert(project).values({
		id: fixture.projectId,
		workspaceId: actor.workspaceId,
		name: "AFF-US-012 Runtime Project",
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
		idempotencyKey: `us012-runtime-${fixture.generationId}`,
		requestHash: "a".repeat(64),
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "us012-runtime",
		promptVersion: "us012-runtime",
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
		editableSnapshotJson: {},
		revision: 1,
		createdByUserId: actor.userId,
		createdAt: now,
		updatedAt: now,
		savedAt: null,
	});
	await db.insert(voiceConfig).values({
		id: randomUUID(),
		workspaceId: actor.workspaceId,
		projectId: fixture.projectId,
		provider: "apikeyfun",
		voiceId: "eve",
		language: "vi",
		speed: 1,
		revision: 1,
		createdByUserId: actor.userId,
		updatedByUserId: actor.userId,
	});

	const request = (idempotencyKey: string) =>
		generateVoiceSegment(
			actor,
			{ projectId: fixture.projectId, segmentKey: "intro", idempotencyKey },
			dependencies,
		);
	const firstPromise = request("runtime-race-a-1");
	const secondPromise = request("runtime-race-b-1");
	const raceResultsPromise = Promise.allSettled([firstPromise, secondPromise]);
	await bothBeforeInsert;
	releaseBeforeInsert();
	await providerStarted;
	await new Promise((resolve) => setTimeout(resolve, 250));
	releaseProvider();
	const raceResults = await raceResultsPromise;
	const winner = raceResults.find(
		(result): result is PromiseFulfilledResult<Awaited<typeof firstPromise>> =>
			result.status === "fulfilled",
	);
	const loser = raceResults.find((result) => result.status === "rejected");
	assert(winner && loser, "DB race did not produce one winner and one loser.");
	const first = winner.value;
	assert(
		loser.reason?.code === "VOICE_SEGMENT_ALREADY_PENDING",
		`DB race loser returned unexpected error: ${loser.reason?.code ?? "unknown"}`,
	);
	assert(
		providerCallCount === 1,
		`Concurrent runtime made duplicate provider calls: ${providerCallCount}`,
	);
	const loserIdempotencyKey =
		first.artifact.idempotencyKey === "runtime-race-a-1"
			? "runtime-race-b-1"
			: "runtime-race-a-1";
	const raceArtifacts = await db
		.select({
			id: voiceSegmentArtifact.id,
			idempotencyKey: voiceSegmentArtifact.idempotencyKey,
		})
		.from(voiceSegmentArtifact)
		.where(eq(voiceSegmentArtifact.workspaceId, actor.workspaceId));
	assert(
		raceArtifacts.length === 1 && raceArtifacts[0]?.id === first.artifact.id,
		"Concurrent runtime did not persist exactly one winning artifact.",
	);
	assert(
		!raceArtifacts.some(
			(artifact) => artifact.idempotencyKey === loserIdempotencyKey,
		),
		"Concurrent runtime persisted a fake idempotency binding for the loser.",
	);
	assert(
		first.artifact.durationMs === 1_045,
		`Server MP3 duration was not authoritative: ${first.artifact.durationMs}.`,
	);

	const reused = await request(first.artifact.idempotencyKey);
	assert(reused.artifact.id === first.artifact.id, "Idempotency reuse failed.");
	assert(
		providerCallCount === 1,
		"Same idempotency key called provider twice.",
	);

	const stale = new Date(now.getTime() - 10 * 60_000);
	await db.insert(voiceSegmentArtifact).values({
		id: randomUUID(),
		workspaceId: actor.workspaceId,
		projectId: fixture.projectId,
		createdByUserId: actor.userId,
		sourceScriptVersionId: fixture.scriptVersionId,
		sourceScriptRevision: 1,
		segmentKey: "intro",
		segmentTextSnapshot: segmentText,
		textHash: prepared.fingerprint.textHash,
		voiceConfigRevision: 1,
		provider: "apikeyfun",
		voiceId: "eve",
		language: "vi",
		speed: 1,
		idempotencyKey: "runtime-expired-1",
		requestHash: hashVoiceSegmentRequest(prepared.fingerprint),
		status: "pending",
		createdAt: stale,
	});
	const expired = await request("runtime-expired-1");
	assert(
		expired.artifact.status === "indeterminate",
		"Expired pending was not reconciled conservatively.",
	);
	assert(
		providerCallCount === 1,
		"Expired pending triggered an automatic retry.",
	);

	console.log(
		"AFF-US-012 Phase 2 runtime integration passed: DB transaction race coalescing, server-owned synthesis input, authoritative duration, idempotency reuse and expired-pending reconciliation.",
	);
} finally {
	await db
		.delete(voiceSegmentArtifact)
		.where(eq(voiceSegmentArtifact.workspaceId, actor.workspaceId));
	await db
		.delete(voiceConfig)
		.where(eq(voiceConfig.workspaceId, actor.workspaceId));
	await db
		.delete(scriptVersion)
		.where(eq(scriptVersion.workspaceId, actor.workspaceId));
	await db
		.delete(scriptGeneration)
		.where(eq(scriptGeneration.workspaceId, actor.workspaceId));
	await db.delete(project).where(eq(project.workspaceId, actor.workspaceId));
	await db.delete(product).where(eq(product.workspaceId, actor.workspaceId));
	await db.delete(user).where(eq(user.id, actor.userId));
	await db.delete(workspace).where(eq(workspace.id, actor.workspaceId));
	await rm(storageRoot, { recursive: true, force: true });
}

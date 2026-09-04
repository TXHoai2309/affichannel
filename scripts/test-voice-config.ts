import { randomUUID } from "node:crypto";
import type {
	FactLockInputSnapshot,
	ScriptVersionEditableSnapshot,
} from "@affichannel/core";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const { eq, inArray } = await import("drizzle-orm");
const {
	db,
	factLockRun,
	product,
	project,
	scriptGeneration,
	scriptVersion,
	user,
	voiceConfig,
	workspace,
	workspaceMember,
} = await import("@affichannel/db");
const {
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	FACT_LOCK_PROMPT_VERSION,
	FACT_LOCK_SNAPSHOT_VERSION,
	INTERNAL_WORKSPACE_ID,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
} = await import("@affichannel/core");
const { FactLockError, VoiceConfigError } = await import("@affichannel/core");
const { appRouter } = await import("../packages/api/src/routers/index.ts");
const { RPCHandler } = await import(
	"../packages/api/node_modules/@orpc/server/dist/adapters/fetch/index.mjs"
);
const { getVoiceConfig, listServerVoicePresets, saveVoiceConfig } =
	await import("../packages/api/src/services/voice-config-service.ts");
const { FactLockGate } = await import(
	"../packages/api/src/services/fact-lock-gate-service.ts"
);
const { ApiKeyFunTtsProvider } = await import(
	"../packages/api/src/providers/tts/apikeyfun-tts-provider.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function expectCode(
	action: () => Promise<unknown>,
	code: string,
): Promise<unknown> {
	return action().then(
		() => {
			throw new Error(`Expected ${code}.`);
		},
		(error) => {
			assert(
				(error instanceof VoiceConfigError || error instanceof FactLockError) &&
					error.code === code,
				`Expected ${code}, received ${error?.code ?? error}.`,
			);
			return error;
		},
	);
}

type Actor = { workspaceId: string; userId: string };
type Fixture = {
	actor: Actor;
	productId: string;
	projectId: string;
	generationId: string;
	scriptVersionId: string;
	factLockRunId: string;
};

const actorA = { workspaceId: randomUUID(), userId: randomUUID() };
const actorB = { workspaceId: randomUUID(), userId: randomUUID() };
const fixtureA: Fixture = {
	actor: actorA,
	productId: randomUUID(),
	projectId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
	factLockRunId: randomUUID(),
};
const fixtureConcurrent: Fixture = {
	actor: actorA,
	productId: randomUUID(),
	projectId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
	factLockRunId: randomUUID(),
};
const fixtureB: Fixture = {
	actor: actorB,
	productId: randomUUID(),
	projectId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
	factLockRunId: randomUUID(),
};
const fixtures = [fixtureA, fixtureConcurrent, fixtureB];
const fixtureMembershipIds = [randomUUID(), randomUUID(), randomUUID()];

const editableSnapshot: ScriptVersionEditableSnapshot = {
	schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
	language: "vi-VN",
	hookVariants: [
		{ key: "hook-1", text: "Một thay đổi nhỏ cho trải nghiệm tốt hơn." },
		{ key: "hook-2", text: "Đây là điều mình kiểm tra đầu tiên." },
		{ key: "hook-3", text: "Thử một lựa chọn phù hợp hơn." },
	],
	selectedHookKey: "hook-1",
	voiceoverSegments: [
		{ key: "intro", text: "Mình thử sản phẩm trong một ngày." },
	],
	scenes: [
		{
			order: 1,
			durationSeconds: 15,
			visualDirection: "Cận cảnh sản phẩm.",
			onScreenText: "Trải nghiệm thực tế",
			voiceoverSegmentKeys: ["intro"],
		},
	],
	cta: { text: "Xem thêm thông tin nhé." },
	caption: "Một trải nghiệm ngắn gọn.",
	hashtags: ["#review"],
	disclosure: "Nội dung có liên kết affiliate.",
	claims: [],
	claimsSourceRevision: 1,
	claimsStatus: "current",
};

const generationOutput = {
	schemaVersion: editableSnapshot.schemaVersion,
	language: editableSnapshot.language,
	hookVariants: editableSnapshot.hookVariants,
	voiceoverSegments: editableSnapshot.voiceoverSegments,
	scenes: editableSnapshot.scenes,
	cta: editableSnapshot.cta,
	caption: editableSnapshot.caption,
	hashtags: editableSnapshot.hashtags,
	disclosure: editableSnapshot.disclosure,
	claims: editableSnapshot.claims,
};

function factLockSnapshot(
	scriptVersionId: string,
	scriptRevision: number,
): FactLockInputSnapshot {
	return {
		snapshotVersion: FACT_LOCK_SNAPSHOT_VERSION,
		scriptVersion: {
			id: scriptVersionId,
			revision: scriptRevision,
			snapshot: editableSnapshot,
		},
		productFacts: [],
		policy: {
			avoidWords: [],
			affiliateDisclosure: editableSnapshot.disclosure,
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

async function insertFixture(fixture: Fixture, label: string) {
	const now = new Date();
	await db.insert(product).values({
		id: fixture.productId,
		workspaceId: fixture.actor.workspaceId,
		name: `AFF-US-011 ${label}`,
		category: "Audio",
		createdByUserId: fixture.actor.userId,
	});
	await db.insert(project).values({
		id: fixture.projectId,
		workspaceId: fixture.actor.workspaceId,
		name: `AFF-US-011 Project ${label}`,
		productId: fixture.productId,
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
		currentStepKey: "voice",
		createdByUserId: fixture.actor.userId,
	});
	await db.insert(scriptGeneration).values({
		id: fixture.generationId,
		workspaceId: fixture.actor.workspaceId,
		projectId: fixture.projectId,
		createdByUserId: fixture.actor.userId,
		idempotencyKey: `us011-${label}-${fixture.generationId}`,
		requestHash: "a".repeat(64),
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "us011-fixture",
		promptVersion: "us011-fixture",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshotJson: {},
		inputHash: "b".repeat(64),
		promptHash: "c".repeat(64),
		status: "completed",
		outputJson: generationOutput,
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
		providerRequestId: null,
		inputTokens: null,
		outputTokens: null,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: null,
		finishedAt: now,
		createdAt: now,
	});
	await db.insert(scriptVersion).values({
		id: fixture.scriptVersionId,
		workspaceId: fixture.actor.workspaceId,
		projectId: fixture.projectId,
		sourceGenerationId: fixture.generationId,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: editableSnapshot,
		revision: 1,
		createdByUserId: fixture.actor.userId,
		createdAt: now,
		updatedAt: now,
		savedAt: null,
	});
	await db.insert(factLockRun).values({
		id: fixture.factLockRunId,
		workspaceId: fixture.actor.workspaceId,
		projectId: fixture.projectId,
		scriptVersionId: fixture.scriptVersionId,
		sourceScriptRevision: 1,
		idempotencyKey: `us011-fact-lock-${label}-${fixture.factLockRunId}`,
		requestHash: "d".repeat(64),
		inputSnapshotJson: factLockSnapshot(fixture.scriptVersionId, 1),
		inputHash: "e".repeat(64),
		promptHash: "f".repeat(64),
		provider: "deterministic",
		model: "us011-fixture",
		promptVersion: FACT_LOCK_PROMPT_VERSION,
		outputSchemaVersion: FACT_LOCK_OUTPUT_SCHEMA_VERSION,
		status: "passed",
		providerRequestId: null,
		inputTokens: null,
		outputTokens: null,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: null,
		executionClaimedAt: null,
		createdByUserId: fixture.actor.userId,
		createdAt: now,
		finishedAt: now,
	});
}

async function testProtectedApi() {
	const handler = new RPCHandler(appRouter);
	const request = () =>
		new Request("http://localhost/api/rpc/voice/listPresets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
	const unauthenticated = await handler.handle(request(), {
		prefix: "/api/rpc",
		context: { auth: null, session: null },
	});
	assert(
		unauthenticated.response?.status === 401,
		"voice.listPresets did not reject an unauthenticated request.",
	);
	const authenticated = await handler.handle(request(), {
		prefix: "/api/rpc",
		context: { auth: null, session: { user: { id: actorA.userId } } },
	});
	assert(
		authenticated.response?.status === 200,
		"voice.listPresets did not accept a workspace actor.",
	);
}

try {
	await db.insert(workspace).values([
		{ id: actorA.workspaceId, name: "AFF-US-011 Workspace A" },
		{ id: actorB.workspaceId, name: "AFF-US-011 Workspace B" },
	]);
	await db.insert(user).values([
		{
			id: actorA.userId,
			name: "AFF-US-011 User A",
			email: `${actorA.userId}@example.test`,
			emailVerified: true,
		},
		{
			id: actorB.userId,
			name: "AFF-US-011 User B",
			email: `${actorB.userId}@example.test`,
			emailVerified: true,
		},
	]);
	await db.insert(workspaceMember).values([
		{
			id: fixtureMembershipIds[0],
			workspaceId: actorA.workspaceId,
			userId: actorA.userId,
		},
		{
			id: fixtureMembershipIds[1],
			workspaceId: actorB.workspaceId,
			userId: actorB.userId,
		},
		{
			id: fixtureMembershipIds[2],
			workspaceId: INTERNAL_WORKSPACE_ID,
			userId: actorA.userId,
		},
	]);
	await Promise.all(
		fixtures.map((fixture, index) =>
			insertFixture(fixture, `fixture-${index}`),
		),
	);

	const catalog = listServerVoicePresets();
	assert(
		catalog.map((preset) => preset.id).join(",") === "ara,eve,leo,rex,sal",
		"Server catalog is not deterministic or complete.",
	);
	assert(
		new ApiKeyFunTtsProvider().listVoices().length === 5,
		"TTS provider catalog adapter did not expose the verified catalog.",
	);

	await testProtectedApi();
	assert(
		(await getVoiceConfig(actorA, fixtureA.projectId)) === null,
		"An unsaved VoiceConfig was implicitly persisted.",
	);

	const created = await saveVoiceConfig(actorA, {
		projectId: fixtureA.projectId,
		baseRevision: null,
		voiceId: "ara",
		language: "vi",
		speed: 1,
	});
	assert(
		created.revision === 1 && created.provider === "apikeyfun",
		"Create failed.",
	);
	const loaded = await getVoiceConfig(actorA, fixtureA.projectId);
	assert(loaded?.id === created.id && loaded.revision === 1, "Reload failed.");

	let revision = created.revision;
	for (const voiceId of ["eve", "leo", "rex", "sal"]) {
		const updated = await saveVoiceConfig(actorA, {
			projectId: fixtureA.projectId,
			baseRevision: revision,
			voiceId,
			language: "vi",
			speed: 1,
		});
		assert(updated.voiceId === voiceId, `Preset ${voiceId} did not save.`);
		revision = updated.revision;
	}
	await expectCode(
		() =>
			saveVoiceConfig(actorA, {
				projectId: fixtureA.projectId,
				baseRevision: 1,
				voiceId: "ara",
				language: "vi",
				speed: 1,
			}),
		"VOICE_CONFIG_CONFLICT",
	);
	await expectCode(
		() =>
			saveVoiceConfig(actorA, {
				projectId: fixtureA.projectId,
				baseRevision: revision,
				voiceId: "unknown",
				language: "vi",
				speed: 1,
			}),
		"TTS_VOICE_NOT_FOUND",
	);
	await expectCode(
		() =>
			saveVoiceConfig(actorA, {
				projectId: fixtureA.projectId,
				baseRevision: revision,
				voiceId: "ara",
				language: "en",
				speed: 1,
			}),
		"TTS_LANGUAGE_NOT_SUPPORTED",
	);
	await expectCode(
		() =>
			saveVoiceConfig(actorA, {
				projectId: fixtureA.projectId,
				baseRevision: revision,
				voiceId: "ara",
				language: "vi",
				speed: 1.6,
			}),
		"TTS_SPEED_OUT_OF_RANGE",
	);

	const concurrent = await Promise.allSettled([
		saveVoiceConfig(actorA, {
			projectId: fixtureConcurrent.projectId,
			baseRevision: null,
			voiceId: "ara",
			language: "vi",
			speed: 1,
		}),
		saveVoiceConfig(actorA, {
			projectId: fixtureConcurrent.projectId,
			baseRevision: null,
			voiceId: "eve",
			language: "vi",
			speed: 1,
		}),
	]);
	assert(
		concurrent.filter((result) => result.status === "fulfilled").length === 1 &&
			concurrent.some(
				(result) =>
					result.status === "rejected" &&
					result.reason instanceof VoiceConfigError &&
					result.reason.code === "VOICE_CONFIG_CONFLICT",
			),
		"Concurrent first create did not produce one success and one domain conflict.",
	);

	await expectCode(
		() => getVoiceConfig(actorA, fixtureB.projectId),
		"VOICE_CONFIG_NOT_FOUND",
	);
	await expectCode(
		() =>
			saveVoiceConfig(actorA, {
				projectId: fixtureB.projectId,
				baseRevision: null,
				voiceId: "ara",
				language: "vi",
				speed: 1,
			}),
		"VOICE_CONFIG_NOT_FOUND",
	);

	await db
		.update(scriptVersion)
		.set({
			revision: 2,
			editableSnapshotJson: { ...editableSnapshot, claimsStatus: "stale" },
			updatedAt: new Date(),
		})
		.where(eq(scriptVersion.id, fixtureA.scriptVersionId));
	const staleGate = await FactLockGate.evaluate(actorA, fixtureA.projectId);
	assert(
		staleGate.reason === "FACT_LOCK_STALE_SCRIPT",
		"Script edit did not stale the Fact Lock gate.",
	);
	const staleLoaded = await getVoiceConfig(actorA, fixtureA.projectId);
	assert(
		staleLoaded?.revision === revision,
		"VoiceConfig read was blocked by a stale Fact Lock during setup.",
	);
	const staleSaved = await saveVoiceConfig(actorA, {
		projectId: fixtureA.projectId,
		baseRevision: revision,
		voiceId: "ara",
		language: "vi",
		speed: 1,
	});
	assert(
		staleSaved.revision === revision + 1,
		"VoiceConfig setup write was blocked by a stale Fact Lock.",
	);
	revision = staleSaved.revision;
	const persistedWhileStale = await db
		.select({ id: voiceConfig.id, revision: voiceConfig.revision })
		.from(voiceConfig)
		.where(eq(voiceConfig.projectId, fixtureA.projectId));
	assert(persistedWhileStale.length === 1, "Stale gate deleted VoiceConfig.");

	const reopenedRevision = 3;
	await db
		.update(scriptVersion)
		.set({
			revision: reopenedRevision,
			editableSnapshotJson: editableSnapshot,
			updatedAt: new Date(),
		})
		.where(eq(scriptVersion.id, fixtureA.scriptVersionId));
	await db.insert(factLockRun).values({
		id: randomUUID(),
		workspaceId: actorA.workspaceId,
		projectId: fixtureA.projectId,
		scriptVersionId: fixtureA.scriptVersionId,
		sourceScriptRevision: reopenedRevision,
		idempotencyKey: `us011-reopen-${randomUUID()}`,
		requestHash: "1".repeat(64),
		inputSnapshotJson: factLockSnapshot(
			fixtureA.scriptVersionId,
			reopenedRevision,
		),
		inputHash: "2".repeat(64),
		promptHash: "3".repeat(64),
		provider: "deterministic",
		model: "us011-fixture",
		promptVersion: FACT_LOCK_PROMPT_VERSION,
		outputSchemaVersion: FACT_LOCK_OUTPUT_SCHEMA_VERSION,
		status: "passed",
		providerRequestId: null,
		inputTokens: null,
		outputTokens: null,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: null,
		executionClaimedAt: null,
		createdByUserId: actorA.userId,
		createdAt: new Date(),
		finishedAt: new Date(),
	});
	const reopened = await getVoiceConfig(actorA, fixtureA.projectId);
	assert(
		reopened?.id === created.id && reopened.revision === revision,
		"Fact Lock rerun did not reopen the persisted VoiceConfig.",
	);
	const reopenedSaved = await saveVoiceConfig(actorA, {
		projectId: fixtureA.projectId,
		baseRevision: reopened.revision,
		voiceId: "ara",
		language: "vi",
		speed: 1,
	});
	assert(
		reopenedSaved.revision === reopened.revision + 1,
		"Fact Lock rerun did not reopen VoiceConfig writes.",
	);

	console.log(
		"AFF-US-011 VoiceConfig integration passed: catalog, protected API, create/load/update CAS, concurrent create, validation, workspace isolation, stale/reopen.",
	);
} finally {
	const projectIds = fixtures.map((fixture) => fixture.projectId);
	const generationIds = fixtures.map((fixture) => fixture.generationId);
	const scriptVersionIds = fixtures.map((fixture) => fixture.scriptVersionId);
	const runIds = (
		await db
			.select({ id: factLockRun.id })
			.from(factLockRun)
			.where(inArray(factLockRun.projectId, projectIds))
	).map((row) => row.id);
	if (runIds.length > 0) {
		await db.delete(factLockRun).where(inArray(factLockRun.id, runIds));
	}
	await db
		.delete(voiceConfig)
		.where(inArray(voiceConfig.projectId, projectIds));
	await db
		.delete(scriptVersion)
		.where(inArray(scriptVersion.id, scriptVersionIds));
	await db
		.delete(scriptGeneration)
		.where(inArray(scriptGeneration.id, generationIds));
	await db.delete(project).where(inArray(project.id, projectIds));
	await db.delete(product).where(
		inArray(
			product.id,
			fixtures.map((fixture) => fixture.productId),
		),
	);
	await db
		.delete(workspaceMember)
		.where(inArray(workspaceMember.id, fixtureMembershipIds));
	await db.delete(user).where(inArray(user.id, [actorA.userId, actorB.userId]));
	await db
		.delete(workspace)
		.where(inArray(workspace.id, [actorA.workspaceId, actorB.workspaceId]));
}

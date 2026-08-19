import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
	FactLockInputSnapshot,
	ScriptVersionEditableSnapshot,
} from "@affichannel/core";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(process.cwd(), "apps/web/.env"),
	override: true,
});

const { eq, inArray } = await import("drizzle-orm");
const {
	db,
	factDependency,
	factLockRun,
	product,
	productFact,
	project,
	scriptGeneration,
	scriptVersion,
	user,
	voiceConfig,
	workspace,
} = await import("@affichannel/db");
const {
	FACT_LOCK_OUTPUT_SCHEMA_VERSION,
	FACT_LOCK_PROMPT_VERSION,
	FACT_LOCK_SNAPSHOT_VERSION,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
	FactLockError,
	VoiceConfigError,
} = await import("@affichannel/core");
const { previewVoice } = await import(
	"../packages/api/src/services/voice-preview-service.ts"
);
const { saveVoiceConfig } = await import(
	"../packages/api/src/services/voice-config-service.ts"
);
const { FactLockGate } = await import(
	"../packages/api/src/services/fact-lock-gate-service.ts"
);
const { listVoicePresets } = await import("@affichannel/core");
type TtsProvider =
	import("../packages/api/src/providers/tts/tts-provider.ts").TtsProvider;
type TtsPreviewInput =
	import("../packages/api/src/providers/tts/tts-provider.ts").TtsPreviewInput;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function expectCode(action: () => Promise<unknown>, code: string) {
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

type Fixture = {
	workspaceId: string;
	userId: string;
	productId: string;
	projectId: string;
	generationId: string;
	scriptVersionId: string;
	factId: string;
	factLockRunId: string;
};

const actor = { workspaceId: randomUUID(), userId: randomUUID() };
const otherActor = { workspaceId: randomUUID(), userId: randomUUID() };
const main: Fixture = {
	workspaceId: actor.workspaceId,
	userId: actor.userId,
	productId: randomUUID(),
	projectId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
	factId: randomUUID(),
	factLockRunId: randomUUID(),
};
const missingConfig: Fixture = {
	workspaceId: actor.workspaceId,
	userId: actor.userId,
	productId: randomUUID(),
	projectId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
	factId: randomUUID(),
	factLockRunId: randomUUID(),
};

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
		{ key: "intro", text: "  Mình   thử sản phẩm trong một ngày.  " },
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

function factSnapshot(
	fixture: Fixture,
	scriptRevision: number,
	factRevision: number,
): FactLockInputSnapshot {
	return {
		snapshotVersion: FACT_LOCK_SNAPSHOT_VERSION,
		scriptVersion: {
			id: fixture.scriptVersionId,
			revision: scriptRevision,
			snapshot: editableSnapshot,
		},
		productFacts:
			fixture === main
				? [
						{
							id: fixture.factId,
							revision: factRevision,
							content: "Pin dùng liên tục 20 giờ.",
							type: "specification",
							status: "verified",
							assessment: {
								verification: "verified",
								evidence: "complete",
								freshness: "not_applicable",
								freshnessReason: "not_applicable",
							},
							generationUsability: "allowed",
							source: {
								type: "official",
								label: "Official",
								url: "https://example.test/fact",
								confirmedAt: "2026-08-01",
								expiresAt: null,
							},
						},
					]
				: [],
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
		workspaceId: fixture.workspaceId,
		name: `AFF-US-011 Preview ${label}`,
		category: "Audio",
		createdByUserId: fixture.userId,
	});
	await db.insert(project).values({
		id: fixture.projectId,
		workspaceId: fixture.workspaceId,
		name: `AFF-US-011 Preview Project ${label}`,
		productId: fixture.productId,
		currentStepKey: "voice",
		createdByUserId: fixture.userId,
	});
	await db.insert(scriptGeneration).values({
		id: fixture.generationId,
		workspaceId: fixture.workspaceId,
		projectId: fixture.projectId,
		createdByUserId: fixture.userId,
		idempotencyKey: `us011-preview-${label}-${fixture.generationId}`,
		requestHash: "a".repeat(64),
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "us011-preview-fixture",
		promptVersion: "us011-preview-fixture",
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
		workspaceId: fixture.workspaceId,
		projectId: fixture.projectId,
		sourceGenerationId: fixture.generationId,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: editableSnapshot,
		revision: 1,
		createdByUserId: fixture.userId,
		createdAt: now,
		updatedAt: now,
		savedAt: null,
	});
	if (fixture === main) {
		await db.insert(productFact).values({
			id: fixture.factId,
			workspaceId: fixture.workspaceId,
			productId: fixture.productId,
			revision: 1,
			content: "Pin dùng liên tục 20 giờ.",
			type: "specification",
			status: "verified",
			sourceType: "official",
			sourceLabel: "Official",
			sourceUrl: "https://example.test/fact",
			confirmedAt: "2026-08-01",
			expiresAt: null,
			notes: null,
			createdByUserId: fixture.userId,
			updatedByUserId: fixture.userId,
			createdAt: now,
			updatedAt: now,
		});
	}
	await insertPassedRun(fixture, 1, 1, now);
}

async function insertPassedRun(
	fixture: Fixture,
	scriptRevision: number,
	factRevision: number,
	createdAt = new Date(),
) {
	const runId = randomUUID();
	await db.insert(factLockRun).values({
		id: runId,
		workspaceId: fixture.workspaceId,
		projectId: fixture.projectId,
		scriptVersionId: fixture.scriptVersionId,
		sourceScriptRevision: scriptRevision,
		idempotencyKey: `us011-preview-lock-${runId}`,
		requestHash: "d".repeat(64),
		inputSnapshotJson: factSnapshot(fixture, scriptRevision, factRevision),
		inputHash: "e".repeat(64),
		promptHash: "f".repeat(64),
		provider: "deterministic",
		model: "us011-preview-fixture",
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
		errorMessage: null,
		executionClaimedAt: null,
		createdByUserId: fixture.userId,
		createdAt,
		finishedAt: createdAt,
	});
	if (fixture === main) {
		await db.insert(factDependency).values({
			id: randomUUID(),
			workspaceId: fixture.workspaceId,
			productFactId: fixture.factId,
			factRevision,
			dependentType: "fact_lock",
			dependentId: runId,
			createdAt,
			detachedAt: null,
			invalidatedAt: null,
			invalidationReason: null,
		});
	}
}

class DeterministicPreviewProvider implements TtsProvider {
	readonly providerId = "deterministic-test";
	callCount = 0;
	lastInput: TtsPreviewInput | null = null;

	listVoices() {
		return listVoicePresets();
	}

	async preview(input: TtsPreviewInput) {
		this.callCount += 1;
		this.lastInput = input;
		return {
			audio: new Uint8Array([0xff, 0xfb, 0x90]),
			contentType: "audio/mpeg" as const,
			providerRequestId: null,
			latencyMs: 1,
		};
	}
}

await db.insert(workspace).values([
	{ id: actor.workspaceId, name: "AFF-US-011 Preview Workspace" },
	{ id: otherActor.workspaceId, name: "AFF-US-011 Other Workspace" },
]);
await db.insert(user).values([
	{
		id: actor.userId,
		name: "AFF-US-011 Preview User",
		email: `${actor.userId}@example.test`,
		emailVerified: true,
	},
	{
		id: otherActor.userId,
		name: "AFF-US-011 Other User",
		email: `${otherActor.userId}@example.test`,
		emailVerified: true,
	},
]);

try {
	await insertFixture(main, "main");
	await insertFixture(missingConfig, "missing-config");
	const provider = new DeterministicPreviewProvider();

	const created = await saveVoiceConfig(actor, {
		projectId: main.projectId,
		baseRevision: null,
		voiceId: "eve",
		language: "vi",
		speed: 1,
	});
	const preview = await previewVoice(actor, main.projectId, { provider });
	assert(
		preview.audio.byteLength > 0,
		"Preview did not return deterministic audio.",
	);
	assert(
		preview.contentType === "audio/mpeg",
		"Preview MIME type is not audio/mpeg.",
	);
	assert(
		provider.callCount === 1,
		"PASS preview did not call provider exactly once.",
	);
	assert(
		provider.lastInput?.text === "Mình thử sản phẩm trong một ngày.",
		"Preview text was not derived safely.",
	);
	let configRevision = created.revision;
	for (const voiceId of ["ara", "eve", "leo", "rex", "sal"]) {
		const saved = await saveVoiceConfig(actor, {
			projectId: main.projectId,
			baseRevision: configRevision,
			voiceId,
			language: "vi",
			speed: 1,
		});
		configRevision = saved.revision;
		await previewVoice(actor, main.projectId, { provider });
		assert(
			provider.lastInput?.voiceId === voiceId,
			`Preview did not use ${voiceId}.`,
		);
	}
	const passedPreviewCount = provider.callCount;
	assert(
		passedPreviewCount === 6,
		"Preview did not cover all catalog presets.",
	);

	await db
		.update(scriptVersion)
		.set({
			revision: 2,
			editableSnapshotJson: { ...editableSnapshot, claimsStatus: "stale" },
			updatedAt: new Date(),
		})
		.where(eq(scriptVersion.id, main.scriptVersionId));
	assert(
		(await FactLockGate.evaluate(actor, main.projectId)).reason ===
			"FACT_LOCK_STALE_SCRIPT",
		"Script edit did not stale the Fact Lock gate.",
	);
	await expectCode(
		() => previewVoice(actor, main.projectId, { provider }),
		"FACT_LOCK_REQUIRED",
	);
	assert(
		provider.callCount === passedPreviewCount,
		"Stale Script invoked the provider.",
	);

	await db
		.update(scriptVersion)
		.set({
			revision: 3,
			editableSnapshotJson: editableSnapshot,
			updatedAt: new Date(),
		})
		.where(eq(scriptVersion.id, main.scriptVersionId));
	await insertPassedRun(main, 3, 1);
	await previewVoice(actor, main.projectId, { provider });
	assert(
		provider.callCount === passedPreviewCount + 1,
		"Fact Lock rerun did not reopen preview.",
	);

	await db
		.update(productFact)
		.set({
			revision: 2,
			content: "Pin dùng liên tục 18 giờ.",
			updatedAt: new Date(),
		})
		.where(eq(productFact.id, main.factId));
	assert(
		(await FactLockGate.evaluate(actor, main.projectId)).reason ===
			"FACT_LOCK_STALE_FACTS",
		"Product Fact edit did not stale the Fact Lock gate.",
	);
	await expectCode(
		() => previewVoice(actor, main.projectId, { provider }),
		"FACT_LOCK_REQUIRED",
	);
	assert(
		provider.callCount === passedPreviewCount + 1,
		"Stale Product Fact invoked the provider.",
	);

	await insertPassedRun(main, 3, 2);
	await previewVoice(actor, main.projectId, { provider });
	assert(
		provider.callCount === passedPreviewCount + 2,
		"Product Fact rerun did not reopen preview.",
	);

	await expectCode(
		() => previewVoice(otherActor, main.projectId, { provider }),
		"FACT_LOCK_NOT_FOUND",
	);
	assert(
		provider.callCount === passedPreviewCount + 2,
		"Cross-workspace preview invoked the provider.",
	);
	await expectCode(
		() => previewVoice(actor, missingConfig.projectId, { provider }),
		"VOICE_CONFIG_NOT_FOUND",
	);
	assert(
		provider.callCount === passedPreviewCount + 2,
		"Missing VoiceConfig invoked the provider.",
	);

	console.log(
		"AFF-US-011 Voice preview integration passed: derived text, deterministic audio, stale Script/Product Fact blocking, rerun recovery, missing config and workspace isolation.",
	);
} finally {
	const projectIds = [main.projectId, missingConfig.projectId];
	const runRows = await db
		.select({ id: factLockRun.id })
		.from(factLockRun)
		.where(inArray(factLockRun.projectId, projectIds));
	const runIds = runRows.map((row) => row.id);
	if (runIds.length > 0) {
		await db
			.delete(factDependency)
			.where(inArray(factDependency.dependentId, runIds));
		await db.delete(factLockRun).where(inArray(factLockRun.id, runIds));
	}
	await db
		.delete(voiceConfig)
		.where(inArray(voiceConfig.projectId, projectIds));
	await db
		.delete(scriptVersion)
		.where(
			inArray(scriptVersion.id, [
				main.scriptVersionId,
				missingConfig.scriptVersionId,
			]),
		);
	await db
		.delete(scriptGeneration)
		.where(
			inArray(scriptGeneration.id, [
				main.generationId,
				missingConfig.generationId,
			]),
		);
	await db.delete(project).where(inArray(project.id, projectIds));
	await db
		.delete(productFact)
		.where(inArray(productFact.id, [main.factId, missingConfig.factId]));
	await db
		.delete(product)
		.where(inArray(product.id, [main.productId, missingConfig.productId]));
	await db
		.delete(user)
		.where(inArray(user.id, [actor.userId, otherActor.userId]));
	await db
		.delete(workspace)
		.where(inArray(workspace.id, [actor.workspaceId, otherActor.workspaceId]));
}

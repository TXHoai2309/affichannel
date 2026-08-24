import { randomUUID } from "node:crypto";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const { eq, inArray } = await import("drizzle-orm");
const {
	channelSettings,
	contentBrief,
	db,
	factDependency,
	factInvalidationEvent,
	factLockClaim,
	factLockClaimFact,
	factLockRun,
	outputRules,
	product,
	productFact,
	project,
	projectStepStatus,
	scriptGeneration,
	scriptVersion,
	user,
	workspace,
} = await import("@affichannel/db");
const {
	SCRIPT_OUTPUT_SCHEMA_VERSION,
	scriptGenerationSections,
} = await import("@affichannel/core");
const { FactLockError } = await import("@affichannel/core/fact-lock/errors");
const { createProjectInputSchema } = await import(
	"@affichannel/core/project/project-validation"
);
const { FactLockGate } = await import(
	"../packages/api/src/services/fact-lock-gate-service.ts"
);
const { getFactLockState, prepareFactLockRun, runPreparedFactLock } = await import(
	"../packages/api/src/services/fact-lock-service.ts"
);
const { createProject: createProjectService } = await import(
	"@affichannel/core/project/project-service"
);
const { createProjectRepository } = await import(
	"../packages/api/src/services/project-repository.ts"
);
const { initializeScriptVersion: initializeScriptVersionService } = await import(
	"../packages/api/src/services/script-version-service.ts"
);
const { saveScriptVersion } = await import(
	"../packages/api/src/services/script-version-service.ts"
);
const { DeterministicTextProvider } = await import(
	"../packages/api/src/providers/text/deterministic-text-provider.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function expectFactLockCode(
	action: () => Promise<unknown>,
	code: string,
) {
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

const prefix = `fact-lock-flow-${Date.now()}-${randomUUID().slice(0, 8)}`;
const userId = `${prefix}-user`;
const workspaceId = `${prefix}-workspace`;
const productId = randomUUID();
const factId = randomUUID();
const projectIds: string[] = [];
const generationIds: string[] = [];
const scriptVersionIds: string[] = [];
const runIds: string[] = [];

const actor = { workspaceId, userId };
const factLockConfig = {
	provider: "deterministic",
	model: "fact-lock-deterministic-v1",
	promptVersion: "fact-lock-prompt.v3" as const,
	outputSchemaVersion: "fact-lock-output.v1" as const,
};

function generationOutput() {
	return {
		schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-1", text: "Pin 20 giờ cho ngày dài." },
			{ key: "hook-2", text: "Một lựa chọn cho trải nghiệm nghe." },
			{ key: "hook-3", text: "Điều cần kiểm tra đầu tiên." },
		],
		voiceoverSegments: [
			{ key: "intro", text: "Pin dùng 20 giờ trong một lần sạc." },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 30,
				visualDirection: "Cận cảnh sản phẩm.",
				onScreenText: "Pin 20 giờ",
				voiceoverSegmentKeys: ["intro"],
			},
		],
		cta: { text: "Xem thêm thông tin." },
		caption: "Tai nghe cho ngày dài.",
		hashtags: ["#review"],
		disclosure: "Nội dung có liên kết affiliate.",
		claims: [
			{
				text: "Pin dùng 20 giờ trong một lần sạc.",
				occurrence: { section: "voiceover" as const, segmentKey: "intro" },
			},
		],
	};
}

async function createLegacyProject(label: string) {
	const input = createProjectInputSchema.parse({
		name: `${prefix} ${label}`,
		productId,
		platform: "tiktok",
		goal: "Fact Lock saved ScriptVersion regression",
		durationSeconds: 30,
		angle: "Deterministic saved ScriptVersion flow",
		description: undefined,
	});
	const project = await createProjectService(
		createProjectRepository(),
		actor,
		input,
	);
	projectIds.push(project.id);
	return project;
}

async function insertGeneration(projectId: string) {
	const generationId = randomUUID();
	const now = new Date();
	await db.insert(scriptGeneration).values({
		id: generationId,
		workspaceId,
		projectId,
		createdByUserId: userId,
		idempotencyKey: `${prefix}-generation-${generationId}`,
		requestHash: "a".repeat(64),
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "fact-lock-flow-fixture",
		promptVersion: "fixture",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshotJson: { snapshotVersion: "script-input.v2", facts: [] },
		inputHash: "b".repeat(64),
		promptHash: "c".repeat(64),
		status: "completed",
		outputJson: generationOutput(),
		validSections: [...scriptGenerationSections],
		invalidSections: [],
		providerRequestId: `${prefix}-provider-${generationId}`,
		inputTokens: 10,
		outputTokens: 20,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: null,
		finishedAt: now,
		createdAt: now,
	});
	generationIds.push(generationId);
	return generationId;
}

async function deleteFixture() {
	if (runIds.length > 0) {
		const claimIds = (
			await db
				.select({ id: factLockClaim.id })
				.from(factLockClaim)
				.where(inArray(factLockClaim.runId, runIds))
		).map((row) => row.id);
		if (claimIds.length > 0) {
			await db
				.delete(factLockClaimFact)
				.where(inArray(factLockClaimFact.claimId, claimIds));
		}
		await db
			.delete(factLockClaim)
			.where(inArray(factLockClaim.runId, runIds));
		await db
			.delete(factInvalidationEvent)
			.where(inArray(factInvalidationEvent.dependentId, runIds));
		await db
			.delete(factDependency)
			.where(inArray(factDependency.dependentId, runIds));
		await db.delete(factLockRun).where(inArray(factLockRun.id, runIds));
	}
	if (generationIds.length > 0) {
		await db
			.delete(factDependency)
			.where(inArray(factDependency.dependentId, generationIds));
	}
	if (scriptVersionIds.length > 0) {
		await db
			.delete(scriptVersion)
			.where(inArray(scriptVersion.id, scriptVersionIds));
	}
	if (generationIds.length > 0) {
		await db
			.delete(scriptGeneration)
			.where(inArray(scriptGeneration.id, generationIds));
	}
	if (projectIds.length > 0) {
		await db
			.delete(projectStepStatus)
			.where(inArray(projectStepStatus.projectId, projectIds));
		await db
			.delete(contentBrief)
			.where(inArray(contentBrief.projectId, projectIds));
		await db.delete(project).where(inArray(project.id, projectIds));
	}
	await db.delete(productFact).where(eq(productFact.id, factId));
	await db.delete(product).where(eq(product.id, productId));
	await db.delete(channelSettings).where(eq(channelSettings.workspaceId, workspaceId));
	await db.delete(outputRules).where(eq(outputRules.workspaceId, workspaceId));
	await db.delete(workspace).where(eq(workspace.id, workspaceId));
	await db.delete(user).where(eq(user.id, userId));
}

try {
	await db.insert(workspace).values({ id: workspaceId, name: `${prefix} workspace` });
	await db.insert(user).values({
		id: userId,
		name: `${prefix} user`,
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(product).values({
		id: productId,
		workspaceId,
		name: `${prefix} product`,
		category: "Audio",
		status: "active",
		currency: "VND",
		createdByUserId: userId,
	});
	await db.insert(productFact).values({
		id: factId,
		workspaceId,
		productId,
		revision: 1,
		content: "Pin dùng 20 giờ trong một lần sạc.",
		type: "specification",
		status: "verified",
		sourceType: "official",
		sourceLabel: "Fact Lock flow fixture",
		sourceUrl: "https://example.com/fact-lock-flow",
		confirmedAt: "2026-08-24",
		createdByUserId: userId,
		updatedByUserId: userId,
	});
	await db.insert(channelSettings).values({
		id: randomUUID(),
		workspaceId,
		niche: "Audio",
		targetAudience: "Người nghe nhạc",
		tone: "Tin cậy",
		contentPillar: "Review",
		defaultCta: "Xem thêm thông tin.",
		affiliateDisclosure: "Nội dung có liên kết affiliate.",
		avoidWords: [],
		createdByUserId: userId,
		updatedByUserId: userId,
	});
	await db.insert(outputRules).values({
		id: randomUUID(),
		workspaceId,
		language: "vi-VN",
		aspectRatio: "9:16",
		subtitleSafeArea: "standard",
		claimLimit: null,
		requireFinalCta: true,
		createdByUserId: userId,
		updatedByUserId: userId,
	});

	const projectRecord = await createLegacyProject("legacy affiliate");
	assert(
		projectRecord.contentType === "AFFILIATE" &&
			projectRecord.creationPath === "SCRIPTED" &&
			projectRecord.contentFormat?.ref.key === "SCRIPTED_STANDARD" &&
			projectRecord.contentFormat.ref.version === 1,
		"M3B legacy Project did not persist canonical identity.",
	);
	const noScriptProject = await createLegacyProject("no script negative");

	const generationId = await insertGeneration(projectRecord.id);
	const draft = await initializeScriptVersionService(actor, {
		projectId: projectRecord.id,
		sourceGenerationId: generationId,
	});
	scriptVersionIds.push(draft.id);
	assert(
		draft.status === "draft" &&
			draft.sourceGenerationId === generationId &&
			draft.revision === 1 &&
			draft.editableSnapshot.selectedHookKey === "hook-1" &&
			draft.editableSnapshot.claims.length === 1,
		"ScriptGeneration -> ScriptVersion initialization lost Fact Lock continuity.",
	);

	await expectFactLockCode(
		() => prepareFactLockRun(actor, {
			projectId: noScriptProject.id,
			idempotencyKey: `${prefix}-no-script`,
		}, factLockConfig),
		"FACT_LOCK_SCRIPT_NOT_READY",
	);

	const saved = await saveScriptVersion(actor, {
		scriptVersionId: draft.id,
		baseRevision: draft.revision,
	});
	scriptVersionIds.push(saved.id);
	assert(
		saved.status === "saved" &&
			saved.versionNumber === 1 &&
			saved.sourceGenerationId === generationId &&
			saved.editableSnapshot.selectedHookKey === "hook-1" &&
			saved.editableSnapshot.claims.length === 1,
		"Saved ScriptVersion did not preserve canonical claims linkage.",
	);

	const readyToRun = await FactLockGate.evaluate(actor, projectRecord.id);
	assert(
		readyToRun.reason === "FACT_LOCK_NOT_RUN" &&
		readyToRun.currentScriptVersionId === draft.id &&
		readyToRun.currentScriptRevision === draft.revision,
		"Fact Lock did not resolve the current draft after ScriptVersion save.",
	);

	const prepared = await prepareFactLockRun(
		actor,
		{ projectId: projectRecord.id, idempotencyKey: `${prefix}-run` },
		factLockConfig,
	);
	runIds.push(prepared.id);
	assert(
		prepared.scriptVersionId === draft.id &&
		prepared.sourceScriptRevision === draft.revision &&
		prepared.inputSnapshot.scriptVersion.id === draft.id &&
		prepared.inputSnapshot.scriptVersion.snapshot.claims.length === 1,
		"Fact Lock prepared against the wrong ScriptVersion or claims snapshot.",
	);
	const completed = await runPreparedFactLock(
		actor,
		prepared,
		new DeterministicTextProvider({ factLockSnapshot: prepared.inputSnapshot }),
	);
	assert(
		completed.status === "passed" && completed.claims.length >= 1,
		"Fact Lock did not execute normally after saved ScriptVersion.",
	);
	const passed = await FactLockGate.evaluate(actor, projectRecord.id);
	assert(
		passed.allowed && passed.reason === "FACT_LOCK_PASSED",
		"Fact Lock gate did not pass after the normal run.",
	);
	const state = await getFactLockState(actor, projectRecord.id);
	assert(
		state.currentScriptVersion?.id === draft.id &&
		state.latestRequest?.sourceScriptRevision === draft.revision &&
		state.latestRequest?.effectiveStatus === "passed",
		"Fact Lock state lost current ScriptVersion/revision continuity.",
	);

	await db
		.update(scriptVersion)
		.set({
			editableSnapshotJson: {
				...draft.editableSnapshot,
				selectedHookKey: null,
			},
		})
		.where(eq(scriptVersion.id, draft.id));
	await expectFactLockCode(
		() => prepareFactLockRun(actor, {
			projectId: projectRecord.id,
			idempotencyKey: `${prefix}-invalid`,
		}, factLockConfig),
		"FACT_LOCK_SCRIPT_NOT_READY",
	);

	const invalidGate = await FactLockGate.evaluate(actor, projectRecord.id);
	assert(
		!invalidGate.allowed && invalidGate.reason === "SCRIPT_NOT_READY",
		`Invalid ScriptVersion was not blocked: ${invalidGate.reason}.`,
	);
	await db
		.update(scriptVersion)
		.set({
			editableSnapshotJson: {
				...draft.editableSnapshot,
				selectedHookKey: "hook-1",
				claimsStatus: "stale",
			},
		})
		.where(eq(scriptVersion.id, draft.id));
	const staleGate = await FactLockGate.evaluate(actor, projectRecord.id);
	assert(
		!staleGate.allowed && staleGate.reason === "FACT_LOCK_STALE_SCRIPT",
		`Stale ScriptVersion was not blocked: ${staleGate.reason}.`,
	);
	await expectFactLockCode(
		() => prepareFactLockRun(actor, {
			projectId: noScriptProject.id,
			idempotencyKey: `${prefix}-wrong-project`,
		}, factLockConfig),
		"FACT_LOCK_SCRIPT_NOT_READY",
	);

	console.log(
		"Fact Lock saved ScriptVersion flow passed: M3B canonical create, generation claims, default selected hook, immutable save, normal run, and negative gates.",
	);
} finally {
	await deleteFixture().catch((error) => {
		console.error("Fact Lock saved ScriptVersion fixture cleanup failed.", error);
	});
}

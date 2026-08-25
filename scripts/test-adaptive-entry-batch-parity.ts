import { randomUUID } from "node:crypto";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const {
	channelSettings,
	contentBrief,
	db,
	factDependency,
	factLockRun,
	product,
	productFact,
	project,
	projectStepStatus,
	scriptGeneration,
	scriptVersion,
	user,
	voiceConfig,
	voiceSegmentArtifact,
	workspace,
} = await import("@affichannel/db");
const { and, eq, inArray } = await import("drizzle-orm");
const { SCRIPT_OUTPUT_SCHEMA_VERSION, mapProjectWorkflowEntrySummary } =
	await import("@affichannel/core");
const { env } = await import("@affichannel/env/server");
const { FactLockGate } = await import(
	"../packages/api/src/services/fact-lock-gate-service.ts"
);
const { getProjectWorkflowSubject } = await import(
	"../packages/api/src/services/project-repository.ts"
);
const {
	buildProjectWorkflowEntrySnapshots,
	databaseProjectWorkflowEntryBatchRepository,
} = await import(
	"../packages/api/src/services/project-workflow-entry-service.ts"
);
const { getProjectWorkflowSnapshot } = await import(
	"../packages/api/src/services/project-workflow-read-service.ts"
);
const { getScriptGenerationReadModel } = await import(
	"../packages/api/src/services/script-generation-service.ts"
);
const { findCurrentScriptVersion } = await import(
	"../packages/api/src/services/script-version-repository.ts"
);
const { hashVoiceSegmentText } = await import(
	"../packages/api/src/services/voice-segment-hashing.ts"
);
const { getVoiceStepWorkflowReadSnapshot } = await import(
	"../packages/api/src/services/voice-step-workflow-service.ts"
);

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const fixture = randomUUID();
const workspaceId = `entry-parity-workspace-${fixture}`;
const userId = `entry-parity-user-${fixture}`;
const productId = `entry-parity-product-${fixture}`;
const factId = `entry-parity-fact-${fixture}`;
const projectId = `entry-parity-project-${fixture}`;
const unsupportedProjectId = `entry-parity-unsupported-${fixture}`;
const usableGenerationId = `entry-parity-generation-usable-${fixture}`;
const latestGenerationId = `entry-parity-generation-latest-${fixture}`;
const scriptVersionId = `entry-parity-script-${fixture}`;
const reviewRunId = `entry-parity-review-${fixture}`;
const passedRunId = `entry-parity-passed-${fixture}`;
const actor = { workspaceId, userId };
const baseTime = new Date("2026-08-24T10:00:00.000Z");
const temporalNow = new Date("2026-08-24T12:00:00.000Z");
const projectIds = [projectId, unsupportedProjectId];
let readMutationCount = 0;

const snapshotWithSegments = (
	revision: number,
	segmentKeys = ["intro", "body"],
) => ({
	schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
	language: "vi-VN" as const,
	hookVariants: [
		{ key: "selected", text: "Parity fixture hook." },
		{ key: "benefit", text: "Parity fixture benefit." },
		{ key: "problem", text: "Parity fixture problem." },
	],
	selectedHookKey: "selected",
	voiceoverSegments: segmentKeys.map((key) => ({
		key,
		text: `Parity voice segment ${key}.`,
	})),
	scenes: [
		{
			order: 1,
			durationSeconds: 30,
			visualDirection: "Static parity fixture",
			onScreenText: "Parity",
			voiceoverSegmentKeys: segmentKeys,
		},
	],
	cta: { text: "Xem thêm" },
	caption: "Parity fixture.",
	hashtags: ["#parity"],
	disclosure: "Nội dung có liên kết affiliate.",
	claims: [],
	claimsSourceRevision: revision,
	claimsStatus: "current" as const,
});

async function readOwnedState(targetProjectId: string) {
	const [projects, steps, versions, runs, configs, artifacts] =
		await Promise.all([
			db.select().from(project).where(eq(project.id, targetProjectId)),
			db
				.select()
				.from(projectStepStatus)
				.where(eq(projectStepStatus.projectId, targetProjectId)),
			db
				.select()
				.from(scriptVersion)
				.where(eq(scriptVersion.projectId, targetProjectId)),
			db
				.select()
				.from(factLockRun)
				.where(eq(factLockRun.projectId, targetProjectId)),
			db
				.select()
				.from(voiceConfig)
				.where(eq(voiceConfig.projectId, targetProjectId)),
			db
				.select()
				.from(voiceSegmentArtifact)
				.where(eq(voiceSegmentArtifact.projectId, targetProjectId)),
		]);
	return JSON.stringify({
		projects,
		steps,
		versions,
		runs,
		configs,
		artifacts,
	});
}

function equivalentWorkflow(
	single: NonNullable<Awaited<ReturnType<typeof getProjectWorkflowSnapshot>>>,
	batch: NonNullable<Awaited<ReturnType<typeof getProjectWorkflowSnapshot>>>,
) {
	return {
		nextApplicableStep: single.adaptiveWorkflow.nextApplicableStep,
		nextRouteKey: single.adaptiveWorkflow.nextRouteKey,
		capabilities: single.adaptiveWorkflow.steps.map((step) => ({
			capability: step.capability,
			state: step.applicabilityState,
			completion: step.completion,
			reasonCode: step.reasonCode,
		})),
		unsupportedState: single.adaptiveWorkflow.unsupportedState,
		visibleStepCount: single.adaptiveWorkflow.steps.filter(
			(step) => step.visible,
		).length,
		completedVisibleStepCount: single.adaptiveWorkflow.steps.filter(
			(step) => step.visible && step.completion === "COMPLETE",
		).length,
		entry: mapProjectWorkflowEntrySummary(
			single.projectId,
			single.adaptiveWorkflow,
		),
		batch: {
			nextApplicableStep: batch.adaptiveWorkflow.nextApplicableStep,
			nextRouteKey: batch.adaptiveWorkflow.nextRouteKey,
			capabilities: batch.adaptiveWorkflow.steps.map((step) => ({
				capability: step.capability,
				state: step.applicabilityState,
				completion: step.completion,
				reasonCode: step.reasonCode,
			})),
			unsupportedState: batch.adaptiveWorkflow.unsupportedState,
			visibleStepCount: batch.adaptiveWorkflow.steps.filter(
				(step) => step.visible,
			).length,
			completedVisibleStepCount: batch.adaptiveWorkflow.steps.filter(
				(step) => step.visible && step.completion === "COMPLETE",
			).length,
			entry: mapProjectWorkflowEntrySummary(
				batch.projectId,
				batch.adaptiveWorkflow,
			),
		},
	};
}

async function assertParity(input: {
	label: string;
	projectId?: string;
	expectedCapability?: "SCRIPT" | "FACT_LOCK" | "VOICE" | "RENDER" | null;
	expectedRoute?: "content" | "fact-lock" | "voice" | "video" | null;
	temporal?: boolean;
}) {
	const targetProjectId = input.projectId ?? projectId;
	const temporalContext = input.temporal
		? {
				now: temporalNow,
				pendingLeaseMs: Number(env.VOICE_SEGMENT_PENDING_LEASE_MS),
			}
		: undefined;
	const before = await readOwnedState(targetProjectId);
	const single = await getProjectWorkflowSnapshot(
		actor,
		targetProjectId,
		input.temporal
			? {
					findSubject: getProjectWorkflowSubject,
					readScript: getScriptGenerationReadModel,
					readCurrentScriptVersion: findCurrentScriptVersion,
					evaluateFactLock: FactLockGate.evaluate,
					readVoice: (readActor, readProjectId, sources) =>
						getVoiceStepWorkflowReadSnapshot(
							readActor,
							readProjectId,
							sources,
							temporalContext,
						),
				}
			: undefined,
	);
	assert(single, `${input.label}: canonical single snapshot missing.`);
	const rows = await databaseProjectWorkflowEntryBatchRepository.load(actor, [
		targetProjectId,
	]);
	const batch = buildProjectWorkflowEntrySnapshots(
		actor,
		rows,
		temporalContext,
	)[0];
	assert(batch, `${input.label}: batch snapshot missing.`);

	assert(
		JSON.stringify(single.applicabilityInput) ===
			JSON.stringify(batch.applicabilityInput),
		`${input.label}: Resolver input differs between single and batch. single=${JSON.stringify(single.applicabilityInput)} batch=${JSON.stringify(batch.applicabilityInput)}`,
	);
	const comparison = equivalentWorkflow(single, batch);
	assert(
		JSON.stringify({
			nextApplicableStep: comparison.nextApplicableStep,
			nextRouteKey: comparison.nextRouteKey,
			capabilities: comparison.capabilities,
			unsupportedState: comparison.unsupportedState,
			visibleStepCount: comparison.visibleStepCount,
			completedVisibleStepCount: comparison.completedVisibleStepCount,
			entry: comparison.entry,
		}) === JSON.stringify(comparison.batch),
		`${input.label}: workflow/entry truth differs between single and batch.`,
	);
	if (
		input.expectedCapability !== undefined ||
		input.expectedRoute !== undefined
	) {
		assert(
			comparison.nextApplicableStep === input.expectedCapability &&
				comparison.nextRouteKey === input.expectedRoute,
			`${input.label}: unexpected canonical next step/route.`,
		);
	}
	const after = await readOwnedState(targetProjectId);
	if (before !== after) readMutationCount += 1;
	assert(
		before === after,
		`${input.label}: read path mutated persisted state.`,
	);
	return {
		entry: comparison.entry,
		applicabilityInput: single.applicabilityInput,
	};
}

async function insertGeneration(input: {
	id: string;
	status: "completed" | "failed";
	createdAt: Date;
}) {
	await db.insert(scriptGeneration).values({
		id: input.id,
		workspaceId,
		projectId,
		createdByUserId: userId,
		idempotencyKey: `entry-parity-${input.id}`,
		requestHash: input.status === "completed" ? "a".repeat(64) : "b".repeat(64),
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "entry-parity",
		promptVersion: "entry-parity",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshotJson: {},
		inputHash: input.status === "completed" ? "c".repeat(64) : "d".repeat(64),
		promptHash: input.status === "completed" ? "e".repeat(64) : "f".repeat(64),
		status: input.status,
		outputJson: input.status === "completed" ? {} : null,
		validSections:
			input.status === "completed"
				? [
						"hook",
						"voiceover",
						"scenes",
						"cta",
						"caption",
						"hashtags",
						"disclosure",
						"claims",
					]
				: [],
		invalidSections: [],
		errorCode: input.status === "failed" ? "DETERMINISTIC_FAILURE" : null,
		finishedAt: input.createdAt,
		createdAt: input.createdAt,
	});
}

async function insertFactLockRun(input: {
	id: string;
	status: "review_required" | "passed";
	createdAt: Date;
	sourceScriptRevision: number;
}) {
	await db.insert(factLockRun).values({
		id: input.id,
		workspaceId,
		projectId,
		scriptVersionId,
		sourceScriptRevision: input.sourceScriptRevision,
		idempotencyKey: `entry-parity-${input.id}`,
		requestHash: input.status === "passed" ? "1".repeat(64) : "2".repeat(64),
		inputSnapshotJson: { productFacts: [{ id: factId, revision: 1 }] },
		inputHash: input.status === "passed" ? "3".repeat(64) : "4".repeat(64),
		promptHash: input.status === "passed" ? "5".repeat(64) : "6".repeat(64),
		provider: "deterministic",
		model: "entry-parity",
		promptVersion: "entry-parity",
		outputSchemaVersion: "entry-parity",
		status: input.status,
		createdByUserId: userId,
		createdAt: input.createdAt,
		finishedAt: input.createdAt,
	});
	await db.insert(factDependency).values({
		id: `entry-parity-dependency-${input.id}`,
		workspaceId,
		productFactId: factId,
		factRevision: 1,
		dependentType: "fact_lock",
		dependentId: input.id,
	});
}

async function insertVoiceArtifact(input: {
	id: string;
	segmentKey: string;
	status: "completed" | "failed" | "pending";
	createdAt: Date;
	sourceRevision?: number;
}) {
	const text = `Parity voice segment ${input.segmentKey}.`;
	await db.insert(voiceSegmentArtifact).values({
		id: input.id,
		workspaceId,
		projectId,
		createdByUserId: userId,
		sourceScriptVersionId: scriptVersionId,
		sourceScriptRevision: input.sourceRevision ?? 1,
		segmentKey: input.segmentKey,
		segmentTextSnapshot: text,
		textHash: hashVoiceSegmentText(text),
		voiceConfigRevision: 1,
		provider: "apikeyfun",
		voiceId: "eve",
		language: "vi",
		speed: 1,
		idempotencyKey: `entry-parity-${input.id}`,
		requestHash: input.id.includes("pending")
			? "7".repeat(64)
			: input.id.includes("failed")
				? "8".repeat(64)
				: "9".repeat(64),
		status: input.status,
		errorCode: input.status === "failed" ? "DETERMINISTIC_FAILURE" : null,
		storageProvider: input.status === "completed" ? "local" : null,
		storageKey:
			input.status === "completed" ? `entry-parity/${input.id}.mp3` : null,
		mimeType: input.status === "completed" ? "audio/mpeg" : null,
		byteSize: input.status === "completed" ? 1 : null,
		checksum: input.status === "completed" ? "0".repeat(64) : null,
		durationMs: input.status === "completed" ? 100 : null,
		createdAt: input.createdAt,
		finishedAt: input.status === "pending" ? null : input.createdAt,
	});
}

try {
	await db.insert(workspace).values({ id: workspaceId, name: "Entry parity" });
	await db.insert(user).values({
		id: userId,
		name: "Entry parity fixture",
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(channelSettings).values({
		id: `entry-parity-channel-${fixture}`,
		workspaceId,
		niche: "Công nghệ",
		targetAudience: "Người dùng thử nghiệm",
		tone: "Tin cậy",
		contentPillar: "Review",
		defaultCta: "Xem thêm",
		affiliateDisclosure: "Có liên kết affiliate.",
		avoidWords: [],
		createdByUserId: userId,
		updatedByUserId: userId,
	});
	await db.insert(product).values({
		id: productId,
		workspaceId,
		name: "Entry parity product",
		createdByUserId: userId,
	});
	await db.insert(productFact).values({
		id: factId,
		workspaceId,
		productId,
		content: "Entry parity verified fact",
		type: "specification",
		status: "verified",
		sourceType: "official",
		sourceLabel: "Parity fixture",
		confirmedAt: "2026-08-24",
		createdByUserId: userId,
		updatedByUserId: userId,
	});
	await db.insert(project).values([
		{
			id: projectId,
			workspaceId,
			name: "Entry parity project",
			productId,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			currentStepKey: "product",
			createdByUserId: userId,
		},
		{
			id: unsupportedProjectId,
			workspaceId,
			name: "Entry parity unsupported",
			productId,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "UNSUPPORTED_TEST_FORMAT",
			contentFormatVersion: 1,
			currentStepKey: "product",
			createdByUserId: userId,
		},
	]);
	await db.insert(contentBrief).values(
		projectIds.map((targetProjectId) => ({
			id: `entry-parity-brief-${targetProjectId}`,
			projectId: targetProjectId,
			platform: "tiktok",
			goal: "Validate batch parity",
			durationSeconds: 30,
			angle: "Deterministic",
			description: null,
		})),
	);

	const results: Record<string, Awaited<ReturnType<typeof assertParity>>> = {};
	results.A = await assertParity({
		label: "A",
		expectedCapability: "SCRIPT",
		expectedRoute: "content",
	});
	assert(
		results.A.applicabilityInput.script.channelSettingsComplete &&
			results.A.applicabilityInput.script.productFactsUsable,
		"A: Channel Settings and Product Facts must use canonical completeness/usability semantics.",
	);

	await insertGeneration({
		id: usableGenerationId,
		status: "completed",
		createdAt: baseTime,
	});
	await db.insert(factDependency).values({
		id: `entry-parity-generation-dependency-${fixture}`,
		workspaceId,
		productFactId: factId,
		factRevision: 1,
		dependentType: "script_generation",
		dependentId: usableGenerationId,
	});
	await insertGeneration({
		id: latestGenerationId,
		status: "failed",
		createdAt: new Date(baseTime.getTime() + 1_000),
	});
	results.B = await assertParity({
		label: "B",
		expectedCapability: "SCRIPT",
		expectedRoute: "content",
	});
	assert(
		results.B.applicabilityInput.script.generationStatus === "FAILED" &&
			results.B.applicabilityInput.script.usableGenerationPresent &&
			results.B.applicabilityInput.script.sourceDependencyCurrent,
		"B: latest request, latest usable generation, and generation dependencies must follow canonical ordering.",
	);

	await db.insert(scriptVersion).values({
		id: scriptVersionId,
		workspaceId,
		projectId,
		sourceGenerationId: usableGenerationId,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: snapshotWithSegments(1),
		revision: 1,
		createdByUserId: userId,
		createdAt: new Date(baseTime.getTime() + 2_000),
		updatedAt: new Date(baseTime.getTime() + 2_000),
		savedAt: null,
	});
	results.C = await assertParity({
		label: "C",
		expectedCapability: "FACT_LOCK",
		expectedRoute: "fact-lock",
	});
	assert(
		results.C.applicabilityInput.script.currentVersionPresent &&
			results.C.applicabilityInput.script.currentVersionFactLockReady,
		"C: current draft ScriptVersion selection/validation must match canonical ordering.",
	);

	await insertFactLockRun({
		id: reviewRunId,
		status: "review_required",
		createdAt: new Date(baseTime.getTime() + 3_000),
		sourceScriptRevision: 1,
	});
	results.D = await assertParity({
		label: "D",
		expectedCapability: "FACT_LOCK",
		expectedRoute: "fact-lock",
	});
	assert(
		results.D.applicabilityInput.factLock.gateReason ===
			"FACT_LOCK_REVIEW_REQUIRED",
		"D: latest Fact Lock run must be the review blocker.",
	);

	await insertFactLockRun({
		id: passedRunId,
		status: "passed",
		createdAt: new Date(baseTime.getTime() + 4_000),
		sourceScriptRevision: 1,
	});
	results.E = await assertParity({
		label: "E",
		expectedCapability: "VOICE",
		expectedRoute: "voice",
	});

	await db.insert(voiceConfig).values({
		id: `entry-parity-voice-${fixture}`,
		workspaceId,
		projectId,
		provider: "apikeyfun",
		voiceId: "eve",
		language: "vi",
		speed: 1,
		revision: 1,
		createdByUserId: userId,
		updatedByUserId: userId,
	});
	results.F = await assertParity({
		label: "F",
		expectedCapability: "VOICE",
		expectedRoute: "voice",
	});

	await insertVoiceArtifact({
		id: `entry-parity-intro-failed-${fixture}`,
		segmentKey: "intro",
		status: "failed",
		createdAt: new Date(baseTime.getTime() + 5_000),
	});
	await insertVoiceArtifact({
		id: `entry-parity-intro-complete-${fixture}`,
		segmentKey: "intro",
		status: "completed",
		createdAt: new Date(baseTime.getTime() + 6_000),
	});
	results.G = await assertParity({
		label: "G",
		expectedCapability: "VOICE",
		expectedRoute: "voice",
	});
	assert(
		results.G.applicabilityInput.voice.usableSegments === 1 &&
			results.G.applicabilityInput.voice.failedSegments === 0,
		"G: latest current Voice attempt must supersede the older failed attempt.",
	);

	await insertVoiceArtifact({
		id: `entry-parity-body-complete-${fixture}`,
		segmentKey: "body",
		status: "completed",
		createdAt: new Date(baseTime.getTime() + 7_000),
	});
	results.H = await assertParity({
		label: "H",
		expectedCapability: "RENDER",
		expectedRoute: "video",
	});
	assert(
		results.H.entry.nextActionKind === "COMING_SOON" &&
			results.H.entry.completedVisibleSteps === 4 &&
			results.H.entry.totalVisibleSteps === 5 &&
			results.H.entry.canContinue === false,
		"H: Render entry summary must be 4/5 COMING_SOON and non-continuable.",
	);

	await db
		.delete(voiceSegmentArtifact)
		.where(eq(voiceSegmentArtifact.projectId, projectId));
	await db
		.update(scriptVersion)
		.set({
			editableSnapshotJson: snapshotWithSegments(2, ["intro"]),
			revision: 2,
			updatedAt: new Date(baseTime.getTime() + 8_000),
		})
		.where(eq(scriptVersion.id, scriptVersionId));
	await db
		.update(factLockRun)
		.set({ sourceScriptRevision: 2 })
		.where(eq(factLockRun.id, passedRunId));
	await insertVoiceArtifact({
		id: `entry-parity-pending-${fixture}`,
		segmentKey: "intro",
		status: "pending",
		sourceRevision: 2,
		createdAt: new Date(
			temporalNow.getTime() - Number(env.VOICE_SEGMENT_PENDING_LEASE_MS),
		),
	});
	const expired = await assertParity({
		label: "expired-pending",
		expectedCapability: "VOICE",
		expectedRoute: "voice",
		temporal: true,
	});
	assert(
		expired.entry.nextState === "BLOCKED" &&
			expired.entry.nextCompletion === "IN_PROGRESS" &&
			expired.entry.nextReasonCode === "VOICE_SEGMENTS_INDETERMINATE",
		"Expired pending must project to blocked/in-progress/indeterminate Voice.",
	);

	await db
		.update(scriptVersion)
		.set({
			editableSnapshotJson: snapshotWithSegments(3),
			revision: 3,
			updatedAt: new Date(baseTime.getTime() + 9_000),
		})
		.where(eq(scriptVersion.id, scriptVersionId));
	results.I = await assertParity({
		label: "I",
		expectedCapability: "FACT_LOCK",
		expectedRoute: "fact-lock",
	});
	assert(
		results.I.applicabilityInput.factLock.gateReason ===
			"FACT_LOCK_STALE_SCRIPT",
		"I: latest ScriptVersion revision must stale the previous Fact Lock run.",
	);

	await db
		.update(factLockRun)
		.set({ sourceScriptRevision: 3 })
		.where(eq(factLockRun.id, passedRunId));
	await db
		.update(productFact)
		.set({ revision: 2, updatedAt: new Date(baseTime.getTime() + 10_000) })
		.where(eq(productFact.id, factId));
	await db
		.update(factDependency)
		.set({
			invalidatedAt: new Date(baseTime.getTime() + 10_000),
			invalidationReason: "fact_changed",
		})
		.where(
			and(
				eq(factDependency.workspaceId, workspaceId),
				inArray(factDependency.dependentId, [passedRunId, usableGenerationId]),
			),
		);
	results.J = await assertParity({
		label: "J",
		expectedCapability: "FACT_LOCK",
		expectedRoute: "fact-lock",
	});
	assert(
		!results.J.applicabilityInput.script.sourceDependencyCurrent &&
			results.J.applicabilityInput.factLock.gateReason ===
				"FACT_LOCK_STALE_FACTS",
		"J: invalidated generation/run dependencies and Product Fact revision must project stale consistently.",
	);

	const unsupported = await assertParity({
		label: "unsupported",
		projectId: unsupportedProjectId,
	});
	assert(
		unsupported.entry.unsupported && !unsupported.entry.canContinue,
		"Unsupported parity must fail closed to a non-continuable entry.",
	);

	assert(
		readMutationCount === 0,
		"Parity reads must have zero persisted mutation.",
	);
	console.log(
		"AFF-US-015/15B2 adaptive entry parity passed: A-J=10/10; expiredPending=PASS; unsupported=PASS; ordering=PASS; dependencies=PASS; mutation=0; voiceReconciliation=0; providerCalls=0.",
	);
} finally {
	await db
		.delete(voiceSegmentArtifact)
		.where(eq(voiceSegmentArtifact.projectId, projectId));
	await db.delete(voiceConfig).where(eq(voiceConfig.projectId, projectId));
	await db
		.delete(factDependency)
		.where(eq(factDependency.workspaceId, workspaceId));
	await db.delete(factLockRun).where(eq(factLockRun.projectId, projectId));
	await db.delete(scriptVersion).where(eq(scriptVersion.projectId, projectId));
	await db
		.delete(scriptGeneration)
		.where(eq(scriptGeneration.projectId, projectId));
	await db.delete(project).where(inArray(project.id, projectIds));
	await db.delete(productFact).where(eq(productFact.productId, productId));
	await db.delete(product).where(eq(product.id, productId));
	await db
		.delete(channelSettings)
		.where(eq(channelSettings.workspaceId, workspaceId));
	await db.delete(workspace).where(eq(workspace.id, workspaceId));
	await db.delete(user).where(eq(user.id, userId));
}

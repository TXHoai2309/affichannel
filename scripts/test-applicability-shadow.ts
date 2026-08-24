import { randomUUID } from "node:crypto";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const {
	channelSettings,
	contentBrief,
	db,
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
const { and, eq } = await import("drizzle-orm");
const { SCRIPT_OUTPUT_SCHEMA_VERSION } = await import("@affichannel/core");
const { env } = await import("@affichannel/env/server");
const { getProjectDetails, getProjectWorkflowSubject } = await import(
	"../packages/api/src/services/project-repository.ts"
);
const {
	observeProjectApplicabilityShadow,
	observeProjectApplicabilityShadowFromSnapshot,
} = await import(
	"../packages/api/src/services/applicability-shadow-service.ts"
);
const { createProjectWorkflowRequestReader, getProjectWorkflowSnapshot } =
	await import("../packages/api/src/services/project-workflow-read-service.ts");
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

const fixtureId = randomUUID();
const workspaceId = `m4-shadow-workspace-${fixtureId}`;
const userId = `m4-shadow-user-${fixtureId}`;
const productId = `m4-shadow-product-${fixtureId}`;
const projectId = `m4-shadow-project-${fixtureId}`;
const actor = { workspaceId, userId };

async function projectOwnedRows() {
	const [
		projectRows,
		stepRows,
		scriptRows,
		factLockRows,
		configRows,
		segmentRows,
	] = await Promise.all([
		db.select().from(project).where(eq(project.id, projectId)),
		db
			.select()
			.from(projectStepStatus)
			.where(eq(projectStepStatus.projectId, projectId)),
		db
			.select()
			.from(scriptVersion)
			.where(eq(scriptVersion.projectId, projectId)),
		db.select().from(factLockRun).where(eq(factLockRun.projectId, projectId)),
		db.select().from(voiceConfig).where(eq(voiceConfig.projectId, projectId)),
		db
			.select()
			.from(voiceSegmentArtifact)
			.where(eq(voiceSegmentArtifact.projectId, projectId)),
	]);
	return JSON.stringify({
		projectRows,
		stepRows,
		scriptRows,
		factLockRows,
		configRows,
		segmentRows,
	});
}

try {
	await db.insert(workspace).values({ id: workspaceId, name: "M4 shadow" });
	await db.insert(user).values({
		id: userId,
		name: "M4 shadow fixture",
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	await db.insert(channelSettings).values({
		id: `m4-shadow-channel-${fixtureId}`,
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
		name: "M4 shadow product",
		createdByUserId: userId,
	});
	await db.insert(project).values({
		id: projectId,
		workspaceId,
		name: "M4 shadow project",
		productId,
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
		currentStepKey: "product",
		createdByUserId: userId,
	});
	await db.insert(contentBrief).values({
		id: `m4-shadow-brief-${fixtureId}`,
		projectId,
		platform: "tiktok",
		goal: "Validate shadow parity",
		durationSeconds: 30,
		angle: "Deterministic",
		description: null,
	});
	await db.insert(productFact).values({
		id: `m4-shadow-fact-${fixtureId}`,
		workspaceId,
		productId,
		content: "Fixture fact",
		type: "specification",
		status: "verified",
		sourceType: "official",
		sourceLabel: "M4 fixture",
		confirmedAt: "2026-08-24",
		createdByUserId: userId,
		updatedByUserId: userId,
	});

	const projectDetails = await getProjectDetails(workspaceId, projectId);
	assert(projectDetails, "M4 Project fixture must be readable.");
	const before = await projectOwnedRows();
	const observation = await observeProjectApplicabilityShadow(
		actor,
		projectDetails,
	);
	const requestReader = createProjectWorkflowRequestReader();
	const [snapshot, reusedSnapshot] = await Promise.all([
		requestReader.get(actor, projectId),
		requestReader.get(actor, projectId),
	]);
	assert(snapshot, "Adaptive Workflow snapshot must be readable.");
	assert(
		snapshot === reusedSnapshot,
		"Request-owned reader must reuse one snapshot promise/result.",
	);
	const inaccessibleSnapshot = await requestReader.get(
		{ workspaceId: `${workspaceId}-other`, userId },
		projectId,
	);
	assert(
		inaccessibleSnapshot === undefined,
		"Adaptive Workflow snapshot must preserve workspace authorization.",
	);
	const reusedObservation = observeProjectApplicabilityShadowFromSnapshot(
		actor,
		snapshot,
	);
	const after = await projectOwnedRows();

	assert(observation.status === "compared", "M4 baseline must be compared.");
	assert(
		observation.mismatches.length === 0,
		"M4 baseline must have zero shadow mismatches.",
	);
	assert(
		reusedObservation.status === "compared" &&
			reusedObservation.mismatches.length === 0,
		"M4 comparison must reuse the Adaptive Workflow snapshot without mismatch.",
	);
	assert(
		snapshot.adaptiveWorkflow.nextApplicableStep === "SCRIPT" &&
			snapshot.adaptiveWorkflow.nextRouteKey === "content",
		"Adaptive Workflow must map the current Affiliate fixture to Content.",
	);
	assert(
		snapshot.adaptiveWorkflow.steps.length === 5 &&
			snapshot.adaptiveWorkflow.steps.every(
				(step, index) => step.visibleOrdinal === index + 1,
			),
		"Adaptive Workflow must expose five ordered canonical capabilities.",
	);
	assert(
		before === after,
		"M4 shadow execution must not mutate Project state.",
	);

	const temporalNow = new Date("2026-08-24T12:00:00.000Z");
	const generationId = `m4-shadow-generation-${fixtureId}`;
	const scriptVersionId = `m4-shadow-script-${fixtureId}`;
	const segmentId = `m4-shadow-segment-${fixtureId}`;
	const segmentText = "Lease-aware read-only Voice fixture.";
	await db.insert(scriptGeneration).values({
		id: generationId,
		workspaceId,
		projectId,
		createdByUserId: userId,
		idempotencyKey: `m4-shadow-generation-${fixtureId}`,
		requestHash: "a".repeat(64),
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "phase-15a-lease",
		promptVersion: "phase-15a-lease",
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
		finishedAt: temporalNow,
		createdAt: temporalNow,
	});
	await db.insert(scriptVersion).values({
		id: scriptVersionId,
		workspaceId,
		projectId,
		sourceGenerationId: generationId,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: {
			schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
			language: "vi-VN",
			hookVariants: [
				{ key: "selected", text: "Lease-aware fixture hook." },
				{ key: "benefit", text: "Lease-aware fixture benefit." },
				{ key: "problem", text: "Lease-aware fixture problem." },
			],
			selectedHookKey: "selected",
			voiceoverSegments: [{ key: "intro", text: segmentText }],
			scenes: [
				{
					order: 1,
					durationSeconds: 30,
					visualDirection: "Static fixture",
					onScreenText: "Lease-aware",
					voiceoverSegmentKeys: ["intro"],
				},
			],
			cta: { text: "Xem thêm" },
			caption: "Lease-aware fixture.",
			hashtags: ["#fixture"],
			disclosure: "Nội dung có liên kết affiliate.",
			claims: [],
			claimsSourceRevision: 1,
			claimsStatus: "current",
		},
		revision: 1,
		createdByUserId: userId,
		createdAt: temporalNow,
		updatedAt: temporalNow,
		savedAt: null,
	});
	await db.insert(voiceConfig).values({
		id: `m4-shadow-voice-config-${fixtureId}`,
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
	await db.insert(voiceSegmentArtifact).values({
		id: segmentId,
		workspaceId,
		projectId,
		createdByUserId: userId,
		sourceScriptVersionId: scriptVersionId,
		sourceScriptRevision: 1,
		segmentKey: "intro",
		segmentTextSnapshot: segmentText,
		textHash: hashVoiceSegmentText(segmentText),
		voiceConfigRevision: 1,
		provider: "apikeyfun",
		voiceId: "eve",
		language: "vi",
		speed: 1,
		idempotencyKey: `m4-shadow-pending-${fixtureId}`,
		requestHash: "d".repeat(64),
		status: "pending",
		errorCode: null,
		createdAt: new Date(
			temporalNow.getTime() - Number(env.VOICE_SEGMENT_PENDING_LEASE_MS),
		),
		finishedAt: null,
	});

	const temporalBefore = await projectOwnedRows();
	const leaseAwareSnapshot = await getProjectWorkflowSnapshot(
		actor,
		projectId,
		{
			findSubject: getProjectWorkflowSubject,
			readScript: async () =>
				({
					latestRequest: { status: "completed" },
					latestUsableArtifact: {},
					dependencyState: null,
					context: {
						channelSettings: {},
						facts: [{ generationUsability: "allowed" }],
					},
				}) as never,
			readCurrentScriptVersion: findCurrentScriptVersion,
			evaluateFactLock: async () =>
				({ allowed: true, reason: "FACT_LOCK_PASSED" }) as never,
			readVoice: (readActor, readProjectId, sources) =>
				getVoiceStepWorkflowReadSnapshot(readActor, readProjectId, sources, {
					now: temporalNow,
					pendingLeaseMs: Number(env.VOICE_SEGMENT_PENDING_LEASE_MS),
				}),
		},
	);
	assert(leaseAwareSnapshot, "Expired pending fixture must be readable.");
	const voiceStep = leaseAwareSnapshot.adaptiveWorkflow.steps.find(
		(step) => step.capability === "VOICE",
	);
	assert(
		voiceStep?.applicabilityState === "BLOCKED" &&
			voiceStep.completion === "IN_PROGRESS" &&
			voiceStep.reasonCode === "VOICE_SEGMENTS_INDETERMINATE" &&
			leaseAwareSnapshot.adaptiveWorkflow.nextApplicableStep === "VOICE",
		`Expired pending must project to canonical indeterminate Voice applicability; received ${voiceStep?.applicabilityState}/${voiceStep?.completion}/${voiceStep?.reasonCode}, next=${leaseAwareSnapshot.adaptiveWorkflow.nextApplicableStep}.`,
	);
	const leaseAwareObservation = observeProjectApplicabilityShadowFromSnapshot(
		actor,
		leaseAwareSnapshot,
	);
	assert(
		leaseAwareObservation.status === "compared" &&
			leaseAwareObservation.mismatches.length === 0,
		"M4 shadow must preserve parity for expired pending projection.",
	);
	const temporalAfter = await projectOwnedRows();
	assert(
		temporalBefore === temporalAfter,
		"Lease-aware Adaptive read must not persist pending reconciliation.",
	);
	console.log(
		"AFF-US-014/M4 + AFF-US-015/15A integration passed: parity=PASS; expiredPendingProjection=PASS; requestReuse=PASS; mutation=0; voiceReconciliation=0; providerCalls=0.",
	);
} finally {
	await db
		.delete(voiceSegmentArtifact)
		.where(eq(voiceSegmentArtifact.projectId, projectId));
	await db.delete(voiceConfig).where(eq(voiceConfig.projectId, projectId));
	await db.delete(scriptVersion).where(eq(scriptVersion.projectId, projectId));
	await db
		.delete(scriptGeneration)
		.where(eq(scriptGeneration.projectId, projectId));
	await db
		.delete(productFact)
		.where(
			and(
				eq(productFact.workspaceId, workspaceId),
				eq(productFact.productId, productId),
			),
		);
	await db.delete(project).where(eq(project.id, projectId));
	await db.delete(product).where(eq(product.id, productId));
	await db
		.delete(channelSettings)
		.where(eq(channelSettings.workspaceId, workspaceId));
	await db.delete(workspace).where(eq(workspace.id, workspaceId));
	await db.delete(user).where(eq(user.id, userId));
}

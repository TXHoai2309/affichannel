import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(process.cwd(), "apps/web/.env"),
	override: true,
});

const { and, eq, inArray, sql } = await import("drizzle-orm");
const {
	aiSettings,
	channelSettings,
	db,
	factDependency,
	factInvalidationEvent,
	factLockClaim,
	factLockClaimFact,
	factLockRun,
	outputRules,
	product,
	productFact,
	productFactHistory,
	project,
	scriptGeneration,
	scriptVersion,
	user,
	workspace,
	workspaceMember,
} = await import("@affichannel/db");
const { FactLockError } = await import("@affichannel/core/fact-lock/errors");
const { SCRIPT_OUTPUT_SCHEMA_VERSION } = await import("@affichannel/core");
const {
	executeFactLockRun,
	finalizeFactLockRun,
	getFactLockState,
	prepareFactLockRun,
	runPreparedFactLock,
} = await import("../packages/api/src/services/fact-lock-service.ts");
const { DeterministicTextProvider } = await import(
	"../packages/api/src/providers/text/deterministic-text-provider.ts"
);

import type {
	TextProvider,
	TextProviderEstimateRequest,
	TextProviderRequest,
	TextProviderResult,
} from "../packages/api/src/providers/text/text-provider.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function expectCode(action: () => Promise<unknown>, code: string) {
	await action().then(
		() => {
			throw new Error(`Expected ${code}.`);
		},
		(error) =>
			assert(
				error instanceof FactLockError && error.code === code,
				`Expected ${code}, received ${error?.code ?? error}.`,
			),
	);
}

const prefix = `US010_${Date.now()}_${randomUUID().slice(0, 8)}`;
const userAId = randomUUID();
const userBId = randomUUID();
const workspaceAId = randomUUID();
const workspaceBId = randomUUID();
const actorA = { workspaceId: workspaceAId, userId: userAId };
const actorB = { workspaceId: workspaceBId, userId: userBId };
const fixtureA = {
	productId: randomUUID(),
	projectId: randomUUID(),
	factId: randomUUID(),
	multiFactAId: randomUUID(),
	multiFactBId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
};
const fixtureB = {
	productId: randomUUID(),
	projectId: randomUUID(),
	factId: randomUUID(),
	multiFactAId: randomUUID(),
	multiFactBId: randomUUID(),
	generationId: randomUUID(),
	scriptVersionId: randomUUID(),
};
const fixtures = [fixtureA, fixtureB];
const config = {
	provider: "deterministic",
	model: "fact-lock-deterministic-v1",
	promptVersion: "fact-lock-prompt.v1" as const,
	outputSchemaVersion: "fact-lock-output.v1" as const,
};

function draft() {
	return {
		schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		language: "vi-VN",
		hookVariants: [
			{ key: "selected", text: "Bạn có biết tai nghe này có pin 20 giờ?" },
			{ key: "benefit", text: "Một lựa chọn cho ngày dài." },
			{ key: "problem", text: "Đang tìm tai nghe phù hợp?" },
		],
		voiceoverSegments: [
			{ key: "intro", text: "Pin dùng 20 giờ trong một lần sạc." },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 30,
				visualDirection: "Cận cảnh sản phẩm",
				onScreenText: "Pin 20 giờ",
				voiceoverSegmentKeys: ["intro"],
			},
		],
		cta: { text: "Xem thêm thông tin" },
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

function fakeProvider(
	content: unknown,
	options: {
		callCount?: { value: number };
		onGenerate?: () => void | Promise<void>;
	} = {},
): TextProvider {
	const result = (request: TextProviderRequest): TextProviderResult => ({
		content,
		providerRequestId: `fake-${request.idempotencyKey}`,
		inputTokens: 10,
		outputTokens: 20,
		estimatedCostMicros: BigInt(0),
		actualCostMicros: BigInt(0),
		currency: "VND",
	});
	return {
		name: "fake-fact-lock",
		estimateCost: async (_request: TextProviderEstimateRequest) => ({
			estimatedCostMicros: BigInt(0),
			currency: "VND",
			inputTokens: 10,
			pricingBasis: "integration",
		}),
		generate: async (request) => {
			if (options.callCount) options.callCount.value += 1;
			await options.onGenerate?.();
			return result(request);
		},
	};
}

function supportedOutput(
	factMappings: Array<{
		factId: string;
		relation: "supports" | "related" | "contradicts";
	}>,
) {
	return {
		schemaVersion: "fact-lock-output.v1",
		claims: [
			{
				claimKey: "claim-supported",
				claimText: "Pin dùng 20 giờ trong một lần sạc.",
				occurrence: { section: "voiceover" as const, segmentKey: "intro" },
				classificationStatus: "SUPPORTED" as const,
				reason: "Khớp Product Fact.",
				confidence: 1,
				suggestionText: null,
				factMappings,
			},
		],
	};
}

async function expectDbFailure(action: () => Promise<unknown>) {
	await action().then(
		() => {
			throw new Error("Expected database constraint failure.");
		},
		() => undefined,
	);
}

function needsReviewOutput(
	factMappings: Array<{
		factId: string;
		relation: "supports" | "related" | "contradicts";
	}> = [],
) {
	return {
		schemaVersion: "fact-lock-output.v1",
		claims: [
			{
				claimKey: "claim-review",
				claimText: "Pin dùng 20 giờ trong một lần sạc.",
				occurrence: { section: "voiceover", segmentKey: "intro" },
				classificationStatus: "NEEDS_REVIEW",
				reason: "Cần kiểm tra lại cách diễn đạt.",
				confidence: null,
				suggestionText: "Đối chiếu với nguồn chính thức.",
				factMappings,
			},
		],
	};
}

async function insertFixture(fixture: typeof fixtureA, suffix: string) {
	await db.insert(product).values({
		id: fixture.productId,
		workspaceId: workspaceAId,
		name: `${prefix} Product ${suffix}`,
		category: "Audio",
		createdByUserId: userAId,
	});
	await db.insert(project).values({
		id: fixture.projectId,
		workspaceId: workspaceAId,
		name: `${prefix} Project ${suffix}`,
		productId: fixture.productId,
		currentStepKey: "fact-lock",
		createdByUserId: userAId,
	});
	await db.insert(productFact).values({
		id: fixture.factId,
		workspaceId: workspaceAId,
		productId: fixture.productId,
		revision: 1,
		content: "Pin dùng 20 giờ trong một lần sạc.",
		type: "specification",
		status: "verified",
		sourceType: "official",
		sourceLabel: "Integration source",
		sourceUrl: "https://example.com/fact",
		confirmedAt: "2026-08-15",
		createdByUserId: userAId,
		updatedByUserId: userAId,
	});
	await db.insert(scriptGeneration).values({
		id: fixture.generationId,
		workspaceId: workspaceAId,
		projectId: fixture.projectId,
		createdByUserId: userAId,
		idempotencyKey: `${prefix}_generation_${suffix}`,
		requestHash: "a".repeat(64),
		mode: "full",
		provider: "deterministic",
		model: "fixture",
		promptVersion: "fixture",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshotJson: {},
		inputHash: "b".repeat(64),
		promptHash: "c".repeat(64),
		status: "completed",
		outputJson: draft(),
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
		finishedAt: new Date(),
	});
	await db.insert(scriptVersion).values({
		id: fixture.scriptVersionId,
		workspaceId: workspaceAId,
		projectId: fixture.projectId,
		sourceGenerationId: fixture.generationId,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: {
			...draft(),
			selectedHookKey: "selected",
			claimsSourceRevision: 1,
			claimsStatus: "stale",
		},
		revision: 1,
		createdByUserId: userAId,
	});
}

try {
	await db.insert(workspace).values([
		{ id: workspaceAId, name: `${prefix} A` },
		{ id: workspaceBId, name: `${prefix} B` },
	]);
	await db.insert(user).values([
		{
			id: userAId,
			name: `${prefix} A`,
			email: `${userAId}@example.test`,
			emailVerified: true,
		},
		{
			id: userBId,
			name: `${prefix} B`,
			email: `${userBId}@example.test`,
			emailVerified: true,
		},
	]);
	await db.insert(workspaceMember).values([
		{ id: randomUUID(), workspaceId: workspaceAId, userId: userAId },
		{ id: randomUUID(), workspaceId: workspaceBId, userId: userBId },
	]);
	await db.insert(channelSettings).values({
		id: randomUUID(),
		workspaceId: workspaceAId,
		niche: "Audio",
		targetAudience: "Người nghe nhạc",
		tone: "Tin cậy",
		contentPillar: "Review",
		defaultCta: "Xem thêm thông tin",
		affiliateDisclosure: "Nội dung có liên kết affiliate.",
		avoidWords: ["cam kết tuyệt đối"],
		createdByUserId: userAId,
		updatedByUserId: userAId,
	});
	await db.insert(aiSettings).values({
		id: randomUUID(),
		workspaceId: workspaceAId,
		textProvider: config.provider,
		textModel: config.model,
		createdByUserId: userAId,
		updatedByUserId: userAId,
	});
	await db.insert(outputRules).values({
		id: randomUUID(),
		workspaceId: workspaceAId,
		language: "vi-VN",
		aspectRatio: "9:16",
		subtitleSafeArea: "standard",
		claimLimit: null,
		requireFinalCta: true,
		createdByUserId: userAId,
		updatedByUserId: userAId,
	});
	await insertFixture(fixtureA, "A");
	await insertFixture(fixtureB, "B");

	const first = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_same_key` },
		config,
	);
	const completed = await executeFactLockRun(
		actorA,
		first,
		new DeterministicTextProvider({ factLockSnapshot: first.inputSnapshot }),
	);
	assert(
		completed.status === "passed" && completed.claims.length === 1,
		"Valid deterministic Fact Lock did not pass.",
	);
	assert(
		completed.claims[0]?.factMappings[0]?.factRevision === 1,
		"Claim mapping did not pin exact Fact revision.",
	);
	const dependency = await db
		.select()
		.from(factDependency)
		.where(
			and(
				eq(factDependency.dependentType, "fact_lock"),
				eq(factDependency.dependentId, first.id),
			),
		);
	assert(
		dependency.length === 1 && dependency[0].detachedAt === null,
		"Fact Lock dependency was not registered.",
	);
	const replay = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_same_key` },
		config,
	);
	assert(
		replay.id === first.id,
		"Same idempotency key did not replay the same run.",
	);

	const concurrentRun = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_concurrent` },
		config,
	);
	const concurrentCalls = { value: 0 };
	let releaseProvider!: () => void;
	const providerRelease = new Promise<void>((resolve) => {
		releaseProvider = resolve;
	});
	let resolveProviderStarted!: () => void;
	const providerStarted = new Promise<void>((resolve) => {
		resolveProviderStarted = resolve;
	});
	const controlledProvider = fakeProvider(
		supportedOutput([{ factId: fixtureA.factId, relation: "supports" }]),
		{
			callCount: concurrentCalls,
			onGenerate: async () => {
				resolveProviderStarted();
				await providerRelease;
			},
		},
	);
	const ownerPromise = runPreparedFactLock(
		actorA,
		concurrentRun,
		controlledProvider,
	);
	await providerStarted;
	const observer = await runPreparedFactLock(
		actorA,
		concurrentRun,
		controlledProvider,
	);
	assert(
		observer.id === concurrentRun.id &&
			observer.status === "pending" &&
			concurrentCalls.value === 1,
		"Concurrent same-key caller did not observe the owned pending run.",
	);
	releaseProvider();
	const owner = await ownerPromise;
	assert(
		owner.status === "passed" && concurrentCalls.value === 1,
		"Concurrent same-key execution called the provider more than once.",
	);
	const concurrentRows = await db
		.select()
		.from(factLockRun)
		.where(
			and(
				eq(factLockRun.workspaceId, workspaceAId),
				eq(factLockRun.idempotencyKey, `${prefix}_concurrent`),
			),
		);
	assert(
		concurrentRows.length === 1,
		"Concurrent requests created duplicate DB runs.",
	);
	const concurrentClaims = await db
		.select()
		.from(factLockClaim)
		.where(eq(factLockClaim.runId, concurrentRun.id));
	assert(
		concurrentClaims.length === 1,
		"Concurrent requests created duplicate claims.",
	);
	const completedObserver = await runPreparedFactLock(
		actorA,
		concurrentRun,
		controlledProvider,
	);
	assert(
		completedObserver.id === concurrentRun.id && concurrentCalls.value === 1,
		"Completed same-key replay called the provider again.",
	);
	await expectCode(
		() =>
			prepareFactLockRun(
				actorA,
				{ projectId: fixtureB.projectId, idempotencyKey: `${prefix}_same_key` },
				config,
			),
		"FACT_LOCK_IDEMPOTENCY_CONFLICT",
	);

	const pending = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_pending_a` },
		config,
	);
	await expectCode(
		() =>
			prepareFactLockRun(
				actorA,
				{
					projectId: fixtureA.projectId,
					idempotencyKey: `${prefix}_pending_b`,
				},
				config,
			),
		"FACT_LOCK_ALREADY_PENDING",
	);
	await finalizeFactLockRun(actorA, {
		runId: pending.id,
		outcome: { kind: "failure", code: "AI_PROVIDER_ERROR" },
	});

	const staleClaimRun = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_stale_claim` },
		config,
	);
	await db
		.update(factLockRun)
		.set({ executionClaimedAt: new Date(Date.now() - 10 * 60 * 1000) })
		.where(eq(factLockRun.id, staleClaimRun.id));
	const staleClaimCalls = { value: 0 };
	const reconciledStaleClaim = await runPreparedFactLock(
		actorA,
		staleClaimRun,
		fakeProvider(
			supportedOutput([{ factId: fixtureA.factId, relation: "supports" }]),
			{
				callCount: staleClaimCalls,
			},
		),
	);
	assert(
		reconciledStaleClaim.status === "indeterminate" &&
			staleClaimCalls.value === 0,
		"Stale execution claim was retried instead of conservatively becoming indeterminate.",
	);

	const failedRun = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_failed` },
		config,
	);
	const failed = await runPreparedFactLock(
		actorA,
		failedRun,
		new DeterministicTextProvider({ scenario: "malformed" }),
	);
	assert(
		failed.status === "failed",
		"Malformed provider output did not fail the run.",
	);
	const failedDependency = await db
		.select()
		.from(factDependency)
		.where(eq(factDependency.dependentId, failed.id));
	assert(
		failedDependency.every((item) => item.detachedAt !== null),
		"Failed run retained active dependencies.",
	);
	const afterFailed = await getFactLockState(actorA, fixtureA.projectId);
	assert(
		afterFailed.latestRequest?.id === failed.id &&
			afterFailed.latestApplicableRun?.id === concurrentRun.id,
		"Failed request must not replace the latest usable passed run.",
	);

	const indeterminateRun = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_uncertain` },
		config,
	);
	const indeterminate = await runPreparedFactLock(
		actorA,
		indeterminateRun,
		new DeterministicTextProvider({ scenario: "timeout_uncertain" }),
	);
	assert(
		indeterminate.status === "indeterminate",
		"Uncertain provider outcome was not persisted as indeterminate.",
	);
	const uncertainDependency = await db
		.select()
		.from(factDependency)
		.where(eq(factDependency.dependentId, indeterminate.id));
	assert(
		uncertainDependency.some((item) => item.detachedAt === null),
		"Indeterminate run must retain dependency evidence.",
	);
	const afterIndeterminate = await getFactLockState(actorA, fixtureA.projectId);
	assert(
		afterIndeterminate.latestRequest?.id === indeterminate.id &&
			afterIndeterminate.latestApplicableRun?.id === concurrentRun.id,
		"Indeterminate request must not replace the latest usable passed run.",
	);

	const reviewRun = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_review` },
		config,
	);
	const review = await runPreparedFactLock(
		actorA,
		reviewRun,
		fakeProvider(needsReviewOutput()),
	);
	assert(
		review.status === "review_required" &&
			review.claims[0]?.reviewStatus === "UNRESOLVED",
		"NEEDS_REVIEW was not persisted as review_required/unresolved.",
	);
	const reviewClaimRow = (
		await db
			.select()
			.from(factLockClaim)
			.where(eq(factLockClaim.runId, reviewRun.id))
			.limit(1)
	)[0];
	assert(reviewClaimRow, "Review claim fixture was not persisted.");
	const reviewedAt = new Date();
	await db
		.update(factLockClaim)
		.set({
			reviewStatus: "MANUAL_APPROVED",
			reviewedByUserId: userAId,
			reviewedAt,
			reviewNote: "Đã đối chiếu nguồn chính thức.",
		})
		.where(eq(factLockClaim.id, reviewClaimRow.id));
	const approvedReviewClaim = (
		await db
			.select()
			.from(factLockClaim)
			.where(eq(factLockClaim.id, reviewClaimRow.id))
			.limit(1)
	)[0];
	assert(
		approvedReviewClaim?.reviewStatus === "MANUAL_APPROVED" &&
			approvedReviewClaim.reviewedByUserId === userAId &&
			approvedReviewClaim.reviewedAt !== null,
		"Manual review metadata did not persist.",
	);
	await expectDbFailure(() =>
		db
			.update(factLockClaim)
			.set({ reviewedByUserId: null, reviewedAt: null })
			.where(eq(factLockClaim.id, reviewClaimRow.id)),
	);
	await expectDbFailure(() =>
		db
			.update(factLockClaim)
			.set({ classificationStatus: "UNSUPPORTED" })
			.where(eq(factLockClaim.id, reviewClaimRow.id)),
	);
	await expectDbFailure(() =>
		db
			.update(factLockClaim)
			.set({ classificationStatus: "PROHIBITED" })
			.where(eq(factLockClaim.id, reviewClaimRow.id)),
	);
	await db
		.update(factLockClaim)
		.set({
			classificationStatus: "SUPPORTED",
			reviewStatus: "AUTO_PASSED",
			reviewedByUserId: null,
			reviewedAt: null,
			reviewNote: null,
		})
		.where(eq(factLockClaim.id, reviewClaimRow.id));
	await expectDbFailure(() =>
		db
			.update(factLockClaim)
			.set({ reviewedByUserId: userAId, reviewedAt })
			.where(eq(factLockClaim.id, reviewClaimRow.id)),
	);
	await expectDbFailure(() =>
		db
			.update(factLockClaim)
			.set({ reviewStatus: "UNRESOLVED" })
			.where(eq(factLockClaim.id, reviewClaimRow.id)),
	);
	await db
		.update(factLockClaim)
		.set({ classificationStatus: "NEEDS_REVIEW", reviewStatus: "UNRESOLVED" })
		.where(eq(factLockClaim.id, reviewClaimRow.id));

	await db.insert(productFact).values([
		{
			id: fixtureA.multiFactAId,
			workspaceId: workspaceAId,
			productId: fixtureA.productId,
			revision: 2,
			content: "Vỏ nhôm chắc chắn.",
			type: "specification",
			status: "verified",
			sourceType: "official",
			sourceLabel: "Integration source A",
			sourceUrl: "https://example.com/fact-a",
			confirmedAt: "2026-08-15",
			createdByUserId: userAId,
			updatedByUserId: userAId,
		},
		{
			id: fixtureA.multiFactBId,
			workspaceId: workspaceAId,
			productId: fixtureA.productId,
			revision: 7,
			content: "Có hộp sạc nhỏ gọn.",
			type: "feature",
			status: "verified",
			sourceType: "official",
			sourceLabel: "Integration source B",
			sourceUrl: "https://example.com/fact-b",
			confirmedAt: "2026-08-15",
			createdByUserId: userAId,
			updatedByUserId: userAId,
		},
	]);
	const multiRevisionRun = await prepareFactLockRun(
		actorA,
		{
			projectId: fixtureA.projectId,
			idempotencyKey: `${prefix}_multi_revision`,
		},
		config,
	);
	const multiRevisionResult = await runPreparedFactLock(
		actorA,
		multiRevisionRun,
		fakeProvider(
			supportedOutput([
				{ factId: fixtureA.multiFactAId, relation: "supports" },
				{ factId: fixtureA.multiFactBId, relation: "supports" },
			]),
		),
	);
	const multiMappings = multiRevisionResult.claims[0]?.factMappings ?? [];
	assert(
		multiRevisionResult.status === "passed" &&
			multiMappings.some(
				(mapping) =>
					mapping.factId === fixtureA.multiFactAId &&
					mapping.factRevision === 2,
			) &&
			multiMappings.some(
				(mapping) =>
					mapping.factId === fixtureA.multiFactBId &&
					mapping.factRevision === 7,
			) &&
			!("factRevision" in (multiRevisionResult.claims[0] ?? {})),
		"Fact revisions were not preserved per mapping without a top-level claim revision.",
	);
	const relatedRun = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_related` },
		config,
	);
	const relatedResult = await runPreparedFactLock(
		actorA,
		relatedRun,
		fakeProvider(
			needsReviewOutput([
				{ factId: fixtureA.multiFactAId, relation: "related" },
			]),
		),
	);
	assert(
		relatedResult.claims[0]?.factMappings[0]?.relation === "related",
		"Canonical related relation did not persist/read back.",
	);
	const relatedClaimRow = (
		await db
			.select({ id: factLockClaim.id })
			.from(factLockClaim)
			.where(eq(factLockClaim.runId, relatedRun.id))
			.limit(1)
	)[0];
	const relatedMapping = relatedClaimRow
		? (
				await db
					.select()
					.from(factLockClaimFact)
					.where(eq(factLockClaimFact.claimId, relatedClaimRow.id))
					.limit(1)
			)[0]
		: undefined;
	if (relatedMapping) {
		await expectDbFailure(() =>
			db
				.update(factLockClaimFact)
				.set({ relation: "context" })
				.where(
					and(
						eq(factLockClaimFact.claimId, relatedMapping.claimId),
						eq(factLockClaimFact.factId, relatedMapping.factId),
						eq(factLockClaimFact.factRevision, relatedMapping.factRevision),
						eq(factLockClaimFact.relation, relatedMapping.relation),
					),
				),
		);
	}

	const raceRun = await prepareFactLockRun(
		actorA,
		{ projectId: fixtureA.projectId, idempotencyKey: `${prefix}_race` },
		config,
	);
	await db
		.update(scriptVersion)
		.set({
			revision: sql`${scriptVersion.revision} + 1`,
			updatedAt: new Date(),
		})
		.where(eq(scriptVersion.id, fixtureA.scriptVersionId));
	const raceResult = await runPreparedFactLock(
		actorA,
		raceRun,
		new DeterministicTextProvider({ factLockSnapshot: raceRun.inputSnapshot }),
	);
	assert(
		raceResult.status === "passed",
		"Race fixture did not persist historical result.",
	);
	const staleState = await getFactLockState(actorA, fixtureA.projectId);
	assert(
		staleState.latestRequest?.effectiveStatus === "stale",
		"Script revision race did not produce stale effective status.",
	);

	const persistedState = await getFactLockState(actorA, fixtureA.projectId);
	assert(
		persistedState.latestRequest?.id === staleState.latestRequest?.id,
		"Reopen did not return persisted latest request.",
	);
	await expectCode(
		() => getFactLockState(actorB, fixtureA.projectId),
		"FACT_LOCK_NOT_FOUND",
	);

	const currentFact = await db
		.select()
		.from(productFact)
		.where(eq(productFact.id, fixtureA.factId))
		.limit(1)
		.then((rows) => rows[0]);
	assert(currentFact, "Fact fixture disappeared before invalidation proof.");
	await import("../packages/api/src/services/product-fact-service.ts").then(
		({ updateProductFact }) =>
			updateProductFact(actorA, {
				id: fixtureA.factId,
				expectedRevision: currentFact.revision,
				data: {
					content: "Pin dùng 18 giờ trong một lần sạc.",
					type: "specification",
					status: "verified",
					sourceType: "official",
					sourceLabel: "Integration source",
					sourceUrl: "https://example.com/fact",
					confirmedAt: "2026-08-16",
					expiresAt: null,
					notes: null,
				},
				verificationIntent: "preserve",
			}),
	);
	const invalidatedState = await getFactLockState(actorA, fixtureA.projectId);
	assert(
		invalidatedState.latestRequest?.effectiveStatus === "stale",
		"Fact revision change did not invalidate the Fact Lock result.",
	);

	console.log("AFF-US-010 Fact Lock foundation integration checks passed.");
} finally {
	try {
		const runIds = (
			await db
				.select({ id: factLockRun.id })
				.from(factLockRun)
				.where(
					inArray(
						factLockRun.projectId,
						fixtures.map((fixture) => fixture.projectId),
					),
				)
		).map((row) => row.id);
		if (runIds.length > 0) {
			await db
				.delete(factInvalidationEvent)
				.where(inArray(factInvalidationEvent.dependentId, runIds));
			await db
				.delete(factDependency)
				.where(inArray(factDependency.dependentId, runIds));
			await db.delete(factLockRun).where(inArray(factLockRun.id, runIds));
		}
		await db.delete(productFactHistory).where(
			inArray(
				productFactHistory.productId,
				fixtures.map((fixture) => fixture.productId),
			),
		);
		await db.delete(productFact).where(
			inArray(
				productFact.id,
				fixtures.flatMap((fixture) => [
					fixture.factId,
					fixture.multiFactAId,
					fixture.multiFactBId,
				]),
			),
		);
		await db.delete(scriptVersion).where(
			inArray(
				scriptVersion.id,
				fixtures.map((fixture) => fixture.scriptVersionId),
			),
		);
		await db.delete(scriptGeneration).where(
			inArray(
				scriptGeneration.id,
				fixtures.map((fixture) => fixture.generationId),
			),
		);
		await db.delete(project).where(
			inArray(
				project.id,
				fixtures.map((fixture) => fixture.projectId),
			),
		);
		await db.delete(product).where(
			inArray(
				product.id,
				fixtures.map((fixture) => fixture.productId),
			),
		);
		await db
			.delete(outputRules)
			.where(eq(outputRules.workspaceId, workspaceAId));
		await db.delete(aiSettings).where(eq(aiSettings.workspaceId, workspaceAId));
		await db
			.delete(channelSettings)
			.where(eq(channelSettings.workspaceId, workspaceAId));
		await db
			.delete(workspaceMember)
			.where(inArray(workspaceMember.userId, [userAId, userBId]));
		await db
			.delete(workspace)
			.where(inArray(workspace.id, [workspaceAId, workspaceBId]));
		await db.delete(user).where(inArray(user.id, [userAId, userBId]));
	} catch (error) {
		console.error("Fact Lock integration cleanup failed.", error);
	}
}

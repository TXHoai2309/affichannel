import { randomUUID } from "node:crypto";
import { configureIntegrationEnvironment } from "./test-environment.ts";

configureIntegrationEnvironment();

const { eq, inArray } = await import("drizzle-orm");
const {
	db,
	aiSettings,
	channelSettings,
	contentBrief,
	factDependency,
	factInvalidationEvent,
	product,
	productFact,
	productFactHistory,
	project,
	scriptGeneration,
	user,
	workspace,
	workspaceMember,
} = await import("@affichannel/db");
const { ScriptGenerationError } = await import(
	"@affichannel/core/script-generation/errors"
);
const { DeterministicTextProvider } = await import(
	"../packages/api/src/providers/text/deterministic-text-provider.ts"
);
const {
	finalizeScriptGeneration,
	getScriptGenerationReadModel,
	markScriptGenerationIndeterminate,
	prepareScriptGeneration: prepareScriptGenerationService,
	runPreparedScriptGeneration,
} = await import("../packages/api/src/services/script-generation-service.ts");
const { updateProductFact } = await import(
	"../packages/api/src/services/product-fact-service.ts"
);

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
				error instanceof ScriptGenerationError && error.code === code,
				`Expected ${code}, received ${error?.code ?? error}.`,
			),
	);
}

const prefix = `US008_${Date.now()}_${randomUUID().slice(0, 8)}`;
const userAId = `${prefix}_user_a`;
const userBId = `${prefix}_user_b`;
const workspaceAId = `${prefix}_workspace_a`;
const workspaceBId = `${prefix}_workspace_b`;
const actorA = { workspaceId: workspaceAId, userId: userAId };
const actorB = { workspaceId: workspaceBId, userId: userBId };
const fixtures = [1, 2, 3].map((index) => ({
	productId: `${prefix}_product_${index}`,
	projectId: `${prefix}_project_${index}`,
	factId: `${prefix}_fact_${index}`,
}));
const recoveryFactId = `${prefix}_fact_recovery`;
const foundationConfig = {
	provider: "deterministic",
	model: "foundation-deterministic-v2",
	promptVersion: "script-prompt.v2",
	outputSchemaVersion: "script-draft.v2",
};
const prepareScriptGeneration = (
	actor: typeof actorA,
	input: Parameters<typeof prepareScriptGenerationService>[1],
	override: Partial<typeof foundationConfig> = {},
) =>
	prepareScriptGenerationService(actor, input, {
		...foundationConfig,
		...override,
	});

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
		id: `${prefix}_channel_settings`,
		workspaceId: workspaceAId,
		niche: "Công nghệ",
		targetAudience: "Người dùng cần thiết bị audio",
		tone: "Tin cậy",
		contentPillar: "Review sản phẩm",
		defaultCta: "Xem thêm thông tin",
		affiliateDisclosure: "Nội dung có liên kết affiliate.",
		avoidWords: [],
		createdByUserId: userAId,
		updatedByUserId: userAId,
	});
	await db.insert(aiSettings).values({
		id: `${prefix}_ai_settings`,
		workspaceId: workspaceAId,
		textProvider: "deterministic",
		textModel: foundationConfig.model,
		createdByUserId: userAId,
		updatedByUserId: userAId,
	});
	for (const [index, fixture] of fixtures.entries()) {
		await db.insert(product).values({
			id: fixture.productId,
			workspaceId: workspaceAId,
			name: `${prefix} Product ${index + 1}`,
			category: "Audio",
			createdByUserId: userAId,
		});
		await db.insert(project).values({
			id: fixture.projectId,
			workspaceId: workspaceAId,
			name: `${prefix} Project ${index + 1}`,
			productId: fixture.productId,
			contentType: "AFFILIATE",
			creationPath: "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			currentStepKey: "product",
			createdByUserId: userAId,
		});
		await db.insert(contentBrief).values({
			id: randomUUID(),
			projectId: fixture.projectId,
			platform: "tiktok",
			goal: "Tạo chuyển đổi",
			durationSeconds: 30,
			angle: "Trải nghiệm thực tế",
			description: "  ",
		});
		await db.insert(productFact).values({
			id: fixture.factId,
			workspaceId: workspaceAId,
			productId: fixture.productId,
			revision: 1,
			content: "Pin dùng 20 giờ",
			type: "specification",
			status: "verified",
			sourceType: "official",
			sourceLabel: "Integration fixture source",
			sourceUrl: "https://example.com/integration-fact",
			confirmedAt: "2026-08-15",
			createdByUserId: userAId,
			updatedByUserId: userAId,
		});
	}

	const first = fixtures[0];
	const prepared = await prepareScriptGeneration(actorA, {
		projectId: first.projectId,
		idempotencyKey: `${prefix}_same`,
		mode: "full",
	});
	assert(
		prepared.status === "pending",
		"Preparation must create a pending generation.",
	);
	const configReplay = await prepareScriptGeneration(
		actorA,
		{
			projectId: first.projectId,
			idempotencyKey: `${prefix}_same`,
			mode: "full",
		},
		{ model: "server-config-b" },
	);
	assert(
		configReplay.id === prepared.id && configReplay.model === prepared.model,
		"Server config changes must not break an idempotent replay.",
	);
	await expectCode(
		() =>
			prepareScriptGeneration(actorA, {
				projectId: fixtures[1].projectId,
				idempotencyKey: `${prefix}_same`,
				mode: "full",
			}),
		"IDEMPOTENCY_CONFLICT",
	);
	await expectCode(
		() =>
			prepareScriptGeneration(actorA, {
				projectId: first.projectId,
				idempotencyKey: `${prefix}_alternate`,
				mode: "full",
			}),
		"GENERATION_ALREADY_IN_PROGRESS",
	);

	const preparedDependency = await db
		.select()
		.from(factDependency)
		.where(eq(factDependency.dependentId, prepared.id));
	const preparedFact = prepared.inputSnapshot.facts.find(
		(fact) => fact.id === first.factId,
	);
	assert(
		preparedFact &&
			preparedDependency.length === 1 &&
			preparedDependency[0].factRevision === preparedFact.revision,
		"Snapshot and dependency revisions must be atomic and equal.",
	);

	const completed = await runPreparedScriptGeneration(
		actorA,
		prepared,
		new DeterministicTextProvider({ snapshot: prepared.inputSnapshot }),
	);
	assert(
		completed.status === "completed",
		"Deterministic provider must complete a valid generation.",
	);
	const finalizeAgain = await finalizeScriptGeneration(actorA, {
		generationId: prepared.id,
		outcome: { kind: "failure", code: "AI_PROVIDER_ERROR" },
	});
	assert(
		finalizeAgain.status === "completed",
		"Terminal generation must only finalize once.",
	);

	let finalizeCalls = 0;
	await runPreparedScriptGeneration(
		actorA,
		prepared,
		new DeterministicTextProvider({ snapshot: prepared.inputSnapshot }),
		async () => {
			finalizeCalls += 1;
			throw new Error("persistence failed");
		},
	).then(
		() => {
			throw new Error("Finalize persistence failure must propagate.");
		},
		(error) =>
			assert(
				error instanceof Error &&
					error.message === "persistence failed" &&
					finalizeCalls === 1,
				"Finalize error was normalized or retried.",
			),
	);

	const partial = await prepareScriptGeneration(actorA, {
		projectId: first.projectId,
		idempotencyKey: `${prefix}_partial`,
		mode: "full",
	});
	const partialResult = await runPreparedScriptGeneration(
		actorA,
		partial,
		new DeterministicTextProvider({
			snapshot: partial.inputSnapshot,
			scenario: "partial",
		}),
	);
	assert(
		partialResult.status === "partial" &&
			partialResult.invalidSections.includes("voiceover") &&
			partialResult.invalidSections.includes("scenes") &&
			partialResult.invalidSections.includes("claims"),
		"Partial parent fixture was not created.",
	);
	const parentBeforeRepair = JSON.stringify(partialResult.output);
	const repair = await prepareScriptGeneration(actorA, {
		projectId: first.projectId,
		idempotencyKey: `${prefix}_repair`,
		mode: "repair",
		parentGenerationId: partial.id,
		repairSections: ["voiceover", "scenes", "claims"],
	});
	const repaired = await runPreparedScriptGeneration(
		actorA,
		repair,
		new DeterministicTextProvider({ snapshot: repair.inputSnapshot }),
	);
	assert(
		repaired.status === "completed" &&
			repaired.parentGenerationId === partial.id &&
			repaired.output?.voiceoverSegments?.length === 2 &&
			JSON.stringify(partialResult.output) === parentBeforeRepair,
		"Repair did not create an immutable merged child.",
	);
	await expectCode(
		() =>
			prepareScriptGeneration(actorA, {
				projectId: first.projectId,
				idempotencyKey: `${prefix}_bad_repair`,
				mode: "repair",
				parentGenerationId: partial.id,
				repairSections: ["hook"],
			}),
		"INVALID_REPAIR_SECTIONS",
	);

	const readAfterRepair = await getScriptGenerationReadModel(
		actorA,
		first.projectId,
	);
	assert(
		readAfterRepair.latestUsableArtifact?.id === repair.id,
		"Latest usable artifact must be the repaired child.",
	);
	const currentFact = await db
		.select()
		.from(productFact)
		.where(eq(productFact.id, first.factId))
		.limit(1)
		.then((rows) => rows[0]);
	assert(currentFact, "Fixture Fact disappeared before invalidation test.");
	await updateProductFact(actorA, {
		id: first.factId,
		expectedRevision: currentFact.revision,
		data: {
			content: "Pin dùng 18 giờ",
			type: "specification",
			status: "verified",
			sourceType: null,
			sourceLabel: null,
			sourceUrl: null,
			confirmedAt: null,
			expiresAt: null,
			notes: null,
		},
		verificationIntent: "preserve",
	});
	const readAfterInvalidation = await getScriptGenerationReadModel(
		actorA,
		first.projectId,
	);
	assert(
		readAfterInvalidation.dependencyState?.state === "invalidated",
		"Fact update must invalidate the generation dependency.",
	);
	await expectCode(
		() =>
			prepareScriptGeneration(actorA, {
				projectId: first.projectId,
				idempotencyKey: `${prefix}_invalidated_repair`,
				mode: "repair",
				parentGenerationId: partial.id,
				repairSections: ["voiceover"],
			}),
		"BASE_GENERATION_INVALIDATED",
	);
	await db.insert(productFact).values({
		id: recoveryFactId,
		workspaceId: workspaceAId,
		productId: first.productId,
		revision: 1,
		content: "Có chế độ chống ồn chủ động",
		type: "feature",
		status: "verified",
		sourceType: "official",
		sourceLabel: "Integration recovery fixture",
		sourceUrl: "https://example.com/integration-recovery-fact",
		confirmedAt: "2026-08-15",
		createdByUserId: userAId,
		updatedByUserId: userAId,
	});

	const second = fixtures[1];
	const differentKeyRace = await Promise.allSettled([
		prepareScriptGeneration(actorA, {
			projectId: second.projectId,
			idempotencyKey: `${prefix}_race_a`,
			mode: "full",
		}),
		prepareScriptGeneration(actorA, {
			projectId: second.projectId,
			idempotencyKey: `${prefix}_race_b`,
			mode: "full",
		}),
	]);
	assert(
		differentKeyRace.filter((result) => result.status === "fulfilled")
			.length === 1,
		"Different-key concurrency must have exactly one winner.",
	);
	assert(
		differentKeyRace.filter(
			(result) =>
				result.status === "rejected" &&
				result.reason instanceof ScriptGenerationError &&
				result.reason.code === "GENERATION_ALREADY_IN_PROGRESS",
		).length === 1,
		"Different-key concurrency must block exactly one request.",
	);
	const pendingRows = await db
		.select()
		.from(scriptGeneration)
		.where(eq(scriptGeneration.projectId, second.projectId));
	assert(
		pendingRows.filter((row) => row.status === "pending").length === 1,
		"Different-key race must leave exactly one pending row.",
	);
	const raceWinner = differentKeyRace.find(
		(result): result is PromiseFulfilledResult<typeof prepared> =>
			result.status === "fulfilled",
	)?.value;
	assert(raceWinner, "Race winner is missing.");
	await runPreparedScriptGeneration(
		actorA,
		raceWinner,
		new DeterministicTextProvider({ snapshot: raceWinner.inputSnapshot }),
	);

	const third = fixtures[2];
	const sameKeyRace = await Promise.all([
		prepareScriptGeneration(actorA, {
			projectId: third.projectId,
			idempotencyKey: `${prefix}_same_race`,
			mode: "full",
		}),
		prepareScriptGeneration(actorA, {
			projectId: third.projectId,
			idempotencyKey: `${prefix}_same_race`,
			mode: "full",
		}),
	]);
	assert(
		sameKeyRace[0].id === sameKeyRace[1].id,
		"Same-key concurrency must resolve to one generation ID.",
	);
	const sameKeyRows = await db
		.select()
		.from(scriptGeneration)
		.where(eq(scriptGeneration.projectId, third.projectId));
	const sameKeyDependencies = await db
		.select()
		.from(factDependency)
		.where(eq(factDependency.dependentId, sameKeyRace[0].id));
	assert(
		sameKeyRows.length === 1 && sameKeyDependencies.length === 1,
		"Same-key concurrency must create one artifact and one dependency set.",
	);

	const pendingAfterUsable = await prepareScriptGeneration(actorA, {
		projectId: first.projectId,
		idempotencyKey: `${prefix}_read_pending`,
		mode: "full",
	});
	const readPending = await getScriptGenerationReadModel(
		actorA,
		first.projectId,
	);
	assert(
		readPending.latestRequest?.id === pendingAfterUsable.id &&
			readPending.latestUsableArtifact?.id === repair.id,
		"Read model must separate latest pending request from latest usable artifact.",
	);
	const failed = await runPreparedScriptGeneration(
		actorA,
		pendingAfterUsable,
		new DeterministicTextProvider({
			snapshot: pendingAfterUsable.inputSnapshot,
			scenario: "malformed",
		}),
	);
	const failedDependencies = await db
		.select()
		.from(factDependency)
		.where(eq(factDependency.dependentId, failed.id));
	assert(
		failed.status === "failed" &&
			failedDependencies.every((dependency) => dependency.detachedAt !== null),
		"Failed generation must detach dependencies.",
	);

	const indeterminate = await prepareScriptGeneration(actorA, {
		projectId: second.projectId,
		idempotencyKey: `${prefix}_indeterminate`,
		mode: "full",
	});
	await expectCode(
		() =>
			markScriptGenerationIndeterminate(actorA, indeterminate.id, {
				expectedCreatedAt: indeterminate.createdAt,
				staleBefore: new Date(indeterminate.createdAt.getTime() - 1),
			}),
		"GENERATION_NOT_STALE",
	);
	const marked = await markScriptGenerationIndeterminate(
		actorA,
		indeterminate.id,
		{ expectedCreatedAt: indeterminate.createdAt, staleBefore: new Date() },
	);
	const indeterminateDependencies = await db
		.select()
		.from(factDependency)
		.where(eq(factDependency.dependentId, marked.id));
	assert(
		marked.status === "indeterminate" &&
			indeterminateDependencies.some(
				(dependency) => dependency.detachedAt === null,
			),
		"Indeterminate generation must retain dependencies.",
	);

	await expectCode(
		() => getScriptGenerationReadModel(actorB, first.projectId),
		"GENERATION_NOT_FOUND",
	);
	await expectCode(
		() =>
			prepareScriptGeneration(actorB, {
				projectId: first.projectId,
				idempotencyKey: `${prefix}_cross_workspace`,
				mode: "repair",
				parentGenerationId: partial.id,
				repairSections: ["voiceover"],
			}),
		"GENERATION_NOT_FOUND",
	);

	console.log("US008 script-generation foundation integration checks passed.");
} finally {
	try {
		const generationRows = await db
			.select({ id: scriptGeneration.id })
			.from(scriptGeneration)
			.where(
				inArray(
					scriptGeneration.projectId,
					fixtures.map((fixture) => fixture.projectId),
				),
			);
		const generationIds = generationRows.map((row) => row.id);
		if (generationIds.length > 0) {
			await db
				.delete(factInvalidationEvent)
				.where(inArray(factInvalidationEvent.dependentId, generationIds));
			await db
				.delete(factDependency)
				.where(inArray(factDependency.dependentId, generationIds));
			await db
				.delete(scriptGeneration)
				.where(inArray(scriptGeneration.id, generationIds));
		}
		await db.delete(productFactHistory).where(
			inArray(
				productFactHistory.productId,
				fixtures.map((fixture) => fixture.productId),
			),
		);
		await db
			.delete(productFact)
			.where(
				inArray(productFact.id, [
					...fixtures.map((fixture) => fixture.factId),
					recoveryFactId,
				]),
			);
		await db.delete(contentBrief).where(
			inArray(
				contentBrief.projectId,
				fixtures.map((fixture) => fixture.projectId),
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
			.delete(aiSettings)
			.where(inArray(aiSettings.workspaceId, [workspaceAId, workspaceBId]));
		await db
			.delete(channelSettings)
			.where(
				inArray(channelSettings.workspaceId, [workspaceAId, workspaceBId]),
			);
		await db
			.delete(workspaceMember)
			.where(inArray(workspaceMember.userId, [userAId, userBId]));
		await db
			.delete(workspace)
			.where(inArray(workspace.id, [workspaceAId, workspaceBId]));
		await db.delete(user).where(inArray(user.id, [userAId, userBId]));
	} catch (error) {
		console.error(
			"Integration cleanup skipped because the configured DB driver could not connect.",
			error,
		);
	}
}

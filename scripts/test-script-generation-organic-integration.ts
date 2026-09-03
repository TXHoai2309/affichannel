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
	project,
	scriptGeneration,
	scriptVersion,
	user,
	workspace,
	workspaceMember,
} = await import("@affichannel/db");
const { ScriptGenerationError } = await import("@affichannel/core");
const { DeterministicTextProvider } = await import(
	"../packages/api/src/providers/text/deterministic-text-provider.ts"
);
const {
	prepareScriptGeneration,
	runPreparedScriptGeneration,
	getScriptGenerationReadModel,
} = await import("../packages/api/src/services/script-generation-service.ts");
const { initializeScriptVersion, autosaveScriptVersion } = await import(
	"../packages/api/src/services/script-version-service.ts"
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

const prefix = `US019B_${Date.now()}_${randomUUID().slice(0, 8)}`;
const userId = `${prefix}_user`;
const workspaceId = `${prefix}_workspace`;
const actor = { workspaceId, userId };
const storyProjectId = `${prefix}_story`;
const tipsProjectId = `${prefix}_tips`;
const zeroProjectId = `${prefix}_zero`;
const productProposalProjectId = `${prefix}_product_proposal`;
const unsupportedProjectId = `${prefix}_unsupported`;
const organicWithProductProjectId = `${prefix}_organic_with_product`;
const affiliateNoProductProjectId = `${prefix}_affiliate_no_product`;
const productId = `${prefix}_product`;
const config = {
	provider: "deterministic",
	model: "organic-integration-v3",
	promptVersion: "script-prompt.v2",
	outputSchemaVersion: "script-draft.v2",
};

function input(
	projectId: string,
	key: string,
	mode: "full" | "repair" = "full",
) {
	return { projectId, idempotencyKey: `${prefix}_${key}`, mode } as const;
}

try {
	await db.insert(workspace).values({ id: workspaceId, name: prefix });
	await db.insert(user).values({
		id: userId,
		name: prefix,
		email: `${userId}@example.test`,
		emailVerified: true,
	});
	await db
		.insert(workspaceMember)
		.values({ id: randomUUID(), workspaceId, userId });
	await db.insert(channelSettings).values({
		id: `${prefix}_channel`,
		workspaceId,
		niche: "Học tập",
		targetAudience: "Người trẻ",
		tone: "Ấm áp",
		contentPillar: "Giá trị thực tế",
		defaultCta: "Theo dõi kênh",
		affiliateDisclosure: "Nội dung có liên kết affiliate.",
		avoidWords: [],
		createdByUserId: userId,
		updatedByUserId: userId,
	});
	await db.insert(aiSettings).values({
		id: `${prefix}_ai`,
		workspaceId,
		textProvider: "deterministic",
		textModel: config.model,
		createdByUserId: userId,
		updatedByUserId: userId,
	});

	const projects = [
		[
			storyProjectId,
			"Kể một câu chuyện ngắn về việc hình thành thói quen đọc sách mỗi tối.",
			"story",
		],
		[tipsProjectId, "3 mẹo tập trung khi học trong 30 phút.", "tips"],
		[
			zeroProjectId,
			"Video xây kênh chia sẻ trải nghiệm làm việc và học tập.",
			"zero",
		],
		[
			productProposalProjectId,
			"Nội dung giáo dục không có sản phẩm.",
			"product-proposal",
		],
		[unsupportedProjectId, "Không hỗ trợ.", "unsupported"],
		[
			organicWithProductProjectId,
			"Organic có sản phẩm chưa được mở.",
			"organic-product",
		],
		[
			affiliateNoProductProjectId,
			"Affiliate thiếu sản phẩm.",
			"affiliate-no-product",
		],
	] as const;
	await db.insert(product).values({
		id: productId,
		workspaceId,
		name: "Không nên xuất hiện",
		category: "Test",
		createdByUserId: userId,
	});
	for (const [id, description, key] of projects) {
		await db.insert(project).values({
			id,
			workspaceId,
			name: key,
			productId: key === "organic-product" ? productId : null,
			contentType: key === "affiliate-no-product" ? "AFFILIATE" : "ORGANIC",
			creationPath: key === "unsupported" ? "QUICK_IMAGE" : "SCRIPTED",
			contentFormatKey: "SCRIPTED_STANDARD",
			contentFormatVersion: 1,
			currentStepKey: "content",
			createdByUserId: userId,
		});
		await db.insert(contentBrief).values({
			id: randomUUID(),
			projectId: id,
			platform: "tiktok",
			goal: "Xây kênh",
			durationSeconds: 30,
			angle: "Chia sẻ điều hữu ích",
			description,
		});
	}

	const story = await prepareScriptGeneration(
		actor,
		input(storyProjectId, "story"),
		config,
	);
	assert(
		story.inputSnapshot.snapshotVersion === "script-input.v3" &&
			story.inputSnapshot.sourceMode === "ORGANIC_NO_PRODUCT",
		"Story fixture did not derive Organic v3 source mode.",
	);
	assert(
		story.inputSnapshot.product === undefined &&
			story.inputSnapshot.facts === undefined,
		"Organic snapshot contains Product/Product Facts.",
	);
	assert(
		story.promptVersion === "script-prompt.v3" &&
			story.outputSchemaVersion === "script-draft.v3",
		"Organic artifact versions are not v3.",
	);
	const storyDone = await runPreparedScriptGeneration(
		actor,
		story,
		new DeterministicTextProvider({ snapshot: story.inputSnapshot }),
	);
	assert(
		storyDone.status === "completed",
		"Storytelling Organic generation did not complete.",
	);
	const storyVersion = await initializeScriptVersion(actor, {
		projectId: storyProjectId,
		sourceGenerationId: storyDone.id,
	});
	assert(
		storyVersion.editableSnapshot.schemaVersion === "script-draft.v3" &&
			storyVersion.editableSnapshot.claimsStatus === "current",
		"Organic ScriptVersion was not initialized as v3/current.",
	);

	const tips = await prepareScriptGeneration(
		actor,
		input(tipsProjectId, "tips"),
		config,
	);
	const tipsDone = await runPreparedScriptGeneration(
		actor,
		tips,
		new DeterministicTextProvider({
			snapshot: tips.inputSnapshot,
			scenario: "organic_general_proposal",
		}),
	);
	assert(
		tipsDone.status === "completed" &&
			tipsDone.output?.claims?.[0] &&
			"subjectStatus" in tipsDone.output.claims[0] &&
			tipsDone.output.claims[0].subjectStatus === "NEEDS_CONFIRMATION",
		"GENERAL Organic proposal was auto-confirmed.",
	);
	const tipsVersion = await initializeScriptVersion(actor, {
		projectId: tipsProjectId,
		sourceGenerationId: tipsDone.id,
	});
	const submitted = {
		...tipsVersion.editableSnapshot,
		caption: "Đã chỉnh sửa caption.",
	};
	const autosaved = await autosaveScriptVersion(actor, {
		scriptVersionId: tipsVersion.id,
		baseRevision: tipsVersion.revision,
		editableSnapshot: submitted,
	});
	assert(
		autosaved.editableSnapshot.claims[0] &&
			"proposedSubject" in autosaved.editableSnapshot.claims[0],
		"Organic autosave dropped proposedSubject.",
	);

	const zero = await prepareScriptGeneration(
		actor,
		input(zeroProjectId, "zero"),
		config,
	);
	const zeroDone = await runPreparedScriptGeneration(
		actor,
		zero,
		new DeterministicTextProvider({
			snapshot: zero.inputSnapshot,
			scenario: "organic_zero_claims",
		}),
	);
	assert(
		zeroDone.status === "completed" && zeroDone.output?.claims?.length === 0,
		"Zero-claim Organic generation was not accepted.",
	);

	const negative = await prepareScriptGeneration(
		actor,
		input(productProposalProjectId, "product-proposal"),
		config,
	);
	const negativeDone = await runPreparedScriptGeneration(
		actor,
		negative,
		new DeterministicTextProvider({
			snapshot: negative.inputSnapshot,
			scenario: "organic_product_proposal",
		}),
	);
	assert(
		negativeDone.status === "failed" &&
			negativeDone.errorCode?.includes("ORGANIC_PRODUCT_CLAIM_PROPOSAL"),
		"PRODUCT proposal was not rejected fail-closed.",
	);
	assert(
		(await getScriptGenerationReadModel(actor, productProposalProjectId))
			.latestUsableArtifact === null,
		"Rejected PRODUCT proposal became usable.",
	);

	await expectCode(
		() =>
			prepareScriptGeneration(
				actor,
				input(affiliateNoProductProjectId, "affiliate-no-product"),
				config,
			),
		"GENERATION_NOT_FOUND",
	);
	await expectCode(
		() =>
			prepareScriptGeneration(
				actor,
				input(unsupportedProjectId, "unsupported"),
				config,
			),
		"ORGANIC_SOURCE_NOT_SUPPORTED",
	);
	await expectCode(
		() =>
			prepareScriptGeneration(
				actor,
				input(organicWithProductProjectId, "organic-product"),
				config,
			),
		"ORGANIC_SOURCE_NOT_SUPPORTED",
	);

	const partial = await prepareScriptGeneration(
		actor,
		input(storyProjectId, "story-partial"),
		config,
	);
	const partialDone = await runPreparedScriptGeneration(
		actor,
		partial,
		new DeterministicTextProvider({
			snapshot: partial.inputSnapshot,
			scenario: "partial",
		}),
	);
	assert(
		partialDone.status === "partial" &&
			partialDone.inputSnapshot.sourceMode === "ORGANIC_NO_PRODUCT",
		"Organic partial fixture did not remain v3.",
	);
	const repair = await prepareScriptGeneration(
		actor,
		{
			projectId: storyProjectId,
			idempotencyKey: `${prefix}_story_repair`,
			mode: "repair",
			parentGenerationId: partial.id,
			repairSections: partialDone.invalidSections,
		},
		config,
	);
	const repaired = await runPreparedScriptGeneration(
		actor,
		repair,
		new DeterministicTextProvider({ snapshot: repair.inputSnapshot }),
	);
	assert(
		repaired.status === "completed" &&
			repaired.inputSnapshot.sourceMode === "ORGANIC_NO_PRODUCT" &&
			repaired.output?.schemaVersion === "script-draft.v3",
		"Organic repair switched source semantics.",
	);

	console.log(
		"AFF-US-019 19B Organic ScriptGeneration integration checks passed.",
	);
} finally {
	try {
		const projectIds = projectsForCleanup();
		await db
			.delete(scriptVersion)
			.where(inArray(scriptVersion.projectId, projectIds));
		const generationRows = await db
			.select({ id: scriptGeneration.id })
			.from(scriptGeneration)
			.where(inArray(scriptGeneration.projectId, projectIds));
		const generationIds = generationRows.map((row) => row.id);
		if (generationIds.length) {
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
		await db
			.delete(contentBrief)
			.where(inArray(contentBrief.projectId, projectIds));
		await db.delete(project).where(inArray(project.id, projectIds));
		await db.delete(product).where(eq(product.id, productId));
		await db.delete(aiSettings).where(eq(aiSettings.workspaceId, workspaceId));
		await db
			.delete(channelSettings)
			.where(eq(channelSettings.workspaceId, workspaceId));
		await db.delete(workspaceMember).where(eq(workspaceMember.userId, userId));
		await db.delete(workspace).where(eq(workspace.id, workspaceId));
		await db.delete(user).where(eq(user.id, userId));
	} catch (error) {
		console.error("Organic integration cleanup failed.", error);
	}
}

function projectsForCleanup() {
	return [
		storyProjectId,
		tipsProjectId,
		zeroProjectId,
		productProposalProjectId,
		unsupportedProjectId,
		organicWithProductProjectId,
		affiliateNoProductProjectId,
	];
}

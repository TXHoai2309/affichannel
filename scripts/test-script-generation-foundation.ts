import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), "apps/web/.env"), override: true });

if (process.env.AFF_US008_DATABASE_URL) {
	process.env.DATABASE_URL = process.env.AFF_US008_DATABASE_URL;
	process.env.DATABASE_URL_DIRECT = process.env.AFF_US008_DATABASE_URL;
}

const { eq, inArray, like } = await import("drizzle-orm");
const {
	db,
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
const { ScriptGenerationError } = await import("@affichannel/core/script-generation/errors");
const { DeterministicTextProvider } = await import("../packages/api/src/providers/text/deterministic-text-provider.ts");
const {
	getScriptGenerationReadModel,
	prepareScriptGeneration,
	runPreparedScriptGeneration,
} = await import("../packages/api/src/services/script-generation-service.ts");
const { updateProductFact } = await import("../packages/api/src/services/product-fact-service.ts");

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const prefix = `US008_${Date.now()}_${randomUUID().slice(0, 8)}`;
const userAId = `${prefix}_user_a`;
const userBId = `${prefix}_user_b`;
const workspaceAId = `${prefix}_workspace_a`;
const workspaceBId = `${prefix}_workspace_b`;
const productId = `${prefix}_product`;
const projectId = `${prefix}_project`;
const factId = `${prefix}_fact`;
const actorA = { workspaceId: workspaceAId, userId: userAId };
const actorB = { workspaceId: workspaceBId, userId: userBId };

try {
	await db.insert(workspace).values([
		{ id: workspaceAId, name: `${prefix} A` },
		{ id: workspaceBId, name: `${prefix} B` },
	]);
	await db.insert(user).values([
		{ id: userAId, name: `${prefix} A`, email: `${userAId}@example.test`, emailVerified: true },
		{ id: userBId, name: `${prefix} B`, email: `${userBId}@example.test`, emailVerified: true },
	]);
	await db.insert(workspaceMember).values([
		{ id: randomUUID(), workspaceId: workspaceAId, userId: userAId },
		{ id: randomUUID(), workspaceId: workspaceBId, userId: userBId },
	]);
	await db.insert(product).values({ id: productId, workspaceId: workspaceAId, name: `${prefix} Product`, category: "Audio", createdByUserId: userAId });
	await db.insert(project).values({ id: projectId, workspaceId: workspaceAId, name: `${prefix} Project`, productId, currentStepKey: "product", createdByUserId: userAId });
	await db.insert(contentBrief).values({ id: randomUUID(), projectId, platform: "tiktok", goal: "Tạo chuyển đổi", durationSeconds: 30, angle: "Trải nghiệm thực tế", description: "  " });
	await db.insert(productFact).values({ id: factId, workspaceId: workspaceAId, productId, revision: 1, content: "Pin dùng 20 giờ", type: "specification", status: "verified", createdByUserId: userAId, updatedByUserId: userAId });

	const prepared = await prepareScriptGeneration(actorA, { projectId, idempotencyKey: `${prefix}_same`, mode: "full" });
	assert(prepared.status === "pending", "Preparation must create a pending generation.");
	const sameRequest = await prepareScriptGeneration(actorA, { projectId, idempotencyKey: `${prefix}_same`, mode: "full" });
	assert(sameRequest.id === prepared.id, "Same idempotency request must return the same generation.");
	await prepareScriptGeneration(actorA, { projectId, idempotencyKey: `${prefix}_conflict`, mode: "full", model: "different-model" }).then(
		() => { throw new Error("Expected a pending-project conflict."); },
		(error) => assert(error instanceof ScriptGenerationError && error.code === "GENERATION_ALREADY_IN_PROGRESS", "Different key must be blocked while pending."),
	);

	const concurrent = await Promise.allSettled([
		prepareScriptGeneration(actorA, { projectId, idempotencyKey: `${prefix}_race_a`, mode: "full" }),
		prepareScriptGeneration(actorA, { projectId, idempotencyKey: `${prefix}_race_b`, mode: "full" }),
	]);
	assert(concurrent.filter((result) => result.status === "fulfilled").length === 0, "Existing pending row must block both concurrent alternate keys.");
	assert(concurrent.every((result) => result.status === "rejected" && result.reason instanceof ScriptGenerationError && result.reason.code === "GENERATION_ALREADY_IN_PROGRESS"), "Concurrent pending protection returned an unexpected result.");

	const provider = new DeterministicTextProvider({ snapshot: prepared.inputSnapshot });
	const completed = await runPreparedScriptGeneration(actorA, prepared, provider);
	assert(completed.status === "completed", "Deterministic provider must complete a valid generation.");
	const readAfterCompletion = await getScriptGenerationReadModel(actorA, projectId);
	assert(readAfterCompletion.latestUsableArtifact?.id === prepared.id && readAfterCompletion.dependencyState?.state === "current", "Latest read model or current dependency state is wrong.");

	const currentFact = await db.select().from(productFact).where(eq(productFact.id, factId)).limit(1).then((rows) => rows[0]);
	assert(currentFact, "Fixture Fact disappeared before invalidation test.");
	await updateProductFact(actorA, {
		id: factId,
		expectedRevision: currentFact.revision,
		data: { content: "Pin dùng 18 giờ", type: "specification", status: "verified", sourceType: null, sourceLabel: null, sourceUrl: null, confirmedAt: null, expiresAt: null, notes: null },
		verificationIntent: "preserve",
	});
	const readAfterInvalidation = await getScriptGenerationReadModel(actorA, projectId);
	assert(readAfterInvalidation.dependencyState?.state === "invalidated", "Fact update must invalidate the generation dependency.");

	await prepareScriptGeneration(actorA, { projectId, idempotencyKey: `${prefix}_repair`, mode: "repair", parentGenerationId: prepared.id, repairSections: ["claims"] }).then(
		() => { throw new Error("Expected repair from an invalidated parent to be blocked."); },
		(error) => assert(error instanceof ScriptGenerationError && error.code === "BASE_GENERATION_INVALIDATED", "Invalidated parent repair returned the wrong error."),
	);
	const crossWorkspaceRead = await getScriptGenerationReadModel(actorB, projectId);
	assert(crossWorkspaceRead.latestRequest === null, "Cross-workspace read must not disclose the generation.");

	console.log("US008 script-generation foundation integration checks passed.");
} finally {
	await db.delete(factInvalidationEvent).where(like(factInvalidationEvent.dependentId, `${prefix}%`));
	await db.delete(factDependency).where(like(factDependency.dependentId, `${prefix}%`));
	await db.delete(scriptGeneration).where(like(scriptGeneration.id, `${prefix}%`));
	await db.delete(productFactHistory).where(eq(productFactHistory.productId, productId));
	await db.delete(productFact).where(eq(productFact.id, factId));
	await db.delete(contentBrief).where(eq(contentBrief.projectId, projectId));
	await db.delete(project).where(eq(project.id, projectId));
	await db.delete(product).where(eq(product.id, productId));
	await db.delete(workspaceMember).where(inArray(workspaceMember.userId, [userAId, userBId]));
	await db.delete(workspace).where(inArray(workspace.id, [workspaceAId, workspaceBId]));
	await db.delete(user).where(inArray(user.id, [userAId, userBId]));
}

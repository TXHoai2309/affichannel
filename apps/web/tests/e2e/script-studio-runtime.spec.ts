import { createProject } from "@affichannel/core/project/project-service";
import {
	aiSettings,
	channelSettings,
	db,
	factDependency,
	factInvalidationEvent,
	outputRules,
	product,
	productFact,
	productFactHistory,
	project,
	scriptGeneration,
	user,
} from "@affichannel/db";
import { expect, type Page, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";

import { upsertAiSettings } from "../../../../packages/api/src/services/ai-settings-service";
import { upsertChannelSettings } from "../../../../packages/api/src/services/channel-settings-service";
import { upsertOutputRules } from "../../../../packages/api/src/services/output-rules-service";
import { createProductFact } from "../../../../packages/api/src/services/product-fact-service";
import { createProduct } from "../../../../packages/api/src/services/product-service";
import { createProjectRepository } from "../../../../packages/api/src/services/project-repository";
import { getWorkspaceActor } from "../../../../packages/api/src/services/workspace";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;

test.describe("AFF-US-008 final runtime integration", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("runs getState, estimate, deterministic generate, persistence, and reopen against Neon", async ({
		page,
	}) => {
		const fixture = await seedRuntimeFixture();
		try {
			await signIn(page);

			const stateResponsePromise = page.waitForResponse((response) =>
				response.url().includes("/api/rpc/scriptGeneration/getState"),
			);
			const estimateResponsePromise = page.waitForResponse((response) =>
				response.url().includes("/api/rpc/scriptGeneration/estimate"),
			);
			await page.goto(`/projects/${fixture.projectId}/content`);

			const stateResponse = await stateResponsePromise;
			const statePayload = await stateResponse.json();
			expect(stateResponse.ok()).toBeTruthy();
			expect(statePayload.json.context.project.name).toBe(fixture.projectName);
			expect(statePayload.json.context.product.name).toBe(fixture.productName);
			expect(statePayload.json.context.facts).toHaveLength(1);
			expect(statePayload.json.context.channelSettings).not.toBeNull();
			expect(statePayload.json.latestRequest).toBeNull();

			const estimateResponse = await estimateResponsePromise;
			const estimatePayload = await estimateResponse.json();
			const estimate = estimatePayload.json;
			expect(estimateResponse.ok()).toBeTruthy();
			expect(estimate.provider).toBe("apikeyfun");
			expect(estimate.model).toBe("claude-sonnet-4-6");
			expect(BigInt(estimate.estimatedCostMicros)).toBeGreaterThan(BigInt(0));
			expect(estimate.currency).toMatch(/^[A-Z]{3}$/);
			await expect(page.getByText("Chi phí ước tính")).toBeVisible();

			await upsertAiSettings(fixture.actor, {
				textProvider: "deterministic",
				textModel: "runtime-deterministic-v2",
			});

			await page
				.getByRole("button", { name: "Tạo kịch bản", exact: true })
				.first()
				.click();
			await expectScriptOutput(page, fixture.factContent);

			const [generation] = await db
				.select()
				.from(scriptGeneration)
				.where(eq(scriptGeneration.projectId, fixture.projectId));
			expect(generation).toBeTruthy();
			expect(generation.status).toBe("completed");
			expect(generation.provider).toBe("deterministic");
			expect(generation.outputJson).not.toBeNull();
			expect(generation.finishedAt).not.toBeNull();

			const snapshot = generation.inputSnapshotJson as {
				facts: Array<{ id: string; revision: number }>;
			};
			expect(
				snapshot.facts.map(({ id, revision }) => ({ id, revision })),
			).toEqual([{ id: fixture.factId, revision: fixture.factRevision }]);

			const dependencies = await db
				.select()
				.from(factDependency)
				.where(eq(factDependency.dependentId, generation.id));
			expect(dependencies).toHaveLength(1);
			expect(dependencies[0]).toMatchObject({
				productFactId: fixture.factId,
				factRevision: fixture.factRevision,
				dependentType: "script_generation",
				dependentId: generation.id,
				detachedAt: null,
				invalidatedAt: null,
			});

			const reopenedStatePromise = page.waitForResponse((response) =>
				response.url().includes("/api/rpc/scriptGeneration/getState"),
			);
			await page.reload();
			const reopenedState = await (await reopenedStatePromise).json();
			expect(reopenedState.json.latestUsableArtifact.id).toBe(generation.id);
			await expectScriptOutput(page, fixture.factContent);
		} finally {
			await cleanupRuntimeFixture(fixture);
		}
	});
});

type RuntimeFixture = {
	actor: { workspaceId: string; userId: string };
	projectId: string;
	productId: string;
	factId: string;
	factRevision: number;
	factContent: string;
	projectName: string;
	productName: string;
};

async function seedRuntimeFixture(): Promise<RuntimeFixture> {
	if (!fixedAccountEmail) throw new Error("E2E_AUTH_EMAIL is required.");
	const [fixedUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, fixedAccountEmail))
		.limit(1);
	if (!fixedUser) throw new Error("The fixed E2E account does not exist.");
	const actor = await getWorkspaceActor(fixedUser.id);
	if (!actor)
		throw new Error("The fixed E2E account has no internal workspace.");

	const existingSettings = await db
		.select({ id: channelSettings.id })
		.from(channelSettings)
		.where(eq(channelSettings.workspaceId, actor.workspaceId));
	const existingAiSettings = await db
		.select({ id: aiSettings.id })
		.from(aiSettings)
		.where(eq(aiSettings.workspaceId, actor.workspaceId));
	const existingOutputRules = await db
		.select({ id: outputRules.id })
		.from(outputRules)
		.where(eq(outputRules.workspaceId, actor.workspaceId));
	if (
		existingSettings.length > 0 ||
		existingAiSettings.length > 0 ||
		existingOutputRules.length > 0
	) {
		throw new Error(
			"Runtime fixture requires an empty Channel/AI/Output Settings workspace.",
		);
	}

	const suffix = Date.now().toString(36);
	const projectName = `US008 Runtime Project ${suffix}`;
	const productName = `US008 Runtime Product ${suffix}`;
	const factContent = "Pin dùng 20 giờ theo thông tin chính thức.";
	const productRecord = await createProduct(actor, {
		name: productName,
		category: "Audio",
		status: "active",
		thumbnailUrl: undefined,
		sourceUrl: undefined,
		affiliateUrl: undefined,
		priceAmount: null,
		currency: "VND",
	});
	const repository = createProjectRepository();
	const projectRecord = await createProject(repository, actor, {
		name: projectName,
		productId: productRecord.id,
		platform: "tiktok",
		goal: "Tạo nội dung review có thể kiểm chứng",
		durationSeconds: 30,
		angle: "Nêu trải nghiệm thực tế dựa trên Product Facts",
		description: "Fixture integration tự dọn sau khi kiểm tra.",
	});
	const fact = await createProductFact(actor, {
		productId: productRecord.id,
		data: {
			content: factContent,
			type: "specification",
			status: "verified",
			sourceType: "official",
			sourceLabel: "US008 runtime integration",
			sourceUrl: "https://example.com/us008-runtime-fact",
			confirmedAt: "2026-08-15",
			expiresAt: null,
			notes: null,
		},
	});

	await upsertChannelSettings(actor, {
		niche: "Công nghệ",
		targetAudience: "Người dùng cần tai nghe",
		tone: "Tin cậy, rõ ràng",
		contentPillar: "Review sản phẩm",
		defaultCta: "Xem thêm thông tin",
		affiliateDisclosure: "Nội dung có liên kết affiliate.",
		avoidWords: [],
	});
	await upsertOutputRules(actor, {
		language: "vi-VN",
		aspectRatio: "9:16",
		subtitleSafeArea: "standard",
		claimLimit: null,
		requireFinalCta: true,
	});
	await upsertAiSettings(actor, {
		textProvider: "apikeyfun",
		textModel: "claude-sonnet-4-6",
	});

	return {
		actor,
		projectId: projectRecord.id,
		productId: productRecord.id,
		factId: fact.id,
		factRevision: fact.revision,
		factContent,
		projectName,
		productName,
	};
}

async function cleanupRuntimeFixture(fixture: RuntimeFixture) {
	const [generationRows] = await Promise.all([
		db
			.select({ id: scriptGeneration.id })
			.from(scriptGeneration)
			.where(eq(scriptGeneration.projectId, fixture.projectId)),
	]);
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
	await db
		.delete(productFactHistory)
		.where(eq(productFactHistory.productId, fixture.productId));
	await db.delete(productFact).where(eq(productFact.id, fixture.factId));
	await db.delete(project).where(eq(project.id, fixture.projectId));
	await db.delete(product).where(eq(product.id, fixture.productId));
	await db
		.delete(aiSettings)
		.where(eq(aiSettings.workspaceId, fixture.actor.workspaceId));
	await db
		.delete(channelSettings)
		.where(eq(channelSettings.workspaceId, fixture.actor.workspaceId));
	await db
		.delete(outputRules)
		.where(eq(outputRules.workspaceId, fixture.actor.workspaceId));
}

async function expectScriptOutput(page: Page, factContent: string) {
	for (const heading of [
		"Hook variants",
		"Voiceover",
		"Scenes",
		"CTA",
		"Caption",
		"Hashtags",
		"Disclosure affiliate",
		"Candidate claims",
	]) {
		await expect(page.getByText(heading, { exact: true })).toBeVisible();
	}
	await expect(page.getByText("Chưa qua Fact Lock")).toBeVisible();
	await expect(
		page.getByLabel("Generated Script").getByText(factContent, { exact: true }),
	).toBeVisible();
}

async function signIn(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
}

import { randomUUID } from "node:crypto";
import { SCRIPT_OUTPUT_SCHEMA_VERSION } from "@affichannel/core";
import { createProject } from "@affichannel/core/project/project-service";
import {
	db,
	factDependency,
	factLockClaim,
	factLockClaimFact,
	factLockRun,
	product,
	productFact,
	productFactHistory,
	project,
	scriptGeneration,
	scriptVersion,
	user,
} from "@affichannel/db";
import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createProductFact } from "../../../../packages/api/src/services/product-fact-service";
import { createProduct } from "../../../../packages/api/src/services/product-service";
import { createProjectRepository } from "../../../../packages/api/src/services/project-repository";
import { getWorkspaceActor } from "../../../../packages/api/src/services/workspace";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;

test.describe("AFF-US-010 Fact Lock Review", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("loads the three-pane review, approves a claim, and reopens it", async ({
		page,
	}) => {
		const fixture = await seedReviewFixture();
		const consoleErrors: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		try {
			await signIn(page);
			const stateResponsePromise = page.waitForResponse((response) =>
				response.url().includes("/api/rpc/factLock/getState"),
			);
			await page.goto(`/projects/${fixture.projectId}/fact-lock`);
			const stateResponse = await stateResponsePromise;
			expect(stateResponse.ok()).toBeTruthy();
			await expect(
				page.getByRole("heading", { name: "Fact Lock Review" }),
			).toBeVisible();
			await expect(page.getByText("Claims trong script")).toBeVisible();
			await expect(page.getByText("Review claim")).toBeVisible();
			await expect(
				page.getByText("Product Facts", { exact: true }),
			).toBeVisible();
			await expect(page.getByText(fixture.factContent)).toBeVisible();
			await expect(
				page.getByText("Pin dùng 20 giờ trong một lần sạc.").first(),
			).toBeVisible();

			await page.getByRole("button", { name: "Duyệt thủ công" }).click();
			await expect(page.getByText("Đã duyệt claim thủ công")).toBeVisible();
			await expect(page.getByText("Đã duyệt thủ công").first()).toBeVisible();

			await page.reload();
			await expect(page.getByText("Đã duyệt thủ công").first()).toBeVisible();
			await expect(page.getByText("Đã kiểm tra").first()).toBeVisible();
			expect(consoleErrors).toEqual([]);
		} finally {
			await cleanupReviewFixture(fixture);
		}
	});

	test("shows actionable feedback when whole-field delete is unsafe", async ({
		page,
	}) => {
		const fixture = await seedReviewFixture();
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}/fact-lock`);
			await expect(
				page.getByRole("heading", { name: "Fact Lock Review" }),
			).toBeVisible();
			await page.getByRole("button", { name: "Xoá", exact: true }).click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Xoá claim" })
				.click();
			await expect(
				page.getByText(
					"Không thể xóa tự động an toàn. Hãy chỉnh sửa đoạn chứa claim.",
				),
			).toBeVisible();
			await expect(page.getByText("Đã xoá claim khỏi script")).toHaveCount(0);
			await expect(page.getByText("Review đã lỗi thời")).toHaveCount(0);
			await page.reload();
			await expect(page.getByText(fixture.factContent)).toBeVisible();
			await expect(
				page.getByText("Pin dùng 20 giờ trong một lần sạc.").first(),
			).toBeVisible();
		} finally {
			await cleanupReviewFixture(fixture);
		}
	});
});

type ReviewFixture = {
	actor: { workspaceId: string; userId: string };
	projectId: string;
	productId: string;
	factId: string;
	generationId: string;
	scriptVersionId: string;
	runId: string;
	claimId: string;
	factContent: string;
};

async function signIn(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.locator("form").getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
}

async function seedReviewFixture(): Promise<ReviewFixture> {
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

	const productRecord = await createProduct(actor, {
		name: `US010 Review Product ${Date.now()}`,
		category: "Audio",
		status: "active",
		thumbnailUrl: undefined,
		sourceUrl: undefined,
		affiliateUrl: undefined,
		priceAmount: null,
		currency: "VND",
	});
	const projectRecord = await createProject(createProjectRepository(), actor, {
		name: `US010 Review Project ${Date.now()}`,
		productId: productRecord.id,
		platform: "tiktok",
		goal: "Review claim",
		durationSeconds: 30,
		angle: "Đối chiếu Product Facts",
		description: "Fixture Fact Lock Review.",
	});
	const fact = await createProductFact(actor, {
		productId: productRecord.id,
		data: {
			content: "Pin dùng 20 giờ theo thông tin chính thức.",
			type: "specification",
			status: "verified",
			sourceType: "official",
			sourceLabel: "US010 fixture source",
			sourceUrl: "https://example.com/us010-fact",
			confirmedAt: "2026-08-15",
			expiresAt: null,
			notes: null,
		},
	});
	const generationId = randomUUID();
	const scriptVersionId = randomUUID();
	const runId = randomUUID();
	const claimId = randomUUID();
	const snapshot = {
		schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		language: "vi-VN",
		hookVariants: [{ key: "selected", text: "Tai nghe cho ngày dài." }],
		selectedHookKey: "selected",
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
		claimsSourceRevision: 1,
		claimsStatus: "current" as const,
	};
	await db.insert(scriptGeneration).values({
		id: generationId,
		workspaceId: actor.workspaceId,
		projectId: projectRecord.id,
		createdByUserId: actor.userId,
		idempotencyKey: `us010-e2e-${randomUUID()}`,
		requestHash: "a".repeat(64),
		mode: "full",
		provider: "deterministic",
		model: "us010-e2e",
		promptVersion: "us010-e2e",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshotJson: {},
		inputHash: "b".repeat(64),
		promptHash: "c".repeat(64),
		status: "completed",
		outputJson: snapshot,
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
		id: scriptVersionId,
		workspaceId: actor.workspaceId,
		projectId: projectRecord.id,
		sourceGenerationId: generationId,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: snapshot,
		revision: 1,
		createdByUserId: actor.userId,
	});
	const inputSnapshot = {
		snapshotVersion: "fact-lock-input.v1" as const,
		scriptVersion: { id: scriptVersionId, revision: 1, snapshot },
		productFacts: [
			{
				id: fact.id,
				revision: fact.revision,
				content: fact.content,
				type: fact.type,
				status: "verified" as const,
				assessment: "fresh" as const,
				generationUsability: "allowed" as const,
				source: {
					type: fact.sourceType,
					label: fact.sourceLabel,
					url: fact.sourceUrl,
					confirmedAt: fact.confirmedAt,
					expiresAt: fact.expiresAt,
				},
			},
		],
		policy: {
			avoidWords: [],
			affiliateDisclosure: "Nội dung có liên kết affiliate.",
			language: "vi-VN" as const,
		},
		outputRules: {
			language: "vi-VN" as const,
			aspectRatio: "9:16" as const,
			subtitleSafeArea: "standard" as const,
			claimLimit: null,
			requireFinalCta: true,
		},
	};
	await db.insert(factLockRun).values({
		id: runId,
		workspaceId: actor.workspaceId,
		projectId: projectRecord.id,
		scriptVersionId,
		sourceScriptRevision: 1,
		idempotencyKey: `us010-review-${randomUUID()}`,
		requestHash: "d".repeat(64),
		inputSnapshotJson: inputSnapshot,
		inputHash: "e".repeat(64),
		promptHash: "f".repeat(64),
		provider: "deterministic",
		model: "us010-e2e",
		promptVersion: "fact-lock-prompt.v1",
		outputSchemaVersion: "fact-lock-output.v1",
		status: "review_required",
		createdByUserId: actor.userId,
		finishedAt: new Date(),
	});
	await db.insert(factLockClaim).values({
		id: claimId,
		workspaceId: actor.workspaceId,
		runId,
		claimKey: "claim-review",
		claimText: "Pin dùng 20 giờ trong một lần sạc.",
		occurrenceJson: { section: "voiceover", segmentKey: "intro" },
		classificationStatus: "NEEDS_REVIEW",
		reviewStatus: "UNRESOLVED",
		reason: "Cần đối chiếu thêm với nguồn chính thức.",
		confidence: 0.9,
		suggestionText: "Pin được công bố ở mức 20 giờ.",
		checkedAt: new Date(),
	});
	await db.insert(factLockClaimFact).values({
		claimId,
		factId: fact.id,
		factRevision: fact.revision,
		relation: "supports",
	});
	await db.insert(factDependency).values({
		id: randomUUID(),
		workspaceId: actor.workspaceId,
		productFactId: fact.id,
		factRevision: fact.revision,
		dependentType: "fact_lock",
		dependentId: runId,
	});
	return {
		actor,
		projectId: projectRecord.id,
		productId: productRecord.id,
		factId: fact.id,
		generationId,
		scriptVersionId,
		runId,
		claimId,
		factContent: fact.content,
	};
}

async function cleanupReviewFixture(fixture: ReviewFixture) {
	await db
		.delete(factDependency)
		.where(eq(factDependency.dependentId, fixture.runId));
	await db.delete(factLockRun).where(eq(factLockRun.id, fixture.runId));
	await db
		.delete(productFactHistory)
		.where(eq(productFactHistory.productId, fixture.productId));
	await db.delete(productFact).where(eq(productFact.id, fixture.factId));
	await db
		.delete(scriptVersion)
		.where(eq(scriptVersion.id, fixture.scriptVersionId));
	await db
		.delete(scriptGeneration)
		.where(eq(scriptGeneration.id, fixture.generationId));
	await db.delete(project).where(eq(project.id, fixture.projectId));
	await db.delete(product).where(eq(product.id, fixture.productId));
}

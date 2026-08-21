import { randomUUID } from "node:crypto";
import { SCRIPT_OUTPUT_SCHEMA_VERSION } from "@affichannel/core";
import { createProject } from "@affichannel/core/project/project-service";
import {
	channelSettings,
	db,
	factDependency,
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
	voiceConfig,
} from "@affichannel/db";
import { expect, type Page, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { DeterministicTextProvider } from "../../../../packages/api/src/providers/text/deterministic-text-provider";
import {
	prepareFactLockRun,
	runPreparedFactLock,
} from "../../../../packages/api/src/services/fact-lock-service";
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

	test("opens Voice/Video/Preview only for a passed gate and relocks after script edit", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const fixture = await seedReviewFixture("passed");
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}/voice`, {
				waitUntil: "commit",
			});
			await expect(
				page.getByRole("heading", { name: "Giọng đọc" }),
			).toBeVisible();
			await expect(
				page.getByRole("heading", { name: "Voice Studio" }),
			).toBeVisible();
			await expect(page.getByText("Fact Lock đã đạt")).toBeVisible();
			await expect(page.getByText("Đã mở khóa")).toBeVisible();
			await expect(page.getByRole("radio", { name: /Ara/ })).toBeChecked();
			await expect(
				page.getByRole("slider", { name: "Tốc độ giọng đọc" }),
			).toHaveValue("1");

			await page.getByText("Eve", { exact: true }).click();
			await page.getByRole("slider", { name: "Tốc độ giọng đọc" }).fill("1.1");
			await expect(page.getByText("Chưa lưu", { exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Lưu cấu hình" }).click();
			await expect(
				page.getByText("Đã lưu", { exact: true }).first(),
			).toBeVisible();
			const [firstVoiceConfig] = await db
				.select()
				.from(voiceConfig)
				.where(eq(voiceConfig.projectId, fixture.projectId));
			expect(firstVoiceConfig?.voiceId).toBe("eve");
			expect(firstVoiceConfig?.language).toBe("vi");
			expect(firstVoiceConfig?.speed).toBeCloseTo(1.1);

			await page.reload({ waitUntil: "commit" });
			await expect(
				page.getByRole("heading", { name: "Voice Studio" }),
			).toBeVisible();
			await expect(page.getByRole("radio", { name: /Eve/ })).toBeChecked();
			await expect(
				page.getByRole("slider", { name: "Tốc độ giọng đọc" }),
			).toHaveValue("1.1");

			const firstPreviewResponse = page.waitForResponse(
				(response) =>
					response
						.url()
						.includes(`/projects/${fixture.projectId}/voice/preview`) &&
					response.request().method() === "POST",
			);
			await page.getByRole("button", { name: "Nghe thử" }).click();
			const firstPreview = await firstPreviewResponse;
			expect(firstPreview.status()).toBe(200);
			expect(firstPreview.headers()["content-type"]).toContain("audio/mpeg");
			await expect(
				page.locator('audio[aria-label="Bản nghe thử giọng đọc"]'),
			).toBeVisible();

			await page.getByText("Ara", { exact: true }).click();
			await expect(page.locator("audio")).toHaveCount(0);
			await expect(page.getByText("Chưa lưu", { exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Lưu cấu hình" }).click();
			await expect(
				page.getByText("Đã lưu", { exact: true }).first(),
			).toBeVisible();
			const secondPreviewResponse = page.waitForResponse(
				(response) =>
					response
						.url()
						.includes(`/projects/${fixture.projectId}/voice/preview`) &&
					response.request().method() === "POST",
			);
			await page.getByRole("button", { name: "Nghe thử" }).click();
			const secondPreview = await secondPreviewResponse;
			expect(secondPreview.status()).toBe(200);
			await expect(
				page.locator('audio[aria-label="Bản nghe thử giọng đọc"]'),
			).toBeVisible();
			await expect(
				page
					.getByRole("navigation", { name: "Các bước project" })
					.getByText("Có thể tiếp tục"),
			).toHaveCount(3);

			await openProjectStep(page, fixture.projectId, "video");
			await expect(
				page.getByRole("heading", { name: "Dựng video" }),
			).toBeVisible();
			await expect(page.getByText("Đã mở khóa")).toBeVisible();

			await openProjectStep(page, fixture.projectId, "preview");
			await expect(
				page.getByRole("heading", { name: "Preview & Render" }),
			).toBeVisible();
			await expect(page.getByText("Đã mở khóa")).toBeVisible();
			await page.reload({ waitUntil: "commit" });
			await expect(page.getByText("Đã mở khóa")).toBeVisible();

			await openProjectStep(page, fixture.projectId, "content");
			await page
				.getByLabel("Voiceover đoạn 1")
				.fill("Nội dung đã được chỉnh sửa để kiểm tra re-lock.");
			await expect(page.getByText("Đã lưu").first()).toBeVisible({
				timeout: 5_000,
			});

			await page.goto(`/projects/${fixture.projectId}/voice`, {
				waitUntil: "commit",
			});
			await expect(
				page.getByRole("heading", { name: "Voice Studio" }),
			).toHaveCount(0);
			await expect(page.getByText("Fact Lock đã cũ theo script")).toBeVisible();
			await expect(page.getByText("Đang khóa")).toBeVisible();
			await expect(
				page
					.getByRole("navigation", { name: "Các bước project" })
					.getByText("Bị khóa"),
			).toHaveCount(3);

			await openFactLockReview(page, fixture.projectId);
			await rerunDeterministicFactLock(fixture);
			await page.reload({ waitUntil: "commit" });
			await expect(page.getByText("Đã chạy Fact Lock")).toHaveCount(0);
			await openProjectStep(page, fixture.projectId, "voice");
			await expect(
				page.getByRole("heading", { name: "Voice Studio" }),
			).toBeVisible();
			await expect(page.getByText("Fact Lock đã đạt")).toBeVisible();
			await expect(page.getByText("Đã mở khóa")).toBeVisible();
			await expect(page.getByRole("radio", { name: /Ara/ })).toBeChecked();
			await expect(
				page.getByRole("slider", { name: "Tốc độ giọng đọc" }),
			).toHaveValue("1.1");
			const thirdPreviewResponse = page.waitForResponse(
				(response) =>
					response
						.url()
						.includes(`/projects/${fixture.projectId}/voice/preview`) &&
					response.request().method() === "POST",
			);
			await page.getByRole("button", { name: "Nghe thử" }).click();
			expect((await thirdPreviewResponse).status()).toBe(200);
			await expect(
				page.locator('audio[aria-label="Bản nghe thử giọng đọc"]'),
			).toBeVisible();
			await expect(
				page
					.getByRole("navigation", { name: "Các bước project" })
					.getByText("Hoàn thành"),
			).toHaveCount(3);
			await openProjectStep(page, fixture.projectId, "video");
			await expect(page.getByText("Đã mở khóa")).toBeVisible();
			await openProjectStep(page, fixture.projectId, "preview");
			await expect(page.getByText("Đã mở khóa")).toBeVisible();
			await page.reload({ waitUntil: "commit" });
			await expect(page.getByText("Đã mở khóa")).toBeVisible();
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
	createdChannelSettingsId: string | null;
	createdOutputRulesId: string | null;
	factContent: string;
	scriptSnapshot: Record<string, unknown>;
};

async function signIn(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.locator("form").getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
}

type ProjectFlowStep = "content" | "fact-lock" | "preview" | "video" | "voice";

async function openProjectStep(
	page: Page,
	projectId: string,
	stepKey: ProjectFlowStep,
) {
	const href = `/projects/${projectId}/${stepKey}`;
	const stepperLink = page
		.getByRole("navigation", { name: "Các bước project" })
		.locator(`a[href="${href}"]`);
	await Promise.all([
		page.waitForURL(new RegExp(`${projectId}/${stepKey}$`), {
			waitUntil: "commit",
		}),
		stepperLink.click(),
	]);
}

async function openFactLockReview(page: Page, projectId: string) {
	await openProjectStep(page, projectId, "fact-lock");
	await expect(
		page.getByRole("heading", { name: "Fact Lock Review" }),
	).toBeVisible();
}

async function seedReviewFixture(
	mode: "review_required" | "passed" = "review_required",
): Promise<ReviewFixture> {
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
	const [existingChannelSettings] = await db
		.select({ id: channelSettings.id })
		.from(channelSettings)
		.where(eq(channelSettings.workspaceId, actor.workspaceId))
		.limit(1);
	const [existingOutputRules] = await db
		.select({ id: outputRules.id })
		.from(outputRules)
		.where(eq(outputRules.workspaceId, actor.workspaceId))
		.limit(1);
	const createdChannelSettingsId = existingChannelSettings
		? null
		: randomUUID();
	const createdOutputRulesId = existingOutputRules ? null : randomUUID();
	if (createdChannelSettingsId) {
		await db.insert(channelSettings).values({
			id: createdChannelSettingsId,
			workspaceId: actor.workspaceId,
			niche: "Audio",
			targetAudience: "Người nghe nhạc",
			tone: "Tin cậy",
			contentPillar: "Review",
			defaultCta: "Xem thêm thông tin",
			affiliateDisclosure: "Nội dung có liên kết affiliate.",
			avoidWords: [],
			createdByUserId: actor.userId,
			updatedByUserId: actor.userId,
		});
	}
	if (createdOutputRulesId) {
		await db.insert(outputRules).values({
			id: createdOutputRulesId,
			workspaceId: actor.workspaceId,
			language: "vi-VN",
			aspectRatio: "9:16",
			subtitleSafeArea: "standard",
			claimLimit: null,
			requireFinalCta: true,
			createdByUserId: actor.userId,
			updatedByUserId: actor.userId,
		});
	}

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
		hookVariants: [
			{ key: "selected", text: "Tai nghe cho ngày dài." },
			{ key: "benefit", text: "Một lựa chọn cho ngày dài." },
			{ key: "problem", text: "Đang tìm tai nghe phù hợp?" },
		],
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
	const passed = mode === "passed";
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
		promptVersion: "fact-lock-prompt.v3",
		outputSchemaVersion: "fact-lock-output.v1",
		status: mode,
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
		classificationStatus: passed ? "SUPPORTED" : "NEEDS_REVIEW",
		reviewStatus: passed ? "AUTO_PASSED" : "UNRESOLVED",
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
		createdChannelSettingsId,
		createdOutputRulesId,
		factContent: fact.content,
		scriptSnapshot: snapshot,
	};
}

async function cleanupReviewFixture(fixture: ReviewFixture) {
	const runIds = (
		await db
			.select({ id: factLockRun.id })
			.from(factLockRun)
			.where(eq(factLockRun.projectId, fixture.projectId))
	).map((row) => row.id);
	if (runIds.length > 0) {
		await db
			.delete(factDependency)
			.where(inArray(factDependency.dependentId, runIds));
		await db.delete(factLockRun).where(inArray(factLockRun.id, runIds));
	}
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
	await db
		.delete(voiceConfig)
		.where(eq(voiceConfig.projectId, fixture.projectId));
	await db.delete(project).where(eq(project.id, fixture.projectId));
	await db.delete(product).where(eq(product.id, fixture.productId));
	if (fixture.createdOutputRulesId)
		await db
			.delete(outputRules)
			.where(eq(outputRules.id, fixture.createdOutputRulesId));
	if (fixture.createdChannelSettingsId)
		await db
			.delete(channelSettings)
			.where(eq(channelSettings.id, fixture.createdChannelSettingsId));
}

async function rerunDeterministicFactLock(fixture: ReviewFixture) {
	const prepared = await prepareFactLockRun(
		fixture.actor,
		{
			projectId: fixture.projectId,
			idempotencyKey: `us010-e2e-rerun-${randomUUID()}`,
		},
		{
			provider: "deterministic",
			model: "us010-e2e",
			promptVersion: "fact-lock-prompt.v3",
			outputSchemaVersion: "fact-lock-output.v1",
		},
	);
	const result = await runPreparedFactLock(
		fixture.actor,
		prepared,
		new DeterministicTextProvider({
			factLockSnapshot: prepared.inputSnapshot,
		}),
	);
	expect(result.status).toBe("passed");
	expect(result.sourceScriptRevision).toBe(2);
}

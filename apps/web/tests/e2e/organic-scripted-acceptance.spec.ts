import { randomUUID } from "node:crypto";
import {
	aiSettings,
	channelSettings,
	claimManifest,
	db,
	factLockRun,
	outputRules,
	product,
	productFact,
	productFactHistory,
	project,
	scriptClaimRefreshRun,
	scriptGeneration,
	scriptVersion,
	user,
	voiceConfig,
	voiceSegmentArtifact,
} from "@affichannel/db";
import { expect, type Page, test } from "@playwright/test";
import { desc, eq } from "drizzle-orm";
import { upsertAiSettings } from "../../../../packages/api/src/services/ai-settings-service";
import { upsertChannelSettings } from "../../../../packages/api/src/services/channel-settings-service";
import { upsertOutputRules } from "../../../../packages/api/src/services/output-rules-service";
import { createProductFact } from "../../../../packages/api/src/services/product-fact-service";
import { createProduct } from "../../../../packages/api/src/services/product-service";
import { createProjectRepository } from "../../../../packages/api/src/services/project-repository";
import { sha256Hex } from "../../../../packages/api/src/services/script-generation-hashing";
import { getWorkspaceActor } from "../../../../packages/api/src/services/workspace";
import { createProject } from "../../../../packages/core/src/project/project-service";
import { canonicalizeJson } from "../../../../packages/core/src/script-generation/canonical-json";
import {
	ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
	ORGANIC_SCRIPT_PROMPT_VERSION,
	ORGANIC_SCRIPT_SNAPSHOT_VERSION,
} from "../../../../packages/core/src/script-generation/policy";
import { scriptGenerationSections } from "../../../../packages/core/src/script-generation/types";
import type { ScriptVersionEditableSnapshot } from "../../../../packages/core/src/script-version/types";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;
const evidenceRoot =
	process.env.AFFICHANNEL_EVIDENCE_DIR ??
	"C:/Users/User/.codex/visualizations/2026/09/04/aff-us-019";
const consoleIssuesByPage = new WeakMap<Page, string[]>();

function attachConsoleAudit(page: Page) {
	const issues: string[] = [];
	consoleIssuesByPage.set(page, issues);
	page.on("console", (message) => {
		if (message.type() === "error") issues.push(message.text());
	});
	page.on("pageerror", (error) => issues.push(error.message));
	return issues;
}

async function captureEvidence(page: Page, name: string) {
	await (await import("node:fs/promises")).mkdir(evidenceRoot, {
		recursive: true,
	});
	await page.screenshot({
		path: `${evidenceRoot}/${name}.png`,
		fullPage: name === "organic-claimless-script-fixed",
	});
}

function assertNoBrowserErrors(page: Page) {
	expect(consoleIssuesByPage.get(page) ?? []).toEqual([]);
}

function assertNoPolicyAuthorityInRequests(
	requests: readonly { body: unknown }[],
) {
	const forbiddenKeys = new Set([
		"sourceMode",
		"builderVersion",
		"inputVersion",
		"skipFactLock",
		"factLockNotRequired",
		"productClaimState",
		"subjectStatus",
		"subjectSource",
	]);
	function visit(value: unknown): void {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (!value || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value)) {
			expect(forbiddenKeys.has(key)).toBe(false);
			if (typeof child === "string") {
				expect(child).not.toMatch(/^MANIFEST_V[12]$/u);
			}
			visit(child);
		}
	}
	for (const request of requests) visit(request.body);
}

test.describe("AFF-US-019 Phase 19E.2 Organic Scripted acceptance", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("creates Organic without Product, generates zero claims, and reaches Voice", async ({
		page,
	}) => {
		attachConsoleAudit(page);
		const fixture = await createSettingsFixture("claimless");
		let projectId: string | undefined;
		try {
			await signIn(page);
			await page.goto("/projects/new");
			await page.getByRole("radio", { name: "Organic" }).check();
			await page.getByLabel("Tên dự án").fill(fixture.projectName);
			await page.getByLabel("Mục tiêu").fill("Chia sẻ một thói quen hữu ích");
			await page.getByLabel("Góc tiếp cận").fill("Kể một trải nghiệm ngắn");

			const createResponsePromise = page.waitForResponse((response) =>
				response.url().includes("/api/rpc/project/create"),
			);
			await page.getByRole("button", { name: "Tạo dự án" }).click();
			const createResponse = await createResponsePromise;
			expect(createResponse.ok()).toBeTruthy();
			const created = (await createResponse.json()).json as {
				id: string;
				product: { id: string };
				contentType: string;
				creationPath: string;
				contentFormat: { ref: { key: string; version: number } };
				workflowEntry: { nextRouteKey: string };
			};
			projectId = created.id;
			expect(created.product.id).toBe("");
			expect(created.contentType).toBe("ORGANIC");
			expect(created.creationPath).toBe("SCRIPTED");
			expect(created.contentFormat.ref).toEqual({
				key: "SCRIPTED_STANDARD",
				version: 1,
			});
			expect(created.workflowEntry.nextRouteKey).toBe("content");
			await expect(page).toHaveURL(
				new RegExp(`/projects/${projectId}/content$`),
			);

			await expect(
				page.getByRole("heading", { name: "Script Studio" }),
			).toBeVisible();
			await expect(
				page.getByText(
					"Không bắt buộc cho nội dung Organic không gắn sản phẩm.",
				),
			).toBeVisible();
			await captureEvidence(page, "organic-claimless-content-desktop");
			const generateResponsePromise = page.waitForResponse((response) =>
				response.url().includes("/api/rpc/scriptGeneration/generate"),
			);
			await page
				.getByRole("button", { name: "Tạo kịch bản", exact: true })
				.first()
				.click();
			expect((await generateResponsePromise).ok()).toBeTruthy();
			await expect(
				page.getByRole("heading", { name: "Generated Script" }),
			).toBeVisible();
			await expect(page.getByText("Hoàn thành", { exact: true })).toBeVisible();
			await expect(
				page.getByText("Không có claim cần kiểm tra.", { exact: true }),
			).toBeVisible();
			await expect(
				page.getByText("Candidate claims · Chưa qua Fact Lock", {
					exact: true,
				}),
			).toHaveCount(0);
			await expect(
				page.getByText("Disclosure affiliate", { exact: true }),
			).toHaveCount(0);
			await captureEvidence(page, "organic-claimless-script-fixed");
			await expect(page.getByTestId("claim-subject-confirmation")).toHaveCount(
				0,
			);
			await page
				.getByRole("button", { name: /bắt đầu chỉnh sửa|chỉnh sửa/i })
				.first()
				.click();
			await expect(
				page.getByRole("button", { name: "Lưu phiên bản" }),
			).toBeVisible();

			const stateResponse = await page.request.post(
				"/api/rpc/project/getAdaptiveWorkflow",
				{
					data: { json: { id: projectId } },
				},
			);
			const workflow = (await stateResponse.json()).json;
			expect(step(workflow, "PRODUCT").applicabilityState).toBe("NOT_REQUIRED");
			expect(step(workflow, "FACT_LOCK").applicabilityState).toBe(
				"NOT_REQUIRED",
			);
			expect(step(workflow, "VOICE").navigable).toBe(true);

			await page.getByRole("link", { name: "Giọng đọc" }).click();
			await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/voice$`));
			await expect(
				page.getByRole("heading", { name: "Voice Studio" }),
			).toBeVisible();
			await page.getByRole("button", { name: "Lưu cấu hình" }).click();
			await expect(
				page.getByText("Đã lưu", { exact: true }).first(),
			).toBeVisible();
			const previewResponse = page.waitForResponse(
				(response) =>
					response.url().includes(`/projects/${projectId}/voice/preview`) &&
					response.request().method() === "POST",
			);
			await page.getByRole("button", { name: "Nghe thử" }).click();
			const previewResponseResult = await previewResponse;
			expect(previewResponseResult.status()).toBe(200);
			await expect(
				page.locator('audio[aria-label="Bản nghe thử giọng đọc"]'),
			).toBeVisible();
			const firstSegment = page.getByTestId("voice-segment-intro");
			await expect(
				firstSegment.getByRole("button", { name: "Tạo giọng đọc" }),
			).toBeEnabled();
			await firstSegment.getByRole("button", { name: "Tạo giọng đọc" }).click();
			await expect(firstSegment.getByText(/Đã tạo ·/)).toBeVisible({
				timeout: 30_000,
			});
			await page.reload();
			await expect(page.getByText(/Đã tạo ·/).first()).toBeVisible();
			assertNoBrowserErrors(page);
		} finally {
			if (projectId) await cleanupFixture(projectId, fixture.productId);
			else await cleanupSettings(fixture.actor.workspaceId);
		}
	});

	test("confirms PRODUCT proposal as GENERAL, keeps Product skipped, and survives F5", async ({
		page,
	}) => {
		const fixture = await seedOrganicFixture({
			label: "override-general",
			claims: [
				pendingClaim("Một thói quen nhỏ giúp bắt đầu ngày mới.", "PRODUCT"),
			],
		});
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}/content`);
			await expect(
				page.getByTestId("claim-subject-confirmation"),
			).toBeVisible();
			await expect(page.getByText("Đề xuất từ AI")).toBeVisible();
			await expect(
				page.getByText("Thông tin về sản phẩm").first(),
			).toBeVisible();
			const confirmationPromise = page.waitForRequest((request) =>
				request.url().includes("/api/rpc/scriptVersion/confirmClaimSubjects"),
			);
			await page.getByRole("radio", { name: "Thông tin chung" }).check();
			await page.getByRole("button", { name: "Xác nhận phạm vi" }).click();
			const confirmation = await confirmationPromise;
			const payload = confirmation.postDataJSON().json;
			expect(payload.decisions).toEqual([
				{ claimIndex: 0, subject: "GENERAL" },
			]);
			await expect(page.getByTestId("claim-subject-confirmation")).toHaveCount(
				0,
			);
			await expect(page.getByText("Đã lưu phạm vi claim")).toBeVisible();
			await expect(
				page.getByText("Không cần Fact Lock cho các claim hiện tại.", {
					exact: true,
				}),
			).toBeVisible();
			await page.reload();
			await expect(page.getByTestId("claim-subject-confirmation")).toHaveCount(
				0,
			);
			await expect(
				page.getByText("Không cần Fact Lock cho các claim hiện tại.", {
					exact: true,
				}),
			).toBeVisible();
			const workflow = await getWorkflow(page, fixture.projectId);
			expect(step(workflow, "PRODUCT").applicabilityState).toBe("NOT_REQUIRED");
			expect(step(workflow, "FACT_LOCK").applicabilityState).toBe(
				"NOT_REQUIRED",
			);
			expect(step(workflow, "VOICE").navigable).toBe(true);
		} finally {
			await cleanupFixture(fixture.projectId, fixture.productId);
		}
	});

	test("marks claim inventory stale after editing the claim-bearing Script and blocks Voice", async ({
		page,
	}) => {
		const fixture = await seedOrganicFixture({
			label: "edit-stale",
			claims: [
				pendingClaim("Một thói quen nhỏ giúp bắt đầu ngày mới.", "GENERAL"),
			],
		});
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}/content`);
			const panel = page.getByTestId("claim-subject-confirmation");
			await panel.getByRole("radio", { name: "Thông tin chung" }).check();
			await panel.getByRole("button", { name: "Xác nhận phạm vi" }).click();
			await expect(panel).toHaveCount(0);
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(
				page.getByRole("heading", { name: "Script Editor" }),
			).toBeVisible();
			await page
				.getByLabel("Voiceover đoạn 1")
				.fill("Nội dung đã chỉnh sửa để kiểm tra stale.");
			await expect(
				page.getByText("Claims cần cập nhật trước Fact Lock"),
			).toBeVisible({
				timeout: 15_000,
			});
			const workflow = await getWorkflow(page, fixture.projectId);
			expect(step(workflow, "FACT_LOCK").applicabilityState).toBe("STALE");
			expect(["STALE", "BLOCKED"]).toContain(
				step(workflow, "VOICE").applicabilityState,
			);
			await page.reload();
			await expect(page.getByTestId("refresh-claims-button")).toBeVisible();
		} finally {
			await cleanupFixture(fixture.projectId, fixture.productId);
		}
	});

	test("confirms PRODUCT, links a Product, runs subset Fact Lock, and reaches Voice", async ({
		page,
	}) => {
		const fixture = await seedOrganicFixture({
			label: "product-escalation",
			claims: [pendingClaim("Bình giữ lạnh 12 giờ.", "PRODUCT")],
			withProduct: true,
		});
		test.setTimeout(120_000);
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}/content`);
			await page.getByRole("radio", { name: "Thông tin về sản phẩm" }).check();
			await page.getByRole("button", { name: "Xác nhận phạm vi" }).click();
			await expect(page.getByTestId("claim-subject-confirmation")).toHaveCount(
				0,
			);
			await expect(
				page.getByText("Claims hiện tại đã sẵn sàng cho bước Fact Lock.", {
					exact: true,
				}),
			).toBeVisible();
			await expect
				.poll(
					async () =>
						(await getWorkflow(page, fixture.projectId)).steps.find(
							(item: { capability: string }) => item.capability === "PRODUCT",
						)?.applicabilityState,
				)
				.toBe("REQUIRED");

			await page.goto(`/projects/${fixture.projectId}/product`);
			await expect(
				page.getByText("Liên kết sản phẩm", { exact: true }).first(),
			).toBeVisible();
			await page
				.locator("#productId")
				.selectOption(fixture.productId as string);
			await page.getByRole("button", { name: "Liên kết sản phẩm" }).click();
			await expect(
				page.getByText(`Sản phẩm hiện tại: ${fixture.productName}`),
			).toBeVisible();
			await expect
				.poll(
					async () =>
						(await getWorkflow(page, fixture.projectId)).steps.find(
							(item: { capability: string }) => item.capability === "FACT_LOCK",
						)?.applicabilityState,
				)
				.toBe("READY");

			await page.goto(`/projects/${fixture.projectId}/fact-lock`);
			await expect(
				page.getByRole("heading", { name: "Fact Lock Review" }),
			).toBeVisible();
			await page.getByRole("button", { name: "Bắt đầu đối chiếu" }).click();
			await expect(page.getByText("Tự động đạt").first()).toBeVisible({
				timeout: 30_000,
			});
			await page.reload();
			await expect(page.getByText("Tự động đạt").first()).toBeVisible();
			await expect
				.poll(
					async () =>
						(await getWorkflow(page, fixture.projectId)).steps.find(
							(item: { capability: string }) => item.capability === "VOICE",
						)?.applicabilityState,
				)
				.toBe("READY");
		} finally {
			await cleanupFixture(fixture.projectId, fixture.productId);
		}
	});

	test("confirms mixed GENERAL/PRODUCT claims in one batch and locks only the Product subset", async ({
		page,
	}) => {
		attachConsoleAudit(page);
		const fixture = await seedOrganicFixture({
			label: "mixed-g-p-g-p",
			withProduct: true,
			claims: [
				pendingClaim("Một cách nhỏ để bắt đầu ngày mới.", "GENERAL", {
					section: "hook",
					hookKey: "hook",
				}),
				pendingClaim("Bình giữ lạnh 12 giờ.", "PRODUCT"),
				pendingClaim("Bạn có thể bắt đầu từ một bước rất nhỏ.", "GENERAL", {
					section: "voiceover",
					segmentKey: "tip",
				}),
				pendingClaim("Bình giữ lạnh 12 giờ.", "PRODUCT", {
					section: "caption",
				}),
			],
		});
		test.setTimeout(120_000);
		try {
			await signIn(page);
			await page.setViewportSize({ width: 390, height: 844 });
			const requests: Array<{
				url: string;
				method: string;
				body: unknown;
			}> = [];
			page.on("request", (request) => {
				if (request.method() !== "POST" || !request.url().includes("/api/rpc/"))
					return;
				let body: unknown;
				try {
					body = request.postDataJSON();
				} catch {
					return;
				}
				requests.push({ url: request.url(), method: request.method(), body });
			});
			await page.goto(`/projects/${fixture.projectId}/content`);
			const panel = page.getByTestId("claim-subject-confirmation");
			await expect(panel).toBeVisible();
			await panel.scrollIntoViewIfNeeded();
			await captureEvidence(page, "organic-claims-confirmation-mobile");
			const confirmButton = panel.getByRole("button", {
				name: "Xác nhận phạm vi",
			});
			await expect(confirmButton).toBeDisabled();
			await panel
				.getByRole("radiogroup", { name: "Chọn phạm vi cho claim 1" })
				.getByRole("radio", { name: "Thông tin chung" })
				.check();
			await expect(confirmButton).toBeDisabled();
			expect(
				requests.filter((item) =>
					item.url.includes("scriptVersion/confirmClaimSubjects"),
				).length,
			).toBe(0);
			const decisions = ["GENERAL", "PRODUCT", "GENERAL", "PRODUCT"] as const;
			for (const [index, subject] of decisions.entries()) {
				if (index === 0) continue;
				await panel
					.getByRole("radiogroup", {
						name: `Chọn phạm vi cho claim ${index + 1}`,
					})
					.getByRole("radio", {
						name:
							subject === "PRODUCT"
								? "Thông tin về sản phẩm"
								: "Thông tin chung",
					})
					.check();
			}
			await expect(confirmButton).toBeEnabled();
			const before = await db
				.select({ revision: scriptVersion.revision })
				.from(scriptVersion)
				.where(eq(scriptVersion.projectId, fixture.projectId))
				.limit(1);
			const confirmationResponse = page.waitForResponse((response) =>
				response.url().includes("/api/rpc/scriptVersion/confirmClaimSubjects"),
			);
			await confirmButton.click();
			const confirmation = await confirmationResponse;
			expect(confirmation.ok()).toBeTruthy();
			await expect(panel).toHaveCount(0);
			const confirmationRequests = requests.filter((item) =>
				item.url.includes("scriptVersion/confirmClaimSubjects"),
			);
			expect(confirmationRequests).toHaveLength(1);
			const confirmationRequest = confirmationRequests[0];
			if (!confirmationRequest)
				throw new Error("Confirmation request missing.");
			const payload = (
				confirmationRequest.body as { json?: { decisions?: unknown[] } }
			).json;
			expect(payload?.decisions).toHaveLength(4);
			const after = await db
				.select({ revision: scriptVersion.revision })
				.from(scriptVersion)
				.where(eq(scriptVersion.projectId, fixture.projectId))
				.limit(1);
			expect(after[0]?.revision).toBe((before[0]?.revision ?? 0) + 1);
			await expect
				.poll(
					async () =>
						step(await getWorkflow(page, fixture.projectId), "PRODUCT")
							.applicabilityState,
				)
				.toBe("REQUIRED");

			await page.setViewportSize({ width: 1440, height: 900 });
			await page.goto(`/projects/${fixture.projectId}/product`);
			await page
				.locator("#productId")
				.selectOption(fixture.productId as string);
			await page.getByRole("button", { name: "Liên kết sản phẩm" }).click();
			await expect(
				page.getByText(`Sản phẩm hiện tại: ${fixture.productName}`),
			).toBeVisible();
			await captureEvidence(page, "organic-product-linked-desktop");
			await page.goto(`/projects/${fixture.projectId}/fact-lock`);
			await page.getByRole("button", { name: "Bắt đầu đối chiếu" }).click();
			await expect(page.getByText("Tự động đạt").first()).toBeVisible({
				timeout: 30_000,
			});
			await captureEvidence(page, "organic-fact-lock-product-subset-desktop");
			const [manifest] = await db
				.select({
					claimCount: claimManifest.claimCount,
					claimsJson: claimManifest.claimsJson,
				})
				.from(claimManifest)
				.where(eq(claimManifest.projectId, fixture.projectId))
				.orderBy(desc(claimManifest.createdAt), desc(claimManifest.id))
				.limit(1);
			expect(manifest?.claimCount).toBe(4);
			const claimsJson = manifest?.claimsJson as unknown as ReadonlyArray<{
				subject?: { kind?: string };
			}>;
			expect(
				claimsJson.filter((claim) => claim.subject?.kind === "PRODUCT").length,
			).toBe(2);
			await page.reload();
			await expect(page.getByText("Tự động đạt").first()).toBeVisible();
			assertNoPolicyAuthorityInRequests(requests);
			assertNoBrowserErrors(page);
		} finally {
			await cleanupFixture(fixture.projectId, fixture.productId);
		}
	});

	test("refreshes stale Organic claims into GENERAL without a page reload", async ({
		page,
	}) => {
		const fixture = await seedOrganicFixture({
			label: "refresh-general",
			claims: [pendingClaim("Một ý tưởng chung.", "GENERAL")],
			stale: true,
		});
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}/content`);
			await expect(
				page.getByRole("button", { name: "Cập nhật Claims" }),
			).toBeVisible();
			await page.getByRole("button", { name: "Cập nhật Claims" }).click();
			await expect(
				page.getByTestId("claim-subject-confirmation"),
			).toBeVisible();
			await page.getByRole("radio", { name: "Thông tin chung" }).check();
			await page.getByRole("button", { name: "Xác nhận phạm vi" }).click();
			await expect(page.getByTestId("claim-subject-confirmation")).toHaveCount(
				0,
			);
			await expect(
				page.getByRole("heading", { name: "Script Studio" }),
			).toBeVisible();
			const workflow = await getWorkflow(page, fixture.projectId);
			expect(step(workflow, "PRODUCT").applicabilityState).toBe("NOT_REQUIRED");
		} finally {
			await cleanupFixture(fixture.projectId, fixture.productId);
		}
	});

	test("keeps a refreshed PRODUCT proposal non-escalating until the user confirms", async ({
		page,
	}) => {
		const fixture = await seedOrganicFixture({
			label: "refresh-product",
			model: "organic-product-e2e",
			claims: [pendingClaim("Một thông tin cần kiểm tra.", "GENERAL")],
			stale: true,
		});
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}/content`);
			await page.getByRole("button", { name: "Cập nhật Claims" }).click();
			const panel = page.getByTestId("claim-subject-confirmation");
			await expect(panel).toBeVisible();
			await expect(
				panel.getByText("Thông tin về sản phẩm").first(),
			).toBeVisible();
			const before = await getWorkflow(page, fixture.projectId);
			expect(step(before, "PRODUCT").applicabilityState).toBe("BLOCKED");
			await panel.getByRole("radio", { name: "Thông tin chung" }).check();
			await panel.getByRole("button", { name: "Xác nhận phạm vi" }).click();
			await expect(panel).toHaveCount(0);
			const after = await getWorkflow(page, fixture.projectId);
			expect(step(after, "PRODUCT").applicabilityState).toBe("NOT_REQUIRED");
			expect(step(after, "FACT_LOCK").applicabilityState).toBe("NOT_REQUIRED");
		} finally {
			await cleanupFixture(fixture.projectId, fixture.productId);
		}
	});

	test("blocks a stale-client Voice preview before the deterministic provider is called", async ({
		page,
	}) => {
		const fixture = await seedOrganicFixture({
			label: "voice-toctou",
			withProduct: true,
			claims: [],
		});
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}/voice`);
			await page.getByRole("button", { name: "Lưu cấu hình" }).click();
			await expect(
				page.getByText("Đã lưu", { exact: true }).first(),
			).toBeVisible();
			const [draft] = await db
				.select({
					id: scriptVersion.id,
					revision: scriptVersion.revision,
					editableSnapshotJson: scriptVersion.editableSnapshotJson,
				})
				.from(scriptVersion)
				.where(eq(scriptVersion.projectId, fixture.projectId))
				.limit(1);
			expect(draft).toBeDefined();
			const snapshot =
				draft?.editableSnapshotJson as ScriptVersionEditableSnapshot;
			const nextRevision = (draft?.revision ?? 1) + 1;
			await db
				.update(project)
				.set({ productId: fixture.productId })
				.where(eq(project.id, fixture.projectId));
			await db
				.update(scriptVersion)
				.set({
					revision: nextRevision,
					editableSnapshotJson: {
						...snapshot,
						claims: [
							{
								text: "Bình giữ lạnh 12 giờ.",
								occurrence: { section: "voiceover", segmentKey: "intro" },
								subject: { kind: "PRODUCT", binding: "PROJECT_PRODUCT" },
								subjectStatus: "CONFIRMED",
								subjectSource: "USER",
								proposedSubject: null,
							},
						],
						claimsSourceRevision: nextRevision,
						claimsStatus: "current",
					},
				})
				.where(eq(scriptVersion.id, draft?.id as string));
			const preview = await page.request.post(
				`/api/projects/${fixture.projectId}/voice/preview`,
			);
			expect(preview.status()).toBe(409);
			expect((await preview.json()).code).toBe("FACT_LOCK_REQUIRED");
			const artifacts = await db
				.select({ id: voiceSegmentArtifact.id })
				.from(voiceSegmentArtifact)
				.where(eq(voiceSegmentArtifact.projectId, fixture.projectId));
			expect(artifacts).toHaveLength(0);
		} finally {
			await cleanupFixture(fixture.projectId, fixture.productId);
		}
	});

	test("keeps the legacy Affiliate Product → Fact Lock → Voice path intact", async ({
		page,
	}) => {
		const fixture = await seedAffiliateFixture();
		test.setTimeout(120_000);
		try {
			await signIn(page);
			await page.goto(`/projects/${fixture.projectId}/content`);
			await expect(
				page.getByRole("heading", { name: "Script Studio" }),
			).toBeVisible();
			await page
				.getByRole("button", { name: "Tạo kịch bản", exact: true })
				.first()
				.click();
			await expect(
				page.getByRole("heading", { name: "Generated Script" }),
			).toBeVisible();
			await expect(page.getByTestId("claim-subject-confirmation")).toHaveCount(
				0,
			);
			await page
				.getByRole("button", { name: /bắt đầu chỉnh sửa|chỉnh sửa/i })
				.first()
				.click();
			await expect
				.poll(
					async () =>
						step(await getWorkflow(page, fixture.projectId), "PRODUCT")
							.applicabilityState,
				)
				.toBe("READY");
			await expect
				.poll(
					async () =>
						step(await getWorkflow(page, fixture.projectId), "FACT_LOCK")
							.applicabilityState,
				)
				.toBe("READY");
			await page.goto(`/projects/${fixture.projectId}/fact-lock`);
			await page.getByRole("button", { name: "Bắt đầu đối chiếu" }).click();
			await expect(page.getByText("Tự động đạt").first()).toBeVisible({
				timeout: 30_000,
			});
			await page.goto(`/projects/${fixture.projectId}/voice`);
			await expect
				.poll(
					async () =>
						step(await getWorkflow(page, fixture.projectId), "VOICE")
							.applicabilityState,
				)
				.toBe("READY");
			await page.getByRole("button", { name: "Lưu cấu hình" }).click();
			await page.getByRole("button", { name: "Nghe thử" }).click();
			await expect(
				page.locator('audio[aria-label="Bản nghe thử giọng đọc"]'),
			).toBeVisible();
		} finally {
			await cleanupFixture(fixture.projectId, fixture.productId);
		}
	});
});

type Fixture = {
	actor: { workspaceId: string; userId: string };
	projectId: string;
	projectName: string;
	productId: string | null;
	productName: string | null;
};

function pendingClaim(
	text: string,
	proposedSubject: "GENERAL" | "PRODUCT",
	occurrence: ScriptVersionEditableSnapshot["claims"][number]["occurrence"] = {
		section: "voiceover",
		segmentKey: "intro",
	},
): ScriptVersionEditableSnapshot["claims"][number] {
	return {
		text,
		occurrence,
		subject:
			proposedSubject === "GENERAL"
				? { kind: "GENERAL" as const }
				: { kind: "PRODUCT" as const, binding: "PROJECT_PRODUCT" as const },
		subjectStatus: "NEEDS_CONFIRMATION" as const,
		subjectSource: null,
		proposedSubject,
	};
}

async function createSettingsFixture(label: string) {
	const actor = await requireActor();
	await upsertChannelSettings(actor, {
		niche: "Đời sống",
		targetAudience: "Người xem nội dung hữu ích",
		tone: "Thân thiện, rõ ràng",
		contentPillar: "Thói quen tốt",
		defaultCta: "Theo dõi để xem thêm",
		affiliateDisclosure: "Nội dung minh bạch.",
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
		textProvider: "deterministic",
		textModel: "organic-zero-e2e",
	});
	return {
		actor,
		projectName: `19E2 ${label} ${Date.now()}`,
		productId: null,
	};
}

async function seedOrganicFixture(input: {
	label: string;
	claims: ScriptVersionEditableSnapshot["claims"];
	withProduct?: boolean;
	stale?: boolean;
	model?: string;
}): Promise<Fixture> {
	const actor = await requireActor();
	await upsertChannelSettings(actor, {
		niche: "Đời sống",
		targetAudience: "Người xem nội dung hữu ích",
		tone: "Thân thiện, rõ ràng",
		contentPillar: "Thói quen tốt",
		defaultCta: "Theo dõi để xem thêm",
		affiliateDisclosure: "Nội dung minh bạch.",
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
		textProvider: "deterministic",
		textModel:
			input.model ??
			(input.label.includes("refresh")
				? "organic-general-e2e"
				: "organic-zero-e2e"),
	});
	const productRecord = input.withProduct
		? await createProduct(actor, {
				name: `19E2 Product ${Date.now()}`,
				category: "Đời sống",
				status: "active",
				thumbnailUrl: undefined,
				sourceUrl: undefined,
				affiliateUrl: undefined,
				priceAmount: null,
				currency: "VND",
			})
		: null;
	if (productRecord) {
		await createProductFact(actor, {
			productId: productRecord.id,
			data: {
				content: "Bình giữ lạnh 12 giờ.",
				type: "specification",
				status: "verified",
				sourceType: "official",
				sourceLabel: "19E.2 E2E fixture",
				sourceUrl: "https://example.com/19e2-fact",
				confirmedAt: "2026-09-04",
				expiresAt: null,
				notes: null,
			},
		});
	}
	const projectRecord = await createProject(createProjectRepository(), actor, {
		name: `19E2 ${input.label} ${Date.now()}`,
		productId: null,
		platform: "tiktok",
		goal: "Tạo nội dung Organic deterministic",
		durationSeconds: 30,
		angle: "Kể một trải nghiệm ngắn",
		description: "Fixture E2E.",
		contentType: "ORGANIC",
		creationPath: "SCRIPTED",
		contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
	});
	const versionId = randomUUID();
	const generationId = randomUUID();
	const snapshot = createSnapshot(
		input.claims,
		input.stale ? "stale" : "current",
	);
	const snapshotHash = sha256Hex(canonicalizeJson(snapshot));
	await db.insert(scriptGeneration).values({
		id: generationId,
		workspaceId: actor.workspaceId,
		projectId: projectRecord.id,
		createdByUserId: actor.userId,
		idempotencyKey: `organic-e2e-${randomUUID()}`,
		requestHash: snapshotHash,
		mode: "full",
		provider: "deterministic",
		model: "organic-zero-e2e",
		promptVersion: ORGANIC_SCRIPT_PROMPT_VERSION,
		outputSchemaVersion: ORGANIC_SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshotJson: {
			snapshotVersion: ORGANIC_SCRIPT_SNAPSHOT_VERSION,
			request: { mode: "full", repair: null },
			project: { id: projectRecord.id, name: projectRecord.name },
			contentBrief: {
				platform: "tiktok",
				goal: "Tạo nội dung Organic deterministic",
				durationSeconds: 30,
				angle: "Kể một trải nghiệm ngắn",
				description: "Fixture E2E.",
			},
			product: null,
			channelSettings: {
				niche: "Đời sống",
				targetAudience: "Người xem nội dung hữu ích",
				tone: "Thân thiện, rõ ràng",
				contentPillar: "Thói quen tốt",
				defaultCta: "Theo dõi để xem thêm",
				affiliateDisclosure: "Nội dung minh bạch.",
				avoidWords: [],
			},
			mediaMetadata: [],
			outputRules: {
				language: "vi-VN",
				aspectRatio: "9:16",
				subtitleSafeArea: "standard",
				claimLimit: null,
				requireFinalCta: true,
			},
			facts: [],
		},
		inputHash: snapshotHash,
		promptHash: snapshotHash,
		status: "completed",
		outputJson: snapshot,
		validSections: [...scriptGenerationSections],
		invalidSections: [],
		providerRequestId: `organic-e2e-${generationId}`,
		inputTokens: 1,
		outputTokens: 1,
		estimatedCostMicros: BigInt(0),
		actualCostMicros: BigInt(0),
		currency: "VND",
		finishedAt: new Date(),
	});
	await db.insert(scriptVersion).values({
		id: versionId,
		workspaceId: actor.workspaceId,
		projectId: projectRecord.id,
		sourceGenerationId: generationId,
		status: "draft",
		versionNumber: null,
		editableSnapshotJson: snapshot,
		revision: 1,
		createdByUserId: actor.userId,
	});
	if (input.stale) {
		await db
			.update(project)
			.set({ currentStepKey: "content" })
			.where(eq(project.id, projectRecord.id));
	}
	return {
		actor,
		projectId: projectRecord.id,
		projectName: projectRecord.name,
		productId: productRecord?.id ?? null,
		productName: productRecord?.name ?? null,
	};
}

async function seedAffiliateFixture(): Promise<Fixture> {
	const actor = await requireActor();
	await upsertChannelSettings(actor, {
		niche: "Đời sống",
		targetAudience: "Người xem nội dung hữu ích",
		tone: "Thân thiện, rõ ràng",
		contentPillar: "Thói quen tốt",
		defaultCta: "Theo dõi để xem thêm",
		affiliateDisclosure: "Nội dung minh bạch.",
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
		textProvider: "deterministic",
		textModel: "affiliate-e2e",
	});
	const productRecord = await createProduct(actor, {
		name: `19E2 Affiliate Product ${Date.now()}`,
		category: "Đời sống",
		status: "active",
		thumbnailUrl: undefined,
		sourceUrl: undefined,
		affiliateUrl: undefined,
		priceAmount: null,
		currency: "VND",
	});
	await createProductFact(actor, {
		productId: productRecord.id,
		data: {
			content: "Bình giữ lạnh 12 giờ.",
			type: "specification",
			status: "verified",
			sourceType: "official",
			sourceLabel: "19E.2 Affiliate fixture",
			sourceUrl: "https://example.com/19e2-affiliate-fact",
			confirmedAt: "2026-09-04",
			expiresAt: null,
			notes: null,
		},
	});
	const projectRecord = await createProject(createProjectRepository(), actor, {
		name: `19E2 Affiliate ${Date.now()}`,
		productId: productRecord.id,
		platform: "tiktok",
		goal: "Tạo nội dung Affiliate deterministic",
		durationSeconds: 30,
		angle: "Kể một trải nghiệm ngắn",
		description: "Affiliate regression fixture.",
		contentType: "AFFILIATE",
		creationPath: "SCRIPTED",
		contentFormat: { key: "SCRIPTED_STANDARD", version: 1 },
	});
	return {
		actor,
		projectId: projectRecord.id,
		projectName: projectRecord.name,
		productId: productRecord.id,
		productName: productRecord.name,
	};
}

function createSnapshot(
	claims: ScriptVersionEditableSnapshot["claims"],
	claimsStatus: "current" | "stale",
): ScriptVersionEditableSnapshot {
	const claimText = (section: string, key?: string) =>
		claims.find((claim) => {
			if (claim.occurrence.section !== section) return false;
			if (section === "voiceover" && "segmentKey" in claim.occurrence)
				return claim.occurrence.segmentKey === key;
			if (section === "hook" && "hookKey" in claim.occurrence)
				return claim.occurrence.hookKey === key;
			return true;
		})?.text;
	const introText =
		claimText("voiceover", "intro") ??
		"Một thói quen nhỏ giúp bắt đầu ngày mới.";
	const tipText =
		claimText("voiceover", "tip") ?? "Bạn có thể bắt đầu từ một bước rất nhỏ.";
	const hookText =
		claimText("hook", "hook") ?? "Một cách nhỏ để bắt đầu ngày mới.";
	const captionText = claimText("caption") ?? "Một bước nhỏ cho ngày tốt hơn.";
	return {
		schemaVersion: "script-draft.v3",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook", text: hookText },
			{ key: "alt", text: "Lưu lại để thử hôm nay." },
			{ key: "save", text: "Bắt đầu thật đơn giản." },
		],
		selectedHookKey: "hook",
		voiceoverSegments: [
			{ key: "intro", text: introText },
			{ key: "tip", text: tipText },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 15,
				visualDirection: "Minh họa thói quen",
				onScreenText: null,
				voiceoverSegmentKeys: ["intro"],
			},
			{
				order: 2,
				durationSeconds: 15,
				visualDirection: "Cảnh kết thúc",
				onScreenText: null,
				voiceoverSegmentKeys: ["tip"],
			},
		],
		cta: { text: "Theo dõi để xem thêm." },
		caption: captionText,
		hashtags: ["#thoiquen"],
		disclosure: "",
		claims,
		claimsSourceRevision: 1,
		claimsStatus,
	};
}

async function requireActor() {
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
	return actor;
}

async function cleanupSettings(workspaceId: string) {
	await db.delete(aiSettings).where(eq(aiSettings.workspaceId, workspaceId));
	await db
		.delete(channelSettings)
		.where(eq(channelSettings.workspaceId, workspaceId));
	await db.delete(outputRules).where(eq(outputRules.workspaceId, workspaceId));
}

async function cleanupFixture(projectId: string, productId: string | null) {
	const generationIds = await db
		.select({ id: scriptGeneration.id })
		.from(scriptGeneration)
		.where(eq(scriptGeneration.projectId, projectId));
	const versionIds = await db
		.select({ id: scriptVersion.id })
		.from(scriptVersion)
		.where(eq(scriptVersion.projectId, projectId));
	const manifestIds = await db
		.select({ id: claimManifest.id })
		.from(claimManifest)
		.where(eq(claimManifest.projectId, projectId));
	await db
		.delete(voiceSegmentArtifact)
		.where(eq(voiceSegmentArtifact.projectId, projectId));
	await db.delete(voiceConfig).where(eq(voiceConfig.projectId, projectId));
	for (const manifest of manifestIds)
		await db
			.delete(factLockRun)
			.where(eq(factLockRun.claimManifestId, manifest.id));
	await db.delete(factLockRun).where(eq(factLockRun.projectId, projectId));
	await db.delete(claimManifest).where(eq(claimManifest.projectId, projectId));
	await db
		.delete(scriptClaimRefreshRun)
		.where(eq(scriptClaimRefreshRun.projectId, projectId));
	for (const version of versionIds)
		await db.delete(scriptVersion).where(eq(scriptVersion.id, version.id));
	for (const generation of generationIds)
		await db
			.delete(scriptGeneration)
			.where(eq(scriptGeneration.id, generation.id));
	await db.delete(project).where(eq(project.id, projectId));
	if (productId) {
		await db.delete(productFact).where(eq(productFact.productId, productId));
		await db
			.delete(productFactHistory)
			.where(eq(productFactHistory.productId, productId));
		await db.delete(product).where(eq(product.id, productId));
	}
	await cleanupSettings((await requireActor()).workspaceId);
}

async function signIn(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
}

async function getWorkflow(page: Page, projectId: string) {
	const response = await page.request.post(
		"/api/rpc/project/getAdaptiveWorkflow",
		{
			data: { json: { id: projectId } },
		},
	);
	return (await response.json()).json;
}

function step(
	workflow: {
		steps: Array<{
			capability: string;
			applicabilityState: string;
			navigable: boolean;
		}>;
	},
	capability: string,
) {
	const found = workflow.steps.find((item) => item.capability === capability);
	if (!found) throw new Error(`Missing workflow step ${capability}`);
	return found;
}

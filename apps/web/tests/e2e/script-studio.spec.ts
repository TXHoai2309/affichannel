import { randomUUID } from "node:crypto";
import { db, product, project } from "@affichannel/db";
import { expect, type Page, type Route, test } from "@playwright/test";
import { eq } from "drizzle-orm";

const fixedAccountEmail = process.env.E2E_AUTH_EMAIL;
const fixedAccountPassword = process.env.E2E_AUTH_PASSWORD;

const SCRIPT_SECTIONS = [
	"hook",
	"voiceover",
	"scenes",
	"cta",
	"caption",
	"hashtags",
	"disclosure",
	"claims",
] as const;

test.describe("AFF-US-009 Phase 2 Script Editor & Autosave", () => {
	test.beforeEach(async () => {
		test.skip(
			!fixedAccountEmail || !fixedAccountPassword,
			"Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD.",
		);
	});

	test("generates a completed script and keeps it after refresh", async ({
		page,
	}) => {
		const fixture = await createProject(page);
		let state = createReadModel(fixture, null, null, "current");
		const completedArtifact = createArtifact(
			fixture,
			"generation-completed",
			"completed",
			createOutput("Cảnh đã tạo"),
		);

		try {
			await mockState(page, () => state);
			await mockEstimate(page);
			await page.route(
				"**/api/rpc/scriptGeneration/generate",
				async (route) => {
					state = createReadModel(
						fixture,
						completedArtifact,
						completedArtifact,
						"current",
					);
					await fulfillJson(route, completedArtifact);
				},
			);

			await page.goto(`/projects/${fixture.projectId}/content`);
			await expect(page.getByText("Chi phí ước tính")).toBeVisible();
			await page
				.getByRole("button", { name: "Tạo kịch bản", exact: true })
				.first()
				.click();

			await expectScriptOutput(page, "Cảnh đã tạo");
			await expect(
				page.getByRole("button", { name: "Chỉnh sửa" }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Tạo lại kịch bản" }),
			).toBeVisible();
			await page.reload();
			await expectScriptOutput(page, "Cảnh đã tạo");
		} finally {
			await deleteProjectFixture(fixture);
		}
	});

	test("repairs a current partial artifact through repair and keeps parent content", async ({
		page,
	}) => {
		const fixture = await createProject(page);
		const parentArtifact = createArtifact(
			fixture,
			"generation-partial",
			"partial",
			createOutput("Cảnh cũ cần tạo lại"),
		);
		let state = createReadModel(
			fixture,
			parentArtifact,
			parentArtifact,
			"current",
		);
		let repairPayload: unknown;
		const childArtifact = createArtifact(
			fixture,
			"generation-repaired",
			"completed",
			createOutput("Cảnh đã được sửa"),
			parentArtifact.id,
		);

		try {
			await mockState(page, () => state);
			await mockEstimate(page);
			await page.route("**/api/rpc/scriptGeneration/repair", async (route) => {
				repairPayload = route.request().postDataJSON();
				state = createReadModel(
					fixture,
					childArtifact,
					childArtifact,
					"current",
				);
				await fulfillJson(route, childArtifact);
			});

			await page.goto(`/projects/${fixture.projectId}/content`);
			await expect(page.getByText("Scenes", { exact: true })).toBeVisible();
			await expect(
				page.getByText("Cần tạo lại", { exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Tạo lại phần này" }),
			).toBeVisible();

			await page.getByRole("button", { name: "Tạo lại phần này" }).click();
			await expectScriptOutput(page, "Cảnh đã được sửa");
			expect(JSON.stringify(repairPayload)).toContain(parentArtifact.id);
		} finally {
			await deleteProjectFixture(fixture);
		}
	});

	test("keeps an invalidated partial artifact visible without a repair CTA", async ({
		page,
	}) => {
		const fixture = await createProject(page);
		const invalidatedArtifact = createArtifact(
			fixture,
			"generation-invalidated",
			"partial",
			createOutput("Cảnh từ dữ liệu cũ"),
		);
		const state = createReadModel(
			fixture,
			invalidatedArtifact,
			invalidatedArtifact,
			"invalidated",
		);

		try {
			await mockState(page, () => state);
			await mockEstimate(page);
			await page.goto(`/projects/${fixture.projectId}/content`);

			await expect(
				page.getByText("Product Facts đã thay đổi", { exact: true }).last(),
			).toBeVisible();
			await expect(
				page
					.getByRole("status")
					.getByText("Không thể tạo lại riêng phần lỗi của kịch bản cũ."),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Tạo lại phần này" }),
			).toHaveCount(0);
			await expect(
				page.getByRole("button", { name: "Tạo kịch bản mới" }),
			).toBeVisible();
		} finally {
			await deleteProjectFixture(fixture);
		}
	});

	test("opens the editor, autosaves edits, and restores them after refresh", async ({
		page,
	}) => {
		const fixture = await createProject(page);
		const completedArtifact = createArtifact(
			fixture,
			"generation-editor",
			"completed",
			createOutput("Cảnh để chỉnh sửa"),
		);
		const state = createReadModel(
			fixture,
			completedArtifact,
			completedArtifact,
			"current",
		);
		let draft: ScriptVersionFixture | null = null;
		let autosaveCount = 0;

		try {
			await mockState(page, () => state);
			await mockEstimate(page);
			await page.route("**/api/rpc/scriptVersion/getCurrent", async (route) => {
				await fulfillJson(route, draft);
			});
			await page.route("**/api/rpc/scriptVersion/initialize", async (route) => {
				draft = createScriptVersion(fixture, completedArtifact);
				await fulfillJson(route, draft);
			});
			await page.route("**/api/rpc/scriptVersion/autosave", async (route) => {
				const payload = route.request().postDataJSON().json as {
					editableSnapshot: ScriptVersionFixture["editableSnapshot"];
				};
				autosaveCount += 1;
				if (draft) {
					draft = {
						...draft,
						revision: draft.revision + 1,
						editableSnapshot: {
							...payload.editableSnapshot,
							claimsStatus: "stale",
						},
					};
				}
				await fulfillJson(route, draft);
			});

			await page.goto(`/projects/${fixture.projectId}/content`);
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(
				page.getByRole("heading", { name: "Script Editor" }),
			).toBeVisible();
			const hookOne = page.getByRole("radio", { name: "Hook 1" });
			const hookTwo = page.getByRole("radio", { name: "Hook 2" });
			const hookThree = page.getByRole("radio", { name: "Hook 3" });
			await expect(hookOne).toBeChecked();
			await page
				.getByTestId("hook-card-2")
				.getByText("Chọn hook", { exact: true })
				.click();
			await expect(hookTwo).toBeChecked();
			await expect(hookOne).not.toBeChecked();
			await page.getByLabel("Nội dung Hook 1").click();
			await expect(hookTwo).toBeChecked();
			await hookThree.focus();
			await hookThree.press("Space");
			await expect(hookThree).toBeChecked();
			await hookOne.focus();
			await hookOne.press("Enter");
			await expect(hookOne).toBeChecked();
			await hookTwo.click();
			await page
				.getByLabel("Voiceover đoạn 1")
				.fill("Voiceover đã được chỉnh sửa trong editor.");
			await expect(
				page.getByText("Có thay đổi chưa lưu").first(),
			).toBeVisible();
			await expect(page.getByText("Đã lưu").first()).toBeVisible({
				timeout: 5_000,
			});
			expect(autosaveCount).toBeGreaterThanOrEqual(1);
			await expect(
				page.getByText("Claims cần cập nhật trước Fact Lock"),
			).toBeVisible();

			await page.reload();
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(
				page.getByRole("heading", { name: "Script Editor" }),
			).toBeVisible();
			await expect(page.getByRole("radio", { name: "Hook 2" })).toBeChecked();
			await expect(page.getByLabel("Voiceover đoạn 1")).toHaveValue(
				"Voiceover đã được chỉnh sửa trong editor.",
			);
		} finally {
			await deleteProjectFixture(fixture);
		}
	});

	test("saves immutable history, previews a version, and restores it with confirmation", async ({
		page,
	}) => {
		const fixture = await createProject(page);
		const artifact = createArtifact(
			fixture,
			"generation-editor-history",
			"completed",
			createOutput("Cảnh history"),
		);
		const state = createReadModel(fixture, artifact, artifact, "current");
		let draft: ScriptVersionFixture | null = null;
		let savedVersions: ScriptVersionFixture[] = [];

		try {
			await mockState(page, () => state);
			await page.route(
				"**/api/rpc/scriptGeneration/estimate",
				async (route) => {
					await fulfillJson(route, null);
				},
			);
			await page.route("**/api/rpc/scriptVersion/getCurrent", async (route) => {
				await fulfillJson(route, draft);
			});
			await page.route("**/api/rpc/scriptVersion/initialize", async (route) => {
				draft = createScriptVersion(fixture, artifact);
				await fulfillJson(route, draft);
			});
			await page.route("**/api/rpc/scriptVersion/autosave", async (route) => {
				const payload = route.request().postDataJSON().json as {
					editableSnapshot: ScriptVersionFixture["editableSnapshot"];
				};
				if (!draft) throw new Error("Expected a draft before autosave.");
				draft = {
					...draft,
					revision: draft.revision + 1,
					editableSnapshot: {
						...payload.editableSnapshot,
						claimsStatus: "stale",
					},
				};
				await fulfillJson(route, draft);
			});
			await page.route(
				"**/api/rpc/scriptVersion/saveVersion",
				async (route) => {
					if (!draft) throw new Error("Expected a draft before save version.");
					const versionNumber = savedVersions.length + 1;
					const saved = {
						...draft,
						id: `saved-version-${versionNumber}`,
						status: "saved" as const,
						versionNumber,
						savedAt: `2026-08-17T00:0${versionNumber}:00.000Z`,
					};
					savedVersions = [...savedVersions, saved];
					await fulfillJson(route, saved);
				},
			);
			await page.route(
				"**/api/rpc/scriptVersion/listHistory",
				async (route) => {
					await fulfillJson(
						route,
						savedVersions
							.slice()
							.reverse()
							.map(({ editableSnapshot: _snapshot, ...item }) => item),
					);
				},
			);
			await page.route("**/api/rpc/scriptVersion/getVersion", async (route) => {
				const versionId = route.request().postDataJSON().json
					.versionId as string;
				await fulfillJson(
					route,
					savedVersions.find((version) => version.id === versionId) ?? null,
				);
			});
			await page.route("**/api/rpc/scriptVersion/restore", async (route) => {
				const versionId = route.request().postDataJSON().json
					.versionId as string;
				const target = savedVersions.find(
					(version) => version.id === versionId,
				);
				if (!draft || !target) throw new Error("Expected restore target.");
				draft = {
					...draft,
					versionNumber: null,
					revision: draft.revision + 1,
					restoredFromVersionId: target.id,
					editableSnapshot: target.editableSnapshot,
				};
				await fulfillJson(route, draft);
			});

			await page.goto(`/projects/${fixture.projectId}/content`);
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(
				page.getByRole("heading", { name: "Script Editor" }),
			).toBeVisible();
			await page.getByLabel("Voiceover đoạn 1").fill("Voiceover phiên bản 1");
			await page.getByRole("button", { name: "Lưu phiên bản" }).click();
			await expect(
				page.getByText("Đã lưu phiên bản script").first(),
			).toBeVisible();
			await expect(
				page.getByRole("heading", { name: "Generated Script" }),
			).toBeVisible();
			await expect(page.getByText("Phiên bản hiện tại: #1")).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Chỉnh sửa" }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Tạo lại kịch bản" }),
			).toBeVisible();

			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await page.getByLabel("Voiceover đoạn 1").fill("Voiceover phiên bản 2");
			await page.getByRole("button", { name: "Lưu phiên bản" }).click();
			await expect(
				page.getByText("Đã lưu phiên bản script").first(),
			).toBeVisible();
			await expect(
				page.getByRole("heading", { name: "Generated Script" }),
			).toBeVisible();
			await expect(page.getByText("Phiên bản hiện tại: #2")).toBeVisible();
			await page.getByRole("button", { name: "Lịch sử" }).click();
			await expect(page.getByText("Bản lưu #2")).toBeVisible();
			await expect(page.getByText("Bản lưu #1")).toBeVisible();

			await page.getByRole("button", { name: /Bản lưu #2/ }).click();
			await expect(page.getByTestId("saved-version-read-only")).toBeVisible();
			await expect(
				page
					.getByTestId("saved-version-read-only")
					.getByText("Voiceover phiên bản 2"),
			).toBeVisible();
			await page.getByRole("button", { name: "Khôi phục" }).click();
			await expect(
				page.getByRole("heading", { name: "Khôi phục bản lưu?" }),
			).toBeVisible();
			await page.getByRole("button", { name: "Khôi phục bản này" }).click();
			await page
				.getByRole("button", { name: "Đóng lịch sử phiên bản" })
				.click();
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(page.getByLabel("Voiceover đoạn 1")).toHaveValue(
				"Voiceover phiên bản 2",
			);
			await expect(page.getByText("Đã khôi phục bản lưu #2")).toBeVisible();
			await expect(page.getByText(/#null/)).toHaveCount(0);

			await page.reload();
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(
				page.getByRole("heading", { name: "Script Editor" }),
			).toBeVisible();
			await expect(page.getByLabel("Voiceover đoạn 1")).toHaveValue(
				"Voiceover phiên bản 2",
			);
		} finally {
			await deleteProjectFixture(fixture);
		}
	});

	test("keeps the editor and draft content when saving a version fails", async ({
		page,
	}) => {
		const fixture = await createProject(page);
		const artifact = createArtifact(
			fixture,
			"generation-editor-save-failure",
			"completed",
			createOutput("Cảnh save failure"),
		);
		const state = createReadModel(fixture, artifact, artifact, "current");
		let draft: ScriptVersionFixture = createScriptVersion(fixture, artifact);

		try {
			await mockState(page, () => state);
			await mockEstimate(page);
			await page.route("**/api/rpc/scriptVersion/getCurrent", async (route) => {
				await fulfillJson(route, draft);
			});
			await page.route("**/api/rpc/scriptVersion/autosave", async (route) => {
				const payload = route.request().postDataJSON().json as {
					editableSnapshot: ScriptVersionFixture["editableSnapshot"];
				};
				draft = {
					...draft,
					revision: draft.revision + 1,
					editableSnapshot: payload.editableSnapshot,
				};
				await fulfillJson(route, draft);
			});
			await page.route(
				"**/api/rpc/scriptVersion/saveVersion",
				async (route) => {
					await route.fulfill({
						status: 500,
						contentType: "application/json",
						body: JSON.stringify({
							json: { code: "SCRIPT_VERSION_SAVE_FAILED" },
						}),
					});
				},
			);

			await page.goto(`/projects/${fixture.projectId}/content`);
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await page
				.getByLabel("Voiceover đoạn 1")
				.fill("Nội dung phải còn nguyên khi lưu phiên bản lỗi.");
			await expect(page.getByText("Đã lưu").first()).toBeVisible({
				timeout: 5_000,
			});
			await page.getByRole("button", { name: "Lưu phiên bản" }).click();

			await expect(
				page.getByRole("heading", { name: "Script Editor" }),
			).toBeVisible();
			await expect(page.getByLabel("Voiceover đoạn 1")).toHaveValue(
				"Nội dung phải còn nguyên khi lưu phiên bản lỗi.",
			);
			await expect(
				page.getByText("Không thể lưu bản nháp. Hãy thử lại hoặc tải bản mới nhất."),
			).toBeVisible();
		} finally {
			await deleteProjectFixture(fixture);
		}
	});

	test("keeps local edits when the same draft is refetched in the background", async ({
		page,
	}) => {
		const fixture = await createProject(page);
		const artifact = createArtifact(
			fixture,
			"generation-editor-refetch",
			"completed",
			createOutput("Cảnh refetch"),
		);
		const state = createReadModel(fixture, artifact, artifact, "current");
		const initialDraft = createScriptVersion(fixture, artifact);
		let serverDraft: ScriptVersionFixture = initialDraft;
		let getCurrentCount = 0;
		let backgroundPage: Page | null = null;

		try {
			await mockState(page, () => state);
			await page.route("**/api/rpc/scriptVersion/getCurrent", async (route) => {
				getCurrentCount += 1;
				await fulfillJson(route, serverDraft);
			});

			await page.goto(`/projects/${fixture.projectId}/content`);
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(
				page.getByRole("heading", { name: "Script Editor" }),
			).toBeVisible();
			await expect.poll(() => getCurrentCount).toBeGreaterThan(0);

			await page
				.getByLabel("Voiceover đoạn 1")
				.fill("Nội dung local vẫn phải được giữ lại.");
			serverDraft = {
				...serverDraft,
				revision: serverDraft.revision + 1,
				editableSnapshot: {
					...serverDraft.editableSnapshot,
					voiceoverSegments: [
						{ key: "segment-1", text: "Nội dung từ background refetch." },
					],
				},
			};

			const previousGetCurrentCount = getCurrentCount;
			backgroundPage = await page.context().newPage();
			await backgroundPage.goto("about:blank");
			await backgroundPage.bringToFront();
			await page.bringToFront();
			await page.evaluate(() => {
				Object.defineProperty(navigator, "onLine", {
					configurable: true,
					value: false,
				});
				window.dispatchEvent(new Event("offline"));
				Object.defineProperty(navigator, "onLine", {
					configurable: true,
					value: true,
				});
				window.dispatchEvent(new Event("online"));
			});
			await expect
				.poll(() => getCurrentCount)
				.toBeGreaterThan(previousGetCurrentCount);
			await expect(page.getByLabel("Voiceover đoạn 1")).toHaveValue(
				"Nội dung local vẫn phải được giữ lại.",
			);
		} finally {
			await backgroundPage?.close();
			await deleteProjectFixture(fixture);
		}
	});

	test("flushes dirty edits before normal in-app navigation", async ({
		page,
	}) => {
		const fixture = await createProject(page);
		const artifact = createArtifact(
			fixture,
			"generation-editor-navigation",
			"completed",
			createOutput("Cảnh navigation"),
		);
		const state = createReadModel(fixture, artifact, artifact, "current");
		let draft: ScriptVersionFixture = createScriptVersion(fixture, artifact);
		let autosaveCount = 0;

		try {
			await mockState(page, () => state);
			await page.route("**/api/rpc/scriptVersion/getCurrent", async (route) => {
				await fulfillJson(route, draft);
			});
			await page.route("**/api/rpc/scriptVersion/autosave", async (route) => {
				const payload = route.request().postDataJSON().json as {
					editableSnapshot: ScriptVersionFixture["editableSnapshot"];
				};
				autosaveCount += 1;
				draft = {
					...draft,
					revision: draft.revision + 1,
					editableSnapshot: payload.editableSnapshot,
				};
				await fulfillJson(route, draft);
			});

			await page.goto(`/projects/${fixture.projectId}/content`);
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(
				page.getByRole("heading", { name: "Script Editor" }),
			).toBeVisible();
			await page
				.getByLabel("Voiceover đoạn 1")
				.fill("Nội dung được flush trước khi rời trang.");

			const autosaveRequest = page.waitForRequest(
				"**/api/rpc/scriptVersion/autosave",
			);
			await page.locator('a[href="/dashboard"]').first().click();
			await expect(page).toHaveURL(/\/dashboard$/);
			await autosaveRequest;
			expect(autosaveCount).toBe(1);
			expect(draft.editableSnapshot.voiceoverSegments[0]?.text).toBe(
				"Nội dung được flush trước khi rời trang.",
			);

			await page.goto(`/projects/${fixture.projectId}/content`);
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(page.getByLabel("Voiceover đoạn 1")).toHaveValue(
				"Nội dung được flush trước khi rời trang.",
			);
		} finally {
			await deleteProjectFixture(fixture);
		}
	});

	test("keeps a draft when a newer AI generation appears", async ({ page }) => {
		const fixture = await createProject(page);
		const originalArtifact = createArtifact(
			fixture,
			"generation-editor-original",
			"completed",
			createOutput("Bản AI ban đầu"),
		);
		const newerArtifact = createArtifact(
			fixture,
			"generation-editor-newer",
			"completed",
			createOutput("Bản AI mới hơn"),
		);
		const state = createReadModel(
			fixture,
			newerArtifact,
			newerArtifact,
			"current",
		);
		const draft = createScriptVersion(fixture, originalArtifact);

		try {
			await mockState(page, () => state);
			await page.route(
				"**/api/rpc/scriptGeneration/estimate",
				async (route) => {
					await fulfillJson(route, null);
				},
			);
			await page.route("**/api/rpc/scriptVersion/getCurrent", async (route) => {
				await fulfillJson(route, draft);
			});

			await page.goto(`/projects/${fixture.projectId}/content`);
			await page.getByRole("button", { name: "Chỉnh sửa" }).click();
			await expect(page.getByText("Có bản AI mới")).toBeVisible();
			await expect(page.getByLabel("Nội dung Hook 1")).toHaveValue(
				originalArtifact.output.hookVariants[0].text,
			);
			await expect(
				page.getByRole("button", { name: "Tạo kịch bản", exact: true }),
			).toHaveCount(0);
		} finally {
			await deleteProjectFixture(fixture);
		}
	});
});

type ProjectFixture = {
	projectId: string;
	projectName: string;
	productName: string;
};

type ScriptVersionFixture = Omit<
	ReturnType<typeof createScriptVersion>,
	| "editableSnapshot"
	| "status"
	| "versionNumber"
	| "savedAt"
	| "restoredFromVersionId"
> & {
	status: "draft" | "saved";
	versionNumber: number | null;
	savedAt: string | null;
	restoredFromVersionId: string | null;
	editableSnapshot: ReturnType<typeof createOutput> & {
		selectedHookKey: string | null;
		claimsSourceRevision: number;
		claimsStatus: "current" | "stale";
	};
};

function createContext(fixture: ProjectFixture) {
	return {
		project: { id: fixture.projectId, name: fixture.projectName },
		contentBrief: {
			platform: "tiktok",
			goal: "Tạo nội dung chuyển đổi",
			durationSeconds: 30,
			angle: "Trải nghiệm thật",
			description: null,
		},
		product: {
			id: "e2e-product",
			name: fixture.productName,
			category: "Thiết bị công nghệ",
		},
		channelSettings: {
			niche: "Công nghệ",
			targetAudience: "Người mua online",
			tone: "Tự nhiên",
			contentPillar: "Review",
			defaultCta: "Xem thêm",
			affiliateDisclosure: "Đây là nội dung tiếp thị liên kết.",
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
		generationConfig: {
			textProvider: "deterministic",
			textModel: "e2e-model",
			promptVersion: "test-prompt",
			outputSchemaVersion: "test-output",
		},
		facts: [
			{
				id: "e2e-fact",
				revision: 1,
				content: "Sản phẩm có thiết kế nhẹ và dễ sử dụng.",
				type: "feature",
				assessment: {
					verification: "verified",
					evidence: "complete",
					freshness: "fresh",
					freshnessReason: "within_policy",
				},
				generationUsability: "allowed",
				source: {
					type: "official",
					label: "Nguồn chính thức",
					url: null,
					confirmedAt: "2026-08-17",
					expiresAt: null,
				},
			},
		],
	};
}

function createOutput(sceneText: string) {
	return {
		schemaVersion: "script-draft.v2",
		language: "vi-VN",
		hookVariants: [
			{ key: "hook-1", text: "Bạn có đang chọn sai tai nghe?" },
			{ key: "hook-2", text: "Một thay đổi nhỏ cho trải nghiệm nghe tốt hơn." },
			{ key: "hook-3", text: "Mình đã thử mẫu tai nghe này trong một tuần." },
		],
		voiceoverSegments: [
			{
				key: "segment-1",
				text: "Thiết kế nhẹ nên dùng cả ngày vẫn thoải mái.",
			},
		],
		scenes: [
			{
				order: 1,
				durationSeconds: 4,
				visualDirection: sceneText,
				onScreenText: "Nhẹ và dễ dùng",
				voiceoverSegmentKeys: ["segment-1"],
			},
		],
		cta: { text: "Xem sản phẩm qua link bên dưới." },
		caption: "Một lựa chọn nhẹ nhàng cho nhu cầu nghe hằng ngày.",
		hashtags: ["#review", "#tainghe", "#affiliatemarketing"],
		disclosure: "Đây là nội dung tiếp thị liên kết.",
		claims: [
			{
				text: "Tai nghe có thiết kế nhẹ.",
				occurrence: { section: "voiceover", segmentKey: "segment-1" },
			},
		],
	};
}

function createArtifact(
	fixture: ProjectFixture,
	id: string,
	status: "completed" | "partial",
	output: ReturnType<typeof createOutput>,
	parentGenerationId: string | null = null,
) {
	const invalidSections = status === "partial" ? ["scenes"] : [];
	const validSections = SCRIPT_SECTIONS.filter(
		(section) => !invalidSections.includes(section),
	);
	return {
		id,
		workspaceId: "e2e-workspace",
		projectId: fixture.projectId,
		createdByUserId: "e2e-user",
		idempotencyKey: `e2e-${id}`,
		requestHash: `request-${id}`,
		parentGenerationId,
		mode: parentGenerationId ? "repair" : "full",
		provider: "deterministic",
		model: "e2e-model",
		promptVersion: "test-prompt",
		outputSchemaVersion: "test-output",
		inputSnapshot: {
			snapshotVersion: "script-input.v2",
			request: { mode: parentGenerationId ? "repair" : "full", repair: null },
			...createContext(fixture),
		},
		inputHash: `input-${id}`,
		promptHash: `prompt-${id}`,
		status,
		output,
		validSections,
		invalidSections,
		providerRequestId: `provider-${id}`,
		inputTokens: 100,
		outputTokens: 200,
		estimatedCostMicros: "27000",
		actualCostMicros: "27000",
		currency: "USD",
		errorCode: null,
		finishedAt: "2026-08-17T00:00:00.000Z",
		createdAt: "2026-08-17T00:00:00.000Z",
	};
}

function createScriptVersion(
	fixture: ProjectFixture,
	artifact: ReturnType<typeof createArtifact>,
) {
	return {
		id: `script-version-${fixture.projectId}`,
		workspaceId: "e2e-workspace",
		projectId: fixture.projectId,
		sourceGenerationId: artifact.id,
		status: "draft" as const,
		versionNumber: null,
		editableSnapshot: {
			...artifact.output,
			selectedHookKey: "hook-1",
			claimsSourceRevision: 1,
			claimsStatus: "current" as const,
		},
		revision: 1,
		restoredFromVersionId: null,
		createdByUserId: "e2e-user",
		createdAt: "2026-08-17T00:00:00.000Z",
		updatedAt: "2026-08-17T00:00:00.000Z",
		savedAt: null,
	};
}

function createReadModel(
	fixture: ProjectFixture,
	latestRequest: ReturnType<typeof createArtifact> | null,
	latestUsableArtifact: ReturnType<typeof createArtifact> | null,
	dependencyState: "current" | "invalidated",
) {
	return {
		context: createContext(fixture),
		latestRequest,
		latestUsableArtifact,
		dependencyState: latestUsableArtifact
			? {
					state: dependencyState,
					invalidatedFactCount: dependencyState === "invalidated" ? 1 : 0,
				}
			: null,
	};
}

async function mockState(page: Page, getState: () => unknown) {
	await page.route("**/api/rpc/scriptGeneration/getState", async (route) => {
		await fulfillJson(route, getState());
	});
}

async function mockEstimate(page: Page) {
	await page.route("**/api/rpc/scriptGeneration/estimate", async (route) => {
		await fulfillJson(route, {
			provider: "deterministic",
			model: "e2e-model",
			estimatedCostMicros: "27000",
			currency: "USD",
			inputTokens: 100,
			pricingBasis: "e2e-pricing",
		});
	});
}

async function fulfillJson(route: Route, value: unknown) {
	await route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({ json: value }),
	});
}

async function expectScriptOutput(page: Page, sceneText: string) {
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
	await expect(page.getByText(sceneText)).toBeVisible();
}

async function createProject(page: Page): Promise<ProjectFixture> {
	const suffix = randomUUID().slice(0, 8);
	const projectName = `E2E Script Studio project ${suffix}`;
	const productName = `E2E Script Studio product ${suffix}`;

	await signIn(page);
	await page.goto("/projects/new");
	await page.getByRole("button", { name: "Tạo sản phẩm" }).click();
	await page.getByLabel("Tên sản phẩm mới").fill(productName);
	await page.getByRole("button", { name: "Tạo", exact: true }).click();
	await page.getByLabel("Tên dự án").fill(projectName);
	await page.getByLabel("Mục tiêu").fill("Tạo nội dung chuyển đổi");
	await page.getByLabel("Góc tiếp cận").fill("Trải nghiệm thật");
	await page.getByRole("button", { name: "Tạo dự án" }).click();
	await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/product$/i);

	return {
		projectId: page
			.url()
			.match(/\/projects\/([0-9a-f-]{36})\/product$/i)?.[1] as string,
		projectName,
		productName,
	};
}

async function deleteProjectFixture(fixture: ProjectFixture) {
	await db.delete(project).where(eq(project.id, fixture.projectId));
	const [createdProduct] = await db
		.select({ id: product.id })
		.from(product)
		.where(eq(product.name, fixture.productName))
		.limit(1);
	if (createdProduct)
		await db.delete(product).where(eq(product.id, createdProduct.id));
}

async function signIn(page: Page) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(fixedAccountEmail as string);
	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
	await page.getByRole("button", { name: "Đăng nhập" }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
}

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: project-create.spec.ts >> AFF-US-004 project creation >> creates a project, persists its workflow, and reopens its current step
- Location: tests\e2e\project-create.spec.ts:23:6

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/projects\/81113094-d6b5-41d1-a0d5-f84492e8b6c6\/product$/
Received string:  "http://localhost:3002/projects/81113094-d6b5-41d1-a0d5-f84492e8b6c6"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    13 × locator resolved to <html lang="vi" class="light">…</html>
       - unexpected value "http://localhost:3002/projects/81113094-d6b5-41d1-a0d5-f84492e8b6c6"

```

```yaml
- complementary:
  - link "AffiChannel":
    - /url: /dashboard
  - paragraph: Workspace sản xuất
  - navigation "Điều hướng chính":
    - button "Dashboard"
    - button "Dự án"
    - button "Sản phẩm"
    - button "Media Library"
    - button "Analytics"
    - button "Chi phí & Usage"
    - button "Cài đặt"
- banner:
  - heading "E2E project c6f692c3" [level=1]
  - button "Thông báo"
  - button "Mở menu tài khoản": Tô Xuân Hoài
- main:
  - navigation "Các bước project":
    - paragraph: Project steps
    - paragraph: Trạng thái workflow được lưu theo từng dự án; route chỉ xác định bước bạn đang xem.
    - text: 7 bước
    - group "Chú giải trạng thái step": Chú giải trạng thái step Hoàn thành Đang làm Cần xem lại Bị chặn Chưa làm
    - list:
      - listitem:
        - link "01 Sản phẩm Đang làm":
          - /url: /projects/81113094-d6b5-41d1-a0d5-f84492e8b6c6/product
      - listitem:
        - link "02 Nội dung Chưa làm":
          - /url: /projects/81113094-d6b5-41d1-a0d5-f84492e8b6c6/content
      - listitem:
        - link "03 Fact Lock Chưa làm":
          - /url: /projects/81113094-d6b5-41d1-a0d5-f84492e8b6c6/fact-lock
      - listitem:
        - link "04 Giọng đọc Chưa làm":
          - /url: /projects/81113094-d6b5-41d1-a0d5-f84492e8b6c6/voice
      - listitem:
        - link "05 Dựng video Chưa làm":
          - /url: /projects/81113094-d6b5-41d1-a0d5-f84492e8b6c6/video
      - listitem:
        - link "06 Preview & Render Chưa làm":
          - /url: /projects/81113094-d6b5-41d1-a0d5-f84492e8b6c6/preview
      - listitem:
        - link "07 Hoàn thành Chưa làm":
          - /url: /projects/81113094-d6b5-41d1-a0d5-f84492e8b6c6/completed
  - region "E2E project c6f692c3":
    - text: Tổng quan project
    - heading "E2E project c6f692c3" [level=1]
    - paragraph: Thông tin đầu vào và tiến độ hiện tại của project.
    - text: Thông tin project
    - term: Sản phẩm
    - definition: E2E product c6f692c3
    - term: Nền tảng
    - definition: TikTok
    - term: Bước hiện tại
    - definition: Sản phẩm
    - term: Thời lượng
    - definition: 30 giây
    - text: Content Brief
    - term: Mục tiêu
    - definition: Kiểm tra luồng tạo project
    - term: Góc tiếp cận
    - definition: Kiểm tra persistence của content brief
- button "Open Tanstack query devtools":
  - img
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  64  | 									durationSeconds: 30,
  65  | 									angle: "Kiểm tra persistence của content brief",
  66  | 									description: null,
  67  | 								},
  68  | 								product: {
  69  | 									id: "e2e-product",
  70  | 									name: productName,
  71  | 									category: null,
  72  | 								},
  73  | 								channelSettings: null,
  74  | 								mediaMetadata: [],
  75  | 								outputRules: {
  76  | 									language: "vi-VN",
  77  | 									aspectRatio: "9:16",
  78  | 									subtitleSafeArea: "standard",
  79  | 									claimLimit: null,
  80  | 									requireFinalCta: true,
  81  | 								},
  82  | 								generationConfig: {
  83  | 									textProvider: "deterministic",
  84  | 									textModel: "e2e-model",
  85  | 									promptVersion: "test-prompt",
  86  | 									outputSchemaVersion: "test-output",
  87  | 								},
  88  | 								facts: [],
  89  | 							},
  90  | 							latestRequest: null,
  91  | 							latestUsableArtifact: null,
  92  | 							dependencyState: null,
  93  | 						},
  94  | 					}),
  95  | 				}),
  96  | 			);
  97  | 			await page.goto(`/projects/${projectId}/content`);
  98  | 			await expect(
  99  | 				page.getByRole("heading", { name: "Script Studio" }),
  100 | 			).toBeVisible();
  101 | 			await expect(
  102 | 				page
  103 | 					.getByText("Chưa có Product Facts đủ điều kiện để tạo kịch bản.")
  104 | 					.first(),
  105 | 			).toBeVisible();
  106 | 			await expect(
  107 | 				page.getByRole("button", { name: "Tạo kịch bản" }).first(),
  108 | 			).toBeDisabled();
  109 | 			await page.goto(`/projects/${projectId}/product`);
  110 | 
  111 | 			const [persistedProject] = await db
  112 | 				.select({
  113 | 					id: project.id,
  114 | 					currentStepKey: project.currentStepKey,
  115 | 				})
  116 | 				.from(project)
  117 | 				.where(eq(project.id, projectId as string));
  118 | 			expect(persistedProject).toEqual({
  119 | 				id: projectId,
  120 | 				currentStepKey: "product",
  121 | 			});
  122 | 
  123 | 			const persistedBrief = await db
  124 | 				.select({ id: contentBrief.id })
  125 | 				.from(contentBrief)
  126 | 				.where(eq(contentBrief.projectId, projectId as string));
  127 | 			expect(persistedBrief).toHaveLength(1);
  128 | 
  129 | 			const persistedStatuses = await db
  130 | 				.select({ stepKey: projectStepStatus.stepKey })
  131 | 				.from(projectStepStatus)
  132 | 				.where(eq(projectStepStatus.projectId, projectId as string));
  133 | 			expect(persistedStatuses).toHaveLength(7);
  134 | 
  135 | 			await page.getByRole("button", { name: "Tổng quan project" }).click();
  136 | 			await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  137 | 			const overview = page.getByRole("region", { name: projectName });
  138 | 			await expect(
  139 | 				overview.getByRole("heading", { name: projectName }),
  140 | 			).toBeVisible();
  141 | 			await expect(
  142 | 				overview.getByText(productName, { exact: true }),
  143 | 			).toBeVisible();
  144 | 			await expect(overview.getByText("TikTok", { exact: true })).toBeVisible();
  145 | 			await expect(
  146 | 				overview.getByRole("definition").filter({ hasText: /^Sản phẩm$/ }),
  147 | 			).toBeVisible();
  148 | 			await expect(
  149 | 				overview.getByText("Kiểm tra luồng tạo project"),
  150 | 			).toBeVisible();
  151 | 			await expect(
  152 | 				overview.getByText("Kiểm tra persistence của content brief"),
  153 | 			).toBeVisible();
  154 | 
  155 | 			await page.reload();
  156 | 			await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  157 | 			await expect(
  158 | 				page
  159 | 					.getByRole("region", { name: projectName })
  160 | 					.getByRole("heading", { name: projectName }),
  161 | 			).toBeVisible();
  162 | 
  163 | 			await page.goBack();
> 164 | 			await expect(page).toHaveURL(
      |                       ^ Error: expect(page).toHaveURL(expected) failed
  165 | 				new RegExp(`/projects/${projectId}/product$`),
  166 | 			);
  167 | 			await expect(
  168 | 				page
  169 | 					.getByRole("navigation", { name: "Các bước project" })
  170 | 					.getByRole("link", { name: "Sản phẩm" }),
  171 | 			).toContainText("Đang làm");
  172 | 
  173 | 			await page.goto("/projects");
  174 | 			await expect(page.getByText(projectName)).toBeVisible();
  175 | 
  176 | 			await page.goto("/dashboard");
  177 | 			await expect(
  178 | 				page.getByRole("heading", { name: "Tổng quan nhanh" }),
  179 | 			).toBeVisible();
  180 | 			await page.getByRole("link", { name: `Mở dự án ${projectName}` }).click();
  181 | 			await expect(page).toHaveURL(
  182 | 				new RegExp(`/projects/${projectId}/product$`),
  183 | 			);
  184 | 			await expect(
  185 | 				page.getByRole("navigation", { name: "Các bước project" }),
  186 | 			).toBeVisible();
  187 | 		} finally {
  188 | 			if (projectId) {
  189 | 				await db.delete(project).where(eq(project.id, projectId));
  190 | 			}
  191 | 
  192 | 			const [createdProduct] = await db
  193 | 				.select({ id: product.id })
  194 | 				.from(product)
  195 | 				.where(eq(product.name, productName))
  196 | 				.limit(1);
  197 | 			productId = createdProduct?.id;
  198 | 
  199 | 			if (productId) {
  200 | 				await db.delete(product).where(eq(product.id, productId));
  201 | 			}
  202 | 		}
  203 | 	});
  204 | });
  205 | 
  206 | async function signIn(page: Page) {
  207 | 	await page.goto("/login");
  208 | 	await page.getByLabel("Email").fill(fixedAccountEmail as string);
  209 | 	await page.getByLabel("Mật khẩu").fill(fixedAccountPassword as string);
  210 | 	await page.getByRole("button", { name: "Đăng nhập" }).click();
  211 | 	await expect(page).toHaveURL(/\/dashboard$/);
  212 | }
  213 | 
```
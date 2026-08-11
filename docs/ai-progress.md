# Tiến trình AI agent

- Trạng thái: Đang hoạt động
- Cập nhật lần cuối: 2026-08-11

File này ghi lại công việc đáng kể do AI agent thực hiện. Đây không phải chain of
thought hoặc bản sao terminal. Mỗi bản ghi chỉ tóm tắt mục tiêu, thay đổi, bằng
chứng kiểm tra, quyết định, blocker và hành động an toàn tiếp theo.

## Mục tiêu hiện tại

Hoàn thiện AFF-US-003 Dashboard Overview trên nền Project persistence, App Shell và Auth.

### 2026-08-11 — Triển khai AFF-US-003 Dashboard Overview

Thay đổi:

- Thêm contract và domain service Dashboard trong `packages/core`, gồm progress theo step status,
  status/activity mapping và default cost/warning trung thực.
- Thêm protected `dashboard.getOverview()` cùng Drizzle repository: query workspace-scoped,
  recent project limit 5, order theo `updatedAt DESC`, step status tải theo một query `IN`.
- Thay màn debug bằng summary cards, recent projects có link tới current step, activity, warning,
  loading, empty, error/retry và route-level error boundary.
- Thêm integration test kiểm tra workspace isolation, ordering, limit và current step; thêm E2E
  click Dashboard → project current step khi fixed account được cấu hình.
- Global query error chuyển sang message generic, không lộ raw server error.

Kiểm tra:

- `pnpm check-types`, `pnpm --filter web test` 16/16, `pnpm test:integration:dashboard`,
  `pnpm --filter web build` và Biome scoped: đạt.
- Playwright: 3 pass, 5 skipped vì thiếu fixed E2E credentials; Browser plugin không có nên
  visual QA dùng Chrome cài sẵn qua Playwright fallback, chỉ xác nhận được unauthenticated redirect.

Blocker:

- Cần `E2E_AUTH_EMAIL`/`E2E_AUTH_PASSWORD` và cặp Neon pooled/direct cùng project để chốt gate.

### 2026-08-11 — Hardening theo review AFF-US-004

Thay đổi:

- Drizzle migration ưu tiên `DATABASE_URL_DIRECT`, còn runtime tiếp tục dùng pooled
  `DATABASE_URL`; cập nhật cảnh báo cấu hình hai Neon project khác nhau.
- Workspace actor chỉ resolve membership ở `INTERNAL_WORKSPACE_ID`, không lấy membership
  cũ nhất một cách ngầm định.
- Repository update kiểm tra project update thành công trước khi ghi Content Brief.
- Topbar lấy tên project thật qua protected query cho project persisted; demo fixture chỉ
  được dùng ngoài production.
- Bổ sung unit test cho required fields/duplicate name, mở rộng E2E persistence assertions và
  thêm `pnpm test:integration:project-auth` cho kiểm tra chéo workspace.

Blocker:

- Chưa thể xác nhận E2E happy path với 0 skipped vì môi trường chưa có
  `E2E_AUTH_EMAIL`/`E2E_AUTH_PASSWORD`; không ghi credential vào repository.
- Chưa thể coi database config hoàn tất cho đến khi user thay hai URL bằng pooled/direct của
  cùng một Neon project/branch.

### 2026-08-11 — Gọn AppTopbar theo phản hồi giao diện

- Xóa cell title, mô tả và breadcrumb ở đầu các protected route để tránh lặp nội dung
  và tạo khoảng trống không đem lại giá trị.
- AppTopbar dùng panel trắng bo tròn với title ngắn theo route, thông báo và tài khoản;
  project stepper vẫn giữ vai trò điều hướng quy trình ở các trang project.
- Cập nhật route test/E2E và `AGENTS.md` để không tự thêm lại page header chung.

### 2026-08-11 — Triển khai AFF-US-004 Project + Content Brief

Thay đổi:

- Thêm shared domain package cho Project/Product validation, workflow contract và service.
- Thêm workspace nội bộ, membership, Product tối thiểu, Project, ContentBrief và
  ProjectStepStatus; migration `0001_orange_nocturne` và migration sửa check constraint
  `0002_polite_invaders`.
- Create Project dùng transaction để ghi project, brief và đủ bảy step status cùng lúc.
- oRPC có product minimal list/create cùng project list/get/create/update/archive;
  mọi access kiểm tra workspace membership ở server. Workflow mutation chưa public
  trong US004 vì `currentStepKey` là source of truth và transition phải là business action
  transaction đầy đủ.
- Thêm `/projects/new`, selector tạo nhanh product, validation/loading/error/empty state,
  danh sách project thật và redirect/mở lại theo `currentStepKey` được lưu.

Quyết định:

- DEC-008: một internal workspace dùng chung, membership là lớp ownership;
  `createdByUserId` chỉ audit. Chưa thêm organization/role administration.
- Không unique tên project toàn cục hoặc theo workspace.
- AFF-US-005 chưa được làm đầy đủ; only minimal Product prerequisite nằm trong US004 form.

Kiểm tra:

- `pnpm db:generate`, review migration và `pnpm db:migrate` đã chạy trên database app đang dùng.
- `pnpm auth:bootstrap` đã đảm bảo membership của fixed account.
- Database transaction smoke test tạo/đọc/kiểm tra 7 status rồi xóa đúng các record test: đạt.
- `pnpm check-types`, `pnpm --filter web test` và `pnpm --filter web build`: đạt.
- Playwright đạt 3 test public/auth; happy path navigation và US004 create bị skip cho đến khi
  cấu hình `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD`.

### 2026-08-11 — Hardening review trước merge AFF-US-004

Thay đổi:

- Gỡ endpoint `updateWorkflow` generic và contract repository tương ứng; không cho client
  gửi thẳng `currentStepKey` để bỏ qua các step status.
- Sửa ProductSelector dùng label có liên kết thật với input tạo sản phẩm mới; E2E dùng
  accessible locator `getByLabel("Tên sản phẩm mới")`.
- Workspace authorization được kiểm tra trước demo fixture; fixture `demo` chỉ còn tồn tại
  ngoài production.
- Form tạo project dùng trực tiếp `createProjectInputSchema.safeParse()`, normalize
  description toàn dấu cách thành `undefined` và map lỗi API sang thông báo tiếng Việt.
- Dùng `React.cache()` cho session, workspace actor và project loader để tránh query lặp
  trong cùng request ở nested layout/page.

Kiểm tra sẽ chạy sau khi hoàn tất thay đổi: `pnpm check-types`, unit test, build và E2E
US004 khi có fixed credentials.

Lưu ý môi trường:

- `.env` hiện có `DATABASE_URL` và `DATABASE_URL_DIRECT` khác Neon project. Runtime/migration
  dùng `DATABASE_URL` để giữ account/session hiện có; cần thay cả hai URL bằng cặp pooled/direct
  của cùng một Neon project trước khi deploy hoặc chuyển database.

### 2026-08-11 — Làm mềm hình học giao diện App Shell

Mục tiêu:

- Loại bỏ cảm giác ô vuông cứng ở form, control và điều hướng mà không đổi
  palette xanh-trắng hoặc bố cục đã được duyệt.

Thay đổi:

- Shared Button, Input, Textarea, Card, Empty state, menu, overlay và feedback
  component dùng hierarchy bo góc thống nhất.
- Form tạo project, select sản phẩm, project list và active sidebar được bo góc
  nhẹ, bổ sung border/shadow tiết chế cho panel form.
- Bổ sung quy tắc UI mềm trong `AGENTS.md` và Design System; chỉ dùng góc vuông
  cho divider, bảng dày đặc hoặc phần tử lồng trong control đã có khung.

Kiểm tra:

- `pnpm exec biome check` trên 18 file UI đã thay đổi: đạt.
- `pnpm check-types`, `pnpm --filter web test` (14/14) và
  `pnpm --filter web build`: đạt.
- Playwright smoke `/login`: đạt và đã chụp rendered control. Không thể chụp
  `/projects/new` vì phiên Chrome hiện có không thể dùng lại trong Playwright và
  chưa có `E2E_AUTH_EMAIL` / `E2E_AUTH_PASSWORD`.

## Trạng thái project hiện tại

- Better T Stack scaffold đã tồn tại và dependencies đã được cài.
- Git đã có initial scaffold commit.
- Next.js web, oRPC, Better Auth, Drizzle, Neon, shared UI, Turborepo và Biome đã
  được cấu hình.
- `pnpm run check-types` đạt.
- Auth schema và business-domain schema US004 đã được generate migration, review và apply
  vào Neon development.
- AFF-US-001 Auth session, AFF-US-002 App Shell/Navigation và AFF-US-004 Project + Content
  Brief đã được triển khai.
- AFF-US-005 Product management đầy đủ, AFF-US-003 Dashboard dùng dữ liệu thật và các feature
  production workflow vẫn chưa được triển khai.

## Hành động khuyến nghị tiếp theo

1. Làm AFF-US-003 Dashboard từ dữ liệu Project thật của US004.
2. Mở AFF-US-005 để hoàn thiện Product management ngoài selector tối thiểu.
3. Cấu hình `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD` để chạy happy-path browser test.

## Blocker và quyết định còn mở

- `DEC-007`: media lưu local-first hay R2-first.
- Chưa chọn TTS provider trước khi test tiếng Việt đại diện.

## Nhật ký phiên làm việc

### 2026-08-10 — Thiết lập bộ tài liệu chuẩn

Mục tiêu:

- Tạo tài liệu triển khai và quy tắc agent trước khi code.

Thay đổi:

- Thêm chỉ mục tài liệu và thứ tự nguồn sự thật.
- Thêm product spec với phạm vi theo giai đoạn và Acceptance Criteria MVP 0.
- Thêm ranh giới kiến trúc, sơ đồ hệ thống, quy tắc dữ liệu và job.
- Thêm design token, layout, trạng thái UI bắt buộc và accessibility.
- Thêm vertical-slice roadmap và Definition of Done.
- Thêm các quyết định kiến trúc đã chấp nhận và đang đề xuất.
- Thêm changelog, progress tracking và `AGENTS.md` ở root.

Kiểm tra:

- Đã kiểm tra scaffold mà không hiển thị giá trị biến môi trường.
- Đã xác nhận tên biến môi trường và Git ignore.
- Tất cả link Markdown tương đối đều trỏ đến file tồn tại.
- `git diff --check` không có lỗi whitespace.
- `pnpm run check-types` đạt sau khi thêm tài liệu.

Tiếp theo:

- Chủ dự án duyệt MVP 0 và xử lý mô hình ownership trong `DEC-008` trước khi làm
  Product schema.

### 2026-08-10 — Chuyển tài liệu sang tiếng Việt

Mục tiêu:

- Chuyển bộ tài liệu chuẩn và quy tắc agent sang tiếng Việt.

Thay đổi:

- Dịch nội dung trong `docs/`, root `AGENTS.md` và root `README.md`.
- Giữ nguyên tên file, đường dẫn, command, identifier và thuật ngữ code cần
  thiết để tránh thay đổi semantics.
- Giữ nguyên `apps/web/AGENTS.md` vì file này do Next.js tự sinh và quản lý.

Kiểm tra:

- Tất cả link Markdown tương đối đều hợp lệ.
- Không còn heading hoặc nhãn tài liệu tiếng Anh ngoài thuật ngữ kỹ thuật được
  giữ lại có chủ đích.
- `git diff --check` không có lỗi whitespace.
- `pnpm run check-types` đạt sau khi dịch.

Tiếp theo:

- Chủ dự án review nội dung và chốt các quyết định đang đề xuất trước khi code.

### 2026-08-10 — Triển khai AFF-US-001 Auth session

Mục tiêu:

- Hoàn thiện đăng nhập email/password và session cho thành viên cố định.

Thay đổi:

- Khóa public signup trong production bằng Better Auth `disableSignUp`.
- Thêm bootstrap script non-production cho fixed account, không nhận credential
  từ source code.
- Hoàn thiện login UI tiếng Việt, neutral auth error, logout về `/login` và
  optimistic `proxy.ts` cho `/dashboard`.
- Thêm Vitest unit test, Playwright E2E spec và migration Auth.
- Cập nhật product spec, roadmap, decision log và changelog theo DEC-009.

Kiểm tra:

- `pnpm run check-types` đạt.
- `pnpm --filter web test` đạt.
- `pnpm --filter web build` đạt; Next nhận diện `proxy.ts` cho `/dashboard`.
- `pnpm run db:generate` tạo migration Auth và `pnpm run db:migrate` apply thành công
  vào Neon development.
- `pnpm --filter web test:e2e` đạt 3 test; 1 test happy path fixed account được skip
  khi chưa có `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD`.
- `pnpm auth:bootstrap` không có confirmation bị từ chối trước khi tạo account.
- Biome scope của Auth đạt. Root `pnpm run check` vẫn còn lỗi lint nền trong
  `packages/ui` (`input-group.tsx`, `label.tsx`) và cảnh báo cấu hình `biome.json`.

Quyết định:

- DEC-009 — Tài khoản cố định, không public signup trong MVP 0.

Tiếp theo:

- Cấu hình test account và chạy happy path E2E; sau đó xử lý DEC-008 trước Slice 2.

### 2026-08-10 — Triển khai AFF-US-002 App Shell và Navigation

Mục tiêu:

- Tạo protected app shell dùng chung và contract điều hướng cho các slice sau.

Thay đổi:

- Chuyển các protected route vào layout dùng chung với AppSidebar, AppTopbar và
  breadcrumb từ route config tập trung.
- Thêm skeleton route cho Dashboard, Dự án, Sản phẩm, Media Library, Analytics,
  Chi phí & Usage và Cài đặt.
- Thêm project fixture/demo với ProjectStepper 7 bước và 5 trạng thái; `current`
  được suy ra từ URL, chưa persist vào database.
- Bổ sung Badge, Breadcrumb, Dialog và Drawer primitive trong `packages/ui`;
  Job Center/notification mới là entry point placeholder.
- Cập nhật roadmap, design system, DEC-010 và changelog để tách US002 khỏi
  persistence Project/StepStatus của US004.

Kiểm tra:

- `pnpm run check-types` đạt.
- `pnpm --filter web test` đạt 9 test.
- Playwright auth/navigation chưa chạy happy path nếu thiếu `E2E_AUTH_*`; các
  test unauthenticated, public signup và invalid credentials đạt.
- `pnpm --filter web build` đạt; Next nhận diện toàn bộ protected routes và Proxy.

Quyết định:

- DEC-010 — App Shell trước persistence Project.

Tiếp theo:

- Chốt DEC-008 trước khi bắt đầu Product schema; dùng E2E fixed account để chạy
  đầy đủ navigation flow.

### 2026-08-11 — Tinh gọn nội dung đầu trang App Shell

Mục tiêu:

- Loại bỏ copy trang trí không giúp điều hướng hoặc ra quyết định trong US002.

Thay đổi:

- Dashboard dùng title và mô tả theo ngữ cảnh workspace; bỏ `Workspace overview`.
- Trang Dự án bỏ `Workflow`, làm rõ mục đích danh sách và đổi entry point demo
  thành dự án mẫu.
- Placeholder bỏ badge `Đang chuẩn bị` ở đầu trang; mô tả rõ khung đã có và phần
  nghiệp vụ còn chờ slice tương ứng.
- Chuyển page context vào topbar với title và mô tả in nghiêng; bỏ header trùng
  lặp trong main content và breadcrumb cell chỉ có title.
- Bổ sung quy tắc copy header, badge status và semantics `Button`/`Link` vào
  `AGENTS.md` và Design System để các agent áp dụng thống nhất.

Kiểm tra:

- `pnpm run check-types` đạt trên toàn bộ workspace.
- Biome scope của các file TypeScript đã thay đổi đạt.
- `pnpm --filter web test -- routes.test.ts` đạt 4 test, gồm mapping page context
  cho route top-level và project.
- Chưa kiểm tra trực quan trong browser; cần reload các route để review copy sau HMR.

### 2026-08-11 — Hoàn thiện semantic breadcrumb và design baseline US002

Mục tiêu:

- Sửa các điểm còn lại của App Shell theo DEC-010 mà không mở rộng sang business
  persistence của US004.

Thay đổi:

- `app-breadcrumb.tsx` dùng `Fragment` để `BreadcrumbSeparator` và
  `BreadcrumbItem` là sibling `<li>` hợp lệ.
- AppTopbar hiển thị breadcrumb cho nested project route để giữ context điều
  hướng; top-level route không lặp breadcrumb chỉ có title.
- Map global UI token sang `#17212B`, `#F6F3EC`, `#F2A541`, `#2F7D64`; primary
  action và active sidebar dùng orange; sidebar dùng navy.
- Map `--font-sans` và `--font-mono` sang biến Geist đang được load.
- Đồng bộ roadmap rằng US002 chỉ cung cấp `ProjectStepKey`, status mapping và
  persistence contract; lưu dữ liệu thật deferred sang US004 theo DEC-010.

Kiểm tra:

- `pnpm run check-types`: đạt, 2 package typecheck thành công.
- `pnpm --filter web build`: đạt; production build và TypeScript hoàn tất.
- `pnpm --filter web test`: đạt 10/10 test.
- `pnpm --filter web test:e2e`: 3 pass, 4 skipped; 4 test auth/navigation happy
  path chưa chạy vì thiếu `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD`.
- `pnpm run check`: chưa đạt do 4 lỗi lint nền trong `packages/ui` và 2 warning
  unused import ngoài phạm vi US002; các file US002 đã được format/check theo scope.
- Browser visual screenshot chưa hoàn tất vì Browser plugin không có trong môi
  trường và Playwright screenshot CLI thiếu executable headless riêng.

Blocker:

- Cần cung cấp fixed E2E account qua biến môi trường rồi chạy lại auth/navigation
  happy path. US002 chưa đủ điều kiện Done khi blocker này còn tồn tại.

Deferred:

- Project, ContentBrief, ProjectStepStatus persistence và CRUD giữ lại cho US004.

### 2026-08-11 — Khôi phục màu light theme như giao diện cũ

Mục tiêu:

- Giữ bố cục App Shell hiện tại nhưng khôi phục chính xác cảm giác trắng/xám nhẹ
  của giao diện cũ theo phản hồi trực quan.

Thay đổi:

- Workspace, card, popover và sidebar dùng lại bộ token light cũ.
- Active sidebar dùng `secondary` như trước; giữ `nativeButton={false}` và Geist là
  các sửa kỹ thuật độc lập với màu sắc.
- Cập nhật design system để light theme không còn mô tả nền Navy/Cream/Orange.

Kiểm tra:

- `pnpm run check-types`: đạt.
- `pnpm --filter web test`: đạt 10/10 test.
- `pnpm --filter web build`: đạt.
- HTTP smoke check `/dashboard`: trả về 200.
- Chưa có browser visual screenshot trong môi trường này; cần reload `/dashboard`
  và các route protected để review trực quan sau HMR.

### 2026-08-11 — Áp dụng blue-white visual direction cho App Shell

Mục tiêu:

- Đồng bộ màu App Shell với visual reference xanh-trắng được duyệt, không mở rộng
  sang dashboard metrics hoặc dữ liệu giả.

Thay đổi:

- Thêm token blue, blue-900, blue-soft, green, orange và purple trong shared CSS.
- Đặt workspace ở `#F7FAFF`, surface ở trắng, primary/active navigation ở
  `#1677F2`, text chính ở `#122D58`.
- Đưa active sidebar về primary blue; giữ semantic màu phụ cho success, cost và
  grouping, không dùng chúng làm primary action.
- Cập nhật design system, changelog và AGENTS để tránh quay lại palette Navy/Cream
  hoặc thêm gradient/glow ngoài reference.

Kiểm tra:

- `pnpm run check-types`: đạt.
- `pnpm --filter web test`: đạt 10/10 test.
- `pnpm --filter web build`: đạt.
- Scoped Biome check cho App Shell và route config: đạt.
- HTTP smoke check `/login`: trả về 200.
- `pnpm --filter web test:e2e`: 3 pass, 4 skipped vì chưa có fixed E2E account;
  không phát hiện failure mới sau đổi màu.
- Browser plugin không có trong môi trường; fallback Playwright/system Chrome đã
  chụp được `/login` với palette mới. App Shell authenticated chưa chụp được vì
  fixed E2E account chưa được cấu hình.

## Mẫu bản ghi

```text
### YYYY-MM-DD — Tiêu đề task ngắn

Mục tiêu:
- Kết quả được yêu cầu.

Thay đổi:
- File hoặc hành vi quan trọng đã thay đổi.

Kiểm tra:
- Command, test hoặc manual check và kết quả.

Quyết định:
- Decision ID đã thêm hoặc thay đổi, nếu có.

Blocker:
- Vấn đề thực sự chưa giải quyết; bỏ qua nếu không có.

Tiếp theo:
- Hành động an toàn nhỏ nhất tiếp theo.
```

## Quy tắc ghi tiến trình

- Thêm một bản ghi cho mỗi task đáng kể đã hoàn thành, không ghi từng tool call.
- Không ghi secret, credential, giá trị env, private prompt hoặc hidden reasoning.
- Nêu rõ nếu chưa thực hiện kiểm tra.
- Không đánh dấu hoàn thành khi Acceptance Criteria chưa đạt.
- Nếu agent hoàn tác hoặc thay thế công việc trước, giữ lịch sử và giải thích.

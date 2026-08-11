# Tiến trình AI agent

- Trạng thái: Đang hoạt động
- Cập nhật lần cuối: 2026-08-10

File này ghi lại công việc đáng kể do AI agent thực hiện. Đây không phải chain of
thought hoặc bản sao terminal. Mỗi bản ghi chỉ tóm tắt mục tiêu, thay đổi, bằng
chứng kiểm tra, quyết định, blocker và hành động an toàn tiếp theo.

## Mục tiêu hiện tại

Hoàn thiện vertical slice AFF-US-002 cho App Shell, route contract và project
navigation trên nền auth của US001.

## Trạng thái project hiện tại

- Better T Stack scaffold đã tồn tại và dependencies đã được cài.
- Git đã có initial scaffold commit.
- Next.js web, oRPC, Better Auth, Drizzle, Neon, shared UI, Turborepo và Biome đã
  được cấu hình.
- `pnpm run check-types` đạt.
- Auth schema đã được generate migration, review và apply vào Neon development;
  business-domain schema vẫn chưa được thêm.
- AFF-US-001 Auth session đã được triển khai; các feature nghiệp vụ AffiChannel
  chưa được triển khai.
- AFF-US-002 App Shell và Navigation đã được triển khai; chưa tạo business
  Project schema hoặc persistence StepStatus.

## Hành động khuyến nghị tiếp theo

1. Chốt `DEC-008` về mô hình ownership cho nhóm cố định.
2. Bắt đầu Product schema/slice sau khi ownership được chấp nhận.
3. Nối persistence Project/StepStatus ở US004.

## Blocker và quyết định còn mở

- `DEC-007`: media lưu local-first hay R2-first.
- `DEC-008`: dùng chung internal group hay ownership riêng từng user.
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

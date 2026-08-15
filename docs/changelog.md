# Nhật ký thay đổi

Mọi thay đổi đáng chú ý về hành vi người dùng, vận hành và kiến trúc của
AffiChannel được ghi tại đây.

Định dạng dựa trên nguyên tắc Keep a Changelog. Khi bắt đầu phát hành, phiên bản
sử dụng Semantic Versioning.

## Chưa phát hành

### Đã thêm

- DEC-015 và foundation AFF-US-008: persisted `ScriptGeneration`, immutable repair lineage,
  Fact revision snapshot/dependency atomic, idempotency, pending concurrency và latest usable
  artifact read model; chưa thêm provider/API/UI.
- AFF-US-006: Product Facts với schema Fact/History, search/filter/cursor pagination, tab deep-link
  trên Product Detail, drawer thêm/sửa, dialog xóa và trạng thái loading/empty/error.
- AFF-US-006 hardening: server-side evidence rule cho Fact verified, AI eligibility, demote/re-verify
  khi sửa Fact verified, snapshot history transaction và chặn xóa Product khi còn Fact/history.
- AFF-US-006 hardening tiếp: Drawer dùng Viewport đúng chuẩn Base UI và panel bên phải; update Fact
  dùng intent `preserve | verify`; tab Product Facts giữ history bằng browser back/forward/reload;
  regression E2E xác nhận không còn lỗi `Drawer.Popup` và verified content edit trở về Bản nháp.
- AFF-US-005: Product Library, Product CRUD, search/filter, archive/restore, usage count và hard-delete guard;
  Product được workspace-scope và có migration field status/source/affiliate/price/currency.
- AFF-US-005 hardening: Product Library tải thêm theo cursor và Product Detail dùng copy người dùng thay vì
  nhãn implementation; URL được kiểm tra bằng parser với allow-list protocol.
- AFF-US-003: protected Dashboard aggregate, summary cards, recent project list/activity,
  warning empty state, cost contract và loading/empty/error/retry states.
- AFF-US-004: persistence Project, Content Brief, workflow seven-step và internal
  workspace ownership.
- Form tạo project có validation, loading/error state, Product selector tạo nhanh,
  project list/empty state và redirect theo workflow state.
- Monorepo Better T Stack ban đầu gồm Next.js, oRPC, Better Auth, Drizzle, Neon,
  shared UI, Turborepo và Biome.
- Bộ tài liệu chuẩn gồm đặc tả sản phẩm, kiến trúc, hệ thống thiết kế, lộ trình,
  nhật ký quyết định, tiến trình AI và quy tắc agent toàn repository.

### Đã thay đổi

- AFF-US-004 regression TC-026A: `/projects/{id}` nay render Project Overview persisted thay vì
  redirect về current step; nút “Tổng quan project” từ `/product` hỗ trợ refresh và browser Back.
- Cleanup sau AFF-US-003: user menu hiển thị identity từ session với fallback email; CI fail rõ ràng
  nếu authenticated E2E thiếu `E2E_AUTH_EMAIL` hoặc `E2E_AUTH_PASSWORD`.
- Dashboard chỉ đọc dữ liệu Project thật trong workspace hiện tại, không tạo mock metrics hoặc
  bảng read model riêng; link project mở đúng `currentStepKey`.
- Dashboard polish: warning điều hướng tới `targetUrl` với severity rõ ràng, action tạo project
  dùng `CardAction`, copy hướng người dùng hơn, relative time dùng chung và loading skeleton
  bám đúng layout thật; lỗi inline không tạo thêm global toast.
- Chốt authenticated E2E: Playwright tự nạp env cục bộ, fixed-account suite chạy tuần tự để
  tránh tranh chấp session/dev server; 8/8 test đạt, không còn skipped.
- Progress Dashboard được derive từ persisted completed step status và query recent projects
  được giới hạn 5 bản ghi, tránh N+1 step status query.
- Hardening AFF-US-004: migration tooling dùng direct Neon URL, workspace actor dùng internal
  workspace rõ ràng, repository update an toàn hơn và topbar hiển thị tên project persisted.
- Product Library giữ dữ liệu đã tải khi lấy trang tiếp theo; lỗi load-more hiển thị inline và có retry,
  không làm mất danh sách hiện tại.
- Bổ sung kiểm tra required fields, duplicate project name, persistence đủ brief/7 status và
  authorization chéo workspace.
- ProjectStepper đọc workflow current từ database, không coi route đang xem là
  trạng thái đã lưu.
- Bootstrap auth có thể lặp lại để bảo đảm workspace membership cho fixed user hiện có.
- Thu hẹp MVP 0 vào luồng media thật, TTS, Fact Lock và local render worker.
- Xác định tài liệu Markdown trong `docs/` là cơ sở triển khai.
- Chuyển toàn bộ tài liệu chuẩn và quy tắc agent sang tiếng Việt.
- Tinh gọn header Dashboard, Dự án và các route placeholder: bỏ nhãn chung
  chung, dùng copy tiếng Việt theo ngữ cảnh và chỉ hiển thị status khi có dữ liệu
  domain tương ứng.
- Chuyển page context dùng chung vào topbar với title và mô tả in nghiêng; bỏ
  header trùng lặp trong nội dung chính và breadcrumb cell chỉ có title.
- Sửa breadcrumb để separator và item là sibling hợp lệ trong `<ol>`; map token
  giao diện sang Navy, Cream, Orange, Green và đồng bộ font với Geist.
- Điều chỉnh light theme về nền trắng cho workspace và sidebar; giữ orange cho
  active state và primary action để giao diện nhẹ hơn.
- Đổi light theme App Shell sang hệ xanh-trắng theo visual direction mới: blue
  cho primary/active, blue-900 cho text, và các màu green/orange/purple cho
  semantic state có kiểm soát.
- Làm mềm hệ component theo hierarchy radius: control, menu và active navigation
  được bo góc nhẹ; panel/card, dialog/drawer và form tạo project có surface mềm
  hơn nhưng giữ nguyên palette xanh-trắng.
- Hardening US004 trước merge: bỏ generic workflow mutation, sửa accessible label cho
  ProductSelector/E2E, kiểm tra workspace trước fixture, dùng chung Zod validation và
  dedupe server loader bằng `React.cache()`.
- Đổi AppTopbar sang panel trắng bo tròn theo visual direction mới: title ngắn,
  notification và Account Owner; bỏ Job Center khỏi header để giữ chrome gọn.
- Gọn AppTopbar: bỏ cell title, mô tả và breadcrumb lặp lại ở đầu protected route;
  giữ lại các utility action và ProjectStepper.

### Bảo mật

- Tài liệu hóa authorization ở mức bản ghi, loại secret khỏi log, kiểm tra file
  upload, chống SSRF và tách render khỏi Vercel Functions.
- Khóa public signup trong US001; tài khoản cố định được bootstrap ngoài luồng
  public và session được kiểm tra ở server.
- Không public API nhận `currentStepKey` tùy ý; workflow transition phải được triển khai
  như business action có transaction cập nhật step hiện tại và bước tiếp theo cùng nhau.
- Thêm protected App Shell cho US002 với route map tập trung, sidebar, topbar,
  breadcrumb, Job Center/notification entry point và ProjectStepper 7 bước.
- Các route MVP chưa có business logic hiện skeleton; persistence Project/StepStatus
  được giữ lại cho US004 theo DEC-010.

## Chưa phát hành — AFF-US-008 foundation

- Thêm ScriptDraft schema/partial validation, input snapshot, canonical hashing, idempotency và generation read model.
- Thêm `script_generation` migrations `0006`/`0007`/`0008`/`0009`, dependency type `script_generation`, transaction-scoped registration/detach và deterministic provider test scenarios.
- Hardening foundation: requestHash chỉ nhận client intent; repair merge server-side với parent partial;
  provider roles/schema contract; timeout uncertain; stale pending guard; partial cross-reference/
  hashtag validation; DB state-shape CHECK; concurrency/failure integration smoke coverage.
- Chưa thêm live AI SDK, API generate, Script Studio hay ScriptVersion.

### AFF-US-008 Phase 2A — đang triển khai

- Thêm Channel Settings/AI Settings/Output Rules theo workspace, Media Metadata tối thiểu và
  migration `0010`/`0011`.
- Bump structured output/snapshot/prompt lên v2; `hook` đơn thành 3–5 `hookVariants` có key.
- Thêm server-owned production input snapshot, prompt role separation, provider cost estimate và
  protected oRPC estimate/generate/repair/getState.
- Chưa có live provider SDK, UI, ScriptVersion, Fact Lock hay migration shared Neon.

## 0.0.0 — 2026-08-10

### Đã thêm

- Khởi tạo project bằng Better T Stack.
### AFF-US-007 — Fact Freshness và Dependency Invalidation

- Thêm policy freshness tập trung cho price/promotion, assessment verification/evidence/freshness
  và generation usability contract.
- Thêm Product Fact revision, history revision, optimistic CAS cho update/delete và mã lỗi
  `FACT_CONCURRENT_MODIFICATION` với copy tiếng Việt.
- Thêm dependency register/replace/detach, invalidation event trong cùng transaction và
  Dashboard warning deep-link về Product Facts.
- Product Facts hiển thị badge freshness/evidence; migration `0005_exotic_edwin_jarvis.sql`
  đã apply trên Neon branch hiện tại.
- AFF-US-007 hardening: khóa hàng Product Fact khi register/replace và update/delete để không
  tạo active dependency stale; evidence assessment kiểm tra supporting source cho cả Fact type
  optional; Dashboard warning test nhận ngày tường minh và có regression race.
- Regression fix AFF-US-006/007: schema API nhận `null`/rỗng cho URL nguồn của Fact optional;
  verified feature/specification/policy/other không còn bị chặn trước persistence, nhưng vẫn
  hiển thị badge `Thiếu căn cứ` và bị block generation như contract.

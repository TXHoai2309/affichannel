# Nhật ký thay đổi

Mọi thay đổi đáng chú ý về hành vi người dùng, vận hành và kiến trúc của
AffiChannel được ghi tại đây.

Định dạng dựa trên nguyên tắc Keep a Changelog. Khi bắt đầu phát hành, phiên bản
sử dụng Semantic Versioning.

## Chưa phát hành

### Đã thêm

- AFF-US-006: Product Facts với schema Fact/History, search/filter/cursor pagination, tab deep-link
  trên Product Detail, drawer thêm/sửa, dialog xóa và trạng thái loading/empty/error.
- AFF-US-006 hardening: server-side evidence rule cho Fact verified, AI eligibility, demote/re-verify
  khi sửa Fact verified, snapshot history transaction và chặn xóa Product khi còn Fact/history.
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

## 0.0.0 — 2026-08-10

### Đã thêm

- Khởi tạo project bằng Better T Stack.

# Nhật ký thay đổi

Mọi thay đổi đáng chú ý về hành vi người dùng, vận hành và kiến trúc của
AffiChannel được ghi tại đây.

Định dạng dựa trên nguyên tắc Keep a Changelog. Khi bắt đầu phát hành, phiên bản
sử dụng Semantic Versioning.

## Chưa phát hành

### Đã thêm

- AFF-US-004: persistence Project, Content Brief, workflow seven-step và internal
  workspace ownership.
- Form tạo project có validation, loading/error state, Product selector tạo nhanh,
  project list/empty state và redirect theo workflow state.
- Monorepo Better T Stack ban đầu gồm Next.js, oRPC, Better Auth, Drizzle, Neon,
  shared UI, Turborepo và Biome.
- Bộ tài liệu chuẩn gồm đặc tả sản phẩm, kiến trúc, hệ thống thiết kế, lộ trình,
  nhật ký quyết định, tiến trình AI và quy tắc agent toàn repository.

### Đã thay đổi

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

### Bảo mật

- Tài liệu hóa authorization ở mức bản ghi, loại secret khỏi log, kiểm tra file
  upload, chống SSRF và tách render khỏi Vercel Functions.
- Khóa public signup trong US001; tài khoản cố định được bootstrap ngoài luồng
  public và session được kiểm tra ở server.
- Thêm protected App Shell cho US002 với route map tập trung, sidebar, topbar,
  breadcrumb, Job Center/notification entry point và ProjectStepper 7 bước.
- Các route MVP chưa có business logic hiện skeleton; persistence Project/StepStatus
  được giữ lại cho US004 theo DEC-010.

## 0.0.0 — 2026-08-10

### Đã thêm

- Khởi tạo project bằng Better T Stack.

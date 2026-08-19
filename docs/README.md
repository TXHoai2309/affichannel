# Tài liệu AffiChannel

Thư mục này là nguồn tài liệu chuẩn về sản phẩm và kỹ thuật của AffiChannel.
Mã nguồn, schema cơ sở dữ liệu, hợp đồng API và hành vi giao diện phải nhất quán
với các tài liệu tại đây.

## Thứ tự đọc

1. [Đặc tả sản phẩm](./product-spec.md)
2. [Kiến trúc hệ thống](./architecture.md)
3. [Hệ thống thiết kế](./design-system.md)
4. [Lộ trình triển khai](./roadmap.md)
5. [Các quyết định kiến trúc](./decisions.md)
6. [Tiến trình AI agent](./ai-progress.md)
7. [Nhật ký thay đổi](./changelog.md)
8. [Bàn giao AFF-US-004](./aff-us-004.md)
9. [Nền kiến trúc AFF-US-008](./aff-us-008-foundation.md)
10. [AFF-US-008 Phase 2A](./aff-us-008-phase-2a.md)
11. [AFF-US-008 Phase 2B](./aff-us-008-phase-2b.md)
12. [AFF-US-010 Phase 0 Contract Hardening](./aff-us-010-phase-0-contract-hardening.md)
13. [AFF-US-010 Phase 1 Foundation & Classification](./aff-us-010-phase-1-foundation.md)
14. [AFF-US-010 Phase 2 Review & Resolution](./aff-us-010-phase-2-review-resolution.md)
15. [AFF-US-010 Phase 3 Gate & Runtime](./aff-us-010-phase-3-gate-runtime.md)
16. [AFF-US-011 Phase 0 Contract & Architecture Freeze](./aff-us-011-phase-0-contract-decisions.md)

## Thứ tự ưu tiên khi xác định nguồn sự thật

Khi các tài liệu mâu thuẫn, áp dụng thứ tự sau:

1. Chỉ dẫn trực tiếp từ chủ dự án.
2. Các quyết định đã được chấp nhận trong `decisions.md`.
3. `product-spec.md` về phạm vi và hành vi sản phẩm.
4. `architecture.md` về ranh giới kỹ thuật.
5. `design-system.md` về giao diện và ngôn ngữ hình ảnh.
6. `roadmap.md` về thứ tự triển khai.
7. Mã nguồn hiện tại.

Không được tự âm thầm xử lý một mâu thuẫn quan trọng. Hãy ghi quyết định vào
`decisions.md`, cập nhật các tài liệu bị ảnh hưởng và nêu rõ trong
`ai-progress.md`.

## Vòng đời tài liệu

- `Bản nháp`: đang được xác định; không được tự giả định hành vi chưa mô tả.
- `Đã chấp nhận`: được duyệt làm cơ sở triển khai.
- `Đã thay thế`: được giữ lại để tra cứu lịch sử nhưng không còn hiệu lực.

Mỗi tài liệu phải có trạng thái và ngày cập nhật gần tiêu đề. Ngày tháng dùng
định dạng `YYYY-MM-DD` theo múi giờ `Asia/Saigon`.

## Quy tắc cập nhật

- Thay đổi hành vi sản phẩm: cập nhật `product-spec.md`.
- Thay đổi ranh giới kỹ thuật hoặc hạ tầng: cập nhật `architecture.md` và thêm
  hoặc sửa một quyết định.
- Thay đổi token giao diện hoặc mẫu tương tác: cập nhật `design-system.md`.
- Thay đổi phạm vi hoặc thứ tự triển khai: cập nhật `roadmap.md`.
- Công việc triển khai đáng kể: thêm bản ghi ngắn vào `ai-progress.md`.
- Thay đổi người dùng thấy được hoặc ảnh hưởng vận hành: thêm vào phần
  `Chưa phát hành` trong `changelog.md`.

## Tài liệu kế hoạch trước đây

Các file Word và spreadsheet ban đầu vẫn là nguồn tham khảo lịch sử hữu ích.
Các tài liệu Markdown trong thư mục này là cơ sở trực tiếp để triển khai. Nếu
tài liệu cũ mâu thuẫn với thư mục này, hãy áp dụng thứ tự nguồn sự thật nêu trên.

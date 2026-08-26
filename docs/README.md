# Tài liệu AffiChannel

Thư mục này là nguồn tài liệu chuẩn về sản phẩm và kỹ thuật của AffiChannel.
Mã nguồn, schema cơ sở dữ liệu, hợp đồng API và hành vi giao diện phải nhất quán
với các tài liệu tại đây.

Product/UI Specification v0.8 là **canonical product specification** và đã được
chấp nhận ở cấp tài liệu qua DEC-025. DEC-026 đã khóa ContentFormat và đóng Phase 0;
M1/M2/M3 đã hoàn tất cho current Affiliate compatibility baseline. DEC-028 và M4
runtime shadow đã đạt parity; DEC-029/AFF-US-015 presentation cutover đã DONE.
DEC-030/M5 persisted identity enforcement đã DONE qua production migration 0018,
postflight và final regression. AFF-US-013/AFF-US-016 đã DONE; AFF-US-017 đã PASS
Phase 17A–17E và DONE. ClaimManifest foundation vẫn dormant; AFF-US-018
Manifest-First Fact Lock là canonical next runtime story, contract clarification
đã locked nhưng runtime NOT STARTED. M5 không activate future identities.

## Thứ tự đọc

1. [Các quyết định kiến trúc](./decisions.md)
2. [Đặc tả sản phẩm v0.8](./product-spec.md)
3. [Kiến trúc hệ thống](./architecture.md)
4. [Lộ trình triển khai](./roadmap.md)
5. [Kế hoạch Domain Evolution v0.8](./domain-evolution-plan.md)
6. [Contract ClaimManifest và Fact Lock v0.8](./claim-manifest-fact-lock-contract.md)
7. [AFF-US-017 / ClaimManifest Foundation Contract](./aff-us-017-claim-manifest-foundation.md)
8. [Acceptance Plan Domain Evolution v0.8](./domain-evolution-acceptance.md)
9. [AFF-US-014 / M4 Resolver Shadow Contract](./aff-us-014-m4-applicability-resolver-shadow.md)
10. [AFF-US-015 / Adaptive Workflow UI Contract](./aff-us-015-adaptive-workflow-ui.md)
11. [Domain Evolution M5 Enforcement Contract](./domain-evolution-m5-enforcement-contract.md)
12. [Hệ thống thiết kế](./design-system.md)
13. [Tiến trình AI agent](./ai-progress.md)
14. [Nhật ký thay đổi](./changelog.md)

## Historical baseline trước Domain Evolution v0.8

Các tài liệu dưới đây là bằng chứng của golden affiliate flow tại thời điểm từng
story hoàn thành. Chúng phục vụ regression/audit và **không override DEC-025,
Product Specification v0.8 hoặc current execution order trong roadmap**.

1. [Bàn giao AFF-US-004](./aff-us-004.md)
2. [Nền kiến trúc AFF-US-008](./aff-us-008-foundation.md)
3. [AFF-US-008 Phase 2A](./aff-us-008-phase-2a.md)
4. [AFF-US-008 Phase 2B](./aff-us-008-phase-2b.md)
5. [AFF-US-010 Phase 0 Contract Hardening](./aff-us-010-phase-0-contract-hardening.md)
6. [AFF-US-010 Phase 1 Foundation & Classification](./aff-us-010-phase-1-foundation.md)
7. [AFF-US-010 Phase 2 Review & Resolution](./aff-us-010-phase-2-review-resolution.md)
8. [AFF-US-010 Phase 3 Gate & Runtime](./aff-us-010-phase-3-gate-runtime.md)
9. [AFF-US-011 Phase 0 Contract & Architecture Freeze](./aff-us-011-phase-0-contract-decisions.md)
10. [AFF-US-011 Phase 1 Voice Foundation](./aff-us-011-phase-1-foundation.md)
11. [AFF-US-011 Phase 2 TTS Preview Runtime](./aff-us-011-phase-2-tts-preview-runtime.md)
12. [AFF-US-011 Phase 3 Voice Studio](./aff-us-011-phase-3-voice-studio.md)
13. [AFF-US-012 Phase 0 Contract & Architecture Lock](./aff-us-012-phase-0-contract-decisions.md)
14. [AFF-US-012 Phase 1 Foundation](./aff-us-012-phase-1-foundation.md)
15. [AFF-US-012 Phase 2 Runtime, API & Protected Audio](./aff-us-012-phase-2-runtime.md)
16. [AFF-US-012 Phase 3 Voice Segment Studio UI](./aff-us-012-phase-3-ui.md)
17. [AFF-US-012 Phase 4 Final Acceptance](./aff-us-012-phase-4-final-acceptance.md)

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
- `Canonical ở cấp tài liệu`: contract đã chốt nhưng code/schema còn phải qua
  migration và regression gate.
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

Product/UI Specification v0.8 Word là đầu vào canonical đã được DEC-025 tiếp nhận;
các tài liệu Markdown trong thư mục này là contract trực tiếp để triển khai repo.
Các file Word/spreadsheet cũ hơn vẫn là nguồn tham khảo lịch sử. Nếu tài liệu cũ
mâu thuẫn với thư mục này, hãy áp dụng thứ tự nguồn sự thật nêu trên.

Sprint Plan v1.0 đã bị roadmap canonical v0.8 thay thế. Sprint Plan v2.0 là
external project artifact tại `D:\Affichanels\tài liệu`; không tạo relative link
vì file không nằm trong repo.

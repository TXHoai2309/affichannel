# Lộ trình triển khai AffiChannel

- Trạng thái: Bản nháp
- Phiên bản: 0.1.0
- Cập nhật lần cuối: 2026-08-10

## 1. Phương pháp triển khai

Làm theo vertical slice. Mỗi slice gồm database, domain logic, API, UI, các trạng
thái và test tối thiểu để demo một kết quả cho người dùng.

Không làm toàn bộ UI trước hoặc toàn bộ backend trước. Không triển khai backlog
spreadsheet cứng nhắc theo thứ tự từng dòng.

Giới hạn công việc đang làm:

- một User Story đang thực hiện;
- một luồng chính có thể demo;
- một người chịu trách nhiệm cho mỗi quyết định chưa xử lý.

## 2. Điều kiện bắt đầu một slice

Slice chỉ bắt đầu khi có:

- kết quả người dùng;
- Acceptance Criteria rõ ràng;
- dependency đã xác định;
- phạm vi bao gồm và không bao gồm;
- tác động dự kiến lên schema/API;
- cách kiểm thử;
- không còn quyết định chưa xử lý có thể làm thay đổi lớn implementation.

## 3. Giai đoạn 0 — Tài liệu và baseline

Kết quả: có cơ sở triển khai được thống nhất trước feature code.

- Đặc tả sản phẩm chuẩn.
- Ranh giới kiến trúc và bảo mật.
- Hệ thống thiết kế và quy tắc trạng thái UI.
- Quy tắc vận hành AI agent.
- Quy trình changelog và progress tracking.
- Type-check baseline đạt.
- Việc áp dụng Neon schema phải do chủ dự án chủ động quyết định.

Điều kiện hoàn thành:

- Link tài liệu hợp lệ.
- `pnpm run check-types` đạt.
- Chủ dự án duyệt hoặc sửa phạm vi MVP 0.

## 4. Slice 1 — Authentication

Backlog liên quan: `AFF-US-001`.

```text
Bootstrap tài khoản cố định → đăng nhập → mở Dashboard được bảo vệ → refresh → đăng xuất
```

Acceptance Criteria:

- Tài khoản cố định được bootstrap ngoài luồng public và đăng nhập email/mật khẩu hoạt động.
- Session hợp lệ tồn tại sau refresh.
- Người chưa đăng nhập bị chuyển khỏi protected page.
- Protected procedure từ chối unauthenticated request.
- Trạng thái error, loading và sai thông tin đăng nhập dễ hiểu.
- Public signup bị vô hiệu hóa ở server và không có UI `/register`.

Không bao gồm social login, organization/role và account administration UI.

## 5. Slice 2 — App Shell và Navigation

Backlog liên quan: `AFF-US-002`.

```text
Đăng nhập → protected app shell → mở project demo → chuyển 7 bước → back/forward/refresh
```

Acceptance Criteria:

- App dùng chung sidebar và topbar dạng panel trong protected layout.
- Sidebar có Dashboard, Dự án, Sản phẩm, Media Library, Analytics, Chi phí & Usage
  và Cài đặt.
- Topbar có title ngắn theo route, notification entry point và profile; không lặp mô tả
  dài hoặc breadcrumb ở đầu trang.
- ProjectStepper có 7 bước và 5 trạng thái hiển thị bằng chữ/icon, không chỉ bằng màu.
- Direct URL, browser back/forward và refresh giữ đúng shell, route và active step.
- Route chưa có business logic hiển thị skeleton/placeholder rõ ràng.

US002 không tạo Project CRUD, business schema hoặc persistence StepStatus. Slice
này chỉ định nghĩa `ProjectStepKey`, `ProjectStepStatus` và persistence contract
để US004 triển khai lưu trạng thái theo project. Từ US004, workflow current được
lưu tại `Project.currentStepKey`; URL chỉ xác định bước đang được xem, còn
`Project/ContentBrief/StepStatus` là persistence domain thực.

## 6. Slice 3 — Product

Backlog liên quan: `AFF-US-005`.

```text
Mở Products → tạo product → sửa product → archive product
```

- Dữ liệu Product tồn tại trong Neon.
- Mọi thao tác đều kiểm tra ownership.
- List/detail có loading, empty, error và unauthorized.
- Product có dependency được archive thay vì xóa cứng.

## 7. Slice 4 — Product Facts

Backlog liên quan: `AFF-US-006` và `AFF-US-007`.

```text
Mở product → thêm fact có nguồn → kiểm tra freshness → sửa/archive fact
```

- Fact giữ source và verification metadata.
- Fact về giá/khuyến mại hỗ trợ expiry.
- Fact hết hạn/thay đổi chuyển sang review rõ ràng.
- Thay đổi fact có thể vô hiệu Fact Lock run phụ thuộc sau này.

## 8. Slice 5 — Project và Content Brief

Backlog liên quan: `AFF-US-004`.

```text
Tạo project → chọn product → khai báo brief → lưu → mở lại
```

- Project scope và ownership được lưu.
- Required field của brief được validate.
- Project mở lại với workflow state hiện tại.
- Dashboard ban đầu có thể hiển thị recent projects.

Trạng thái AFF-US-004 (2026-08-11): đã triển khai vertical slice tạo/list/mở lại
project. Để không chặn flow, slice có Product prerequisite tối thiểu (chọn hoặc tạo
product trong form); Product management đầy đủ vẫn thuộc AFF-US-005. Tên project được
phép trùng trong workspace. `currentStepKey` là workflow source of truth; các dòng
`project_step_status` chỉ lưu `not_started`, `completed`, `needs_review` hoặc `blocked`.

Trạng thái AFF-US-003 (2026-08-11): đã triển khai Dashboard read model từ Project thật.
Dashboard dùng protected aggregate query, không thêm bảng riêng, hiển thị 4 summary card,
recent projects giới hạn 5, activity derive từ created/updated timestamps, warnings/cost/job
placeholder trung thực và mở project theo current step. Authenticated E2E còn chờ fixed account.

## 9. Slice 6 — Structured Script

Backlog liên quan: `AFF-US-008` và `AFF-US-009`.

```text
Mở project → tạo mock structured draft → chỉnh sửa → lưu version
```

Thứ tự triển khai:

1. Định nghĩa và validate script schema.
2. Xây editor bằng deterministic mock output.
3. Thêm immutable version persistence.
4. Chỉ tích hợp một Text AI adapter sau khi schema và UI hoạt động.

- Hook, voice segment, scene, CTA, caption, hashtag, disclosure và claim có field
  riêng.
- Provider output không hợp schema không được ghi đè draft hợp lệ.
- Mỗi lần lưu/chỉnh sửa tạo script version nhận diện được.

## 10. Slice 7 — Fact Lock

Backlog dự kiến: `AFF-US-010`; phải sửa khoảng trống ID hiện có trước triển khai.

```text
Chạy kiểm tra → xem claim → liên kết bằng chứng → xử lý review → pass hoặc blocked
```

Acceptance Criteria tuân theo `product-spec.md`. TTS và Render bị khóa nếu
version hiện tại chưa có run đạt.

## 11. Slice 8 — Voice và media

Backlog liên quan: `AFF-US-011` đến `AFF-US-014`.

- Test TTS tiếng Việt bằng script đại diện.
- Tạo voice theo segment và cache bằng normalized input hash.
- Upload và validate media thật.
- Gắn media và voice vào scene có thứ tự.

## 12. Slice 9 — Preview và render

Backlog liên quan: `AFF-US-015` đến `AFF-US-020`.

- Scene editor tuần tự cố định.
- Overlay, subtitle, CTA và audio preset cơ bản.
- Một Remotion composition dùng chung cho preview/render.
- Local worker riêng và persistent render job.
- MP4 retry được và có render version history.

MVP 0 hoàn thành khi slice này đạt end-to-end.

## 13. Slice sau MVP

Sau khi có dữ liệu sử dụng thực tế:

1. Channel Settings và mặc định tái sử dụng.
2. Content lifecycle và lịch bảy ngày.
3. Publication record và metric snapshot.
4. Analytics mô tả và hiệu quả chi phí.
5. Một Video AI provider có kiểm soát.

## 14. Backlog trì hoãn

- Routing fallback nhiều provider.
- Premium Video AI adapter.
- Auto-post.
- Recommendation engine.
- Mobile editing nâng cao.
- Quản trị team/workspace.

## 15. Definition of Done của một slice

- Acceptance Criteria đã demo đạt.
- Domain invariant được thực thi ở server.
- Authorization và truy cập chéo người dùng được test.
- Có loading, empty, validation, error, unauthorized và success.
- Type-check và Biome đạt.
- Migration được tạo và review khi phù hợp.
- Changelog và AI progress được cập nhật.
- Slice sau không phụ thuộc hành vi chưa được tài liệu hóa.

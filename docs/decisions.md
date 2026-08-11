# Các quyết định kiến trúc AffiChannel

- Trạng thái: Đang áp dụng
- Cập nhật lần cuối: 2026-08-10

Đây là nhật ký ADR dạng gọn. Không đánh lại số quyết định đã chấp nhận. Khi có
thay đổi quan trọng, hãy tạo quyết định mới thay thế thay vì âm thầm sửa lịch sử.

## Mẫu quyết định

```text
### DEC-NNN — Tiêu đề

- Trạng thái: Đề xuất | Đã chấp nhận | Đã thay thế
- Ngày: YYYY-MM-DD
- Thay thế: mã quyết định nếu có

Bối cảnh
Quyết định
Hệ quả
```

## DEC-001 — Tài liệu triển khai chuẩn

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Các tài liệu Word và spreadsheet lịch sử có nhiều chi tiết hữu ích nhưng khác
nhau về phạm vi và cách gọi tên.

### Quyết định

Các file Markdown trong `docs/` là nguồn sự thật trực tiếp để triển khai, theo
thứ tự ưu tiên trong `docs/README.md`.

### Hệ quả

Agent phải cập nhật tài liệu Markdown chuẩn khi hành vi hoặc kiến trúc thay đổi.
Tài liệu lịch sử chỉ còn vai trò tham khảo.

## DEC-002 — Full-stack Next.js cho thao tác web đồng bộ

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Ứng dụng cần private web UI, authentication, CRUD và typed browser operation cho
một nhóm người dùng cố định nhỏ.

### Quyết định

Dùng Next.js App Router trên Vercel cùng oRPC, Better Auth, Drizzle và Neon.
Không tạo general-purpose API server riêng trong MVP 0.

### Hệ quả

`runtime: none` trong Better T Stack vẫn đúng. Công việc dài hạn vẫn bị loại khỏi
Vercel request handler.

## DEC-003 — Render worker riêng

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Remotion và FFmpeg chạy lâu, dùng nhiều tài nguyên và cần job state bền vững cùng
file tạm.

### Quyết định

Chạy render trong `apps/worker`, ban đầu chạy local cho MVP 0 nếu chủ dự án chưa
chọn nơi deploy. Vercel tạo/đọc job nhưng không render.

### Hệ quả

Repository tiếp tục dùng Turborepo. Render input và state phải serialize được và
dùng chung mà không import Next.js.

## DEC-004 — Triển khai theo vertical slice

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Backlog hiện tại quá rộng để triển khai hiệu quả theo các giai đoạn frontend và
backend tách rời.

### Quyết định

Làm từng User Story với database, domain logic, API, UI, trạng thái và test. Chỉ
giữ một story đang thực hiện.

### Hệ quả

Dashboard và summary screen chỉ hoàn thiện sau khi có dữ liệu nguồn. Có thể dùng
mock provider response để xác minh contract trước live AI integration.

## DEC-005 — Product Facts và Fact Lock

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Nội dung affiliate có thể chứa claim cũ, phóng đại hoặc không được hỗ trợ.

### Quyết định

Product Facts là nguồn sự thật. Fact Lock bắt buộc cho đúng script version hiện
tại trước TTS và render. AI được đề xuất bằng chứng nhưng không tự duyệt claim.

### Hệ quả

Fact phải có provenance và freshness metadata. Thay đổi script/fact làm kết quả
phụ thuộc mất hiệu lực. Trạng thái claim và evidence link được lưu lại.

## DEC-006 — MVP 0 không có Video AI và analytics nâng cao

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Provider integration, generation bất đồng bộ, import analytics và recommendation
sẽ làm phiên bản đầu quá rộng.

### Quyết định

MVP 0 kết thúc bằng video render từ media thật, TTS, Fact Lock, Remotion
composition cố định và đăng thủ công. Video AI và analytics chỉ làm sau khi có
dữ liệu sử dụng thực tế.

### Hệ quả

Không thêm Video AI SDK, tạo calendar hoặc analytics dashboard trong MVP 0 nếu
quyết định này chưa bị thay thế.

## DEC-007 — Chiến lược storage của MVP 0

- Trạng thái: Đề xuất
- Ngày: 2026-08-10

### Bối cảnh

Web app cuối cùng sẽ cần R2, nhưng local render worker có thể bắt đầu nhanh hơn
với local file.

### Quyết định đề xuất

Định nghĩa storage adapter trước khi làm media. Chọn local-first hoặc R2-first
khi bắt đầu Slice 7 mà không thay đổi domain record hoặc object-key semantics.

### Hệ quả

Không bắt đầu media implementation trước khi chủ dự án chấp nhận một lựa chọn.

## DEC-008 — Mô hình ownership cho nhóm cố định

- Trạng thái: Đề xuất
- Ngày: 2026-08-10

### Bối cảnh

Ứng dụng có hai hoặc ba tài khoản cố định, không cần organization/role nâng cao,
nhưng vẫn phải kiểm tra quyền ở mức bản ghi.

### Quyết định đề xuất

Chọn một mô hình trước khi triển khai Product schema:

1. mọi tài khoản cố định dùng chung một internal group scope; hoặc
2. dữ liệu thuộc từng user và được chia sẻ rõ ràng.

### Hệ quả

Lựa chọn này ảnh hưởng mọi protected table và procedure, nên phải chốt trước
Slice 2.

## DEC-009 — Tài khoản cố định, không public signup trong MVP 0

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

AffiChannel là ứng dụng private cho một nhóm thành viên cố định. Public signup
không cần thiết cho MVP 0 và làm tăng bề mặt tấn công cũng như chi phí vận hành
account administration.

### Quyết định

US001 chỉ hỗ trợ email/password cho các tài khoản cố định. Better Auth production
được cấu hình `disableSignUp: true`; không có route hoặc UI `/register`. Tài khoản
được tạo qua bootstrap script chỉ dành cho môi trường non-production, không qua
endpoint public và không lưu password trong repository.

Proxy chỉ làm optimistic redirect cho protected page. Dashboard page và protected
oRPC procedure vẫn bắt buộc kiểm tra session ở server. Social login, forgot
password, email verification, 2FA, organization và role nằm ngoài US001.

### Hệ quả

Acceptance Criteria của Slice 1 dùng fixed-account bootstrap thay cho đăng ký mở.
Mọi thay đổi ownership/group vẫn phải chốt trước Product schema theo DEC-008.

## DEC-010 — App Shell trước persistence Project

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

US002 cần route, sidebar, topbar và ProjectStepper để các màn hình sau có cùng
context. Backlog ban đầu đồng thời yêu cầu lưu StepStatus, trong khi US004 đã
được giao thiết kế Project, ContentBrief và StepStatus.

### Quyết định

US002 triển khai App Shell, route contract, fixture project và mapping trạng thái
step. Không tạo Project CRUD, business schema hoặc persistence StepStatus ở slice
này. Trạng thái `current` được suy ra từ route; các trạng thái domain còn lại sẽ
được lưu cùng Project ở US004.

### Hệ quả

US004 phải cung cấp contract persistence tương thích với `ProjectStepKey` và
`PersistedProjectStepStatus`. Fixture/demo route của US002 chỉ là navigation
scaffold, không được xem là business data.

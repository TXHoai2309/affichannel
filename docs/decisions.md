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

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-11

### Bối cảnh

Ứng dụng có hai hoặc ba tài khoản cố định, không cần organization/role nâng cao,
nhưng vẫn phải kiểm tra quyền ở mức bản ghi.

### Quyết định

Mọi tài khoản cố định thuộc một internal workspace chung. Mỗi protected read/mutation
xác định workspace từ `workspace_member` ở server; client không gửi workspace ID.
`createdByUserId` lưu audit, không thay thế authorization. Chưa tạo organization, role,
invitations hoặc administration UI trong MVP.

### Hệ quả

Product và Project có `workspaceId`; mọi access phải lọc theo workspace. Đa workspace
hoặc role nâng cao là migration/domain slice riêng sau MVP, không thêm dần trong feature UI.

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

## DEC-011 — Vòng đời Product và liên kết Project trong AFF-US-005

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-11

### Bối cảnh

Product được tái sử dụng bởi nhiều Project. Archive Product không được làm hỏng các Project
cũ, nhưng Product đã inactive hoặc archived không được chọn cho Project mới.

### Quyết định

Giữ quan hệ `project.productId` với foreign key restrict. `Product.status` biểu diễn active/inactive;
`archivedAt` biểu diễn archive. Selector mới dùng `listMinimal({ selectableOnly: true })` và lọc
`status=active AND archivedAt IS NULL`. Khi update Project, Product hiện tại được phép giữ nguyên
dù đã inactive/archived; đổi sang Product khác vẫn phải thỏa điều kiện selectable. `referenceCount`
đếm mọi Project còn tồn tại, kể cả Project đã archive. Hard delete chỉ thực hiện khi count bằng 0.

### Hệ quả

Product detail phải hiển thị usage count và các Project liên quan. Delete bị chặn bằng lỗi domain
`PRODUCT_IN_USE`; archive/restore là action riêng. US005 không mở rộng sang Product Facts, R2,
media upload hoặc grid/list toggle.

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

## DEC-012 — Product Facts: verification, history và Product ownership

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-12

### Bối cảnh

Product Facts là dữ liệu nguồn để tái sử dụng trong brief và các bước kiểm tra sau này.
MVP cần lưu được nguồn, vòng đời và lịch sử thay đổi mà chưa mở rộng sang scheduler,
freshness automation hoặc provider AI.

### Quyết định

- `ProductFact.status` chỉ dùng `draft`, `verified`, `inactive`; `type` dùng `price`,
  `promotion`, `specification`, `feature`, `claim`, `policy`, `other`.
- Khi `verified`, Fact loại `price`, `promotion` hoặc `claim` bắt buộc có `sourceType`,
  `sourceLabel` hoặc `sourceUrl`, và `confirmedAt`. Server/core là nơi thực thi rule này.
- `confirmedAt` và `expiresAt` là PostgreSQL `date`/chuỗi `YYYY-MM-DD`, không chuyển timezone.
  `expiresAt` không được trước `confirmedAt`.
- Sửa sensitive field của Fact đang `verified` sẽ demote về `draft` nếu không re-verify;
  re-verify chỉ thành công khi evidence hợp lệ. Fact `verified` chỉ đủ điều kiện AI khi
  status và evidence rule đều đạt.
- Mỗi create/update/delete ghi snapshot trong cùng transaction. History không có FK tới
  `ProductFact`, nên vẫn giữ `productFactId` sau hard delete Fact. Product không hard-delete
  khi còn Project, Fact hoặc Fact history; archive vẫn được phép.
- Facts được truy cập dưới hierarchy Product và workspace authorization. UI dùng deep-link
  `/products/{productId}?tab=facts`; URL là source of truth cho tab và back/forward/reload.

### Hệ quả

US007 mới được bổ sung freshness/stale detection hoặc scheduler; US008 mới được bổ sung
Fact Lock/provider/fetching. Product `priceAmount` vẫn là metadata hiển thị, không đồng bộ
với Fact `type=price`.

## DEC-013 — Intent xác minh Fact và anatomy Drawer dùng chung

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-12

### Bối cảnh

Form chỉnh sửa Fact có thể gửi lại `status=verified` từ state cũ trong khi nội dung hoặc
evidence đã thay đổi. Base UI Drawer cũng yêu cầu `Viewport` để popup hoạt động đúng và
tránh mất swipe handling/touch scroll lock.

### Quyết định

- Update Product Fact phải có intent rõ ràng `preserve | verify`, mặc định là `preserve`.
  Sensitive edit của Fact đang `verified` với `preserve` luôn demote về `draft`; notes-only
  được giữ `verified`. Chỉ `verify` mới chuyển sang `verified`, sau khi server/core validate
  evidence theo type mới và trạng thái hiện tại.
- Shared Drawer dùng anatomy `Drawer.Portal > Drawer.Viewport > Drawer.Popup`; Drawer dạng
  panel bên phải đặt `swipeDirection="right"`. Feature không tự dựng anatomy riêng.
- Tab Product Detail dùng `router.push` cho thao tác người dùng; URL `?tab=facts` là nguồn
  sự thật để render và khôi phục bằng reload/back/forward. `replace` chỉ phù hợp cho chuẩn hóa
  URL nội bộ không tạo history entry.

### Hệ quả

UI phải tách action lưu bình thường khỏi action re-verify và hiển thị cảnh báo khi verified
data bị thay đổi. Regression phải kiểm tra console error của Drawer, lifecycle verified và
history navigation; không dùng global zero-console-errors assertion cho toàn ứng dụng.
## DEC-014 — Freshness, generation usability và dependency invalidation của Product Fact

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-12

### Bối cảnh

Price và promotion có thể trở nên lỗi thời theo thời gian. Khi Fact thay đổi, các bước
sản xuất đã tham chiếu revision cũ phải được đánh dấu cần xem lại; việc này không thể
để từng module tự suy luận riêng.

### Quyết định

- Freshness là assessment/read model, không mở rộng `ProductFact.status`. Chính sách tập
  trung dùng `priceMaxAgeDays=7`, `promotionMaxAgeDays=3`, cảnh báo trước hạn 1 ngày và
  timezone nghiệp vụ `Asia/Ho_Chi_Minh`.
- Tính ngày theo lịch `YYYY-MM-DD`, truyền rõ `today` vào evaluator và không parse date-only
  bằng `new Date("YYYY-MM-DD")`. Thứ tự kết quả là `not_applicable`, `unknown`, `expired`,
  `needs_update`, rồi `fresh`.
- Generation usability tách khỏi freshness: verified+fresh được phép, verified+needs_update
  được phép kèm cảnh báo, còn draft/inactive/thiếu evidence/unknown/expired bị chặn.
  `isFactEligibleForAi()` hiện tại vẫn giữ nguyên.
- Fact có `revision`, mặc định 1. Thay đổi content/type/status/source/date làm tăng revision;
  notes-only không tăng revision. Update/delete dùng optimistic CAS với `expectedRevision`.
- Dependency engine dùng bảng `fact_dependency` và `fact_invalidation_event`. Register phải
  tự đọc revision hiện tại ở server, idempotent; replace detach dependency bị bỏ; mutation,
  history, revision, invalidation và event nằm trong cùng transaction. Clock freshness không
  tự invalidation dependency.
- Dashboard chỉ hiển thị cảnh báo aggregate theo Product và deep-link về
  `/products/{productId}?tab=facts`; không tạo warning table riêng.

### Hệ quả

US008/Fact Lock có thể dùng dependency service và generation usability contract mà không
phụ thuộc vào implementation của UI. Scheduler, notification, scraping và provider AI vẫn
nằm ngoài US007.

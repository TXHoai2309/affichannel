# Đặc tả sản phẩm AffiChannel

- Trạng thái: Bản nháp
- Phiên bản: 0.1.0
- Cập nhật lần cuối: 2026-08-10
- Đối tượng đọc: chủ dự án và các agent triển khai

## 1. Tóm tắt sản phẩm

AffiChannel là ứng dụng web riêng dành cho nhóm cố định từ hai đến ba người để
lập kế hoạch, tạo, render và đánh giá video affiliate dạng ngắn. Đây là công cụ
năng suất nội bộ, không phải sản phẩm SaaS thương mại.

Giá trị cốt lõi là một quy trình có kiểm soát, giúp giảm thao tác lặp lại nhưng
vẫn truy vết được claim sản phẩm và giữ quyết định đăng bài cuối cùng ở con người.

## 2. Nguyên tắc sản phẩm

1. Product Facts là nguồn sự thật cho các claim về sản phẩm.
2. AI tạo bản nháp và đề xuất; AI không tự phê duyệt fact.
3. Fact Lock phải đạt cho đúng phiên bản script hiện tại trước TTS hoặc render.
4. Việc đăng bài vẫn được thực hiện thủ công trong MVP.
5. Media thật của sản phẩm là mặc định; video sinh bởi AI chỉ là thành phần tùy
   chọn.
6. Chi phí, số lần thử lại, nguồn dữ liệu và trạng thái job phải minh bạch.
7. Một luồng end-to-end nhỏ có giá trị hơn nhiều màn hình chưa kết nối.

## 3. Người dùng

### Người dùng chính

Người vận hành kênh chọn sản phẩm, tạo nội dung, duyệt claim, ghép media, xuất
video, đăng thủ công và ghi nhận hiệu suất.

### Mô hình người dùng

- Hai hoặc ba tài khoản cố định.
- Đăng nhập bằng email và mật khẩu.
- Không có organization, billing, marketplace hoặc hệ thống role phức tạp trong
  MVP.
- Authentication không thay thế authorization: mọi thao tác được bảo vệ phải
  xác minh người dùng hiện tại có quyền truy cập bản ghi yêu cầu.

## 4. Mục tiêu

- Lưu thông tin sản phẩm và bằng chứng hỗ trợ để tái sử dụng.
- Chuyển Content Brief thành script có cấu trúc.
- Phát hiện claim không được hỗ trợ, hết hạn hoặc bị cấm trước khi sản xuất.
- Tạo hoặc gắn voiceover và media theo từng scene.
- Preview và render MP4 dọc.
- Lưu version và trạng thái job có thể tiếp tục.
- Ghi nhận chi phí và metrics sau đăng mà không tính trùng.

## 5. Ngoài phạm vi MVP

- Bán công cụ cho khách hàng bên ngoài.
- Thanh toán, subscription, quota hoặc token nội bộ.
- Workspace nhiều tenant và phân quyền nâng cao.
- Tự động đăng production lên mạng xã hội.
- Trình chỉnh sửa phi tuyến hoàn chỉnh như CapCut hoặc Premiere.
- Tự động fallback qua nhiều Video AI provider.
- AI tạo nhạc.
- Kết luận nhân quả hoặc recommendation model nâng cao.
- Ứng dụng mobile native.

## 6. Phạm vi triển khai

### MVP 0: video đầu tiên sử dụng được

MVP 0 phải hỗ trợ một luồng hoàn chỉnh:

```text
Đăng nhập
→ tạo sản phẩm
→ thêm Product Facts đã xác minh
→ tạo project và Content Brief
→ tạo nháp và chỉnh script có cấu trúc
→ duyệt Fact Lock
→ gắn media thật
→ tạo hoặc gắn TTS
→ preview template 9:16 cố định
→ render MP4
→ xuất caption và affiliate disclosure
```

MVP 0 không bao gồm Video AI, tạo lịch nội dung, analytics nâng cao và auto-post.

### MVP 1: quy trình vận hành

- Channel Settings và các thiết lập nội dung tái sử dụng.
- Content Library và trạng thái vòng đời.
- Kế hoạch bảy ngày.
- Import metrics CSV/XLSX và analytics mô tả.
- Báo cáo chi phí theo request, project và video đã đăng.

### MVP 2: media sinh bởi AI có kiểm soát

- Một Video AI provider qua adapter và feature flag.
- Job bất đồng bộ, idempotency, giới hạn retry và xác nhận chi phí.
- Tối đa hai scene AI và mười hai giây AI cho mỗi video.
- Có thể thay bằng media thật khi tạo AI lỗi hoặc bị từ chối.

## 7. Khái niệm domain cốt lõi

### Product

Sản phẩm affiliate tái sử dụng, gồm danh tính, link affiliate, trạng thái, media
và tham chiếu hiệu suất.

### Product Fact

Thông tin có cấu trúc có thể dùng để hỗ trợ claim trong script. Tối thiểu lưu:

- loại fact và giá trị đã chuẩn hóa;
- đơn vị nếu có;
- URL hoặc file bằng chứng;
- nhãn nguồn;
- `retrievedAt` và `lastVerifiedAt`;
- `validUntil` tùy chọn cho giá và khuyến mại;
- locale, thị trường hoặc người bán khi có liên quan;
- trạng thái: active, needs review, expired hoặc archived.

### Project

Đơn vị sản xuất nội dung, liên kết sản phẩm, nền tảng, mục tiêu, thời lượng, góc
tiếp cận, các version script, scene, asset, render và dữ liệu đăng bài.

### Script version

Phiên bản bất biến đã lưu của hook, voiceover segment, chỉ dẫn scene, on-screen
text, CTA, caption, hashtag, disclosure và các claim đã tách.

### Fact-check run

Kết quả kiểm tra cho đúng một script version. Khi sửa nội dung chứa claim, kết
quả cũ bị vô hiệu và chuyển sang stale.

### Scene

Một đoạn video có thứ tự, thời lượng, visual asset, voice segment, overlay text,
subtitle cue, transition preset và thông tin nguồn media.

### Render job và render version

Job bất đồng bộ được lưu bền vững và metadata đầu ra bất biến. Render lỗi hoặc
gián đoạn không được làm mất project.

### Published post và metric snapshot

Render version đã đăng và metrics tích lũy tại một thời điểm. Analytics tính phần
tăng giữa các snapshot và không cộng trực tiếp nhiều snapshot tích lũy.

## 8. Hành vi Fact Lock

Các trạng thái claim:

- `SUPPORTED`: có bằng chứng đủ và còn hiệu lực.
- `NEEDS_REVIEW`: có khả năng được hỗ trợ nhưng wording, phạm vi, nguồn hoặc hạn
  hiệu lực cần con người xử lý rõ ràng.
- `UNSUPPORTED`: không có Product Fact đủ hỗ trợ claim.
- `PROHIBITED`: vi phạm quy tắc nội dung đang áp dụng và không được override.
- `STALE`: script hoặc fact hỗ trợ đã thay đổi sau lần kiểm tra.

Fact Lock run chỉ là `PASSED` khi:

- áp dụng cho đúng script version hiện tại;
- không có claim `UNSUPPORTED`, `PROHIBITED` hoặc `STALE`;
- mọi claim `NEEDS_REVIEW` đã có hành động xử lý được ghi lại;
- mọi claim được hỗ trợ vẫn còn liên kết đến bằng chứng.

Semantic matching hoặc LLM có thể đề xuất fact liên quan. Hệ thống không được
đánh dấu claim là supported nếu thiếu bằng chứng cụ thể.

## 9. Các màn hình chính

US002 chuẩn hóa protected App Shell dùng chung cho các màn hình MVP: Dashboard,
Dự án, Sản phẩm, Media Library, Analytics, Chi phí & Usage và Cài đặt. Các entry
point chưa có business logic vẫn phải có route, breadcrumb, loading/skeleton và
trạng thái placeholder rõ ràng; App Shell không được được xem là Product CRUD.
Project dùng stepper 7 bước: Sản phẩm, Nội dung, Fact Lock, Giọng đọc, Dựng video,
Preview & Render và Hoàn thành.

### Màn hình MVP 0

1. Đăng nhập bằng tài khoản thành viên cố định được bootstrap ngoài luồng public.
2. Dashboard tối thiểu với trạng thái thiết lập và project gần đây.
3. Danh sách và chi tiết sản phẩm.
4. Trình chỉnh Product Facts.
5. Project và Content Brief.
6. Script Studio và panel Fact Lock.
7. Video workspace gồm media, TTS, preview và trạng thái render.
8. Kết quả render và gói export.

### Màn hình giai đoạn sau

- Channel Settings.
- Content Calendar.
- Content Library.
- Analytics.
- Cài đặt provider, storage, voice và render.

## 10. Vòng đời nội dung

```text
IDEA
→ WRITING
→ FACT_REVIEW
→ READY
→ IN_VIDEO
→ RENDERING
→ RENDERED
→ POSTED
→ ANALYZED
→ ARCHIVED
```

Chuyển trạng thái phải được kiểm tra ở server. Giao diện có thể hướng dẫn nhưng
không được là lớp kiểm soát duy nhất.

## 11. Yêu cầu UX toàn cục

- Mọi màn hình dữ liệu có trạng thái loading, empty, success, error và
  unauthorized.
- Hành động phá hủy cần xác nhận và phải tôn trọng quan hệ phụ thuộc.
- Autosave hiển thị saving, saved, offline và failed.
- Job dài vẫn tồn tại khi chuyển trang hoặc reload.
- Request tốn phí hiển thị provider, model, tham số đầu vào, chi phí dự kiến và
  chính sách retry trước khi gửi.
- Affiliate disclosure nằm trong gói export.
- Ngày giờ, múi giờ, tiền tệ, sample size và nguồn dữ liệu phải hiển thị khi ảnh
  hưởng đến cách hiểu.

## 12. Acceptance Criteria của MVP 0

- Thành viên cố định đăng nhập, đăng xuất và giữ session hợp lệ khi refresh.
- Người không có quyền không thể đọc hoặc sửa bản ghi được bảo vệ.
- Sản phẩm và fact được lưu ở Neon và mở lại được.
- Project tham chiếu được sản phẩm và lưu Content Brief.
- Script có cấu trúc chỉnh sửa và version hóa được.
- Fact Lock chặn sản xuất khi claim của version hiện tại không hợp lệ.
- Media thật và TTS được gắn theo scene.
- Preview 9:16 dùng dữ liệu project đã lưu.
- Render lỗi có thể retry và không làm mất project.
- Render thành công tạo metadata MP4 và gói caption có thể export.
- Secret không xuất hiện trong source, client bundle, log, database hoặc file
  export.

## 13. Quyết định còn mở

- File render của MVP 0 lưu local hay upload R2 ngay.
- TTS provider nào vượt qua kiểm thử phát âm tiếng Việt.
- Mô hình ownership chính xác cho nhóm cố định hai đến ba người.
- Nhóm Product Fact nào cần quy tắc đối chiếu deterministic đầu tiên.
Các quyết định mở phải được xử lý trong `decisions.md` trước khi việc triển khai
trở nên khó thay đổi.

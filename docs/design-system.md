# Hệ thống thiết kế AffiChannel

- Trạng thái: Bản nháp
- Phiên bản: 0.1.0
- Cập nhật lần cuối: 2026-08-10

## 1. Định hướng thiết kế

AffiChannel phải tạo cảm giác như một workspace sản xuất tập trung: điềm tĩnh,
rõ ràng và đáng tin cậy. Giao diện không nên giống dashboard AI chung chung với
glow, gradient hoặc metric chỉ mang tính trang trí.

Thứ tự ưu tiên:

1. Làm rõ hành động tiếp theo.
2. Đặt bằng chứng và trạng thái gần nội dung chứa claim.
3. Minh bạch hành động tốn phí hoặc khó hoàn tác.
4. Giữ output 9:16 trong tầm nhìn khi dựng video.
5. Ưu tiên hierarchy và khoảng trắng hơn hiệu ứng.

## 2. Visual tokens

### Màu cốt lõi

| Token | Giá trị | Mục đích |
|---|---|---|
| `blue-500` | `#1677F2` | Primary action và active navigation |
| `blue-900` | `#122D58` | Heading, primary text và icon |
| `blue-50` | `#F2F7FF` | Secondary surface và selected support state |
| `white` | `#FFFFFF` | Card, sidebar và topbar surface |
| `blue-100` | `#DCE9FB` | Border, divider và input |
| `green-600` | `#1FA463` | Trạng thái hoàn thành / supported |
| `orange-500` | `#F28C28` | Chi phí và cảnh báo cần chú ý |
| `purple-500` | `#8667DF` | Phân nhóm phụ, không dùng cho primary action |

Các giá trị trên được map vào token dùng chung trong
`packages/ui/src/styles/globals.css`. Workspace dùng nền xanh rất nhạt
`#F7FAFF`, surface dùng trắng, primary/active dùng blue và text dùng blue-900.

### Màu ngữ nghĩa

| Ý nghĩa | Cách thể hiện |
|---|---|
| Thông tin | Nền xanh lam nhạt và chữ xanh đậm |
| Thành công / supported | Nền xanh lá, icon và chữ đậm dễ đọc |
| Cần xem lại | Nền amber và nhãn review rõ ràng |
| Unsupported / lỗi | Nền đỏ và hành động sửa lỗi |
| Prohibited | Màu đỏ mạnh; không chỉ dựa vào màu |
| Stale | Nền trung tính/amber và hành động chạy lại |

Mọi trạng thái phải có chữ hoặc icon ngoài màu sắc. Độ tương phản tối thiểu đạt
WCAG AA cho chữ thông thường.

### Hạn chế màu sắc

- Không dùng gradient tím-xanh.
- Không dùng glow effect.
- Không truyền đạt trạng thái chỉ bằng màu nền.
- Không dùng blue cho success/error; mỗi trạng thái phải có label hoặc icon đi kèm.
- Không dùng orange hoặc purple làm màu primary; blue là màu hành động chính.

## 3. Typography

- Dùng một sans-serif dễ đọc qua `next/font`.
- Body text: 14–16 px tùy mật độ.
- Page title: 28–32 px, semibold.
- Section heading: 18–22 px, semibold.
- Label và metadata: 12–14 px, đủ tương phản.
- Số liệu chi phí và analytics dùng tabular numerals.
- Không viết hoa toàn bộ body label; chỉ dùng cho status token ngắn.

Chữ tiếng Việt, tên sản phẩm dài, giá, đơn vị và URL phải luôn đọc được.

## 4. Khoảng cách và hình học

- Đơn vị khoảng cách cơ sở: 4 px.
- Khoảng cách thường dùng: 8, 12, 16, 24 và 32 px.
- Chiều cao control chuẩn: 40 px.
- Chiều cao control compact: 32 px.
- Control chuẩn: radius 10 px; control compact: radius 8 px.
- Card và panel: radius 12–14 px; dialog/drawer: 18 px.
- Border của panel phải nhẹ và có chức năng.
- Giao diện cần mềm và dễ tiếp cận, không tạo một lưới ô vuông cứng: phối hợp
  bo góc theo hierarchy, border nhẹ và shadow rất tiết chế. Không dùng
  `rounded-none` cho surface hay control chuẩn; góc vuông chỉ dành cho divider,
  bảng dữ liệu dày đặc hoặc content lồng bên trong một khung đã bo góc.
- Không đặt đoạn văn dài trong card hẹp.

## 5. Application shell

### Chế độ chuẩn

- Sidebar trái: module chính và project context.
- Topbar: page context, trạng thái cloud/job và user menu. Page context gồm title
  và mô tả in nghiêng, là page header duy nhất cho các route chuẩn.
- Main content: primary action và vùng làm việc, không lặp lại title/mô tả đã có
  ở topbar.
- Global job indicator luôn hiện khi chuyển route.

### Nội dung đầu trang

- Chỉ giữ eyebrow khi nó truyền đạt dữ liệu thật như trạng thái, số lượng, thời
  điểm hoặc bước tiếp theo; không dùng nhãn phân loại chung chung chỉ để trang
  trí hoặc lặp lại title.
- Ưu tiên title và mô tả trả lời được người dùng đang ở đâu, dữ liệu nào được
  quản lý và họ nên làm gì tiếp theo.
- Không dùng breadcrumb như một cell chỉ lặp title. Với route sâu, title project
  và stepper cung cấp ngữ cảnh điều hướng; topbar vẫn giữ contract chung.
- Mô tả trong contract topbar dùng italic để phân biệt với title và phải có thể
  bị truncate an toàn trên màn hình hẹp.
- Status badge phải phản ánh dữ liệu domain thật. Với màn hình chưa có logic,
  dùng placeholder rõ phạm vi thay vì một badge status giả.
- Dùng tiếng Việt nhất quán, trừ tên sản phẩm và thuật ngữ domain cần giữ nguyên
  để chính xác.

### Creative mode

Video workspace dùng bố cục tập trung:

```text
┌──────────────┬────────────────────┬──────────────┐
│ Scene/media  │   Preview 9:16     │ Properties   │
│ navigation   │   và playhead      │ Fact/cost    │
└──────────────┴────────────────────┴──────────────┘
│ Quay lại                    Lưu / Preview / Render │
└────────────────────────────────────────────────────┘
```

Preview là trung tâm thị giác. Side panel có thể thu gọn ở màn hình hẹp. MVP
authoring ưu tiên desktop; mobile cần đọc được nhưng chưa cần editor hoàn chỉnh.

## 6. Điều hướng

App Shell của US002 có các entry point ổn định:

- Dashboard
- Dự án
- Sản phẩm
- Media Library
- Analytics
- Chi phí & Usage
- Cài đặt

Các module chưa có business logic hiển thị skeleton/placeholder rõ ràng. Script,
Fact Lock, Voice, Video, Preview và Completed được mở trong project stepper.

## 7. Quy ước component

### Button

- Mỗi vùng thị giác chỉ có một primary action.
- Hành động phá hủy dùng nhãn rõ như `Lưu trữ sản phẩm`, không dùng `OK`.
- Hành động tốn phí hiển thị estimate cạnh button hoặc trong dialog xác nhận.
- Button bị disable phải cho biết lý do bị chặn.

### Form

- Label luôn hiển thị; placeholder chỉ là ví dụ.
- Validation nằm cạnh field và có summary dễ truy cập khi submit lỗi.
- Không làm mất input của người dùng sau lỗi.
- Field tùy chọn phải ghi rõ khi có thể gây nhầm.
- Trạng thái lưu: `Chưa lưu`, `Đang lưu`, `Đã lưu`, `Lưu thất bại`.

### Table và list

- Chỉ dùng table cho dữ liệu lặp có thể so sánh.
- Cột action phải gọn.
- Chỉ thêm search/filter khi quy mô danh sách cần đến.
- Empty state giải thích vì sao trống và hành động tiếp theo.

### Status badge

Dùng thuật ngữ domain nhất quán. Ví dụ dùng `SUPPORTED`, không trộn `Valid`,
`Approved` và `OK`.

### Dialog, drawer và route

- Dialog: xác nhận hoặc quyết định tập trung.
- Drawer: chi tiết bổ trợ nhưng vẫn giữ context hiện tại.
- Full route: thao tác chỉnh sửa sâu, có version hoặc cần URL riêng.

## 8. Trạng thái UI bắt buộc

Mọi vùng bất đồng bộ phải có:

- loading ban đầu;
- không có dữ liệu;
- dữ liệu một phần;
- thành công;
- validation lỗi;
- permission lỗi;
- provider/network lỗi;
- đang retry;
- stale data khi phù hợp.

Skeleton phải gần với bố cục cuối. Không dùng full-page spinner nếu phần còn lại
của trang vẫn hoạt động được.

## 9. Giao diện Fact Lock

- Hiển thị claim trong context gốc của script.
- Đặt status, reason, supporting facts, source và freshness cạnh nhau.
- Bấm claim sẽ highlight vị trí nguồn trong editor.
- `NEEDS_REVIEW` bắt buộc ghi hành động xử lý.
- `PROHIBITED` có hành động viết lại/xóa nhưng không có override.
- Run stale phải disable TTS và Render, kèm `Chạy lại Fact Lock`.
- Luôn hiển thị script version đã được kiểm tra.

## 10. Giao diện chi phí và job

Trước khi gửi request, hiển thị:

- provider và model;
- duration/resolution hoặc đơn vị usage tương ứng;
- estimate theo tiền gốc và VND nếu có;
- retry policy;
- cảnh báo ngân sách.

Trong khi xử lý, trạng thái job phải tồn tại khi chuyển trang hoặc reload. Khi
lỗi, hiển thị nhóm nguyên nhân và hành động an toàn: retry, sửa input, thay media
hoặc cancel.

## 11. Video safe area

- Baseline: 9:16, 720 × 1280, 30 fps cho MVP 0.
- Control subtitle và CTA hiển thị safe-area guide.
- Nội dung quan trọng không nằm trong vùng overlay của nền tảng.
- Preview và render dùng cùng composition data và font.
- Chữ tiếng Việt dài phải wrap ổn định, không bị cắt.

## 12. Accessibility

- Mọi action và dialog dùng được bằng bàn phím.
- Focus indicator rõ ràng.
- Label, description và error association đúng.
- Thông báo trạng thái lưu và job dài khi phù hợp.
- Primary control có target xấp xỉ tối thiểu 40 × 40 px.
- Tôn trọng reduced-motion preference.
- Chart luôn có textual summary và context dữ liệu.

## 13. Vị trí triển khai

- Global tokens: `packages/ui/src/styles/globals.css`.
- Shared primitives: `packages/ui/src/components`.
- App-specific block: `apps/web/src/components` hoặc feature folder.
- Không nhân bản shared primitive trong web app.
- Ưu tiên convention Base UI/shadcn hiện có trước khi thêm thư viện component.

## 14. Checklist nghiệm thu thiết kế

- Primary action rõ ràng.
- Có loading, empty, error, unauthorized và success.
- Chữ không bị cắt ở desktop width thông thường.
- Keyboard navigation và focus hoạt động.
- Trạng thái không chỉ biểu diễn bằng màu.
- Đã thử chữ tiếng Việt và label dài.
- Hành động tốn phí/phá hủy có xác nhận.
- Thuật ngữ UI khớp đặc tả sản phẩm.

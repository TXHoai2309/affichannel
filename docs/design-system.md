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
| `navy-900` | `#17212B` | App frame, heading mạnh, primary text |
| `cream-50` | `#F6F3EC` | Nền workspace chính |
| `orange-500` | `#F2A541` | Primary action và active emphasis |
| `green-600` | `#2F7D64` | Trạng thái hoàn thành và supported |

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
- Không dùng orange làm warning; orange là màu hành động của sản phẩm.

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
- Card radius: 10–12 px.
- Border của panel phải nhẹ và có chức năng.
- Không đặt đoạn văn dài trong card hẹp.

## 5. Application shell

### Chế độ chuẩn

- Sidebar trái: module chính và project context.
- Topbar: page context, trạng thái cloud/job và user menu.
- Main content: title, mô tả ngắn, primary action rồi tới vùng làm việc.
- Global job indicator luôn hiện khi chuyển route.

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

Navigation của MVP 0:

- Dashboard
- Products
- Projects
- Settings

Script và Video workspace được mở từ project. Không hiển thị module top-level
trống khi chưa sử dụng được. Giai đoạn sau mới thêm Calendar, Content Library và
Analytics.

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

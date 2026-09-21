# AFF-US-027 — Canonical Analytics Ingestion và Read Model

- Trạng thái: Implementation complete; acceptance evidence captured
- Cập nhật lần cuối: 2026-09-20
- Phạm vi: manual CSV/XLSX import, canonical read model và protected Analytics UI

## 1. Mục tiêu và ranh giới

AFF-US-027 bổ sung một lớp analytics mô tả cho workspace. Người dùng có thể
preview và xác nhận snapshot từ CSV hoặc XLSX, xem riêng hiệu quả xây kênh,
Affiliate Monetization và AI/render cost, rồi lọc theo các dimension canonical.
Hệ thống không tự đưa ra recommendation, không gọi paid provider, không chạy
FFmpeg và không tự tạo hoặc sửa dữ liệu production content.

Import là manual và immutable: mỗi lần xác nhận tạo một `analytics_import_batch`
và các `analytics_metric_snapshot` additive. Project, ChannelStrategy,
PlannedContentItem và Product hiện hữu không bị rewrite.

## 2. Canonical contract

- Source types chỉ gồm `MANUAL_CSV` và `MANUAL_XLSX`; source identity là metadata
  do người dùng cung cấp, không phải authority thay thế workspace.
- Mapping version hiện tại là `analytics-import.v1`. Server trả mapping proposal,
  canonical metric registry và mapping fingerprint; client không được tự quyết
  timezone hoặc canonical identity.
- Ba metric families tách biệt: `CHANNEL_GROWTH`, `AFFILIATE_MONETIZATION` và
  `AI_RENDER_COST`. Metric key/unit phải khớp registry; giá trị `NaN`, Infinity,
  công thức và số không an toàn đều bị loại.
- Date-only và date có offset được chuẩn hóa theo timezone lưu trên Workspace.
  Range đảo, date không hợp lệ hoặc quá lớn đều fail closed.
- Attribution chỉ nhận canonical ID cùng workspace: Project,
  PlannedContentItem, Product, Pillar và Series. Không fuzzy-match title/name.
  Cross-workspace hoặc dimension không thuộc strategy của Project bị reject.
- `AI_RENDER_COST` chỉ nhận giá trị khớp usage record persisted được phép
  (`script_generation` hoặc `script_claim_refresh_run`). Không có usage record
  hợp lệ nghĩa là `unavailable`, không phải zero.
- Aggregate chạy ở server và luôn trả sample size, cờ insufficient sample với
  ngưỡng tối thiểu 5, số quan sát unattributed và correlation note an toàn.

## 3. Import lifecycle

1. `previewImport` decode bounded base64 ở protected API, parse một sheet, đề
   xuất mapping và trả hash, fingerprint, timezone, sample rows, accepted/rejected
   estimate và rejection reasons. Preview không persist.
2. Người dùng chỉnh mapping nếu cần rồi preview lại. UI chỉ bật confirm khi
   mapping hợp lệ, không có rejected row và có accepted row.
3. `finalizeImport` parse và normalize lại ở server, bind chặt file hash và
   mapping fingerprint của preview để chống TOCTOU. Một row invalid làm toàn bộ
   finalize fail; không có partial batch hoặc partial snapshot.
4. Semantic dedupe được tính từ canonical row identity, metric value, range,
   source và attribution. Cùng nội dung nhưng khác thứ tự row replay cùng batch.
   Idempotency key và unique constraints bảo vệ retry/concurrent request.
5. Read model query theo workspace/date/dimension và aggregate server-side; lịch
   sử import cho biết accepted/row count và duplicate count.

## 4. Parser và giới hạn an toàn

CSV dùng parser quoted-field có hỗ trợ newline trong quote và strict UTF-8.
XLSX chỉ đọc một sheet trong bounded workbook; formula cell bị reject, macro,
external link và formula evaluation không được thực thi. Các giới hạn hiện tại:

| Giới hạn | Giá trị |
| --- | ---: |
| Kích thước file | 5 MiB |
| Số sheet | 1 |
| Số data rows | 20.000 |
| Số columns | 40 |
| Độ dài một cell | 16.384 ký tự |
| Tên file | 1–255 ký tự, không path separator |

## 5. Persistence và API/UI

Migration `0030_nice_scream.sql` chỉ tạo hai bảng analytics, foreign key,
constraint và index additive. Không có alter/drop trên bảng content hiện hữu.

Protected oRPC procedures:

- `analytics.previewImport`
- `analytics.finalizeImport`
- `analytics.listImports`
- `analytics.getReadModel`

Route `/analytics` có file picker CSV/XLSX, preview trước khi ghi, mapping editor,
trạng thái timezone/hash/fingerprint/rejection, ba khu vực read model riêng,
filter date/family/content type/pillar/series/product, import history và
unavailable state cho cost. UI không hiển thị raw server exception.

## 6. Acceptance evidence T01–T11

- **T01 — Baseline:** PASS. Starting `HEAD` và `origin/TXH` là
  `91c3dd2b089b6b2c155399ea0e3b230d479e4062`, divergence 0/0, worktree clean.
- **T02 — Core contract:** PASS. Registry, mapping schema, timezone/date
  normalization, server aggregate và typed rejection reasons được export từ core.
- **T03 — CSV/XLSX parser:** PASS. Formula string không được evaluate; formula cell
  trong XLSX bị reject; limits và filename/extension checks được áp dụng.
- **T04 — Additive DB:** PASS. Migration chạy từ database rỗng trên PostgreSQL 16
  disposable loopback; không dùng Neon/shared database.
- **T05 — Preview:** PASS. Mixed-family CSV trả mapping, hash, fingerprint,
  timezone `Asia/Ho_Chi_Minh`, range và rejection reasons mà không persist.
- **T06 — Finalize/atomicity:** PASS. Import hợp lệ tạo immutable batch/snapshots;
  retry và reordered semantic rows replay, không nhân bản snapshot.
- **T07 — Identity/isolation:** PASS. Cross-workspace Project/Product attribution
  bị reject fail-closed; canonical IDs và strategy dimensions được kiểm tra ở server.
- **T08 — Read model:** PASS. Channel Growth và Affiliate Monetization tách riêng;
  cost unavailable không bị quy đổi thành zero; sample/correlation metadata có mặt.
- **T09 — Protected UI:** PASS về build/type contract và route integration; UI
  không expose public render/upload API và không có worker execution.
- **T10 — Regression:** Focused analytics tests `4/4 PASS`; full web Vitest
  `950 PASS, 7 skipped`; workspace typecheck PASS; production build compile và
  route generation PASS. Full legacy Playwright suite không đạt do harness hiện
  hữu fail ở fixture `id: "demo"`/input validation ngoài US-027.
- **T11 — Runtime boundary:** PASS. Paid provider `0`, FFmpeg `0`, encoded MP4
  `0`, worker execution `0`, render lifecycle writes `0`, existing entities
  untouched. Disposable container đã được remove và port đã đóng.

## 7. Non-goals và follow-up

AFF-US-027 không claim platform API connectors, scheduled ingestion, automatic
recommendation, attribution probabilistic modeling, AI visual generation,
FFmpeg/render execution hoặc full browser acceptance cho legacy suites. Các mục
này chỉ được mở bằng decision/acceptance riêng.

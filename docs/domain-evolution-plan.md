# Kế hoạch Domain Evolution v0.8

- Trạng thái: Đã chấp nhận ở cấp tài liệu; chưa thực thi migration
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-22
- Quyết định liên quan: DEC-025

## 1. Mục tiêu

Mở rộng golden affiliate flow thành domain channel-first có Organic/Affiliate và
nhiều creation path, đồng thời giữ dữ liệu lịch sử, API compatibility và khả năng
rollback. Kế hoạch này chỉ định thứ tự migration; không phải lệnh apply database.

## 2. Contract đích

### Project

- `Project` tiếp tục là content production unit và đóng vai trò Content Item trong MVP.
- `contentType`: `ORGANIC | AFFILIATE`.
- `creationPath`: `QUICK_IMAGE | SCRIPTED | MEDIA_FIRST`.
- `contentFormat`: preset có version, không phải workflow state.
- `productId`: nullable ở database; bắt buộc theo service invariant cho Affiliate
  và mọi Organic content có Product claim.
- Project cũ được backfill `AFFILIATE + SCRIPTED`; Product/artifact cũ giữ nguyên.

### Runtime applicability

Resolver server-side trả trạng thái runtime cho từng dependency/step:
`NOT_REQUIRED | OPTIONAL | REQUIRED | READY | BLOCKED | STALE`. Các giá trị này
không được thêm vào enum `project_step_status.status`.

### Script generation

Server chọn một trong hai input mode:

- `PRODUCT_BACKED`: đọc Product, Product Facts và dependency hiện hữu.
- `ORGANIC_NO_PRODUCT`: không lookup Product/Facts và không được invent Product claim.

Output ScriptDraft, versioning, repair, idempotency và audit hiện hữu được giữ nguyên.

## 3. Trình tự migration additive

### M0 — Freeze và baseline

1. Chốt migration head và backup/restore procedure.
2. Chạy golden affiliate regression theo
   `docs/aff-us-012-phase-4-final-acceptance.md`.
3. Chụp số lượng Project theo Product linkage, current step và artifact state.
4. Không bắt đầu schema change nếu baseline không xanh.

### M1 — Expand schema

1. Thêm `content_type`, `creation_path`, `content_format` ở trạng thái nullable.
2. Thêm index cần thiết cho library/filter; chưa đổi read/write mặc định.
3. Chuẩn bị `claim_manifest` và cột Manifest provenance cho FactLockRun theo
   `docs/claim-manifest-fact-lock-contract.md` trong migration riêng.
4. Không drop/rename cột, không rewrite FactLockRun lịch sử.

### M2 — Backfill có thể tiếp tục

1. Backfill theo batch, idempotent: project cũ → `AFFILIATE + SCRIPTED`.
2. Không thay `productId`, `currentStepKey`, step status hoặc artifact.
3. Ghi progress/checkpoint và kiểm tra row counts sau mỗi batch.
4. Row bất thường được đưa vào exception report; không tự đoán giá trị.

### M3 — Dual-read/compatible write

1. Read model hiểu cả row chưa backfill và row mới.
2. New write luôn ghi Content Type/Creation Path hợp lệ.
3. API response thêm field theo cách backward-compatible; client cũ vẫn chạy.
4. Service invariant, không chỉ UI, chặn Affiliate thiếu Product.

### M4 — Resolver shadow mode

1. Chạy Applicability Resolver ở shadow mode trên golden affiliate projects.
2. So sánh quyết định với gate hiện hữu; mismatch phải có reason code/audit.
3. Chỉ bật resolver làm authority khi affiliate parity đạt acceptance.

### M5 — Enforce và cutover

1. Đặt default/not-null cho field đã backfill khi evidence cho phép.
2. Bật `ORGANIC + QUICK_IMAGE` sau khi server invariants và acceptance test đạt.
3. Bật Manifest-first new writes; legacy rows tiếp tục qua read adapter.
4. Theo dõi error rate, blocked reason và step transition sau rollout.

### M6 — Contract cleanup có điều kiện

Chỉ cleanup compatibility branch sau ít nhất một release ổn định và có bằng chứng
không còn row cũ chưa backfill. Drop/rename là migration riêng, cần phê duyệt mới.

## 4. Ma trận invariant

| Trường hợp | Product | Script | Fact Lock | Voice | Render |
|---|---|---|---|---|---|
| Affiliate + Scripted | Required | Required | Required | Theo path/config | Chỉ khi gate đạt |
| Affiliate + Quick Image | Required | Not required | Required | Optional | Chỉ khi gate đạt |
| Organic claimless + Quick Image | Not required | Not required | Not required | Optional | Cho phép khi composition ready |
| Organic claimless + Scripted | Not required | Required | Not required | Optional | Cho phép khi composition ready |
| Organic có Product claim | Required | Theo path | Required | Optional | Chỉ khi gate đạt |

`Not required` trong bảng là runtime applicability, không phải persisted completion.

## 5. `nextApplicableStep`

Business action phải:

1. khóa Project hoặc dùng optimistic concurrency tương đương;
2. đọc snapshot server mới nhất;
3. tính applicability cho toàn bộ bảy persisted steps;
4. chọn step tiếp theo theo canonical order;
5. cập nhật `currentStepKey` trong cùng transaction;
6. không tạo `completed` giả cho step `NOT_REQUIRED`;
7. ghi reason code/audit để UI giải thích được.

Direct URL có thể xem step khác, nhưng không được trở thành workflow source of truth.

## 6. Rollback

- Trước cutover: tắt feature flag và quay về read/gate cũ; additive columns ở lại.
- Sau cutover: ngừng new Organic writes trước, không xóa dữ liệu đã tạo.
- Manifest-first: tắt new-write path nhưng giữ reader cho cả Manifest/Script mode.
- Không rollback bằng cách đổi Organic thành Affiliate hoặc gắn Product giả.

## 7. Quan sát và bằng chứng bắt buộc

- Tổng Project trước/sau backfill và số row exception.
- Parity report của affiliate resolver.
- Tỷ lệ gate theo reason code và số `NOT_REQUIRED` transition.
- Số new FactLockRun theo Manifest và số legacy run vẫn đọc được.
- Test/command, migration hash, thời điểm apply và người phê duyệt.

## 8. Ngoài phạm vi

- `HYBRID` Content Type.
- Nhiều channel/workspace.
- Auto-post, recommendation engine và AI Visual production.
- Bulk rewrite AFF-US-001–012 hoặc xóa audit history.

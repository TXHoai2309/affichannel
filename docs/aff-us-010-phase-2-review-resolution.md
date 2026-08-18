# AFF-US-010 Phase 2 — Fact Lock Review & Resolution

Ngày: 2026-08-18  
Phạm vi: Review UI và resolution business actions, không bao gồm Voice/Render gate,
FactLockGate hoặc TTS.

## Kết quả

- Route mới: `/projects/[projectId]/fact-lock`.
- Review model dùng `factLock.getState`; client chỉ hiển thị classification/status do
  server trả về, không tự phân loại claim.
- Desktop dùng ba pane: claims, review detail và Product Facts evidence. Ở viewport nhỏ,
  các pane xếp dọc, không tạo overflow ngang.
- Evidence đối chiếu bằng `factId + factRevision` trong snapshot của chính run; không
  dùng top-level claim fact revision.
- Bốn classification được hiển thị bằng copy tiếng Việt. `NEEDS_REVIEW` có thể chuyển
  sang `MANUAL_APPROVED` nhưng classification vẫn là `NEEDS_REVIEW`.
- Có trạng thái no-run, pending, failed, indeterminate, stale, no usable Product Facts
  và error/retry.

## Resolution contract

### Manual approve

`factLock.manualApprove` nhận project/run/claim/script revision và review note tùy chọn.
Server kiểm tra workspace, current draft, current run, dependency freshness, exact CAS
revision và claim `NEEDS_REVIEW + UNRESOLVED`. Transaction ghi reviewer/time/note; nếu
mọi claim đã resolved thì chuyển run `review_required → passed`. Không tăng ScriptVersion
revision và không cho client gửi classification/status/reviewer.

### Edit, delete và apply suggestion

Ba action dùng `factLock.editClaimSource`, `factLock.deleteClaimSource` và
`factLock.applySuggestion`. Server khóa project/run/draft/claim trong transaction,
kiểm tra cùng run/current draft/dependencies và CAS `baseRevision`. Mutation tìm đúng
occurrence bằng exact source locator, không fuzzy replacement; draft tăng revision và
`claimsStatus` thành `stale`. Claim/audit của run cũ không bị mutate.

Delete chỉ được thực hiện khi snapshot sau delete vẫn hợp lệ. Nếu locator không duy nhất
hoặc delete làm script invalid, trả `FACT_LOCK_CLAIM_DELETE_REQUIRES_EDIT` và yêu cầu
người dùng sửa trong Script Editor.

## Không tạo migration

Phase 2 chỉ bổ sung service/router/read-model/UI/test. Không tạo hoặc sửa migration,
không chạy `db:migrate`, không đổi database URL, không tạo Neon branch, không reset/drop
dữ liệu production.

## Kiểm thử

- Core/UI unit test kiểm tra summary/filter/action permissions và occurrence label.
- `scripts/test-fact-lock.ts` kiểm tra manual approve atomic, duplicate approve,
  edit CAS/stale, apply stored suggestion, safe scene delete, idempotency/concurrency,
  failed/indeterminate, dependency/revision invalidation và reopen persistence.
- Authenticated E2E seed fixture tạm, kiểm tra ba pane, evidence, manual approve,
  refresh/reopen và browser console error; fixture cleanup trong `finally`.
- Không được đánh dấu toàn bộ AFF-US-010 DONE chỉ từ Phase 2; Phase 3/live proof và
  gate downstream vẫn là phạm vi riêng nếu backlog yêu cầu.

# AFF-US-029 + AFF-US-030 — AI Provider Governance và Paid Operation Safety

- Trạng thái: **CLOSED / OWNER ACCEPTED**
- Ngày: 2026-09-21
- Branch: `TXH`
- Boundary: foundation và release gate; chưa mở bất kỳ paid provider execution nào.

## Quyết định canonical — DEC-041

Provider/model registry là server-owned. Client chỉ chọn các identity đã có trong
registry; capability mapping, pricing version, currency và unit đều được resolve
ở server. Budget dùng kỳ **MONTHLY**, currency phải khớp pricing version, và mọi
operation có khả năng tính phí phải đi qua estimate → atomic reservation → audit →
adapter → usage/cost → terminal state.

Deterministic provider chỉ là test adapter. `apikeyfun` được đăng ký để kiểm tra
governance và release gate, nhưng `productionRelease=false`; vì vậy batch này
không gọi mạng, không gọi provider trả phí và không tạo artifact AI thật. Future
US28 phải vượt release gate riêng trước first paid operation.

## Lifecycle và safety

`prepare` canonicalize operation-specific semantic input và SHA-256 hash với
version rõ ràng. `idempotencyKey` và request hash là unique trong workspace; replay
trả operation cũ và không gọi adapter lần hai. Workspace settings row được lock
trong transaction để reservation không vượt budget khi concurrent request chạy
đồng thời. Budget 10 với hai estimate 8 chỉ có một reservation thành công.

Operation có `correlationId`, optional `providerRequestId`, safe metadata, pricing
version, lease owner/expiry/fence/attempt và call stage. Timeout trước khi biết
delivery là `FAILED`/release; timeout sau khả năng đã gửi là `INDETERMINATE`/
`UNCERTAIN`, không tự retry. Stale pending có lease reclaim an toàn nếu
`NOT_STARTED`; `POSSIBLY_SENT` chuyển sang uncertainty.

Recovery chỉ nhận action server-validated: reconcile, release/mark failed khi
chưa send, attach orphan artifact có evidence server-recorded hoặc acknowledge
unresolved. Recovery không tự gọi provider. Cross-workspace operation/project,
settings, budget và recovery đều bị từ chối.

Secret chỉ được đọc từ approved server environment khi một adapter production
được release; không lưu secret trong schema, request metadata, audit, log, export
hoặc client bundle. Error/usage metadata được redact trước persistence.

## Surface đã triển khai

- Core registry, capability map, canonical request hash và governance schemas.
- Additive migration `0031_breezy_gressill.sql` với settings, pricing versions,
  operations, reservations, audit và reconciliation; không có destructive DDL.
- Protected oRPC settings/registry/budget/release-gate và operation ledger/recovery.
- `/settings`: provider/model/pricing/budget/enablement/kill-switch với optimistic
  concurrency và không render secret.
- `/usage`: operation ledger, estimate/actual/provider request ID, uncertainty và
  review/reconcile; không có retry/generate button.
- Future-US28 release gate trả `paidExecutionReleased=false` cho tới khi có
  explicit production provider approval.

## Acceptance evidence

- `pnpm check-types`, focused governance tests, full web suite, build và Biome
  targeted check phải pass trước commit.
- Disposable PostgreSQL 16 loopback/no-volume là authority cho migration zero-to-
  current, row-lock concurrency, idempotency, kill switch, stale lease, redaction,
  orphan recovery và cross-workspace denial.
- Neon/shared DB, real provider, paid request, worker, FFmpeg và encoded MP4 đều
  không được dùng trong acceptance.

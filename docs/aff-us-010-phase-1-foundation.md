# AFF-US-010 — Phase 1 Foundation & Classification

Ngày: 2026-08-17  
Trạng thái: Phase 1 implementation ready for acceptance

Phase 1 triển khai runtime nền tảng cho Fact Lock theo contract đã khóa tại
[`aff-us-010-phase-0-contract-hardening.md`](./aff-us-010-phase-0-contract-hardening.md).
Phase này chưa mở màn review thủ công và chưa tạo gate Voice/Render.

## Đã triển khai

- Ba bảng additive: `fact_lock_run`, `fact_lock_claim`, `fact_lock_claim_fact`.
- Hash canonical cho request intent, input snapshot và prompt; snapshot lưu đúng
  `ScriptVersion.revision`, Product Fact revision, policy và Output Rules.
- `fact_dependency` dùng lại với `dependentType = 'fact_lock'`.
- Transaction A tạo một pending run và đăng ký dependency; provider chạy ngoài
  transaction; Transaction B validate output, lưu claim/mapping và CAS-refresh
  metadata claims của ScriptVersion khi revision vẫn khớp.
- Classification server-owned gồm `SUPPORTED`, `NEEDS_REVIEW`, `UNSUPPORTED`,
  `PROHIBITED`; review status chỉ được suy ra ở Phase 1.
- Deterministic server policy kiểm tra `channel_settings.avoid_words`; AI không
  tự có quyền quyết định `PROHIBITED` nếu policy không xác nhận.
- `factLock.run` và `factLock.getState` được workspace-scope. Read model phân biệt
  `latestRequest`, `latestApplicableRun` và effective `stale`.
- Deterministic provider dùng trong test; APIKEY.FUN vẫn đi qua TextProvider
  registry khi runtime provider được cấu hình.

## Bảo toàn dữ liệu và migration

Migration `0013_skinny_princess_powerful.sql` đã được audit trước khi chạy và
apply trên Neon hiện tại. Migration chỉ tạo bảng, constraint, foreign key và
index; không sửa migration cũ, không drop/reset bảng hoặc dữ liệu hiện có.

Mapping Fact không tạo foreign key trực tiếp tới `product_fact`, vì Product Fact
có thể bị hard-delete sau khi đã ghi audit/dependency; `fact_id + fact_revision`
là identity lịch sử của mapping.

## Ngoài phạm vi Phase 1

- UI Fact Lock Review ba khu vực.
- Sửa, xóa, áp dụng suggestion và manual approve.
- Gate Voice/Render, TTS, audio hoặc live paid smoke mặc định.

## Verification

- Web unit: validator classification, policy downgrade, exact occurrence, exact
  Fact mapping revision và stale derivation.
- DB integration: idempotency, pending uniqueness, persistence, dependency,
  failed/indeterminate, latest usable, script race, invalidation, reopen và
  cross-workspace authorization.
- `db:generate` sau migration: `No schema changes, nothing to migrate`.

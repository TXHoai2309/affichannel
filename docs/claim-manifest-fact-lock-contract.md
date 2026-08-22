# Contract ClaimManifest và Fact Lock v0.8

- Trạng thái: Đã chấp nhận ở cấp tài liệu; implementation pending
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-22
- Quyết định liên quan: DEC-025

## 1. Mục đích

Fact Lock phải kiểm tra đúng nội dung cuối có thể xuất hiện trong video, không chỉ
một ScriptVersion. ClaimManifest là immutable server-built inventory nối content
sources, Product Facts evidence, policy run và downstream gate.

## 2. ClaimManifest canonical

Một Manifest tối thiểu có:

```text
id, workspaceId, projectId
sourceType, sourceVersion
compositionVersionId?
claims[]
isEmpty
normalizationStatus
fingerprint
createdAt
```

Mỗi claim chứa stable claim key, normalized text/value/unit/time condition,
source locator, source hash và Product reference nếu có. Source locator phải đủ để
UI đưa người dùng về đúng Script field, overlay, caption, CTA, voice text, declared
claim hoặc composition element.

## 3. Server build pipeline

1. Authorize actor với Project/workspace.
2. Resolve đúng output-bearing sources và immutable/versioned identifiers.
3. Extract candidate claims từ tất cả source types được hỗ trợ.
4. Normalize bằng deterministic rules trước; provider output chỉ là untrusted input.
5. Canonical-sort inventory và tính fingerprint server-side.
6. Persist Manifest bất biến cùng source snapshot/provenance.

Client không được gửi `isEmpty`, canonical fingerprint hoặc kết quả normalization
làm source of truth. Client-supplied preview chỉ là hint và phải được rebuild.

## 4. Empty và uncertainty

`isEmpty=true` chỉ khi:

- mọi source cần đọc đã resolve thành công;
- extraction và normalization hoàn thành;
- canonical inventory có zero claim.

Source thiếu, parser lỗi, provider timeout, unsupported schema hoặc độ chắc chắn
không đủ phải trả `indeterminate`/`blocked`, không được chuyển thành empty để PASS.
Affiliate claimless vẫn có empty Manifest và một policy run có thể PASS với zero
claim results sau khi pipeline trên thành công.

## 5. Fingerprint và stale

Fingerprint bao phủ schema version, ordered normalized claim inventory, source
identifiers/hashes và composition version có ảnh hưởng output. Bất kỳ thay đổi nào
ở Script, overlay, caption, CTA, voice text, declared claim hoặc composition làm
Manifest mới có fingerprint mới.

FactLockRun cũ không bị mutate. Read model trả effective `STALE` khi run không còn
khớp Manifest hiện tại hoặc evidence dependency đã đổi/hết hiệu lực.

## 6. FactLockRun persistence modes

| Mode | `claimManifestId` | `claimManifestFingerprint` | Script provenance |
|---|---|---|---|
| Legacy read | Nullable | Nullable | Có theo schema lịch sử |
| New write | Required | Required | Nullable, nếu Manifest có Script source |

New pending uniqueness/idempotency dùng workspace/project + Manifest fingerprint +
policy/input version. Script revision không còn là khóa canonical cho new writes.
Reader phải hỗ trợ hai mode; không backfill bằng cách tạo Manifest giả cho run cũ.

## 7. Applicability policy

- Affiliate: Fact Lock `REQUIRED` trước TTS/render, kể cả Manifest empty.
- Organic claimless: Fact Lock `NOT_REQUIRED`.
- Organic có Product claim: Product, Product Facts evidence và Fact Lock `REQUIRED`.
- Factual knowledge không dựa trên Product Facts: đi qua manual evidence/review
  flow riêng; không được tự map thành supported Product claim.

Khi Fact Lock `NOT_REQUIRED`, Voice opt-in/TTS không được gọi unconditional
`assertPassed`. Khi `REQUIRED`, mọi mutation tốn phí và worker preflight phải
assert Manifest hiện tại đã PASS.

## 8. Run state và classification

Persisted run states giữ nguyên: `pending`, `review_required`, `passed`, `failed`,
`indeterminate`. `stale` là effective state. Claim classification giữ:
`SUPPORTED`, `NEEDS_REVIEW`, `UNSUPPORTED`, `PROHIBITED`.

Run chỉ PASS khi Manifest đúng fingerprint hiện tại, không có unresolved prohibited/
unsupported claim, review requirements đã được xử lý và evidence dependency còn hiệu lực.

## 9. Race, transaction và idempotency

- Pending run phải claim execution atomically trước provider call.
- Provider chạy ngoài DB transaction.
- Finalize dùng compare-and-set với Manifest fingerprint/input hash.
- Trước TTS/render call, server resolve Manifest/gate lại để chặn invalidation race.
- Stale pending lease kết thúc `indeterminate`; không tự retry paid provider.
- Cùng idempotency key + cùng intent trả cùng result; cùng key + khác intent bị conflict.

## 10. API/read model

Read model tối thiểu trả:

- applicability state và reason code;
- current Manifest ID/fingerprint/source summary;
- effective run state và stale reasons;
- claim/source locators và evidence mapping;
- allowed actions.

UI không tự suy ra PASS/empty/stale. API error phải typed, sanitized và không lộ
provider payload, credentials hoặc signed URL.

## 11. Compatibility và rollout

1. Thêm schema additive và dual-mode reader.
2. Build Manifest ở shadow mode cho affiliate Script output và đo parity.
3. Bật Manifest-first new writes theo feature flag.
4. Bật non-Script sources và Organic policy sau parity/regression.
5. Giữ legacy adapter đến khi retention policy riêng được duyệt.

Chi tiết migration và rollback tại `docs/domain-evolution-plan.md`; bộ test bắt
buộc tại `docs/domain-evolution-acceptance.md`.

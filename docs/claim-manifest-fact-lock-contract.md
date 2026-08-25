# Contract ClaimManifest và Fact Lock v0.8

- Trạng thái: Target US17+US18 canonical; US17 acceptance contract READY,
  implementation chưa bắt đầu; US18 chưa bắt đầu
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-25
- Quyết định liên quan: DEC-025, DEC-028, DEC-031, V08-DEC-011, V08-DEC-013

## 1. Mục đích

Fact Lock phải kiểm tra đúng nội dung cuối có thể xuất hiện trong video, không chỉ
một ScriptVersion. ClaimManifest là immutable server-built inventory của content
sources; downstream FactLockRun dùng inventory đó để nối Product Facts evidence,
policy evaluation và gate.

Contract này mô tả end-state sau AFF-US-018. Exact foundation contract của
AFF-US-017 nằm tại `docs/aff-us-017-claim-manifest-foundation.md`. Runtime hiện tại
vẫn ScriptVersion-first; không được đọc target wording dưới đây như capability đã
active.

## 2. ClaimManifest canonical

Một Manifest tối thiểu có:

```text
id, workspaceId, projectId
strict versioned source descriptor
productId?
schemaVersion, builderVersion
ordered claims[]
claimCount, isEmpty
sourceContentHash, fingerprint
createdByUserId, createdAt
```

Mỗi claim MVP chứa deterministic stable-within-source key, exact validated claim
text, strict source locator và source text hash. Không khóa taxonomy/value/unit/time
fields khi current repository chưa có authority cho chúng. Product association
thuộc Manifest level trong one-Product MVP. Source locator phải đủ để UI tương lai
đưa người dùng về đúng Script field hoặc no-script element.

## 3. Server build pipeline

1. Authorize actor với Project/workspace.
2. Resolve đúng explicit output-bearing source revision và identifiers.
3. Source adapter project validated structured claims theo deterministic rules.
4. Validate locator/text và canonicalize mà không gọi provider trong AFF-US-017.
5. Giữ deterministic adapter-defined order và tính fingerprint server-side.
6. Persist Manifest bất biến cùng source snapshot/provenance.

Client không được gửi `isEmpty`, canonical fingerprint hoặc canonical claims làm
source of truth. AFF-US-017 chỉ có internal service; future client preview nếu có
chỉ là hint và phải được server rebuild.

## 4. Empty và uncertainty

`isEmpty=true` chỉ khi:

- mọi source cần đọc đã resolve thành công;
- extraction và normalization hoàn thành;
- canonical inventory có zero claim.

Source thiếu, stale claims, parser lỗi hoặc unsupported schema phải trả typed build
error và không persist Manifest. Provider timeout/uncertainty là AFF-US-018 Fact
Lock execution concern, không phải Manifest lifecycle. Affiliate claimless có thể
có empty Manifest sau build thành công; policy run zero-claim thuộc AFF-US-018.

## 5. Fingerprint và stale

Fingerprint bao phủ domain/builder version, workspace/Project scope, Product ID,
ordered canonical claim inventory và complete source identifiers/revision/hashes.
Bất kỳ semantic source change nào tạo/reuse fingerprint khác. Exact canonical JSON,
text normalization và claim-key rules nằm trong dedicated AFF-US-017 contract.

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

- Affiliate: Fact Lock là mandatory/applicable trước TTS/render, kể cả Manifest
  empty; runtime state có thể là `REQUIRED`, `READY`, `BLOCKED` hoặc `STALE`.
- Organic claimless: Fact Lock `NOT_REQUIRED`.
- Organic có Product claim: Product, Product Facts evidence và Fact Lock đều
  mandatory/applicable.
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

1. AFF-US-017 thêm pure domain + additive ClaimManifest table, deterministic
   ScriptVersion adapter và internal create/reuse/read service.
2. AFF-US-017 không backfill Scripts/runs, không sửa FactLockRun và không đổi flow.
3. AFF-US-018 thêm dual-mode FactLockRun linkage/reader và shadow/parity evidence.
4. AFF-US-018 bật Manifest-first new writes theo reviewed cutover gate.
5. Non-Script source activation thuộc source story tương ứng; giữ legacy adapter
   đến khi retention policy riêng được duyệt.

Chi tiết migration và rollback tại `docs/domain-evolution-plan.md`; bộ test bắt
buộc tại `docs/domain-evolution-acceptance.md`.

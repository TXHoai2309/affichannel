# Contract ClaimManifest và Fact Lock v0.8

- Trạng thái: Target US17+US18 canonical; AFF-US-017 DONE; AFF-US-018 Phase 18C
  zero-claim execution contract locked
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-26
- Quyết định liên quan: DEC-025, DEC-028, DEC-031, DEC-032, V08-DEC-011,
  V08-DEC-013

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
khớp Manifest hiện tại, Manifest không còn executable/current, Product mismatch,
Product Facts đã đổi/bị invalidate hoặc fingerprint không hợp lệ. Đây là trạng thái
derived; không mutate Manifest để đánh dấu stale.

Historical Manifest vẫn immutable/readable nhưng không được dùng cho FactLockRun
mới nếu không còn executable. AFF-US-018 current activation chỉ nhận explicit
Manifest có `sourceType=SCRIPT_VERSION`, Project identity hiện tại
`AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1`, cùng workspace/Project, Product ID
match, draft ScriptVersion đúng revision, fingerprint hợp lệ và source/content
integrity hợp lệ.
Không resolve `latest Manifest` làm authority.

## 6. FactLockRun persistence modes

| Mode | `inputMode` | `claimManifestId` | `claimManifestFingerprint` | Script provenance |
|---|---|---|---|---|
| Legacy read | `NULL` | `NULL` | `NULL` | Có theo schema lịch sử |
| New write | `MANIFEST_V1` | Required | Required, server-derived | Nullable trong schema; current activation phải populated |

`MANIFEST_V1` yêu cầu Manifest ID/fingerprint được server resolve và kiểm tra cùng
nhau. `inputMode` là persisted discriminator; không suy luận mode chỉ từ nullable FK.
Legacy rows không backfill.

New pending uniqueness dùng partial index chính xác trên
`(workspace_id, project_id, request_hash) WHERE status='pending' AND
input_mode='MANIFEST_V1'`. Legacy pending uniqueness giữ index riêng trên
`(workspace_id, project_id, script_version_id, source_script_revision) WHERE
status='pending' AND input_mode IS NULL`. Hai mode có thể coexist.
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

Với `MANIFEST_V1`, server-owned input version là `fact-lock.manifest.v1` và
`productFactsFingerprint` là SHA-256 lowercase của canonical JSON exact Product Fact
snapshot theo thứ tự deterministic. Request identity là:

Projection chính xác của mỗi Product Fact trong snapshot, theo đúng thứ tự field
canonical JSON, là `id`, `revision`, `content`, `type`, `status`, `assessment`,
`generationUsability`, rồi `source` với các field con theo thứ tự `type`, `label`,
`url`, `confirmedAt`, `expiresAt`. Các Product Facts được chọn theo policy hiện
hành, loại các fact bị blocked, và được sắp xếp `id` tăng dần trước khi projection;
không đưa DB metadata không phục vụ verification vào fingerprint.

```text
requestHash = SHA-256(canonicalJson({
  inputVersion: "fact-lock.manifest.v1",
  claimManifestFingerprint,
  productFactsFingerprint,
}))
```

Zero-claim executable Manifest không cần Product Fact fingerprint và dùng:

```text
SHA-256(canonicalJson({
  inputVersion: "fact-lock.manifest.v1",
  claimManifestFingerprint,
  zeroClaims: true,
}))
```

Same Manifest + changed Product Facts tạo request hash khác. `idempotencyKey` vẫn
là client/retry identity, không phải pending semantic key.

`inputVersion` là server-owned exact constant. Chỉ bump version khi thay đổi semantic
interpretation của policy, claim/result mapping, verdict, fact eligibility hoặc input
projection; không bump vì logging, telemetry hoặc refactor giữ nguyên semantics.

### 9.1. Deterministic zero-claim persistence

Executable `MANIFEST_V1` với `claims.length=0` dùng execution path nội bộ,
deterministic và không gọi provider. Sau khi authorization, currentness, Product và
Manifest integrity đã pass, path này persist một `FactLockRun` terminal `passed` với:

```text
provider              = internal
model                 = deterministic-zero-claim
promptVersion         = fact-lock-zero-claim.v1
outputSchemaVersion   = fact-lock-output.v1
inputMode             = MANIFEST_V1
providerRequestId     = NULL
inputTokens           = NULL
outputTokens          = NULL
estimatedCostMicros   = NULL
actualCostMicros      = NULL
currency              = NULL
executionClaimedAt    = NULL
```

Các metadata trên là server-owned constants, không đọc từ TextProvider config và
không nhận từ caller. `fact_lock_run.prompt_hash` giữ tên lịch sử của execution
provider-backed nhưng với zero-claim lưu SHA-256 lowercase của canonical decision
policy sau, không phải rendered provider prompt:

```json
{
  "kind": "fact-lock-zero-claim",
  "inputVersion": "fact-lock.manifest.v1",
  "promptVersion": "fact-lock-zero-claim.v1",
  "outputSchemaVersion": "fact-lock-output.v1",
  "providerRequired": false,
  "dependenciesRequired": false,
  "outcomeStatus": "passed"
}
```

Policy hash không chứa Manifest ID/fingerprint, Project/workspace, actor,
timestamp, Product Facts hoặc idempotency key. Không đổi tên cột, không thêm cột và
không tạo migration mới.

Zero-claim không resolve provider config, không load hoặc fingerprint Product Facts,
không tạo `fact_lock_claim`, không tạo `fact_lock_claim_fact`, không đăng ký
dependency và không claim external execution. `finishedAt` được ghi bởi server;
mọi billing/provider usage field giữ `NULL`.

Same workspace + idempotency key + zero-claim request hash trả cùng run đã persist;
khác semantic request hash trả `FACT_LOCK_IDEMPOTENCY_CONFLICT`. Concurrent identical
requests phải tạo đúng một run, không lộ unique DB error.

### 9.2. Non-empty Manifest provider execution

Manifest-first provider execution cho `claims.length > 0` dùng prompt version server-owned
`fact-lock-manifest-prompt.v1`, tách biệt với legacy `fact-lock-prompt.v3` và zero-claim
`fact-lock-zero-claim.v1`. Provider chỉ nhận ordered `ClaimManifest.claims`, exact
Product Facts snapshot và policy/output instructions; không gửi Script snapshot như claim
inventory. `promptHash` là SHA-256 của exact deterministic rendered Manifest provider
payload, không chứa timestamp, run ID, provider request ID hoặc giá trị ngẫu nhiên.

Execution phải persist pending `MANIFEST_V1` run cùng immutable input/dependency snapshot,
claim execution atomically trước provider call, gọi provider ngoài transaction và
finalize bằng CAS. Strict result validation dùng exact Manifest claim-key bijection rồi
reorder theo Manifest; Manifest giữ claim key, text, locator và source identity. Provider
mismatch kết thúc `indeterminate` với `FACT_LOCK_PROVIDER_RESULT_MISMATCH` và không tự
retry paid request. Chi tiết runtime thuộc AFF-US-018 Phase 18D; public read/router
cutover vẫn thuộc phase sau.

## 10. API/read model

Read model tối thiểu trả:

- applicability state và reason code;
- current Manifest ID/fingerprint/source summary;
- effective run state và stale reasons;
- claim/source locators và evidence mapping;
- allowed actions.

UI không tự suy ra PASS/empty/stale. API error phải typed, sanitized và không lộ
provider payload, credentials hoặc signed URL.

Error contract tối thiểu và hành động/retryability:

| Error | Retryability / user action | Sanitized API convention |
|---|---|---|
| `FACT_LOCK_MANIFEST_REQUIRED` | Không retry cùng request thiếu Manifest; cung cấp selection hợp lệ | `BAD_REQUEST` |
| `CLAIM_MANIFEST_NOT_FOUND` | Không retry nếu selection/scope chưa được sửa; chọn Manifest hợp lệ | `NOT_FOUND`, không enumerate cross-scope |
| `CLAIM_MANIFEST_NOT_EXECUTABLE` | Không retry cùng Manifest; refresh source và tạo Manifest mới | `CONFLICT` |
| `CLAIM_MANIFEST_FINGERPRINT_MISMATCH` | Không retry tự động; fail closed và xử lý integrity/data issue | sanitized error, không lộ fingerprint nội bộ |
| `FACT_LOCK_PROVIDER_RESULT_MISMATCH` | Không auto paid retry; explicit retry theo idempotency/retry rules | run `indeterminate`, sanitized error |

Cross-workspace hoặc không được phép truy cập Manifest phải map non-enumerating về
`CLAIM_MANIFEST_NOT_FOUND`. Các mapping HTTP chỉ dùng convention hiện hành và
không làm lộ provider payload, credential hoặc nội bộ database.

Legacy `inputMode=NULL` dùng ScriptVersion-first projection. `MANIFEST_V1` dùng
Manifest-aware projection; không tự động mutate ScriptVersion. New run chỉ cho phép
status-only manual approval nếu không sửa Manifest hoặc ScriptVersion. Edit/delete/
apply-suggestion của legacy vẫn giữ behavior cũ; cùng thao tác trên Manifest-first
run bị từ chối và phải tạo Manifest mới từ source đã sửa.

Provider của `MANIFEST_V1` chỉ nhận ordered Manifest claims và exact Product Fact
snapshot; không tự extract inventory khác từ Script. Với N claims, output phải có
đúng N verdicts và exact bijection theo `claimKey`; server reject missing/unknown/
duplicate/extra claim, malformed verdict hoặc invalid Fact, rồi reorder theo Manifest.
Provider không được thêm, bớt, đổi `claimKey`, `claimText` hoặc locator. Provider
result mismatch kết thúc run `indeterminate` với
`FACT_LOCK_PROVIDER_RESULT_MISMATCH`, không tự paid retry.

Executable zero-claim Manifest tạo run `passed` theo deterministic internal contract
ở mục 9.1, không tạo `fact_lock_claim`, không tạo Product Fact dependency và không
gọi provider. Invalid/uncertain source không được chuyển thành zero-claim.

## 11. Compatibility và rollout

1. AFF-US-017 thêm pure domain + additive ClaimManifest table, deterministic
   ScriptVersion adapter và internal create/reuse/read service.
2. AFF-US-017 không backfill Scripts/runs, không sửa FactLockRun và không đổi flow.
3. AFF-US-018 thêm dual-mode FactLockRun linkage/reader và shadow/parity evidence.
4. AFF-US-018 bật Manifest-first new writes theo reviewed cutover gate.
5. Non-Script source activation thuộc source story tương ứng; giữ legacy adapter
   đến khi retention policy riêng được duyệt.

AFF-US-018 không activate `NO_SCRIPT`, `ORGANIC`, `QUICK_IMAGE` hoặc `MEDIA_FIRST`.
Current `MANIFEST_V1` runtime chỉ nhận `SCRIPT_VERSION` Manifest; nullable Script
columns chỉ là schema representation cho future sources. Voice tiếp tục phụ thuộc
FactLockGate và không mở no-script Voice path trong US18.

Chi tiết migration và rollback tại `docs/domain-evolution-plan.md`; bộ test bắt
buộc tại `docs/domain-evolution-acceptance.md`.

## 12. AFF-US-018 migration clarification

Migration 0020 conceptual contract, chưa được tạo trong clarification phase:

- add nullable `input_mode` text, không dùng DB enum;
- add nullable `claim_manifest_id` FK `ON DELETE RESTRICT`;
- add nullable `claim_manifest_fingerprint`;
- relax `script_version_id` và `source_script_revision` về nullable;
- enforce pair invariant: cả hai NULL hoặc cả hai populated với revision dương;
- legacy row shape: `input_mode=NULL` và Manifest fields NULL;
- Manifest row shape: `input_mode='MANIFEST_V1'`, Manifest fields populated và
  fingerprint lowercase SHA-256;
- giữ lịch sử, không backfill, không rewrite `FactLockClaim`, không drop Script FK;
- thay pending uniqueness bằng hai mode-specific partial indexes.

Current application `MANIFEST_V1` writes vẫn phải populate Script provenance từ
Manifest source descriptor. DB nullability không activate `NO_SCRIPT`.

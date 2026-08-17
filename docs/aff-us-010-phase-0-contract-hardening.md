# AFF-US-010 — Phase 0 Contract Hardening

Ngày: 2026-08-17  
Trạng thái: Contract ready for Phase 1 acceptance

Phase 0 chỉ khóa contract và invariant cho Fact Lock. Không tạo schema, migration,
provider/runtime DB, UI hoặc TTS/Voice/Render. Tài liệu này là source of truth cho
Phase 1–3 của AFF-US-010.

## A. Audit findings

Các primitive hiện có được reuse:

- `ScriptGeneration` của US8 là generated artifact bất biến sau terminal state.
- `ScriptVersion` của US9 là aggregate editable, có `revision`,
  `claimsSourceRevision` và `claimsStatus` (`current | stale`).
- `ScriptDraft v2` hiện có occurrence ổn định theo `hookKey`, `segmentKey`,
  `sceneOrder`, CTA và caption.
- `fact_dependency` đã có allow-list `fact_lock`, `voice` và `render`, cùng
  `registerFactDependenciesInTransaction`, `detachFactDependenciesInTransaction`
  và invalidation event. Không dựng dependency architecture mới.
- US8 đã có `canonicalizeJson()` và `sha256Hex()` cho canonical snapshot/prompt
  hashing; Fact Lock reuse cùng convention.
- `output_rules` hiện chỉ có language, aspect ratio, subtitle safe area, claim
  limit và final CTA. `channel_settings.avoidWords` là rule tránh từ, chưa phải
  một policy engine xác định mọi nội dung prohibited.

## B. Validator split

Core có hai boundary rõ ràng:

### `validateScriptVersionForFactLockRun(snapshot)`

Validator pre-run cho phép:

- `claimsStatus = current`; hoặc
- `claimsStatus = stale`.

Nó vẫn bắt buộc snapshot có cấu trúc `ScriptDraft v2` hợp lệ, hook được chọn và
trỏ tới hook tồn tại, stable keys/order/reference hợp lệ, occurrence hợp lệ,
CTA/disclosure/language/schema hợp lệ và nội dung cần kiểm tra có trong source.

`stale` ở đây chỉ nói candidate claims cũ không còn cùng script revision. Fact
Lock run sẽ lấy `sourceScriptRevision` mới và tự tạo claim result mới; không được
dùng candidate claims stale như kết quả đã pass.

### `validateScriptVersionForFactLock(snapshot)`

Strict readiness validator sau extraction/refresh. Nó dùng cùng structural checks
nhưng bắt buộc `claimsStatus = current`. Downstream gate chỉ được dùng validator
này sau khi claims metadata đã được refresh guarded.

## C. Claim state machine

Classification của claim trong một finalized run là immutable:

```text
SUPPORTED | NEEDS_REVIEW | UNSUPPORTED | PROHIBITED
```

Review status là state riêng:

```text
AUTO_PASSED | UNRESOLVED | MANUAL_APPROVED
```

Allowed combinations và transition:

```text
SUPPORTED     + AUTO_PASSED       -> PASS
NEEDS_REVIEW  + UNRESOLVED        -> BLOCK
NEEDS_REVIEW  + MANUAL_APPROVED  -> PASS
UNSUPPORTED   + UNRESOLVED       -> BLOCK
PROHIBITED    + UNRESOLVED       -> HARD BLOCK
```

Chỉ `NEEDS_REVIEW + UNRESOLVED` được chuyển sang `MANUAL_APPROVED`. Không cho
manual approve `UNSUPPORTED` hoặc `PROHIBITED`. Classification không bị rewrite
khi review; chỉ review metadata và trạng thái review được cập nhật theo transition
đã authorize.

Mọi claim finalized phải có `reason`, `checkedAt`; `confidence` là số trong
`[0, 1]` hoặc `null`. Manual review dùng các field riêng:
`reviewedByUserId`, `reviewedAt`, `reviewNote`.

## D. Persisted status và effective status

Persisted `FactLockRun.status` chỉ có:

```text
pending | review_required | passed | failed | indeterminate
```

Read model thêm:

```text
pending | review_required | passed | failed | indeterminate | stale
```

`stale` không phải persisted source of truth và không mutate historical run.
Precedence cho result-bearing run:

1. Nếu `status` là `passed` hoặc `review_required` và script revision không còn
   khớp, effective status là `stale`.
2. Nếu dependency Product Fact cần thiết bị invalidated/detached, hoặc Fact bị
   xóa/không còn đúng pinned revision, effective status là `stale`.
3. Nếu không có stale condition, giữ persisted status.

Để semantics deterministic, `pending`, `failed` và `indeterminate` giữ nguyên
effective status tương ứng; chúng không bị đổi thành `stale`. `pending` chỉ có thể
trở thành terminal result qua finalize transaction, còn `failed`/`indeterminate`
không được coi là usable dù không stale.

## E. Stale derivation

Ba điều kiện cần đối chiếu khi đọc run:

```text
run.sourceScriptRevision === current ScriptVersion.revision
all required fact dependencies are active
each pinned Product Fact still has the pinned revision
```

Một dependency không còn active khi `invalidatedAt` hoặc `detachedAt` khác null.
Fact bị thiếu, bị xóa hoặc revision hiện tại khác `factRevision` cũng làm result
stale. Dependency registration vẫn là mechanism chính; read model chỉ dùng việc
đối chiếu Fact revision như defensive check.

## F. Revision semantics

Không trộn ba revision:

```text
ScriptVersion.revision
  = revision của user-editable script content

ScriptVersion.claimsSourceRevision
  = revision mà candidate claims hiện tại được extract

FactLockRun.sourceScriptRevision
  = exact ScriptVersion revision mà run đã kiểm tra
```

Ví dụ revision 15 có claimsSourceRevision 15 và run sourceScriptRevision 15 là
đồng nhất. User edit làm revision thành 16 thì run 15 stale, không update lịch sử.

## G. Claims metadata refresh

Khi Fact Lock finalize thành công, server có thể cập nhật candidate claims metadata
trên current draft:

```text
claims
claimsStatus = current
claimsSourceRevision = sourceScriptRevision
```

Update này không được sửa user-editable content và không tăng
`ScriptVersion.revision`. Transaction dùng CAS:

```text
WHERE script_version.id = ?
  AND script_version.revision = sourceScriptRevision
```

Nếu không có row affected, script đã đổi trong lúc provider chạy; không đánh dấu
claims current và run không được trở thành applicable cho revision mới.

## H. Input audit contract

Phase 1 phải lưu exact logical input snapshot, tối thiểu:

```json
{
  "scriptVersion": {
    "id": "...",
    "revision": 15,
    "editableContent": "..."
  },
  "productFacts": [
    {
      "factId": "...",
      "revision": 3,
      "content": "...",
      "evidence": "...",
      "status": "verified",
      "freshness": "..."
    }
  ],
  "policySnapshot": {},
  "outputRules": {}
}
```

Snapshot phải chứa đủ content để replay/đối chiếu, không nhận revision do client
gửi làm authority. Không lưu secret, API key, cookie hoặc authorization header.

Hash dùng convention US8 và không trộn mục đích:

```text
requestHash = normalized user intent / request identity
inputHash   = exact resolved logical inputSnapshot
promptHash  = exact rendered prompt sau template/version resolution
```

Run cũng phải lưu `promptVersion`, `outputSchemaVersion`, `provider`, `model` và
`providerRequestId` riêng. `rawOutputJson` không lưu mặc định v1; chỉ lưu normalized
validated output và error metadata an toàn. Raw debug output cần decision retention
và redaction riêng.

## I. Idempotency và retry

Fact Lock run request có `idempotencyKey` và `requestHash`.

```text
same key + same requestHash       -> trả existing FactLockRun
same key + khác requestHash       -> IDEMPOTENCY_CONFLICT
```

`requestHash` phải phụ thuộc ít nhất vào workspace/project, scriptVersionId,
sourceScriptRevision và mode/run intent; không phụ thuộc timestamp ngẫu nhiên.

Database phải giới hạn tối đa một `pending` run theo workspace/project/scriptVersion/
sourceScriptRevision. Double click không được tạo provider call thứ hai.

`failed` và `indeterminate` chỉ retry khi user explicit retry bằng key mới.
Không reuse key cũ, không automatic retry và không coi `indeterminate` là bằng
chứng provider chưa xử lý request.

## J. PROHIBITED authority

AI output không phải authority duy nhất. Phase 0 audit chưa tìm thấy policy engine
đủ để xác định mọi prohibited content; không invent một policy lớn trong phase này.

Phase 1/2 phải có `PolicyEvaluator` ở server/core cho các rule deterministic thực
sự đã cấu hình. Semantics v1:

```text
AI says PROHIBITED + server policy confirms
  -> PROHIBITED

AI says PROHIBITED + server policy does not confirm
  -> NEEDS_REVIEW
```

`PROHIBITED` luôn hard block và không có manual override. Các rule hiện có như
`avoidWords` phải được map rõ vào evaluator, không được suy luận từ màu badge hoặc
text tự do trong UI.

## K. Semantic validation

Relation claim ↔ Product Fact v1:

```text
supports | related | contradicts
```

Mỗi mapping phải pin `factId` và `factRevision`, đồng thời cả hai phải xuất hiện
trong input snapshot. Mapping tới Fact ID/revision ngoài snapshot là invalid.

Occurrence canonical v1 chỉ dùng các target đã tồn tại trong `ScriptDraft v2`:

```text
hook       -> hookKey
voiceover  -> segmentKey
scene      -> sceneOrder
cta
caption
```

`disclosure`, `hashtags` và `visualDirection` chưa phải occurrence target hợp lệ
trong schema hiện tại; không tự thêm type mới ở Phase 0. Scene claim chỉ resolve
được content publishable của scene theo contract Phase 1; nếu không định vị được
exact text thì output invalid, không fuzzy-replace.

Provider output phải qua semantic validator sau schema validator:

```text
SUPPORTED
  -> reason bắt buộc; >= 1 mapping supports hợp lệ
NEEDS_REVIEW
  -> reason bắt buộc; mapping supports/related/contradicts tùy trường hợp
UNSUPPORTED
  -> reason bắt buộc; không được có mapping supports hợp lệ
PROHIBITED
  -> reason bắt buộc; phải có deterministic server policy confirmation
```

`confidence` không quyết định classification. Validator phải kiểm tra target tồn
tại, stable key/order tồn tại và `claimText` khớp hoặc được trích xuất từ source
content thực tế. Output sai occurrence/mapping trả `INVALID_FACT_LOCK_OUTPUT` và
không persist như valid result.

## L. Resolution CAS contract

### Manual approve

Input gồm `projectId`, `factLockRunId`, `claimId` và concurrency context. Server
phải kiểm tra workspace/project, run applicable/current, source script revision
khớp current revision, dependency còn current, classification là `NEEDS_REVIEW`,
review status là `UNRESOLVED` và effective status không stale.

Transition dùng conditional update:

```text
WHERE claim.id = ?
  AND classification = 'NEEDS_REVIEW'
  AND reviewStatus = 'UNRESOLVED'
```

Duplicate approval phải là idempotent hoặc trả typed conflict nhất quán; không tạo
review audit không hợp lệ. Manual approve không tăng ScriptVersion.revision.

### Edit/delete/apply suggestion

Các action dùng:

```text
scriptVersionId, baseRevision, factLockRunId, claimId
```

Server authorize → kiểm tra run/dependency còn applicable → CAS theo
`ScriptVersion.revision` → validate occurrence → sửa current ScriptVersion → tăng
revision. Không mutate `FactLockClaim` audit result. Revision mới làm run cũ stale;
không auto-supported và phải chạy Fact Lock lại.

Delete chỉ được tự động khi occurrence định vị exact text an toàn. Nếu không, trả
domain result để UI mở editor tại occurrence; tuyệt đối không fuzzy destructive
replacement. Suggestion luôn là proposal, server phải validate và CAS lại.

## M. Gate

Reusable server-side contract:

```text
FactLockGate.evaluate(projectId)
FactLockGate.assertPassed(projectId)
```

Gate chỉ cho phép downstream khi có ScriptVersion hiện tại, script strict-valid,
run result-bearing applicable, dependency/fact revision current và mọi claim đạt
matrix PASS. `PROHIBITED`, `UNSUPPORTED`, unresolved `NEEDS_REVIEW`, failed,
indeterminate, pending hoặc stale đều block.

Reason codes:

```text
NO_SCRIPT_VERSION
SCRIPT_NOT_READY
FACT_LOCK_NOT_RUN
FACT_LOCK_PENDING
FACT_LOCK_REVIEW_REQUIRED
FACT_LOCK_STALE_SCRIPT
FACT_LOCK_STALE_FACTS
FACT_LOCK_FAILED
FACT_LOCK_INDETERMINATE
FACT_LOCK_PASSED
```

Gate trả typed reason, không expose stack trace/provider payload. Voice và Render
chưa được implement trong Phase 0; khi thêm phải gọi gate ở server, không chỉ ẩn
nút trên UI.

## N. Dependency

Reuse `fact_dependency` với `dependentType = 'fact_lock'` và `dependentId` là
FactLockRun ID. Transaction tạo run pending phải snapshot Fact revisions và
register dependency trong cùng transaction. Fact update/delete dùng invalidation
mechanism hiện có; không tạo bảng dependency riêng cho Fact Lock.

## O. Tests cho Phase 1–3

Contract phải có proof cho:

- stale candidate claims được pre-run validator chấp nhận, strict validator từ chối;
- bốn classification, allowed combinations và manual approve restriction;
- occurrence/mapping invalid, missing Fact và mismatched revision;
- persisted status và effective stale precedence;
- script revision/fact dependency invalidation;
- CAS manual approve, edit, delete, suggestion và duplicate approval;
- same idempotency key/same intent, conflict và pending uniqueness;
- failed/indeterminate explicit retry bằng key mới;
- gate reason codes và cross-workspace authorization;
- deterministic provider không gọi paid AI trong unit/E2E.

Phase 0 bổ sung unit proof cho validator split trong
`script-version-foundation.test.ts`. Runtime/integration/E2E chỉ thực hiện khi
Phase 1–3 có implementation tương ứng.

## P. Migration

```text
No schema change.
No migration.
Neon unchanged.
```

## Q. Files changed

CREATE:

- `docs/aff-us-010-phase-0-contract-hardening.md`

MODIFY:

- `docs/README.md`
- `packages/core/src/script-version/validation.ts`
- `apps/web/src/features/script-generation/script-version-foundation.test.ts`
- `docs/decisions.md` (DEC-021)
- `docs/product-spec.md`
- `docs/architecture.md`
- `docs/ai-progress.md`
- `docs/changelog.md`

## R. Phase 1 schema recommendation

Phase 1 có thể tạo additive schema gồm:

1. `fact_lock_run`: workspace/project/scriptVersion identity, sourceScriptRevision,
   persisted status, idempotency/request/input/prompt hashes, input snapshot,
   prompt/schema/provider/model metadata, normalized output/error metadata và
   timestamps.
2. `fact_lock_claim`: run FK, immutable claim text/occurrence/classification/reason/
   confidence/checkedAt, controlled review status và reviewed-by/time/note. Thêm
   checks cho allowed combinations.
3. `fact_lock_claim_fact`: claim mapping với relation, `productFactId` và pinned
   `factRevision`; index theo run/claim/fact. Không xem client Fact revision là
   authority.

Index/constraint tối thiểu: workspace/project/source revision, unique
`workspace + idempotencyKey`, partial unique pending scope, run/claim foreign keys,
status/classification/review checks và timestamp indexes cho history/read model.
Fact dependencies dùng bảng hiện có. Raw provider output không nằm trong v1 schema.

## S. Final status

Phase 0 đã khóa contract, validator split và không thay đổi Neon:

```text
AFF-US-010 Phase 0 Contract Hardening is ready for acceptance.
```

Không tự bắt đầu Phase 1.

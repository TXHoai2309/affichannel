# Kế hoạch Domain Evolution v0.8

- Trạng thái: Domain Evolution M1–M5 DONE; AFF-US-013/AFF-US-016/AFF-US-017 DONE;
  M4 shadow retained; AFF-US-018 Phase 18A–18F PASS và DONE; AFF-US-019 chưa bắt
  đầu
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-27
- Quyết định liên quan: DEC-025, DEC-026, DEC-028, DEC-029, DEC-030

## 1. Mục tiêu

Mở rộng golden affiliate flow thành domain channel-first có Organic/Affiliate và
nhiều creation path, đồng thời giữ dữ liệu lịch sử, API compatibility và khả năng
rollback. Kế hoạch này chỉ định thứ tự migration; không phải lệnh apply database.

## 2. Contract đích

### Project

- `Project` tiếp tục là content production unit và đóng vai trò Content Item trong MVP.
- `contentType`: `ORGANIC | AFFILIATE`.
- `creationPath`: `QUICK_IMAGE | SCRIPTED | MEDIA_FIRST`.
- `contentFormat`: immutable `(key, version)` trỏ tới server-owned registry; không
  phải workflow state hoặc applicability authority.
- `productId`: nullable ở database; bắt buộc theo service invariant cho Affiliate
  và mọi Organic content có Product claim.
- Project cũ được backfill
  `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1`; Product/artifact cũ giữ nguyên.

### ContentFormat registry

- Ownership: readonly registry trong `packages/core`; API/server là authority.
- Persistence: `content_format_key TEXT` và `content_format_version INTEGER`.
- Initial registry/defaults:
  - `SCRIPTED` → `SCRIPTED_STANDARD v1`;
  - `QUICK_IMAGE` → `QUICK_IMAGE_STANDARD v1`;
  - `MEDIA_FIRST` → `MEDIA_FIRST_STANDARD v1`.
- Format orthogonal với `ORGANIC | AFFILIATE`; compatibility chỉ dựa trên
  CreationPath ở registry MVP.
- Không có DB registry table, database enum, encoded `key@version`, user-created
  format hoặc admin builder.
- Không có index riêng cho format ở M1; bổ sung sau khi Library/filter có query evidence.

### Runtime applicability

Resolver server-side trả trạng thái runtime cho từng dependency/step:
`NOT_REQUIRED | OPTIONAL | REQUIRED | READY | BLOCKED | STALE`. Các giá trị này
không được thêm vào enum `project_step_status.status`.

### Script generation

Server chọn một trong hai input source mode:

- `PRODUCT_BACKED`: đọc Product, Product Facts và dependency hiện hữu.
- `ORGANIC_NO_PRODUCT`: không lookup Product/Facts và không được invent Product claim.

Input source mode không thay persisted operation mode `full | repair`. Output
ScriptDraft, versioning, repair, idempotency và audit hiện hữu được giữ nguyên.

## 3. Phase 0 baseline readiness audit (historical)

Snapshot dưới đây ghi lại repository trước M1 để bảo toàn migration reasoning; nó
không mô tả current HEAD sau M1/M2/M3. Current accepted baseline đã có migration
`0017`, canonical reconciliation và M3 compatible create/update/read.

- Migration head: `0016_gifted_microbe.sql`; không có `0017`.
- `project.product_id` hiện `NOT NULL`, FK `product(id)` với `ON DELETE RESTRICT`
  và có index `project_product_id_idx`.
- Project còn yêu cầu `workspace_id`, `name`, `current_step_key`,
  `created_by_user_id`, timestamps; `archived_at` nullable. Existing indexes gồm
  workspace/archived/update, Product và creator.
- ContentBrief là one-to-one theo unique `project_id`; `platform`, `goal`,
  `duration_seconds`, `angle` required, `description` nullable; platform hiện chỉ
  `tiktok`, duration 15–180.
- Production create path duy nhất đi qua protected `project.create` → core project
  service → repository transaction. Validation/UI/service đều bắt buộc Product,
  workflow khởi tạo `currentStepKey=product` và insert đủ bảy step status.
- Project detail/list và Dashboard recent projects dùng inner join Product;
  `ProjectDetails.product` là object non-null. Nếu chỉ đổi nullability mà chưa sửa
  read model, Organic no-product sẽ biến mất khỏi list/detail.
- ScriptGeneration context/preflight inner join Product và snapshot Product/Facts
  bắt buộc. `ScriptGeneration.mode` hiện là `full | repair`; future
  `PRODUCT_BACKED | ORGANIC_NO_PRODUCT` phải là input source mode riêng.
- FactLock service/gate hiện resolve Product ID non-null và Product Facts theo
  Project. VoiceConfig/VoiceSegment paths hiện assert FactLock unconditionally.
  Resolver/conditional gate phải bao các path này trước khi bật Organic.
- `project_step_status` chỉ chấp nhận bảy step keys và bốn persisted statuses;
  applicability runtime không được thêm vào enum/check này.

Các điểm trên là Phase 1 touchpoint inventory, không phải authorization sửa source
trong Phase 0.

## 4. Trình tự migration additive

### M0 — Freeze và baseline

1. Chốt migration head và backup/restore procedure.
2. Chạy golden affiliate regression theo
   `docs/aff-us-012-phase-4-final-acceptance.md`.
3. Chụp số lượng Project theo Product linkage, current step và artifact state.
4. DEC-026 đã khóa ContentFormat representation/ownership/versioning và
   backfill/default rule.
5. Không bắt đầu schema change nếu baseline regression/preflight không xanh.

### M1 — Expand schema

1. Thêm `content_type`, `creation_path`, `content_format_key` và
   `content_format_version` ở trạng thái nullable; hai format columns phải cùng
   null hoặc cùng hợp lệ với version dương. Đổi `project.product_id` từ `NOT NULL`
   sang nullable nhưng giữ nguyên FK, `ON DELETE RESTRICT` và
   `project_product_id_idx`.
2. Không đặt DB default và không thêm index riêng cho ContentFormat; chưa đổi
   read/write mặc định.
3. Bổ sung M1 compatibility-read foundation cho các field nullable: all-null read
   được, không mutate, không auto-upgrade và không project legacy triple trước M3;
   golden Affiliate regression phải tiếp tục đạt.
4. Migration/slice `AFF-US-013` M1 chỉ expand Project domain; không tạo
   `claim_manifest` hoặc Manifest provenance cho FactLockRun. ClaimManifest vẫn
   thuộc Domain Evolution tổng thể nhưng được triển khai riêng trong
   `AFF-US-017 — ClaimManifest Foundation`.
5. Không drop/rename cột, không rewrite FactLockRun lịch sử.

### M2 — Backfill có thể tiếp tục

1. Backfill theo batch, idempotent: project cũ →
   `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1`.
2. Không thay `productId`, `currentStepKey`, step status hoặc artifact.
3. Ghi progress/checkpoint và kiểm tra row counts sau mỗi batch.
4. Row bất thường được đưa vào exception report; không tự đoán giá trị.

### M3 — Dual-read/compatible write

1. Read model hiểu cả row chưa backfill và row mới; all-null legacy row được
   project thành legacy triple với `isLegacyProjection=true` hoặc metadata
   provenance tương đương. Partial format ref trả `unsupported` với
   `reasonCode=PARTIAL_CONTENT_FORMAT_REF`; version không hợp lệ trả `unsupported`
   với `reasonCode=INVALID_CONTENT_FORMAT_VERSION`.
2. New write luôn ghi Content Type/Creation Path và ContentFormat ref hợp lệ.
   Create thiếu format dùng server default; supplied ref phải tồn tại/active và
   support CreationPath.
3. API response thêm field theo cách backward-compatible; client cũ vẫn chạy.
4. Service invariant, không chỉ UI, chặn Affiliate thiếu Product.

### M4 — Resolver shadow mode

1. Contract/audit source of truth là
   `docs/aff-us-014-m4-applicability-resolver-shadow.md`; Resolver cover
   `PRODUCT | SCRIPT | FACT_LOCK | VOICE | RENDER` với đúng sáu state canonical.
2. Chạy pure Resolver song song với normalized legacy gates trên golden
   `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1`; legacy vẫn production authority.
3. So sánh state, completion, primary reason và `nextApplicableStep`; mismatch dùng
   typed taxonomy, sanitized diagnostic và không đổi user-visible behavior.
4. Resolver/shadow path không mutate DB/artifact/`project_step_status`/
   `currentStepKey`, không gọi provider và không activate future identity.
5. Video/Render placeholder không được báo READY; sau khi upstream ready phải là
   `BLOCKED + RENDER_FEATURE_NOT_IMPLEMENTED` cho đến slice Render thật.
6. Chỉ mở authority-cutover task riêng khi 100% matrix A–J/golden Affiliate parity,
   zero exception/unmapped case và golden regression đạt. M4 tự nó không cut over.
7. Runtime implementation tests phải thêm negative domain fixtures fail-closed cho
   `AFFILIATE + missing Product`, unsupported ContentFormat và partial/invalid
   Project identity. Các fixture này kiểm tra primary reason precedence; chúng
   không mở rộng production shadow baseline ngoài
   `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1` và không activate future flow.
8. Implementation evidence 2026-08-24: matrix A–J `10/10`, negative fixtures,
   sanitized exception isolation và disposable-DB zero-mutation shadow integration
   PASS; M1/M3B/M2C cùng chín golden suites tiếp tục xanh. Legacy vẫn authority;
   không mở M5/cutover trong slice này.

### M4.1 — AFF-US-015 Adaptive Workflow UI cutover contract

1. Contract source of truth là `docs/aff-us-015-adaptive-workflow-ui.md` và DEC-029.
2. 15A thêm read-model mapper/shared read-only snapshot + tests, chưa UI consumer.
3. 15B chuyển stepper/landing presentation sang Resolver; execution guards giữ
   authority và không mutate persisted workflow.
4. 15C chuyển gated route shells sang cùng snapshot, giữ bookmarked Affiliate URLs
   và server defensive checks.
5. 15D chạy Affiliate A–J, direct-route, loading/error, accessibility/mobile và
   query-budget acceptance. Future identity vẫn inactive.
6. M4 shadow được retain qua adoption; reduce/remove cần explicit decision sau
   zero mismatch/exception/unmapped observation window.
7. OPTIONAL chỉ được activate sau durable server-owned selection contract; current
   baseline không có OPTIONAL.

Implementation evidence Phase 15A — 2026-08-24:

- pure mapper/read model, protected unused query và request-owned cache đã có;
- Project subject query workspace-authorized, read-only và giữ nullable/invalid
  identity để trả controlled unsupported state;
- Script/ScriptVersion/Fact Lock reads chạy song song, Voice dùng pure snapshot;
  Resolver chạy một lần và snapshot được reuse cho M4 comparison;
- pure Voice snapshot project pending quá configured lease thành effective
  `indeterminate` bằng explicit temporal context; persisted artifact không đổi;
- A–J `10/10`, unsupported fixtures, Render placeholder, request reuse và
  disposable-DB zero mutation/provider/reconciliation evidence PASS;
- current stepper/landing/routes và legacy reconciliation behavior chưa cut over.

Implementation evidence Phase 15B1 — 2026-08-24:

- Project layout/Stepper và Project Overview đã dùng request-cached Adaptive
  Workflow làm presentation authority;
- primary stepper dùng visible capability/ordinal động, active route theo pathname,
  Video/Preview cùng map Render và Render unimplemented hiển thị `Sắp có`;
- Web mapper typed/exhaustive theo reason code, delegate canonical tuple validity
  cho pure core invariant, fail closed invalid/unsupported và
  Overview CTA dùng adaptive next route;
- layout Stepper không còn Fact Lock/Voice reconciliation read; 15B2 entry surfaces
  đã cut over; route/deep-link sau đó được chuyển ở 15C.

Implementation evidence Phase 15B2 — 2026-08-24:

- Project List, Dashboard Recent Projects và post-create Continue dùng non-persisted
  Adaptive Workflow entry summary/`nextRouteKey`; Product-detail generic Open dùng
  Project Overview;
- unsupported và Render `COMING_SOON` không vào arbitrary deep route; Continue
  fail closed về Overview và Render giữ nhãn `Sắp có`;
- Dashboard progress dùng visible capability completion, Affiliate baseline `5`,
  completed-through-Voice `4/5`; không còn hardcoded persisted `/7`;
- batch reader gather nguồn theo tập Project ID bằng số query cố định rồi resolve
  trong bộ nhớ; không gọi full Adaptive Workflow pipeline theo từng card và không
  có global cross-request cache;
- integration parity batch-vs-single đạt A–J `10/10`, gồm expired Voice pending,
  unsupported, ordering, source dependencies và Channel Settings/Product Facts;
  evidence giữ zero mutation, zero reconciliation/provider call và fixed query budget;
- Product joins hiện chỉ dành cho Affiliate; `AFFILIATE_PRODUCT_NOT_LINKED` vẫn là
  follow-up của productless activation/hardening và không được active trong 15B2;
- `currentStepKey`/`project_step_status` vẫn persist nhưng không còn presentation/
  navigation authority trong AFF-US-015 surfaces; deep-link gates đã chuyển ở 15C
  và final acceptance được khóa ở 15D.

Implementation evidence Phase 15C — 2026-08-24:

- `/content`, `/fact-lock`, `/voice`, `/video`, `/preview` dùng shared Adaptive
  route gate và request-owned cached snapshot làm presentation authority;
- NOT_REQUIRED/OPTIONAL chưa chọn/REQUIRED/BLOCKED/STALE/unsupported/invalid tuple
  render controlled state, không redirect; READY render capability content;
- BLOCKED/STALE chỉ giữ remediation content khi typed `primaryAction` target đúng
  capability; downstream blocked route không expose execution UI;
- Video/Preview dùng cùng Render truth và cùng trả `Sắp có` không execution CTA;
- generic route presentation không gọi Fact Lock gate riêng hoặc Voice
  reconciliation; server execution guards, M4 shadow và persisted progress giữ nguyên;
- A–J route matrix `10/10`, execution golden, zero mutation/provider/reconciliation,
  15B1/15B2 và fixed-query regressions PASS.

Implementation evidence Phase 15D — 2026-08-25:

- `AC-015-01–18` PASS; AFF-US-015 DONE cho supported Affiliate flow;
- full-system A–J, single/batch parity, expired Voice, tuple invariant,
  NOT_REQUIRED/OPTIONAL mapper, Render/route truth, accessibility semantics và
  query-budget regressions PASS;
- clean disposable DB đạt M1/M3B/M2C/M4 và chín golden suites; Adaptive reads giữ
  mutation/reconciliation/provider call bằng `0`;
- full Web `47/47` files, `437/437` tests và type-check PASS; external manual
  evidence đạt Overview, Dashboard, List và năm deep-link routes;
- M4 shadow vẫn active cho post-cutover diagnostic confidence. Tại thời điểm
  Phase 15D acceptance, M5 chưa bắt đầu.

### M5 — Enforce và cutover

Contract source of truth là `docs/domain-evolution-m5-enforcement-contract.md` và
DEC-030.

1. Sau fresh zero-blocker preflight, đặt NOT NULL cho bốn Channel-First identity
   columns; không đặt DB default/enum/registry table.
2. Giữ `product_id` nullable, legacy request canonicalization, defensive legacy
   read projection, CAS, M2 tooling và M4 shadow qua rollback window.
3. Production writable identity vẫn chỉ là current Affiliate baseline. Organic,
   Quick Image, Media First và Manifest-first thuộc story sau, không được M5 mở.
4. Không đồng bộ/xóa `currentStepKey` hoặc `project_step_status`; Resolver/Adaptive
   authority và các execution guard hiện hữu được giữ nguyên.
5. Rollout theo application-compatible → preflight → explicit migration →
   postflight; bất kỳ legacy/partial/invalid row nào đều STOP, không heuristic fix.

M5A đã implement read-only preflight, migration `0018_natural_speed`, postflight
và disposable compatibility evidence. M5B fresh production read-only preflight
PASS với 16/16 canonical Projects, zero blockers và pre-M5 schema/migration count
18. Session dùng owner role thay vì dedicated read-only credential nhưng chỉ chạy
read-only operations. M5C vẫn phải rerun fresh production preflight ngay trước
apply 0018; M5B evidence không thay thế hoặc authorize M5C gate.

M5C guarded runner đã rerun fresh preflight và apply duy nhất
`0018_natural_speed`: identity columns hiện NOT NULL, `product_id` vẫn nullable,
migration count 18→19 và postflight 16/16 canonical/zero blockers. Không backfill,
Project data mutation, provider call hay workflow authority change.

M5D final regression đã PASS M1, M2A/M2B/M2C, M3B, M4 shadow, Adaptive Workflow,
M5A, chín golden suites, type-check và full Web tests. `AC-M5-01–20` đều PASS;
Domain Evolution M5, AFF-US-013, AFF-US-016 và AFF-US-017 DONE. AFF-US-018
Phase 18A–18F đã PASS và DONE: new Fact Lock writes Manifest-first, legacy
`inputMode=NULL` chỉ còn read compatibility. M4 shadow/approved compatibility
adapters vẫn retained; cleanup thuộc M6 và cần quyết định riêng.

### M6 — Contract cleanup có điều kiện

Chỉ cleanup compatibility branch sau ít nhất một release ổn định và có bằng chứng
không còn row cũ chưa backfill. Drop/rename là migration riêng, cần phê duyệt mới.

### AFF-US-017 — ClaimManifest Foundation sau M5

AFF-US-017 là story đã hoàn tất, không phải M6 cleanup. Contract source of truth là
`docs/aff-us-017-claim-manifest-foundation.md` và DEC-031. Rollout là pure domain
→ additive table → race-safe repository → explicit ScriptVersion revision adapter
→ regression/handoff. Không sửa FactLockRun, không backfill dữ liệu lịch sử và
không đổi current Fact Lock execution; Manifest-first cutover thuộc AFF-US-018.

### AFF-US-018 — Manifest-first Fact Lock (Phase 18A–18F)

AFF-US-018 new writes dùng `inputMode=MANIFEST_V1` và explicit executable
`SCRIPT_VERSION` ClaimManifest. Historical rows giữ `inputMode=NULL`, Script-linked
read behavior và không backfill. Manifest linkage gồm ID/fingerprint server-derived,
FK `ON DELETE RESTRICT`; Script provenance nullable ở schema nhưng current activation
vẫn populate từ Manifest source.

Manifest mode request identity dùng `inputVersion="fact-lock.manifest.v1"`,
Manifest fingerprint và deterministic Product Facts snapshot fingerprint. Pending
uniqueness dùng mode-specific partial indexes: legacy theo ScriptVersion/revision,
Manifest mode theo request hash. Provider phải trả exact claim-key bijection và server
reorder theo Manifest; mismatch thành `indeterminate`. Executable zero-claim Manifest
PASS không provider/dependency. Manifest-first resolution không mutate Manifest hoặc
ScriptVersion; chỉ status-only manual approval được phép.

`NO_SCRIPT`, Organic, Quick Image và Media First không được activate trong US18.
Migration `0020_chilly_harry_osborn` là additive migration đã được chấp nhận và
giữ nguyên; Phase 18F không tạo migration mới hoặc thay đổi schema. AFF-US-019
chưa bắt đầu. Trước AFF-US-019 phải chạy full Affiliate Scripted flow checkpoint
từ Project tới Voice.

### POST AFF-US-018 — Script Claim Refresh hardening

Đây là contract/design checkpoint sau khi AFF-US-018 đã DONE, không mở lại
AFF-US-018 và không bắt đầu AFF-US-019. Claim Refresh là paid extraction operation
riêng của ScriptVersion: sau claim-bearing edit, claims chuyển `stale`; explicit
refresh tạo candidate `{text, occurrence}` từ exact current Script content; chỉ sau
CAS thành công và claims trở thành `current` mới được build ClaimManifest. Fact Lock
không extract lại claims và Product Facts không thuộc semantic input/hash của Claim
Refresh.

Execution phải có artifact bền vững riêng `script_claim_refresh_run` trong migration
tương lai `0021` — không dùng `FactLockRun` hoặc `ScriptGeneration`. Contract đã khóa
tại DEC-034: source projection/hash deterministic (selected hook, ordered voiceover,
scene on-screen text, CTA, caption), request hash server-owned, workspace-scoped
idempotency, pending semantic uniqueness, durable single-winner execution claim,
provider ngoài transaction và T3 CAS. Status là `pending | completed | failed |
indeterminate`; provider-result mismatch là `failed`, uncertainty là
`indeterminate` và không automatic paid retry.

Với source revision `R`, refresh thành công tạo ScriptVersion revision `R+1`,
`claimsSourceRevision=R+1`, còn run giữ `sourceScriptRevision=R` và
`resultScriptRevision=R+1`. Phasing implementation: CR-A persistence/repository,
CR-B provider/runtime/CAS, CR-C public editor action + current ScriptVersion
read-model + workflow refresh. Chưa tạo migration `0021` trong checkpoint này.

## 5. Ma trận invariant

| Trường hợp | Product | Script | Fact Lock | Voice | Render |
|---|---|---|---|---|---|
| Affiliate + Scripted | Required | Required | Required | Theo path/config | Chỉ khi gate đạt |
| Affiliate + Quick Image | Required | Not required | Required | Optional | Chỉ khi gate đạt |
| Organic claimless + Quick Image | Not required | Not required | Not required | Optional | Cho phép khi composition ready |
| Organic claimless + Scripted | Not required | Required | Not required | Optional | Cho phép khi composition ready |
| Organic có Product claim | Required | Theo path | Required | Optional | Chỉ khi gate đạt |

`Required/Optional/Not required` trong bảng là requirement policy class ở mức
identity, không phải full runtime state hay persisted completion. Tại runtime,
mandatory capability có thể derive `REQUIRED`, `READY`, `BLOCKED` hoặc `STALE`
theo DEC-028.

## 6. `nextApplicableStep`

Resolver pure phải:

1. nhận domain snapshot server đã scope theo workspace;
2. tính applicability cho năm capability M4;
3. chọn capability tiếp theo theo canonical order, bỏ qua `NOT_REQUIRED` và
   unselected `OPTIONAL`;
4. không coi `READY` là `completed`;
5. không mutate `currentStepKey` hoặc tạo persisted `completed` giả;
6. trả typed reason/dependency summary để comparison giải thích được.

Sau M4 parity, nếu được phê duyệt cutover, business action đồng bộ persisted
workflow mới phải khóa Project hoặc dùng optimistic concurrency tương đương, đọc
snapshot mới nhất, tính lại Resolver result và cập nhật `currentStepKey` trong cùng
transaction. Operation đó không thuộc M4 shadow.

Direct URL có thể xem step khác, nhưng không được trở thành workflow source of truth.
AFF-US-015 dùng controlled route states thay vì auto-redirect: NOT_REQUIRED hiện
N/A + CTA, BLOCKED hiện typed remediation, STALE hiện prior safe artifact + rerun.

## 7. Rollback

- M5 chỉ rollback về binary M3B-or-newer đã chứng minh luôn ghi canonical identity.
- Giữ legacy request canonicalization và defensive read projection; không rollback
  bằng null identity hoặc drop constraint âm thầm.
- Organic/Manifest-first chưa active trong M5 nên rollback M5 không mutate các
  identity đó. Mọi constraint rollback là migration riêng có review.

## 8. Quan sát và bằng chứng bắt buộc

- Tổng Project trước/sau backfill và số row exception.
- Parity report của affiliate resolver.
- Tỷ lệ gate theo reason code và số `NOT_REQUIRED` transition.
- Số new FactLockRun theo Manifest và số legacy run vẫn đọc được.
- Số Project có null/partial/unknown/deprecated ContentFormat ref và registry
  version distribution.
- Test/command, migration hash, thời điểm apply và người phê duyệt.

## 9. Ngoài phạm vi

- `HYBRID` Content Type.
- Nhiều channel/workspace.
- Auto-post, recommendation engine và AI Visual production.
- Bulk rewrite AFF-US-001–012 hoặc xóa audit history.

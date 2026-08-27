# Acceptance Plan cho Domain Evolution v0.8

- Trạng thái: Canonical; M4/AFF-US-015 retained/accepted; Domain Evolution M5,
  AFF-US-013, AFF-US-016, AFF-US-017 và AFF-US-018 DONE; AFF-US-019 chưa bắt đầu
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-27
- Quyết định liên quan: DEC-025, DEC-026, DEC-028, DEC-029, DEC-030

## 1. Nguyên tắc đạt

Một phase chỉ đạt khi test domain, persistence, protected API và authenticated E2E
đều có evidence; không dùng UI-only validation làm bằng chứng invariant. Golden
affiliate baseline phải tiếp tục xanh trong toàn bộ rollout.

## 2. Gate A — Migration và compatibility

- [x] DEC-026 khóa ContentFormat representation, registry ownership, versioning
  và backfill/default rule trước migration M1.
- [x] Additive migration 0017 apply thành công trên disposable production-shaped snapshot.
- [x] Project cũ backfill đúng
  `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1`, giữ Product/current step/artifact.
- [x] Backfill chạy lại không đổi kết quả và có exception report.
- [x] Mixed old/new rows đọc được trong deployment window.
- [x] Legacy Script-linked FactLockRun vẫn xem được và có effective state đúng.
- [ ] Rollback feature flag không làm mất Organic/Manifest data đã ghi.

### ContentFormat registry contract

- [x] Mỗi key đại diện một format family và có thể có nhiều version; chỉ cặp
  `(key, version)` là duy nhất, version không trùng trong cùng key và là số nguyên
  dương.
- [x] Mỗi MVP CreationPath có đúng một active default và default đó support path.
- [x] `SCRIPTED_STANDARD v1` tồn tại làm legacy backfill target; version cũ hoặc
  deprecated còn được resolve để đọc Project đã pin.
- [x] Invalid key/version và format/path mismatch bị server từ chối.
- [x] Create không gửi format dùng server default; client không phải authority.
- [x] Đổi ContentType không rewrite format còn compatible.
- [x] Đổi CreationPath sang path incompatible phải gửi replacement format rõ ràng;
  server không silently rewrite.
- [x] Unknown reference vẫn trả raw `(key, version)`, Project page không crash,
  không fallback latest và action cần definition bị block có kiểm soát.
- [x] Partial ContentFormat ref trả `unsupported` với
  `reasonCode=PARTIAL_CONTENT_FORMAT_REF`; version không hợp lệ trả `unsupported`
  với `reasonCode=INVALID_CONTENT_FORMAT_VERSION`.
- [x] ContentFormat resolution chỉ dùng `resolved | deprecated | unsupported`;
  legacy provenance dùng metadata riêng như `isLegacyProjection`, không overload
  resolution.
- [x] Registry không chứa Product/Script/Fact Lock/Voice/Render applicability rule.
- [x] Expand M1 dùng nullable pair có whole-pair integrity, không DB default và
  không index format riêng.

## 3. Gate B — Applicability Resolver

- [x] `AC-014-01–07`: khóa six-state semantics, completion separation, năm
  capabilities, typed reason/precedence, sanitized dependencies và pure
  `nextApplicableStep` tại
  `docs/aff-us-014-m4-applicability-resolver-shadow.md`.
- [x] `AC-014-08`: matrix A–J và golden `AFFILIATE + SCRIPTED` đạt 100% state,
  completion, primary reason và next-step parity.
- [x] `AC-014-09`: Script revision, Product Fact dependency và Voice fingerprint
  tạo đúng `STALE`, không flatten thành generic blocked.
- [x] `AC-014-10–12`: shadow-only, legacy authority giữ nguyên, zero mutation và
  không cut over API/UI/worker.
- [x] `AC-014-13`: future Organic/Quick Image/Media First fixtures không activate
  production write/route behavior.
- [x] `AC-014-14`: Video/Render placeholder trả
  `BLOCKED + RENDER_FEATURE_NOT_IMPLEMENTED` khi upstream ready.
- [x] `AC-014-15`: zero resolver exception/unmapped case và golden regression xanh
  trước khi mở authority-cutover task.
- [x] Affiliate thiếu Product tiếp tục bị từ chối ở application service/protected
  API; DB nullability không phải applicability policy.
- [x] Runtime states không được persist vào `project_step_status.status`, Project
  column hoặc Resolver snapshot table.

## 4. Gate C — Workflow transition

- [x] `nextApplicableStep` bỏ qua đúng step `NOT_REQUIRED` theo canonical order.
- [x] Step bị bỏ qua không được ghi `completed`.
- [x] M4 shadow không cập nhật `currentStepKey`; Resolver chỉ derive result.
- [ ] Future separately approved persisted-cursor synchronization, nếu cần, phải
  atomic dưới concurrent request; DEC-030 xác nhận operation này không thuộc M5.
- [x] Direct Project read/shadow observation không mutate workflow current.
- [x] Back/forward/refresh hiển thị đúng viewed step và current workflow state.
- [x] Resolver change làm downstream gate lại nhưng không tự rollback current step.

## 5. Gate D — Script generation input source modes

- [ ] Server chọn `PRODUCT_BACKED` cho path/policy cần Product.
- [ ] `ORGANIC_NO_PRODUCT` không lookup Product/Facts và không lỗi vì `productId=null`.
- [ ] Persisted operation mode `full | repair` hiện hữu không bị đổi nghĩa hoặc
  thay bằng input source mode.
- [ ] Prompt/output validator chặn Product claim bị invent trong claimless mode.
- [ ] Snapshot/hash/idempotency khác nhau giữa hai mode khi input semantics khác.
- [ ] ScriptDraft/version history và golden generation regression vẫn xanh.

## 6. Gate E — ClaimManifest

AFF-US-017 exact contract và `AC-017-01–22` nằm tại
`docs/aff-us-017-claim-manifest-foundation.md`. Gate E PASS qua Phase 17A–17E;
ClaimManifest foundation đã hoàn tất và đang được dùng bởi public Manifest-first
Fact Lock của AFF-US-018.

- [x] Current ScriptVersion adapter build Manifest deterministic từ exact pinned
  revision/structured claims.
- [x] Client không thể giả `isEmpty` hoặc fingerprint.
- [x] Canonical ordering tạo fingerprint ổn định với input tương đương.
- [x] Sửa bất kỳ output-bearing source nào tạo fingerprint mới và run cũ `STALE`.
- [x] Empty Manifest chỉ được tạo khi extraction/normalization thành công.
- [x] Builder failure không persist empty/failed Manifest; US17 provider calls bằng 0.
- [x] Source locator đưa UI về đúng field/element.

Future adapters cho output-bearing no-script sources vẫn thuộc story tương ứng và
không được activate trong AFF-US-017/AFF-US-018 clarification.

## 7. Gate F — Fact Lock Manifest-first

- [x] New `MANIFEST_V1` FactLockRun có server-derived Manifest ID/fingerprint và
  chỉ chạy explicit executable `SCRIPT_VERSION` Manifest.
- [x] `inputMode=NULL` là legacy read; `inputMode=MANIFEST_V1` là new mode; không
  backfill hoặc suy luận mode từ nullable FK.
- [x] Script provenance nullable ở schema nhưng current US18 runtime vẫn populated
  từ Manifest source descriptor.
- [x] `productFactsFingerprint` và `requestHash` dùng canonical exact snapshot;
  changed Product Facts tạo semantic request khác.
- [x] Legacy và Manifest pending uniqueness dùng hai partial indexes riêng.
- [x] Provider output exact-bijection theo Manifest `claimKey`; server reorder theo
  Manifest và reject missing/extra/duplicate/unknown claim.
- [x] Provider mismatch thành `indeterminate/FACT_LOCK_PROVIDER_RESULT_MISMATCH`;
  không tự retry paid provider.
- [x] Executable zero-claim Manifest PASS, zero claim rows/dependencies/provider calls.
- [x] Manifest-first resolution không mutate Manifest/ScriptVersion; chỉ status-only
  manual approval được phép nếu không đổi source.
- [x] Legacy/new run cùng tồn tại, list/read không nhập nhằng source mode.
- [x] Concurrent finalize dùng CAS và không che một PASS còn applicable.

Gate F PASS qua Phase 18A–18F. Public new writes dùng `prepareManifest` rồi
explicit `claimManifestId`; legacy `inputMode=NULL` chỉ còn read compatibility.
AFF-US-019 chưa bắt đầu. Full Affiliate Scripted flow checkpoint là bắt buộc
trước khi bắt đầu story đó.

## 8. Gate G — Voice, render và Quick Image

- [ ] Organic claimless + Voice opt-in tạo TTS khi Fact Lock `NOT_REQUIRED`.
- [ ] Affiliate hoặc Organic Product claim bị chặn TTS/render nếu run chưa PASS.
- [ ] Gate được assert lại ngay trước paid provider/worker execution.
- [ ] Quick Image claimless hoàn tất không cần Product, Script hoặc Fact Lock.
- [ ] Motion 5/10/15 giây deterministic; preview/render dùng cùng composition input.
- [ ] Render retry tạo immutable variation mới, không overwrite output cũ.
- [ ] Thay overlay/caption/CTA làm Manifest và render readiness stale đúng cách.

## 9. Gate H — Security và authorization

- [ ] Cross-workspace Product/Manifest/FactLockRun bị từ chối.
- [ ] Public signup vẫn disabled; fixed internal accounts không đổi.
- [ ] Provider credential, raw payload và signed URL không xuất log/API.
- [ ] Upload/media validate MIME, size, metadata và ownership.
- [ ] Typed errors không lộ existence của record ngoài workspace.

## 10. Gate I — UX và accessibility

- [x] `AC-015-01–18` đã khóa và final acceptance PASS tại
  `docs/aff-us-015-adaptive-workflow-ui.md`; AFF-US-015 DONE.
- [x] Phase 15A: derived typed mapper, exact route descriptors, completion/state
  separation, controlled unsupported state và A–J `10/10` đã có deterministic tests.
- [x] Phase 15A: protected read-only aggregation reuse một request-owned snapshot;
  zero workflow/artifact mutation, zero Voice reconciliation và zero provider call.
- [x] Phase 15A: Voice read projection dùng configured pending lease và explicit
  clock; expired pending trả effective `indeterminate` tương đương reconciliation
  nhưng không persist status/error/finishedAt.
- [x] Phase 15A: M4 shadow consume resolved snapshot ở adaptive read boundary;
  mismatch taxonomy, exception isolation và legacy `project.get` response giữ nguyên.
- [x] Phase 15B1: Project Stepper/Overview dùng Adaptive Workflow; dynamic visible
  count/ordinal, pathname active route, Render `Sắp có`, unsupported/invalid
  fail-closed qua canonical core tuple invariant và Overview next CTA có
  deterministic tests.
- [x] Phase 15B2: Project List, Dashboard, product-detail và post-create navigation
  dùng adaptive summary/route; Open vs Continue tách biệt, unsupported/Render về
  Overview, visible Affiliate progress `4/5`, batch query không per-card waterfall.
- [x] Phase 15B2 batch-vs-single canonical parity A–J `10/10`: expired Voice pending,
  unsupported, ordering, dependencies, Channel Settings/Product Facts; fixed query
  budget, zero mutation và zero reconciliation/provider call.
- [ ] Productless activation/hardening cho `AFFILIATE_PRODUCT_NOT_LINKED`; Product
  joins của 15B2 tiếp tục Affiliate-only.
- [x] Phase 15C: deep-link/page-shell presentation cutover; execution guards giữ
  server authority.
- [x] Shared route gate phân biệt đủ sáu state và completion bằng text/icon; READY
  không bị coi là complete, STALE không bị flatten thành blocked/failed.
- [ ] Product picker chỉ bắt buộc khi policy yêu cầu và giải thích lý do.
- [x] `NOT_REQUIRED` ẩn khỏi primary stepper với visible numbering liên tục; direct
  URL hiện controlled N/A state. OPTIONAL chưa được production-activate và vẫn cần
  durable server opt-in ở future slice.
- [x] Internal route cutover không làm mất deep link/bảy persisted step routes;
  Product, Content, Fact Lock, Voice, Video và Preview bookmarks vẫn hợp lệ.
- [x] Video/Preview dùng cùng Render result và hiện `Sắp có` khi reason là
  `RENDER_FEATURE_NOT_IMPLEMENTED`; không expose execution CTA.
- [x] Adaptive loading/error, unsupported/invalid, blocked/stale và ready có
  controlled presentation; không flash legacy readiness hoặc redirect loop.
- [ ] Ngoài scope AFF-US-015, các future media/provider flow vẫn cần đủ empty,
  validation, conflict, unauthorized, provider-error và success state khi active.
- [x] Keyboard/focus/label, semantic link/button, `aria-current`, non-color status
  và responsive no-overflow đạt automated source/test audit cùng external manual
  evidence của supported Affiliate flow.
- [x] Adaptive read reuse một authorized snapshot, không provider/mutation hoặc
  duplicate Project + shadow + adaptive gather waterfall.
- [x] Phase 15D: direct-route/manual, loading/error controlled presentation,
  accessibility/mobile và final fixed-query budget accepted; A–J single/batch,
  M4/M3B/M2C/M1, chín golden suites, full Web và type-check đều PASS.

## 11. Gate J — M5 enforcement and cutover

`AC-M5-01–20` và exact production/request/read matrices nằm tại
`docs/domain-evolution-m5-enforcement-contract.md`. Gate chỉ PASS sau clean
M1→M5 migration, fresh production zero-blocker preflight, postflight, rollback
rehearsal, M2/M3B/M4/AFF-US-015 và golden regressions. M5A đã PASS các gate
disposable: clean/dirty migration, schema introspection, binary compatibility,
M2C/M4/Adaptive và golden regression. M5B fresh production preflight PASS với
16 canonical complete Projects, zero blockers/deprecated refs, nullable pre-M5
identity columns, nullable `product_id` và migration count 18. Đây là evidence tại
thời điểm M5B, trước khi M5C được thực hiện; owner-role M5B evidence không được
dùng để skip M5C fresh preflight.

M5C evidence PASS: committed guarded runner reran fresh production preflight
(16/16 canonical, zero blockers), confirmed pre-schema nullable and migration
count 18, applied exactly 0018, then confirmed four identity columns NOT NULL,
`product_id` nullable, migration count 19/latest 0018 and unchanged 16/16
canonical zero-blocker postflight. No Project data mutation/backfill or provider
call occurred.

M5D final regression/sign-off PASS: M1, M2A/M2B/M2C, M3B, M4 shadow, Adaptive
Workflow, M5A, chín golden suites, type-check và full Web tests đều xanh trên
disposable DB; provider call bằng 0. Gate J và `AC-M5-01–20` DONE. AFF-US-013,
AFF-US-016, AFF-US-017 và AFF-US-018 DONE; AFF-US-019 chưa bắt đầu.

AFF-US-018 Phase 18F public cutover PASS: Manifest preparation, explicit public
Manifest run, zero-claim path, dual-mode read/gate, status-only review approval,
source-mutation guards, Voice downstream compatibility và public error mapping
đều có evidence trên current schema. Migration 0020 không đổi; không có 0021,
backfill, production DB touch hoặc live provider call. Full Affiliate Scripted
flow checkpoint phải PASS trước AFF-US-019.

### AC-M5 final matrix

| Criteria | Result | Evidence |
|---|---|---|
| AC-M5-01–02 | PASS | Production preflight: legacy all-null = 0, partial = 0. |
| AC-M5-03–05 | PASS | Identity columns NOT NULL không default; Product nullable; pair/version constraints retained. |
| AC-M5-06–09 | PASS | M5A/M3B/direct-schema, legacy canonicalization, defensive read và typed/deprecated tests PASS. |
| AC-M5-10–12 | PASS | Future modes inactive; Resolver/Adaptive độc lập persisted cursor; guards/CAS/idempotency PASS. |
| AC-M5-13 | PASS | M4 shadow unit/integration parity PASS, zero mutation/provider call. |
| AC-M5-14–17 | PASS | Fresh production preflight, exact 0018 apply, postflight và compatible rollback-binary evidence PASS. |
| AC-M5-18–19 | PASS | M5 completion closes AFF-US-013/AFF-US-016; approved adapters retained. |
| AC-M5-20 | PASS | M5 không có ClaimManifest schema/runtime/source; AFF-US-017 được triển khai sau M5 và hiện đã DONE. |

## 12. Regression suite tối thiểu

```text
type-check
lint/format check
core domain unit tests
database integration tests
protected API integration tests
authenticated golden affiliate E2E
authenticated Organic Quick Image E2E
Manifest stale/uncertainty E2E
Voice optional và conditional Fact Lock E2E
```

Không gọi live paid provider trong deterministic CI. Live smoke test, nếu cần,
phải có budget, credential server-only và evidence riêng.

## 13. Evidence và sign-off

Mỗi gate ghi command, commit/migration hash, môi trường, thời gian, kết quả và link
artifact. Product owner phê duyệt behavior; engineering phê duyệt migration,
security và rollback. Chỉ sau khi tất cả gate áp dụng đạt mới đổi trạng thái repo
từ “document-level canonical” sang “canonical activated”.

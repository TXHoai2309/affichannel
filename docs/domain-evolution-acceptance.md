# Acceptance Plan cho Domain Evolution v0.8

- Trạng thái: Canonical; M4 shadow AC-014-01–15 đạt, Adaptive presentation đã cut
  over qua Phase 15C; M5 chưa mở
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-24
- Quyết định liên quan: DEC-025, DEC-026, DEC-028

## 1. Nguyên tắc đạt

Một phase chỉ đạt khi test domain, persistence, protected API và authenticated E2E
đều có evidence; không dùng UI-only validation làm bằng chứng invariant. Golden
affiliate baseline phải tiếp tục xanh trong toàn bộ rollout.

## 2. Gate A — Migration và compatibility

- [x] DEC-026 khóa ContentFormat representation, registry ownership, versioning
  và backfill/default rule trước migration M1.
- [ ] Additive migration apply thành công trên snapshot giống production.
- [ ] Project cũ backfill đúng
  `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1`, giữ Product/current step/artifact.
- [ ] Backfill chạy lại không đổi kết quả và có exception report.
- [ ] Mixed old/new rows đọc được trong deployment window.
- [ ] Legacy Script-linked FactLockRun vẫn xem được và có effective state đúng.
- [ ] Rollback feature flag không làm mất Organic/Manifest data đã ghi.

### ContentFormat registry contract

- [ ] Mỗi key đại diện một format family và có thể có nhiều version; chỉ cặp
  `(key, version)` là duy nhất, version không trùng trong cùng key và là số nguyên
  dương.
- [ ] Mỗi MVP CreationPath có đúng một active default và default đó support path.
- [ ] `SCRIPTED_STANDARD v1` tồn tại làm legacy backfill target; version cũ hoặc
  deprecated còn được resolve để đọc Project đã pin.
- [ ] Invalid key/version và format/path mismatch bị server từ chối.
- [ ] Create không gửi format dùng server default; client không phải authority.
- [ ] Đổi ContentType không rewrite format còn compatible.
- [ ] Đổi CreationPath sang path incompatible phải gửi replacement format rõ ràng;
  server không silently rewrite.
- [ ] Unknown reference vẫn trả raw `(key, version)`, Project page không crash,
  không fallback latest và action cần definition bị block có kiểm soát.
- [ ] Partial ContentFormat ref trả `unsupported` với
  `reasonCode=PARTIAL_CONTENT_FORMAT_REF`; version không hợp lệ trả `unsupported`
  với `reasonCode=INVALID_CONTENT_FORMAT_VERSION`.
- [ ] ContentFormat resolution chỉ dùng `resolved | deprecated | unsupported`;
  legacy provenance dùng metadata riêng như `isLegacyProjection`, không overload
  resolution.
- [ ] Registry không chứa Product/Script/Fact Lock/Voice/Render applicability rule.
- [ ] Expand M1 dùng nullable pair có whole-pair integrity, không DB default và
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
- [ ] Affiliate thiếu Product tiếp tục bị từ chối ở application service/protected
  API; DB nullability không phải applicability policy.
- [x] Runtime states không được persist vào `project_step_status.status`, Project
  column hoặc Resolver snapshot table.

## 4. Gate C — Workflow transition

- [x] `nextApplicableStep` bỏ qua đúng step `NOT_REQUIRED` theo canonical order.
- [x] Step bị bỏ qua không được ghi `completed`.
- [x] M4 shadow không cập nhật `currentStepKey`; Resolver chỉ derive result.
- [ ] Trong task cutover riêng sau M4, transition cập nhật `currentStepKey` atomic
  dưới concurrent request.
- [x] Direct Project read/shadow observation không mutate workflow current.
- [ ] Back/forward/refresh hiển thị đúng viewed step và current workflow state.
- [ ] Resolver change làm downstream gate lại nhưng không tự rollback current step.

## 5. Gate D — Script generation input source modes

- [ ] Server chọn `PRODUCT_BACKED` cho path/policy cần Product.
- [ ] `ORGANIC_NO_PRODUCT` không lookup Product/Facts và không lỗi vì `productId=null`.
- [ ] Persisted operation mode `full | repair` hiện hữu không bị đổi nghĩa hoặc
  thay bằng input source mode.
- [ ] Prompt/output validator chặn Product claim bị invent trong claimless mode.
- [ ] Snapshot/hash/idempotency khác nhau giữa hai mode khi input semantics khác.
- [ ] ScriptDraft/version history và golden generation regression vẫn xanh.

## 6. Gate E — ClaimManifest

- [ ] Manifest được build server-side từ Script, overlay, caption, CTA, voice,
  declared claims và composition source áp dụng.
- [ ] Client không thể giả `isEmpty` hoặc fingerprint.
- [ ] Canonical ordering tạo fingerprint ổn định với input tương đương.
- [ ] Sửa bất kỳ output-bearing source nào tạo fingerprint mới và run cũ `STALE`.
- [ ] Empty Manifest chỉ được tạo khi extraction/normalization thành công.
- [ ] Parser/provider uncertainty fail closed `indeterminate`/`blocked`.
- [ ] Source locator đưa UI về đúng field/element.

## 7. Gate F — Fact Lock Manifest-first

- [ ] New FactLockRun luôn có Manifest ID/fingerprint.
- [ ] Script provenance nullable và đúng khi Manifest có Script source.
- [ ] Pending/idempotency new writes dùng Manifest fingerprint, không chỉ script revision.
- [ ] Affiliate empty Manifest vẫn chạy policy check và có thể PASS zero claims.
- [ ] Organic Product claim cần current PASS và evidence còn hiệu lực.
- [ ] Legacy/new run cùng tồn tại, list/read không nhập nhằng source mode.
- [ ] Concurrent finalize dùng CAS và không che một PASS còn applicable.

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

- [x] `AC-015-01–18` đã khóa ở cấp tài liệu tại
  `docs/aff-us-015-adaptive-workflow-ui.md`; runtime/UI acceptance vẫn chưa chạy.
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
- [ ] `NOT_REQUIRED` ẩn khỏi primary stepper với visible numbering liên tục; direct
  URL hiện controlled N/A state. OPTIONAL chỉ active sau durable server opt-in.
- [x] Internal route cutover không làm mất deep link/bảy persisted step routes;
  Product, Content, Fact Lock, Voice, Video và Preview bookmarks vẫn hợp lệ.
- [x] Video/Preview dùng cùng Render result và hiện `Sắp có` khi reason là
  `RENDER_FEATURE_NOT_IMPLEMENTED`; không expose execution CTA.
- [ ] Loading, empty, validation, conflict, unauthorized, provider error và success đều có state.
- [ ] Keyboard/focus/label/contrast, semantic link/button, `aria-current` và mobile
  no-overflow đạt baseline hiện hữu.
- [x] Adaptive read reuse một authorized snapshot, không provider/mutation hoặc
  duplicate Project + shadow + adaptive gather waterfall.
- [ ] Phase 15D: authenticated direct-route/manual, loading/error, accessibility,
  mobile và final query-budget acceptance; full AFF-US-015 chưa DONE.

## 11. Regression suite tối thiểu

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

## 12. Evidence và sign-off

Mỗi gate ghi command, commit/migration hash, môi trường, thời gian, kết quả và link
artifact. Product owner phê duyệt behavior; engineering phê duyệt migration,
security và rollback. Chỉ sau khi tất cả gate áp dụng đạt mới đổi trạng thái repo
từ “document-level canonical” sang “canonical activated”.

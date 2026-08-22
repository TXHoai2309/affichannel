# Acceptance Plan cho Domain Evolution v0.8

- Trạng thái: Canonical test contract; chưa chạy
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-22
- Quyết định liên quan: DEC-025, DEC-026

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

- [ ] Mọi key và cặp `(key, version)` là duy nhất; version là số nguyên dương.
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
- [ ] Registry không chứa Product/Script/Fact Lock/Voice/Render applicability rule.
- [ ] Expand M1 dùng nullable pair có whole-pair integrity, không DB default và
  không index format riêng.

## 3. Gate B — Applicability Resolver

- [ ] `AFFILIATE + SCRIPTED` có parity với golden flow hiện hữu.
- [ ] `ORGANIC + QUICK_IMAGE` claimless trả Product/Script/Fact Lock `NOT_REQUIRED`.
- [ ] Organic Scripted claimless yêu cầu Script nhưng không yêu cầu Product/Fact Lock.
- [ ] Organic có Product claim bị block nếu thiếu Product hoặc Product Facts evidence.
- [ ] Affiliate thiếu Product bị từ chối ở application service và protected API.
- [ ] Runtime states không được persist vào `project_step_status.status`.
- [ ] UI, API readiness và worker preflight dùng cùng resolver result/reason code.

## 4. Gate C — Workflow transition

- [ ] `nextApplicableStep` bỏ qua đúng step `NOT_REQUIRED` theo canonical order.
- [ ] Step bị bỏ qua không được ghi `completed`.
- [ ] Transition cập nhật `currentStepKey` atomic dưới concurrent request.
- [ ] Direct URL không mutate workflow current.
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

- [ ] UI phân biệt `NOT_REQUIRED`, `OPTIONAL`, `BLOCKED`, `STALE` bằng text/icon.
- [ ] Product picker chỉ bắt buộc khi policy yêu cầu và giải thích lý do.
- [ ] Bốn tab Studio không làm mất deep link/bảy persisted step routes.
- [ ] Loading, empty, validation, conflict, unauthorized, provider error và success đều có state.
- [ ] Keyboard/focus/label/contrast đạt baseline hiện hữu.

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

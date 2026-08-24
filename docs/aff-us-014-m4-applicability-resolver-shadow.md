# AFF-US-014 / M4 — Applicability Resolver Shadow Acceptance Contract

- Trạng thái: Canonical contract; runtime chưa triển khai
- Phiên bản: 0.8.0
- Ngày khóa: 2026-08-24
- Liên quan: DEC-025, DEC-026, DEC-028, AFF-US-013, AFF-US-015,
  AFF-US-016

## 1. Phạm vi và baseline

M4 chỉ khóa contract và shadow comparison. Legacy gate hiện hữu tiếp tục là
production authority; Resolver chưa được nối vào router, service, worker hoặc UI
và không được phép allow, block, mutate hay đổi navigation của người dùng.

Baseline parity duy nhất được phép chạy production shadow trong M4 là:

```text
ContentType      = AFFILIATE
CreationPath     = SCRIPTED
ContentFormat    = SCRIPTED_STANDARD v1
Product          = required và accessible
```

`ORGANIC`, `QUICK_IMAGE` và `MEDIA_FIRST` là input domain đã tồn tại. Pure-domain
fixtures có thể mô hình hóa policy tương lai đã được canonical docs định nghĩa,
nhưng production write policy `CHANNEL_FIRST_IDENTITY_NOT_ACTIVE` vẫn giữ nguyên.
Biết cách tính một future identity không phải activation của flow đó.

M4 không sở hữu Adaptive Workflow UI (`AFF-US-015`), ClaimManifest
(`AFF-US-017`), Manifest-first Fact Lock (`AFF-US-018`), Render implementation,
M5 enforcement hoặc migration.

## 2. Repository authority audit

### 2.1. Ký hiệu phân loại

- `A` — current authoritative server rule.
- `B` — defensive duplicate; vẫn cần tại execution boundary.
- `C` — UI/read presentation only; không phải business authority.
- `D` — stale/deprecated hoặc không đủ để làm authority.
- `E` — candidate để Resolver sở hữu sau parity/cutover.

### 2.2. Inventory theo capability

| Rule / capability | Current file | Current function/contract | Authority | Duplicate consumers | Resolver ownership candidate | Parity risk | M4 treatment |
|---|---|---|---|---|---|---|---|
| Project identity và Product bắt buộc ở write | `packages/core/src/project/project-validation.ts`; `packages/core/src/project/project-write-contract.ts`; `packages/core/src/project/project-service.ts` | `projectContentBriefFieldsSchema`; `classifyProjectWriteIdentity()`; `createProject()`; `updateProject()` | `A`: schema + service; repository chỉ persist/CAS | `apps/web/src/features/project/project-form.tsx` (`C`) | `E`: chỉ policy Product applicability; authorization/write invariant vẫn ở service | Nhầm DB nullable thành Product optional; activate future identity | Shadow đọc identity đã persist; không đổi M3 write policy |
| Product ownership/persistence | `packages/api/src/services/project-repository.ts`; `packages/api/src/routers/project.ts` | `createProjectRepository().findAccessibleProduct/createProjectBundle/updateProjectBundle`; `projectRouter.create/update` | `A`: service kiểm tra accessible Product trước repository write | Form validation (`C`) | Không chuyển authorization vào Resolver | Cross-workspace hoặc missing Product bị biểu diễn sai thành readiness | Resolver chỉ nhận domain summary `linked/accessible`; không nhận ORM row |
| Script generation preflight | `packages/api/src/services/script-generation-service.ts`; `packages/api/src/routers/script-generation.ts`; `packages/core/src/product-fact/dependency.ts` | `prepareInTransaction()`; `scriptGenerationRouter.generate/repair`; `evaluateFactGenerationUsability()` | `A`: transaction snapshot yêu cầu Project+Product+Brief, Channel Settings hợp lệ và usable Product Facts | `apps/web/src/features/script-generation/script-studio-state.ts::isGenerationContextReady()` (`C`, shallow duplicate) | `E`: SCRIPT applicability/readiness orchestration; source validators vẫn authoritative | UI chỉ kiểm tra facts/settings, trong khi server còn ownership, dependency và race checks | Shadow tái dùng server summaries; không copy SQL/rules vào Resolver |
| Script artifact/version readiness | `packages/core/src/script-version/validation.ts`; `packages/api/src/services/script-version-repository.ts`; `packages/api/src/services/script-version-service.ts` | `validateScriptVersionForFactLockRun()`; `validateScriptVersionForFactLock()`; `findCurrentScriptVersion()`; `saveScriptVersion()` | `A`: current mutable draft + pure validators; saved row là immutable history | Script Studio CTA/editor state (`C`) | `E`: map generation/current draft/validation summaries sang SCRIPT result | Dùng `hasScript` hoặc chỉ thấy generation artifact; bỏ sót `selectedHookKey`, structure, revision và claims current | Contract phân biệt generation, current draft, saved history và Fact Lock-ready validation |
| Fact Lock run preflight | `packages/api/src/services/fact-lock-service.ts`; `packages/api/src/routers/fact-lock.ts` | `buildSnapshotInTransaction()`; `prepareFactLockRun()`; `factLockRouter.run/getState` | `A`: server snapshot, current draft validator, Product/Facts ownership | UI action disable/error copy (`C`) | Resolver không fork run creation policy; chỉ consume pure gate summary | Resolver tự kiểm tra shallow `hasScript` có thể cho chạy sai | M4 input dùng normalized Fact Lock summary từ existing authority |
| Fact Lock downstream gate/stale | `packages/core/src/fact-lock/gate.ts`; `packages/core/src/fact-lock/validation.ts`; `packages/api/src/services/fact-lock-gate-service.ts` | `evaluateFactLockGate()`; `deriveFactLockEffectiveStatus()`; `FactLockGate.evaluate/assertPassed()` | `A`: core pure gate + API-owned workspace snapshot | VoiceConfig, VoicePreview, VoiceSegment gọi `assertPassed()` (`B`); stepper/gated page (`C`) | `E`: FACT_LOCK state/reason mapping; core gate precedence vẫn được reuse | Nhiều nơi hardcode `allowed`; stale Script/Facts dễ bị flatten thành blocked | Shadow adapter map exact gate reason; không đổi gate hoặc downstream assert |
| Voice config/preview eligibility | `packages/api/src/services/voice-config-service.ts`; `packages/api/src/services/voice-preview-service.ts`; `packages/api/src/routers/voice.ts` | `getVoiceConfig()`; `saveVoiceConfig()`; `previewVoice()`; `voiceRouter` | `A/B`: `FactLockGate.assertPassed()` trước read/save và trước/sau provider preview | Voice page/studio error mapping (`C`) | `E`: VOICE applicability và explanation; provider boundary assert vẫn ở service | Preview success bị hiểu nhầm là Voice complete | Preview không tham gia completion; live/provider calls không nằm trong Resolver |
| Voice segment generation và freshness | `packages/core/src/voice-segment/read-model.ts`; `packages/core/src/voice-step/readiness.ts`; `packages/api/src/services/voice-segment-runtime-service.ts`; `packages/api/src/services/voice-step-workflow-service.ts`; `packages/api/src/routers/voice-segment.ts` | `deriveVoiceSegmentReadModel()`; `evaluateVoiceStepReadiness()`; `prepareVoiceSegmentRequest()`; `generateVoiceSegment()`; `loadEvaluation()`; `voiceSegmentRouter` | `A`: fingerprint/readiness pure core; service reassert gate at paid boundary | Voice Studio status helpers (`C`) | `E`: VOICE state/completion mapping; fingerprint authority remains core | VoiceConfig saved hoặc preview audio bị coi là complete; stale artifacts bị đếm usable | Shadow consume summary + per-segment effective status; không gọi TTS/storage |
| Persisted Voice/Video workflow reconciliation | `packages/api/src/services/voice-step-workflow-service.ts` | `getVoiceStatus()`; `reconcileVoiceStep()`; `reconcileVoiceStepBestEffort()` | `A` cho legacy persisted status/current-step mutation | Script/Voice mutations gọi best-effort reconcile (`B`) | Không thuộc pure Resolver; future explicit write operation riêng | Shadow vô tình mutate `project_step_status`/`currentStepKey` | M4 không gọi reconcile từ Resolver path; legacy behavior tiếp tục độc lập |
| Step display/gating | `apps/web/src/features/project-navigation/project-steps.ts`; `project-stepper.tsx`; `gated-project-step-page.tsx`; `project-step-page.tsx` | `getProjectStepStatus()`; `getProjectStepDisplayStatus()`; `getProjectStepReadinessLabel()`; `GatedProjectStepPage`; `ProjectStepPage` | `C`: display + route-content gate, không phải domain authority | Fact Lock và Voice summaries được fetch lại trong layout/page | `AFF-US-015`, không phải M4 cutover | UI flatten `NOT_RUN` thành blocked và route accessible thành ready | Giữ nguyên UI; dùng như legacy parity observation, không sửa |
| Video/Render | `apps/web/src/app/(protected)/projects/[projectId]/video/page.tsx`; `.../preview/page.tsx`; `apps/web/src/features/project-navigation/project-step-page.tsx` | `VideoStepPage`; `PreviewStepPage`; placeholder branch trong `ProjectStepPage` | Không có Render domain authority; route chỉ gate + placeholder (`D`) | Stepper có label/readiness presentation (`C`) | `E`: Resolver phải truthful về capability absence | Route mở sau Voice có thể bị báo sai là Render READY | `BLOCKED + RENDER_FEATURE_NOT_IMPLEMENTED` sau khi upstream ready; không implement Render |
| Current/next step | `packages/core/src/project/project-service.ts`; `packages/api/src/services/voice-step-workflow-service.ts`; `packages/core/src/dashboard/dashboard-service.ts` | `createInitialProjectWorkflowState()`; `reconcileVoiceStep()`; `toRecentProject()/getProjectStepRoute()` | Legacy: create đặt `product`; Voice chỉ tiến `voice -> video`; Dashboard chỉ đọc | Project layout/list/form dùng persisted key (`C`) | `E`: pure `nextApplicableStep`; write synchronization là operation khác | Không có comprehensive legacy next-step authority; `currentStepKey` có thể không phản ánh artifact truth | So sánh với normalized golden oracle; mismatch chưa map được là `LEGACY_UNMAPPED` |
| Cross-capability staleness | `packages/api/src/services/script-generation-repository.ts`; `packages/core/src/fact-lock/gate.ts`; `packages/core/src/fact-lock/validation.ts`; `packages/core/src/voice-segment/fingerprint.ts`; `packages/core/src/voice-segment/read-model.ts` | generation `dependencyState`; `evaluateFactLockGate()`; `deriveFactLockEffectiveStatus()`; `sameVoiceSegmentFingerprint()`; `deriveVoiceSegmentReadModel()` | `A`: từng domain own freshness | UI notices/labels (`C`) | `E`: aggregate only; không thay fingerprint/invalidation authority | Một boolean `stale` chung làm mất reason và precedence | Resolver nhận stable summaries từ từng domain và giữ typed primary reason |

Route inventory đã inspect trực tiếp:

| Route file | Entry point | Current behavior |
|---|---|---|
| `apps/web/src/app/(protected)/projects/[projectId]/content/page.tsx` | `ContentStepPage` | Render `ScriptStudio`; client readiness helpers không thay server preflight. |
| `apps/web/src/app/(protected)/projects/[projectId]/fact-lock/page.tsx` | `FactLockStepPage` | Render `FactLockReview`; run/gate authority vẫn ở API/core. |
| `apps/web/src/app/(protected)/projects/[projectId]/voice/page.tsx` | `VoiceStepPage` | `GatedProjectStepPage` bọc `VoiceStudio`; UI gate trùng server execution guard. |
| `apps/web/src/app/(protected)/projects/[projectId]/video/page.tsx` | `VideoStepPage` | Fact Lock + Voice gated placeholder, chưa có composition/render capability. |
| `apps/web/src/app/(protected)/projects/[projectId]/preview/page.tsx` | `PreviewStepPage` | Fact Lock gated placeholder, chưa có preview/render pipeline. |

### 2.3. Test và fixture authority inventory

| Area | Existing evidence | M4 use |
|---|---|---|
| Project identity/workflow | `apps/web/src/features/project/project-domain.test.ts`; `project-write-contract.test.ts`; `legacy-affiliate-compatibility.test.ts`; `scripts/test-project-channel-first-m3b.ts`; `scripts/test-project-channel-first-m2c.ts` | Giữ M3 rollout inactive ngoài legacy canonical identity; không sửa fixture lịch sử |
| Step UI mapping | `apps/web/src/features/project-navigation/project-steps.test.ts` | Legacy presentation oracle only; không dùng làm server policy |
| Script generation/version | `script-generation-domain.test.ts`; `script-studio-state.test.ts`; `script-version-foundation.test.ts`; `scripts/test-script-generation-foundation.ts`; `scripts/test-script-version-foundation.ts` | Dựng normalized Script snapshot và parity cases A–C/I |
| Fact Lock | `fact-lock-domain.test.ts`; `fact-lock-gate.test.ts`; `fact-lock-review-state.test.ts`; `scripts/test-fact-lock.ts` | Reuse reason precedence và stale Script/Facts evidence |
| Voice | `voice-step-readiness.test.ts`; `voice-segment-foundation.test.ts`; `voice-segment-runtime.test.ts`; `scripts/test-voice-config.ts`; `test-voice-preview.ts`; `test-voice-segment-foundation.ts`; `test-voice-segment-runtime.ts` | Reuse fingerprint/readiness semantics; preview không được tính completion |
| Golden Affiliate | M1 golden-only suites và manual Script → Fact Lock → Voice regression | M4 parity gate; deterministic/offline, không live provider |

Không có runtime telemetry framework chuyên biệt cho Resolver trong repository.
M4 implementation sau phải dùng sanitized structured diagnostic/test artifact;
không log Project text, Script text, Product Fact content, credential hoặc raw ORM
object.

## 3. Canonical state model

Canonical union duy nhất:

```text
NOT_REQUIRED | OPTIONAL | REQUIRED | READY | BLOCKED | STALE
```

`DISABLED`, `UNAVAILABLE`, `INACTIVE`, `PENDING` và `UNRESOLVED` không phải
ApplicabilityState. Chúng có thể là source-domain status hoặc UI copy, không được
đưa vào union.

| State | Exact semantics |
|---|---|
| `NOT_REQUIRED` | Capability bị policy loại khỏi Project identity/flow. Đây không phải lỗi, không phải completion và không block default progression. |
| `OPTIONAL` | Capability áp dụng nhưng không bắt buộc để hoàn tất canonical flow. Default `nextApplicableStep` bỏ qua nếu user chưa opt in. Audit không tìm thấy capability nào thật sự optional trong current Affiliate + Scripted baseline; M4 không invent optional current behavior. |
| `REQUIRED` | Capability bắt buộc nhưng chưa actionable vì normal upstream work đang còn thiếu hoặc đang chạy; không có concrete fault cần repair tại chính capability. |
| `READY` | Capability áp dụng và các prerequisite hiện tại đủ để user/system thực hiện action kế tiếp. `READY` không nói action đã hoàn thành hay chưa. |
| `BLOCKED` | Capability áp dụng và lẽ ra cần tiến hành, nhưng concrete invalid/error/unsupported/not-implemented condition ngăn execution. Phải có typed primary `reasonCode`. |
| `STALE` | Capability có output từng usable/current nhưng dependency/fingerprint upstream đã đổi, nên output đó không còn current. `STALE` giữ provenance và khác failure/block không có prior usable output. |

Boundary duy nhất giữa `REQUIRED` và `BLOCKED` là: normal prerequisite work chưa
xong → `REQUIRED`; concrete fault/invalid/unsupported condition cần remediation →
`BLOCKED`. Pending là normal in-progress reason dưới `REQUIRED`, không phải state.

### 3.1. Applicability và completion tách rời

Resolver không thêm `COMPLETED` vào union. Result có completion summary riêng:

```text
NOT_STARTED | IN_PROGRESS | COMPLETE
```

`READY + COMPLETE` hợp lệ, ví dụ Fact Lock đã PASS hoặc mọi VoiceSegment hiện tại
đều usable. Persisted `project_step_status.status`, artifact status và
FactLockRun status vẫn giữ contract riêng; Resolver chỉ derive read model và không
rewrite chúng.

## 4. Resolver boundary và DTO contract

M4 cover đúng năm capability:

```text
PRODUCT | SCRIPT | FACT_LOCK | VOICE | RENDER
```

Không thêm Channel Strategy, Calendar, Analytics hoặc ClaimManifest như active
capability. ClaimManifest chỉ là future dependency extension của AFF-US-017.

Conceptual pure-domain input, naming implementation có thể theo convention repo:

```ts
type ProjectApplicabilityInput = {
  projectIdentity: {
    contentType: "ORGANIC" | "AFFILIATE";
    creationPath: "SCRIPTED" | "QUICK_IMAGE" | "MEDIA_FIRST";
    contentFormat: {
      key: string;
      version: number;
      resolution: "resolved" | "deprecated" | "unsupported";
    };
  };
  productState: DomainProductSummary;
  productFactsState: DomainProductFactsSummary;
  scriptState: DomainScriptSummary;
  factLockState: DomainFactLockSummary;
  voiceConfigState: DomainVoiceConfigSummary;
  voiceArtifactState: DomainVoiceArtifactSummary;
  renderInputState: DomainRenderInputSummary;
};

type CapabilityResult = {
  capability: Capability;
  state: ApplicabilityState;
  reasonCode: ApplicabilityReasonCode;
  dependencies: readonly DomainDependencySummary[];
  completion: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";
};

type ProjectApplicabilityResult = {
  capabilities: readonly CapabilityResult[];
  nextApplicableStep: Capability | null;
};
```

Rules bắt buộc:

- Repository/service gathers authenticated, workspace-scoped snapshots.
- Resolver pure và deterministic; không query DB, gọi provider/storage, đọc clock
  ẩn, mutate row, tạo artifact hoặc ghi log trực tiếp.
- Không trả raw ORM object, user-authored text hoặc secret trong dependencies.
- Dependencies là stable domain summary, ví dụ identity ref, revision/fingerprint,
  gate reason và aggregate count.
- ContentFormat chỉ cung cấp resolved identity/CreationPath compatibility theo
  DEC-026. Registry definition không chứa Product/Script/Fact Lock/Voice/Render
  applicability flags.

## 5. Reason taxonomy và deterministic precedence

Reason code là typed domain identifier; UI prose không phải authority. `READY`
và `OPTIONAL` cũng có stable reason để parity/explain nhất quán.

### 5.1. Product

Precedence:

1. `PRODUCT_NOT_REQUIRED_FOR_PROJECT_IDENTITY` → `NOT_REQUIRED`.
2. `PROJECT_IDENTITY_UNSUPPORTED` → `BLOCKED`.
3. `AFFILIATE_PRODUCT_NOT_LINKED` → `BLOCKED`.
4. `PRODUCT_NOT_ACCESSIBLE` → `BLOCKED`.
5. `PRODUCT_READY` → `READY`.

Current Affiliate baseline chỉ hợp lệ ở nhánh 5. DB nullability không thay policy.

### 5.2. Script

Precedence:

1. `SCRIPT_NOT_REQUIRED_FOR_CREATION_PATH` → `NOT_REQUIRED`.
2. `PROJECT_IDENTITY_UNSUPPORTED` → `BLOCKED`.
3. `SCRIPT_REQUIRES_ACCESSIBLE_PRODUCT` → `REQUIRED` hoặc `BLOCKED` theo Product
   primary result; không che Product reason trong diagnostics.
4. `SCRIPT_CHANNEL_SETTINGS_INCOMPLETE` → `BLOCKED`.
5. `SCRIPT_PRODUCT_FACTS_UNUSABLE` → `BLOCKED`.
6. `SCRIPT_SOURCE_DEPENDENCY_STALE` → `STALE` khi prior usable generation là
   action target; không tự ép current ScriptVersion regenerate nếu existing server
   gate vẫn cho Fact Lock tiếp tục.
7. `SCRIPT_GENERATION_PENDING` → `REQUIRED`.
8. `SCRIPT_GENERATION_FAILED` hoặc `SCRIPT_GENERATION_INDETERMINATE` → `BLOCKED`.
9. `CURRENT_SCRIPT_VERSION_REQUIRED` → `READY` nếu generation usable và có thể
   initialize; nếu chưa có generation thì `SCRIPT_GENERATION_REQUIRED` → `READY`.
10. `SCRIPT_VERSION_NOT_FACT_LOCK_READY` → `BLOCKED`; validator authoritative là
    `validateScriptVersionForFactLockRun()`, gồm structure và `selectedHookKey`.
11. `SCRIPT_READY` → `READY`.

Immutable saved version là history evidence; current mutable draft + validator là
run authority hiện tại. Resolver không được dùng một boolean `hasScript`.

### 5.3. Fact Lock

Sau applicability exclusion/identity validation, M4 adapter giữ precedence của
`evaluateFactLockGate()`:

1. `FACT_LOCK_REQUIRES_CURRENT_SCRIPT` → `REQUIRED`.
2. `FACT_LOCK_SCRIPT_NOT_READY` → `REQUIRED` nếu normal Script work còn thiếu;
   concrete invalid current Script được báo `BLOCKED` tại SCRIPT.
3. `FACT_LOCK_STALE_FACTS` → `STALE`.
4. `FACT_LOCK_PASSED` → `READY + COMPLETE`.
5. `FACT_LOCK_REVIEW_REQUIRED` → `BLOCKED`.
6. `FACT_LOCK_PENDING` → `REQUIRED + IN_PROGRESS`.
7. `FACT_LOCK_FAILED` → `BLOCKED`.
8. `FACT_LOCK_INDETERMINATE` → `BLOCKED`.
9. `FACT_LOCK_STALE_SCRIPT` → `STALE`.
10. `FACT_LOCK_RUN_REQUIRED` → `READY + NOT_STARTED`.

Nếu Product/project invalid, reason đó đứng trước list trên. Additional diagnostics
có thể giữ nhiều nguyên nhân, nhưng primary reason luôn theo thứ tự này.

### 5.4. Voice

Precedence:

1. `VOICE_NOT_REQUIRED_FOR_PROJECT_IDENTITY` → `NOT_REQUIRED`, hoặc typed future
   opt-in policy → `OPTIONAL`; current Affiliate baseline không dùng hai nhánh này.
2. `VOICE_ARTIFACTS_STALE` → `STALE` khi prior usable audio không khớp current
   ScriptVersion/VoiceConfig fingerprint.
3. `VOICE_REQUIRES_FACT_LOCK_PASS` → `REQUIRED` cho normal upstream work;
   `VOICE_BLOCKED_BY_FACT_LOCK` → `BLOCKED` nếu Fact Lock failed,
   indeterminate, review-required hoặc stale concrete state.
4. `VOICE_CONFIG_REQUIRED` → `READY + NOT_STARTED`.
5. `VOICE_SEGMENTS_FAILED` hoặc `VOICE_SEGMENTS_INDETERMINATE` → `BLOCKED`.
6. `VOICE_SEGMENTS_PENDING` → `REQUIRED + IN_PROGRESS`.
7. `VOICE_SEGMENTS_REQUIRED` hoặc `VOICE_SEGMENTS_INCOMPLETE` → `READY` với
   completion tương ứng.
8. `VOICE_READY` → `READY + COMPLETE`.

Voice Preview không xuất hiện trong precedence vì preview tạm thời không phải
persisted Voice completion.

### 5.5. Render

Precedence:

1. `RENDER_NOT_REQUIRED_FOR_PROJECT_IDENTITY` → `NOT_REQUIRED` nếu future policy
   xác định rõ.
2. `RENDER_REQUIRES_UPSTREAM_CAPABILITIES` → `REQUIRED` khi Product/Script/Fact
   Lock/Voice mandatory chưa complete/current.
3. `RENDER_INPUTS_STALE` → `STALE` chỉ khi future Render artifact/input contract
   thật sự tồn tại.
4. `RENDER_FEATURE_NOT_IMPLEMENTED` → `BLOCKED` trong repository hiện tại.

Route accessible không có quyền override nhánh 4.

## 6. `nextApplicableStep`

Canonical order cho result M4 là:

```text
PRODUCT → SCRIPT → FACT_LOCK → VOICE → RENDER
```

Algorithm:

1. Không dùng `currentStepKey + 1`.
2. Bỏ qua `NOT_REQUIRED`.
3. Bỏ qua `OPTIONAL` chưa opt in; optional không block default flow.
4. Bỏ qua capability mandatory có `completion=COMPLETE` và state current.
5. Chọn capability đầu tiên còn `REQUIRED`, `READY`, `BLOCKED` hoặc `STALE`.
6. Trả `null` khi mọi mandatory capability đã complete/current và không còn
   actionable terminal capability.

Resolver không đọc `currentStepKey` làm applicability authority và không mutate
key đó. Future synchronization phải là write operation riêng, explicit,
transactional và nằm ngoài M4 shadow.

## 7. Affiliate parity matrix

Điều kiện chung A–J: canonical identity hiện tại, accessible Product, valid Brief,
Channel Settings và Product Facts đủ dùng, trừ dependency change được nêu riêng.
Ký hiệu `STATE/completion`; primary reason nằm trong ngoặc.

| Scenario | Product | Script | Fact Lock | Voice | Render | `nextApplicableStep` |
|---|---|---|---|---|---|---|
| A. Product, chưa generation/draft | `READY/COMPLETE` (`PRODUCT_READY`) | `READY/NOT_STARTED` (`SCRIPT_GENERATION_REQUIRED`) | `REQUIRED/NOT_STARTED` (`FACT_LOCK_REQUIRES_CURRENT_SCRIPT`) | `REQUIRED/NOT_STARTED` (`VOICE_REQUIRES_FACT_LOCK_PASS`) | `REQUIRED/NOT_STARTED` (`RENDER_REQUIRES_UPSTREAM_CAPABILITIES`) | `SCRIPT` |
| B. Usable ScriptGeneration, chưa current ScriptVersion draft | `READY/COMPLETE` | `READY/IN_PROGRESS` (`CURRENT_SCRIPT_VERSION_REQUIRED`) | `REQUIRED/NOT_STARTED` | `REQUIRED/NOT_STARTED` | `REQUIRED/NOT_STARTED` | `SCRIPT` |
| C. Current valid ScriptVersion và saved history, chưa Fact Lock run | `READY/COMPLETE` | `READY/COMPLETE` (`SCRIPT_READY`) | `READY/NOT_STARTED` (`FACT_LOCK_RUN_REQUIRED`) | `REQUIRED/NOT_STARTED` | `REQUIRED/NOT_STARTED` | `FACT_LOCK` |
| D. Fact Lock failed/indeterminate/review-required | `READY/COMPLETE` | `READY/COMPLETE` | `BLOCKED/IN_PROGRESS` (exact gate reason) | `BLOCKED/NOT_STARTED` (`VOICE_BLOCKED_BY_FACT_LOCK`) | `REQUIRED/NOT_STARTED` | `FACT_LOCK` |
| E. Fact Lock PASS, chưa VoiceConfig | `READY/COMPLETE` | `READY/COMPLETE` | `READY/COMPLETE` (`FACT_LOCK_PASSED`) | `READY/NOT_STARTED` (`VOICE_CONFIG_REQUIRED`) | `REQUIRED/NOT_STARTED` | `VOICE` |
| F. VoiceConfig saved, chưa segment artifact | `READY/COMPLETE` | `READY/COMPLETE` | `READY/COMPLETE` | `READY/IN_PROGRESS` (`VOICE_SEGMENTS_REQUIRED`) | `REQUIRED/NOT_STARTED` | `VOICE` |
| G. Một phần required VoiceSegments usable | `READY/COMPLETE` | `READY/COMPLETE` | `READY/COMPLETE` | `READY/IN_PROGRESS` (`VOICE_SEGMENTS_INCOMPLETE`) | `REQUIRED/NOT_STARTED` | `VOICE` |
| H. Mọi required VoiceSegments usable/current | `READY/COMPLETE` | `READY/COMPLETE` | `READY/COMPLETE` | `READY/COMPLETE` (`VOICE_READY`) | `BLOCKED/NOT_STARTED` (`RENDER_FEATURE_NOT_IMPLEMENTED`) | `RENDER` |
| I. ScriptVersion revision đổi sau Fact Lock/Voice | `READY/COMPLETE` | `READY/COMPLETE` | `STALE/IN_PROGRESS` (`FACT_LOCK_STALE_SCRIPT`) | `STALE/IN_PROGRESS` (`VOICE_ARTIFACTS_STALE`) | `REQUIRED/NOT_STARTED` | `FACT_LOCK` |
| J. Product Facts revision/dependency đổi | `READY/COMPLETE` | `READY/COMPLETE`; source-generation invalidation là diagnostic, không tự ép regenerate current draft | `STALE/IN_PROGRESS` (`FACT_LOCK_STALE_FACTS`) | `BLOCKED/IN_PROGRESS` (`VOICE_BLOCKED_BY_FACT_LOCK`) | `REQUIRED/NOT_STARTED` | `FACT_LOCK` |

Case C không tuyên bố saved history row là Fact Lock authority. Existing Fact Lock
dùng current draft; row saved chỉ chứng minh explicit save/history trong scenario.

## 8. Shadow comparison contract

Shadow pipeline tương lai:

```text
authenticated domain snapshots
├─ existing legacy gates/status/read models → normalized legacy decision
└─ pure Applicability Resolver             → resolver decision
                                      compare only
```

Legacy remains authority. Resolver exception hoặc mismatch không được đổi response,
route, provider call, `project_step_status`, `currentStepKey` hay artifact. Diagnostic
chỉ chứa Project ID/reference an toàn, capability, state/reason identifiers và
revision/fingerprint summaries không nhạy cảm.

Typed mismatch categories:

```text
STATE_MISMATCH
COMPLETION_MISMATCH
REASON_MISMATCH
NEXT_STEP_MISMATCH
LEGACY_UNMAPPED
RESOLVER_EXCEPTION
```

`LEGACY_UNMAPPED` là cần thiết vì repository chưa có comprehensive next-step
authority. Nó không được âm thầm tính là parity PASS; golden fixture phải bổ sung
expected oracle rõ ràng.

## 9. M4 parity exit gate và cutover boundary

Với internal/personal product hiện tại, deterministic integration parity matrix là
đủ; không invent production traffic percentage khi repo chưa có observability đó.
M4 chỉ đạt khi:

- 100% scenario A–J và golden Affiliate fixtures khớp expected capability state,
  completion, primary reason và `nextApplicableStep`;
- không `RESOLVER_EXCEPTION` hoặc unresolved `LEGACY_UNMAPPED`;
- existing M1/golden Script, Fact Lock và Voice suites vẫn PASS offline;
- zero DB/artifact/current-step mutation từ Resolver/shadow comparison;
- zero live/paid provider call;
- zero API/UI behavior change và future identity activation.

M4 không cut over authority. Consumer migration sau parity cần explicit approval cho
Project API/read model, Script preflight, Fact Lock gate, Voice/TTS execution,
Render worker/route và AFF-US-015 UI. Execution-boundary authorization, CAS,
workspace scope và paid-provider rechecks không bị xóa chỉ vì Resolver tồn tại.

## 10. Stable acceptance criteria

- `AC-014-01` — Union có đúng sáu state đã khóa và semantics không overlap.
- `AC-014-02` — Result derived/non-persisted; completion tách khỏi applicability.
- `AC-014-03` — M4 cover đúng PRODUCT, SCRIPT, FACT_LOCK, VOICE, RENDER.
- `AC-014-04` — Mọi non-trivial state có typed primary reason.
- `AC-014-05` — Primary reason precedence deterministic theo từng capability.
- `AC-014-06` — Dependencies là stable sanitized domain summaries, không raw ORM/text.
- `AC-014-07` — `nextApplicableStep` bỏ qua NOT_REQUIRED/unselected OPTIONAL và
  không phụ thuộc phép cộng `currentStepKey`.
- `AC-014-08` — Matrix A–J đạt 100% Affiliate parity.
- `AC-014-09` — Script/Facts/VoiceConfig/fingerprint change tạo đúng STALE semantics.
- `AC-014-10` — M4 chạy shadow-only; legacy behavior vẫn authority.
- `AC-014-11` — Resolver/shadow có zero DB, artifact, provider và current-step mutation.
- `AC-014-12` — Không authority cutover sang API/UI/worker trong M4.
- `AC-014-13` — ORGANIC/QUICK_IMAGE/MEDIA_FIRST không được production-activate.
- `AC-014-14` — Current Render là `BLOCKED + RENDER_FEATURE_NOT_IMPLEMENTED` khi
  upstream ready; route accessibility không phải readiness.
- `AC-014-15` — Exit gate yêu cầu zero exception/unmapped case và golden regression
  xanh trước một cutover task riêng.

## 11. Contradiction resolution

- Wording cũ nói “Resolver cập nhật `currentStepKey`” được tách thành pure derive
  và future explicit transactional synchronization. M4 không mutate.
- `project_step_status`/`currentStepKey` không còn bị mô tả như ApplicabilityState
  authority; chúng là legacy persisted workflow/progress inputs/outputs riêng.
- Fact Lock không chỉ “áp dụng khi state = REQUIRED”. Khi policy bắt buộc, runtime
  state có thể là REQUIRED, READY, BLOCKED hoặc STALE.
- Video/Preview route mở không còn được diễn giải là Render implemented/READY.
- Product vẫn required cho current Affiliate flow; nullable DB column không tạo
  optional policy.
- DEC-026 giữ nguyên: ContentFormat không sở hữu applicability.

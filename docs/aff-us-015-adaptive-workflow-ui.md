# AFF-US-015 — Adaptive Workflow UI Acceptance Contract

- Trạng thái: Canonical ở cấp tài liệu; chưa implement UI/runtime cutover
- Ngày: 2026-08-24
- Liên quan: DEC-025, DEC-026, DEC-028, DEC-029, AFF-US-014/M4

## 1. Mục tiêu và ranh giới

AFF-US-015 định nghĩa cách UI trong tương lai trình bày kết quả Applicability
Resolver đã accepted ở M4. Resolver/domain là authority cho applicability; web chỉ
map typed result thành stepper, route state, CTA và copy bản địa hóa.

Contract này không đổi React, route guard, public API, schema, migration,
`currentStepKey`, `project_step_status`, M4 shadow behavior hoặc execution guard.
Nó không activate `ORGANIC`, `QUICK_IMAGE`, `MEDIA_FIRST`, không implement Render,
ClaimManifest hoặc M5.

## 2. Repository audit

### 2.1. Current UI/workflow authority inventory

| Current UI rule | File/component/function | Input authority hiện tại | Hardcoded/duplicate logic | Resolver replacement tại cutover | Keep/remove | Risk |
|---|---|---|---|---|---|---|
| Project stepper luôn có bảy bước | `apps/web/src/features/project-navigation/project-steps.ts` — `PROJECT_STEPS`; `project-stepper.tsx` — `ProjectStepper` | Static array + persisted current/status | Fixed order, label, `/7`, `md:grid-cols-7` | Adaptive read model cung cấp capability steps/routes/visibility/ordinal | Bỏ static applicability; giữ presentation primitives | Bước không áp dụng vẫn xuất hiện; numbering sai |
| Step display status | `project-steps.ts` — `getProjectStepStatus()`, `getProjectStepDisplayStatus()`, `getProjectStepReadinessLabel()` | `currentStepKey`, `stepStatuses`, Fact Lock gate, Voice summary | Web tự suy Fact Lock/Voice/Video/Preview readiness | Map trực tiếp `state + completion + reasonCode` | Bỏ business derivation; giữ localized mapper | Duplicate domain rule và báo sai Render READY |
| Project layout snapshot | `apps/web/src/app/(protected)/projects/[projectId]/layout.tsx`; `apps/web/src/lib/project-loader.ts` | Project details, Fact Lock gate, Voice reconciliation | Fetch tuần tự; loader gọi reconciliation trong render/read path | Một request-owned, read-only adaptive snapshot | Thay read path; reconciliation chỉ ở explicit business write | Read có thể mutate status/cursor; query waterfall |
| Content/Script page | `apps/web/src/app/(protected)/projects/[projectId]/content/page.tsx`; `apps/web/src/features/script-generation/script-studio.tsx`; `script-studio-state.ts` | Route access + Script preflight/local state | Không có adaptive route guard; client có CTA/readiness riêng | Adaptive route shell; Script execution preflight vẫn server-owned | Thay workflow-level derivation; giữ action/domain errors | Direct URL bỏ qua workflow presentation |
| Fact Lock page | `apps/web/src/app/(protected)/projects/[projectId]/fact-lock/page.tsx`; `apps/web/src/features/fact-lock/fact-lock-review.tsx`; `fact-lock-gate-panel.tsx` | Fact Lock service/gate | Domain-specific copy/link nằm cục bộ | Adaptive route shell + centralized reason presentation; gate vẫn enforce | Giữ execution gate; hợp nhất workflow copy | Copy/action drift giữa stepper và page |
| Voice page | `apps/web/src/app/(protected)/projects/[projectId]/voice/page.tsx`; `apps/web/src/features/project-navigation/gated-project-step-page.tsx`; `apps/web/src/features/voice/voice-studio.tsx` | Fact Lock gate + Voice services | Voice bị gate bởi Fact Lock ở wrapper | Adaptive route state; Voice/TTS checks vẫn enforce | Thay wrapper presentation, giữ TTS guard | UI unlock không được thành authorization |
| Video page | `apps/web/src/app/(protected)/projects/[projectId]/video/page.tsx`; `apps/web/src/features/project-navigation/project-step-page.tsx` | Fact Lock gate + Voice summary | Route placeholder có thể được label “Có thể tiếp tục” | `RENDER/BLOCKED/RENDER_FEATURE_NOT_IMPLEMENTED` | Giữ informational route, bỏ readiness giả | User tưởng render đã dùng được |
| Preview page | `apps/web/src/app/(protected)/projects/[projectId]/preview/page.tsx`; `apps/web/src/features/project-navigation/project-step-page.tsx` | Chỉ Fact Lock gate | Không kiểm tra Voice/Render implementation | Cùng capability `RENDER`, secondary informational route | Giữ URL, dùng cùng adaptive state | Hai route cùng capability báo khác nhau |
| Completed page | `apps/web/src/app/(protected)/projects/[projectId]/completed/page.tsx` | Static persisted step | Unguarded placeholder | Terminal presentation ngoài capability list | Giữ bookmark/route; gate bằng terminal condition sau này | “Completed” giả khi output chưa tồn tại |
| Project create/open/navigation | `apps/web/src/features/project/project-form.tsx`; `project-list.tsx`; `apps/web/src/features/project-navigation/project-overview.tsx`; `apps/web/src/features/product/product-detail.tsx` | `currentStepKey` + `getProjectStepRoute()` | Persisted cursor quyết định landing/CTA | `nextApplicableStep` + route mapping cho presentation | Giữ legacy fallback đến phase cutover | Landing không phản ánh artifact truth |
| Dashboard recent projects | `packages/core/src/dashboard/dashboard-service.ts`; `apps/web/src/features/dashboard/recent-projects.tsx` | Completed persisted rows / 7 + current key | Progress và target URL theo seven-step model | Adaptive summary/next route từ cùng snapshot | Thay ở phase riêng; không rederive client-side | Dashboard và Project page lệch nhau |
| Voice workflow reconciliation | `packages/api/src/services/voice-step-workflow-service.ts` — `getVoiceStepWorkflowReadSnapshot()`, `reconcileVoiceStep()` | Current Voice artifacts | `reconcileVoiceStep()` upsert status và có thể tiến `voice -> video` | Read dùng read-only snapshot; write vẫn explicit | Giữ business write, bỏ khỏi render/read | GET/render gây mutation |
| M4 observation | `packages/api/src/routers/project.ts` — `project.get`; M4 shadow service | Protected RPC Project read | RSC loader gọi repository/service trực tiếp nên bypass observer | Adaptive service reuse một gathered snapshot; shadow lifecycle explicit | Refactor ở 15A/15B, không làm trong contract | Gather lặp và parity coverage không đồng nhất |

### 2.2. Persisted workflow fields

| Thành phần | Nghĩa hiện tại | Canonical classification |
|---|---|---|
| `project.currentStepKey` | Create khởi tạo `product`; Voice reconciliation chỉ có thể tiến `voice -> video`; list/dashboard dùng làm target | Legacy progress/landing cursor và output của business write; **không phải applicability truth** |
| `project_step_status` | Bảy row `not_started/completed/needs_review/blocked`; Voice reconciliation upsert `voice`/`video` | Legacy completion/status projection; **không phải applicability truth** |
| `createInitialProjectWorkflowState()` | Tạo bảy persisted step và cursor ban đầu | Historical Affiliate initialization authority; giữ trong giai đoạn coexistence |
| `reconcileVoiceStep()` | Lock/read Voice state, upsert persisted rows, có thể tiến cursor | Explicit business write authority; không được gọi để phục vụ adaptive read/render |

Không xóa hoặc đổi nghĩa các field này trong AFF-US-015. UI cutover chỉ ngừng coi
chúng là applicability authority. Bất kỳ persisted synchronization nào là một
transactional command riêng, không phải side effect của GET/page render.

## 3. Canonical Adaptive Workflow read model

Schema dưới đây là contract khái niệm; tên export cuối cùng được chốt ở Phase 15A
nhưng không được đổi semantics:

```ts
type AdaptiveWorkflowRouteKey =
  | "product"
  | "content"
  | "fact-lock"
  | "voice"
  | "video"
  | "preview";

type AdaptiveWorkflowActionKind =
  | "OPEN_STEP"
  | "RESOLVE_BLOCKER"
  | "RETRY_OR_REFRESH"
  | "OPT_IN"
  | "COMING_SOON"
  | "NONE";

type AdaptiveWorkflowRoute = {
  key: AdaptiveWorkflowRouteKey;
  href: string;
  role: "PRIMARY" | "SECONDARY";
};

type AdaptiveWorkflowStep = {
  capability: "PRODUCT" | "SCRIPT" | "FACT_LOCK" | "VOICE" | "RENDER";
  applicabilityState: ApplicabilityState;
  completion: ApplicabilityCompletion;
  reasonCode: ApplicabilityReasonCode;
  routes: readonly AdaptiveWorkflowRoute[];
  visible: boolean;
  navigable: boolean;
  visibleOrdinal: number | null;
  optionalSelection: "NOT_APPLICABLE" | "NOT_SELECTED" | "SELECTED";
  primaryAction: {
    kind: AdaptiveWorkflowActionKind;
    targetCapability: ApplicabilityCapability | null;
    targetRouteKey: AdaptiveWorkflowRouteKey | null;
  };
};

type AdaptiveWorkflowReadModel = {
  projectId: string;
  steps: readonly AdaptiveWorkflowStep[];
  nextApplicableStep: ApplicabilityCapability | null;
  nextRouteKey: AdaptiveWorkflowRouteKey | null;
  terminalRouteEligible: boolean;
  unsupported: boolean;
};
```

Read model là derived, typed, serializable, request-scoped và không persist. Nó
không chứa raw ORM, raw Script/Product/user text, credential, localized prose hoặc
provider call. `visible`, `navigable`, route/action kind là server-owned structural
presentation policy; label/message/action text nằm ở web presentation mapper.

Một mapper chỉ được dùng Resolver result và explicit route policy. Nó không được
tự suy “Fact Lock required nếu…”, “Voice blocked nếu…” hoặc Product requirement.

## 4. Capability, step và route mapping

| Capability | Primary presentation step/route | Secondary route | Ghi chú |
|---|---|---|---|
| `PRODUCT` | `product` → `/projects/:id/product` | Không | Giữ bookmark hiện tại |
| `SCRIPT` | `content` → `/projects/:id/content` | Không | Capability tên Script; UI/route lịch sử tên Content |
| `FACT_LOCK` | `fact-lock` → `/projects/:id/fact-lock` | Không | Không đổi route |
| `VOICE` | `voice` → `/projects/:id/voice` | Không | Không đổi route |
| `RENDER` | `video` → `/projects/:id/video` | `preview` → `/projects/:id/preview` | Một capability có nhiều presentation route; cả hai dùng cùng applicability result |

`completed` không phải Applicability capability. `/projects/:id/completed` là
terminal presentation route và chỉ eligible khi không còn mandatory capability và
future output-completion contract xác nhận hoàn tất. Current Render chưa implement,
nên M4 baseline không đạt terminal route.

Primary stepper ẩn `NOT_REQUIRED` và đánh số động liên tục `1..N`; không hiển thị
gaps kiểu `01 → 04 → 06`. Secondary route không tạo thêm capability number.

## 5. State và completion presentation

State và completion luôn render riêng. `READY` không đồng nghĩa `COMPLETE`.

| State | Completion | Primary label/appearance | Navigation/action |
|---|---|---|---|
| `NOT_REQUIRED` | Canonical hiện tại là `NOT_STARTED`; combination khác là contract error | Ẩn khỏi primary stepper; direct route hiện “Không áp dụng” | Không action execution; CTA về `nextApplicableStep` |
| `OPTIONAL` | `NOT_STARTED` | “Tùy chọn”, ở optional affordance, chưa vào primary progression | `OPT_IN`, chưa được tính là next |
| `OPTIONAL` | `IN_PROGRESS` | “Tùy chọn · Đang thực hiện” | Chỉ hợp lệ khi đã selected; vào primary flow |
| `OPTIONAL` | `COMPLETE` | “Tùy chọn · Hoàn thành” | Selected; không block mandatory progression |
| `REQUIRED` | `NOT_STARTED` | “Cần hoàn tất bước trước”, neutral/waiting, không phải error | Có thể mở controlled prerequisite view; không expose unavailable execution |
| `REQUIRED` | `IN_PROGRESS` | “Đang thực hiện” | Tiếp tục work nếu route/action domain cho phép |
| `REQUIRED` | `COMPLETE` | Invalid resolver combination; fail closed | Controlled error; không tự đổi thành READY |
| `READY` | `NOT_STARTED` | “Sẵn sàng” | Primary actionable step |
| `READY` | `IN_PROGRESS` | “Đang thực hiện” | Resume action |
| `READY` | `COMPLETE` | “Hoàn thành” | Navigable review; progression dùng completion riêng |
| `BLOCKED` | `NOT_STARTED` | “Đang bị chặn”; typed reason | Mở controlled blocked view + `RESOLVE_BLOCKER`; không chạy action bị chặn |
| `BLOCKED` | `IN_PROGRESS` | “Đang bị chặn” và giữ context đã có | Như trên; không xóa artifact |
| `BLOCKED` | `COMPLETE` | Invalid resolver combination | Controlled error/fail closed |
| `STALE` | `IN_PROGRESS` | “Cần cập nhật” warning, không gọi failed | Hiện prior artifact nếu an toàn + `RETRY_OR_REFRESH` |
| `STALE` | `NOT_STARTED` hoặc `COMPLETE` | Invalid với M4 semantics hiện tại | Controlled error/fail closed |

Invalid combination không được web tự sửa hoặc flatten; ghi sanitized diagnostic và
render Project-needs-attention state.

### Reason presentation ownership

`ApplicabilityReasonCode` giữ ở core/server. Web sở hữu exhaustive mapper:

```text
reasonCode
→ localization key
→ short label
→ explanation
→ action kind/target đã được structural policy cho phép
```

Mapper phải exhaustive ở compile/test time. Unknown reason fail closed về controlled
unsupported state, không crash React tree và không đoán business rule. Domain action
errors trong Script/Fact Lock/Voice vẫn được giữ; chỉ workflow-level copy được tập
trung hóa.

## 6. OPTIONAL opt-in contract

`OPTIONAL` khác `NOT_REQUIRED`: capability có thể áp dụng nếu user chủ động chọn.
Unselected optional không vào primary workflow và `nextApplicableStep` bỏ qua.
Selected optional xuất hiện trong primary workflow, có completion bình thường và
được Resolver cân nhắc trước các downstream dependency của chính nó.

Current Affiliate baseline không có OPTIONAL. AFF-US-015 không thêm field. Trước
khi một future flow production-activate OPTIONAL, slice sở hữu capability phải:

1. định nghĩa explicit server-owned durable capability selection trong Project
   configuration hoặc domain aggregate tương ứng;
2. authorization/validate selection bằng command riêng;
3. đưa sanitized `selectedOptionalCapabilities` vào Resolver input;
4. mở rộng `deriveNextApplicableStep()` để chỉ skip OPTIONAL chưa selected;
5. chứng minh reload/back-forward giữ selection và không dùng client local state
   làm authority.

Không được activate optional bằng query string, local state hoặc click route đơn
thuần. CreationPath policy có thể quyết định capability là OPTIONAL, nhưng không
đồng nghĩa user đã opt in.

## 7. Deep-link và route behavior

| Applicability state | Direct route behavior |
|---|---|
| `NOT_REQUIRED` | Render controlled “Không áp dụng cho Project này” tại URL hiện tại và CTA đến `nextRouteKey`; không auto-redirect để tránh loop, mất context và phá bookmark. |
| `OPTIONAL` chưa selected | Render informational/opt-in state; không mount execution UI trước authorized opt-in command. |
| `OPTIONAL` selected | Giống applicable step theo completion; server vẫn kiểm tra selection. |
| `REQUIRED` | Render normal prerequisite/waiting state; không gọi đây là lỗi. Route có thể đọc context nhưng action không khả dụng phải được giải thích. |
| `READY` | Render action UI; server execution guard vẫn kiểm tra lại. |
| `BLOCKED` | Render typed blocked state, reason và CTA tới blocking capability; không mutate cursor/status. |
| `STALE` | Hiện prior artifact nếu domain cho phép, stale warning và explicit re-run/reconcile action. |
| Unsupported identity/reason | Render Project-needs-attention state với safe overview/recovery action; không crash hoặc redirect loop. |

Blocked/Not-required routes có thể là links để người dùng đọc giải thích. Action
thực thi không khả dụng dùng disabled button hoặc không render, kèm reason; không
dùng một “disabled link” không semantic.

## 8. Render placeholder UX

Khi M4 trả:

```text
RENDER / BLOCKED / NOT_STARTED / RENDER_FEATURE_NOT_IMPLEMENTED
```

Stepper hiển thị `Sắp có`, message `Tính năng dựng và render chưa được triển khai`.
Đây không phải lỗi của user, không dùng destructive/error treatment. `/video` và
`/preview` chỉ navigable như informational placeholder; không có CTA thực thi,
không ghi “Có thể tiếp tục”, không tạo fake completion. Primary action kind là
`COMING_SOON` và không phát mutation/provider/job.

## 9. `nextApplicableStep` UI ownership

UI dùng `nextApplicableStep`/`nextRouteKey` cho primary CTA, default landing và
next-step highlight. Active viewed route vẫn lấy từ pathname và tách khỏi next
capability. GET, layout, stepper hoặc redirect không được ghi `currentStepKey` hay
`project_step_status`. Server execution guards, authorization, Fact Lock gate,
Script preflight, TTS checks và CAS/transaction boundaries vẫn là authority cuối.

## 10. Current Affiliate parity matrix

Trong bảng, mọi scenario đều có năm primary capability steps theo thứ tự
`Product → Content → Fact Lock → Voice → Render`; `/preview` là secondary Render
route. `R` = READY, `Q` = REQUIRED, `B` = BLOCKED, `S` = STALE; suffix
`NS/IP/C` là completion.

| Scenario | Status labels theo capability | Navigability | Primary CTA | Next highlight |
|---|---|---|---|---|
| A. Chưa có Script | Product `R/C`; Script `R/NS`; Fact Lock `Q/NS`; Voice `Q/NS`; Render `Q/NS` | Product/Script mở; downstream mở controlled waiting view | `Tạo Script` → `/content` | Script |
| B. Có Script generation, chưa có current usable version | Product `R/C`; Script `R/IP`; Fact Lock `Q/NS`; Voice `Q/NS`; Render `Q/NS` | Script resume; downstream waiting | `Tiếp tục Script` → `/content` | Script |
| C. Script saved, Fact Lock ready | Product `R/C`; Script `R/C`; Fact Lock `R/NS`; Voice `Q/NS`; Render `Q/NS` | Fact Lock actionable; downstream waiting | `Chạy Fact Lock` → `/fact-lock` | Fact Lock |
| D. Fact Lock blocked/review/failed/indeterminate | Product `R/C`; Script `R/C`; Fact Lock `B/IP`; Voice `B/NS`; Render `Q/NS` | Fact Lock mở remediation; Voice blocked view | Typed Fact Lock action → `/fact-lock` | Fact Lock |
| E. Fact Lock passed, chưa có VoiceConfig | Product/Script/Fact Lock `R/C`; Voice `R/NS`; Render `Q/NS` | Voice actionable; Render waiting | `Thiết lập giọng đọc` → `/voice` | Voice |
| F. VoiceConfig saved, chưa có segments | Upstream `R/C`; Voice `R/IP`; Render `Q/NS` | Voice resume | `Tạo voice segments` → `/voice` | Voice |
| G. Segments một phần | Upstream `R/C`; Voice `R/IP`; Render `Q/NS` | Voice resume với progress | `Hoàn tất voice` → `/voice` | Voice |
| H. Mọi segment current/usable | Upstream + Voice `R/C`; Render `B/NS`, label `Sắp có` | Video/Preview informational only | Không có execution CTA (`COMING_SOON`) | Render |
| I. ScriptVersion revision đổi sau Fact Lock/Voice | Product `R/C`; Script `R/C`; Fact Lock `S/IP`; Voice `S/IP`; Render `Q/NS` | Prior safe artifacts có thể xem; downstream stale action phải rerun | `Chạy lại Fact Lock` → `/fact-lock` | Fact Lock |
| J. Product Facts stale | Product `R/C`; Script `R/C`; Fact Lock `S/IP`; Voice `B/IP`; Render `Q/NS` | Fact Lock remediation; Voice controlled blocked | `Chạy lại Fact Lock` → `/fact-lock` | Fact Lock |

Exact state/completion/reason/next của matrix vẫn lấy từ M4 fixture accepted; bảng
này khóa cách trình bày, không tạo oracle domain thứ hai.

## 11. Future Channel-First conceptual matrix

Các dòng sau chỉ là contract/test fixture tương lai, không writable/routable ở US15:

| Future identity | Product | Script | Fact Lock | Voice | Render |
|---|---|---|---|---|---|
| Organic Scripted claimless | `NOT_REQUIRED` | Required/Ready theo artifact | `NOT_REQUIRED` | Policy-dependent `OPTIONAL` hoặc `NOT_REQUIRED` | Eventual requirement; current implementation vẫn blocked |
| Organic Scripted có Product claim | Required | Required | Required | Policy-dependent | Chỉ khi upstream hợp lệ |
| Organic Quick Image claimless | `NOT_REQUIRED` | `NOT_REQUIRED` | `NOT_REQUIRED` | `OPTIONAL` hoặc `NOT_REQUIRED` theo policy | Required khi composition/render tồn tại |

AFF-US-019 sở hữu Organic Scripted; AFF-US-021 sở hữu Quick Image. Các slice đó
phải thỏa opt-in contract trước khi dùng OPTIONAL.

## 12. Read/API aggregation architecture

Minimum-change target là một protected query riêng, conceptually
`project.getAdaptiveWorkflow`, backed bởi
`getAdaptiveWorkflowSnapshot(actor, projectId)`. Không thêm vào public/current
`project.get` trong contract này và không expose DTO trước Phase 15A/15B.

Service target phải:

1. authorize workspace trước khi trả data;
2. gather một sanitized Project/domain snapshot một lần;
3. chạy pure Resolver một lần và map structural read model một lần;
4. reuse snapshot/result cho stepper, landing và gated page;
5. parallelize các independent reads, sequence dependency reads;
6. dùng request-scoped `React.cache`/server dedupe với primitive stable arguments
   ở RSC và client query cache tương ứng;
7. chỉ serialize DTO tối thiểu, không raw ORM/user text;
8. không provider call và không mutation.

Không được tạo waterfall `project.get + shadow gather + adaptive gather`. Khi
adaptive query được implement, M4 observer/comparator phải nhận/reuse cùng gathered
snapshot/result. Current RSC loader bypass `project.get`, nên integration phải đặt
orchestration ở shared service chứ không dựa riêng vào router side effect.

Adaptive read path phải dùng `getVoiceStepWorkflowReadSnapshot()` hoặc read-only
equivalent; không gọi `reconcileVoiceStep()` trong render. Reconciliation tiếp tục
là explicit business write.

## 13. Phased authority cutover

| Phase | Scope | Authority |
|---|---|---|
| 15A — Read-model foundation | Mapper/types, exhaustive reason presentation contract, unit tests, shared snapshot service; chưa consumer | Legacy UI/gates; M4 shadow giữ nguyên |
| 15B — Stepper/landing presentation | Stepper, Project landing/list/dashboard consume adaptive read summary; no read mutation | Resolver cho presentation; execution guards vẫn legacy/domain authority |
| 15C — Route-state adoption | Content/Fact Lock/Voice/Video/Preview route shells dùng cùng snapshot; deep-link semantics áp dụng | Resolver cho presentation/navigation; defensive server guards không bỏ |
| 15D — Parity and acceptance | Matrix A–J, back/forward/refresh, bookmark, accessibility/mobile, loading/error and performance evidence | Cutover chỉ accepted khi toàn bộ gate xanh |

Không có phase nào tự động đồng bộ `currentStepKey`. Nếu cần persisted cursor sync,
đó là future explicit transactional command với approval riêng.

## 14. M4 shadow lifecycle

- 15A: giữ full shadow comparison.
- 15B/15C: giữ comparison cho golden Affiliate baseline trong khi Resolver làm UI
  presentation authority; diagnostic phải sanitized và không đổi response.
- 15D exit: matrix A–J 100%, zero mismatch/exception/unmapped case trong agreed
  observation window, route/manual regression và golden suites xanh, no read
  mutation/provider call, query budget được chấp nhận.
- Sau exit chỉ một quyết định riêng mới được reduce/sample hoặc remove shadow.
  Không tự xóa shadow khi UI bắt đầu dùng Resolver.

## 15. Loading, errors, accessibility và mobile

- Adaptive snapshot có skeleton gần layout cuối; không render legacy “ready” tạm
  thời rồi đổi sang blocked. Loading, error, blocked, stale và ready khác nhau.
- `<nav aria-label>` + ordered list; `aria-current="step"` chỉ cho route đang xem,
  không cho next highlight. Icon/badge luôn có visible text, không chỉ dùng màu.
- Link dùng cho route thật; button dùng cho command/opt-in/retry. Unavailable action
  có reason cạnh control. Sau navigation/controlled state, focus vào page heading;
  async state update dùng live region phù hợp.
- Keyboard/focus ring giữ baseline hiện hữu; target chính xấp xỉ tối thiểu 40px.
- Mobile dùng vertical/compact list hoặc wrapping không overflow ngang. Active,
  blocked, stale, reason và primary CTA phải đọc được; dynamic visible numbering
  không có gap khi `NOT_REQUIRED` bị ẩn.
- Unsupported identity/rendered mapper error phải nằm trong controlled error
  boundary; không crash toàn app shell hoặc redirect vô hạn.

US15 không thêm product analytics/telemetry backend. Chỉ reuse sanitized diagnostic
pattern hiện hữu nếu cần rollout evidence.

## 16. Stable acceptance criteria

- `AC-015-01` — Một derived, typed, serializable Adaptive Workflow read model map
  đúng năm capability và route descriptors; không persist/raw ORM/raw user text.
- `AC-015-02` — UI render ApplicabilityState và completion riêng; `READY` không bị
  coi là complete và `NOT_REQUIRED` không bị coi là completed.
- `AC-015-03` — `NOT_REQUIRED` bị ẩn khỏi primary stepper, numbering động liên tục;
  direct URL render controlled N/A state, không auto-redirect.
- `AC-015-04` — OPTIONAL khác NOT_REQUIRED; unselected optional bị skip, selected
  optional cần durable server-owned selection và được tính trong flow.
- `AC-015-05` — BLOCKED có typed explanation/action, không tự mutate progress và
  không expose unavailable execution.
- `AC-015-06` — STALE có warning riêng, prior safe artifact và explicit rerun/
  reconcile action; không flatten thành blocked/failed.
- `AC-015-07` — `nextApplicableStep` chỉ sở hữu primary CTA/default landing/next
  highlight; active viewed route vẫn theo pathname.
- `AC-015-08` — Adaptive reads/navigation không mutate `currentStepKey`,
  `project_step_status` hoặc artifact.
- `AC-015-09` — Affiliate A–J giữ exact Resolver parity, routes và functional
  Product→Script→Fact Lock→Voice behavior.
- `AC-015-10` — Current Render hiển thị `Sắp có` cho
  `BLOCKED/RENDER_FEATURE_NOT_IMPLEMENTED`; Video/Preview không báo ready.
- `AC-015-11` — Deep links có deterministic state behavior cho đủ sáu state và
  unsupported identity; không redirect loop hoặc phá bookmark Affiliate.
- `AC-015-12` — Web presentation layer có exhaustive typed reason-code mapper;
  core/server không trả Vietnamese prose làm authority.
- `AC-015-13` — Stepper/routes đạt keyboard, focus, semantic link/button,
  `aria-current`, non-color status và mobile/no-overflow contract.
- `AC-015-14` — UI không rederive Product/Script/Fact Lock/Voice/Render policy;
  duplicated shallow checks bị remove/reduced ở cutover.
- `AC-015-15` — Organic, Quick Image và Media First chỉ tồn tại ở conceptual tests;
  không production-write/route activate trong US15.
- `AC-015-16` — Workspace authorization, Script preflight, Fact Lock gate,
  Voice/TTS checks, provider guard, CAS/transaction remain server authority.
- `AC-015-17` — Một authorized read-only gathered snapshot được reuse; không
  `project.get + shadow + adaptive` waterfall, provider call hoặc render mutation.
- `AC-015-18` — M4 shadow được retain qua adoption và chỉ reduce/remove sau explicit
  acceptance với zero mismatch/exception/unmapped evidence.

## 17. Implementation-ready test inventory

Phase implementation phải có unit tests cho mapper/state-completion/reason
exhaustiveness/route mapping/optional selection; integration tests cho authorized
single snapshot, zero mutation, no provider, direct routes và unsupported identity;
UI tests cho A–J, bookmarks, loading/error/stale/blocked, focus/keyboard/mobile.
Golden Affiliate suites và server execution-guard tests không được thay bằng UI
tests.

# Nhật ký thay đổi

Mọi thay đổi đáng chú ý về hành vi người dùng, vận hành và kiến trúc của
AffiChannel được ghi tại đây.

Định dạng dựa trên nguyên tắc Keep a Changelog. Khi bắt đầu phát hành, phiên bản
sử dụng Semantic Versioning.

## Chưa phát hành

### Đã thêm

- AFF-US-010 Phase 1: thêm Fact Lock run/claim/mapping schema additive, deterministic
  classification validator, exact ScriptVersion/Product Fact snapshot, dependency
  registration, idempotent runtime API `factLock.run/getState` và read model stale.
- AFF-US-010 Phase 1 integration proof: deterministic provider persistence, mapping
  revision, latest usable sau failed/indeterminate, invalidation, script race,
  reopen persistence và workspace authorization.
- AFF-US-010 Phase 1 hardening: atomic execution ownership chống duplicate provider,
  stale claim -> indeterminate, review-state/metadata constraints, canonical relation
  `related`, per-mapping Fact revision và migration additive 0014.
- AFF-US-009 Phase 3: Save Version immutable, history newest-first, saved snapshot read-only,
  Get Version và Restore có optimistic concurrency; UI drawer/dialog và authenticated E2E
  cho save, preview, restore, reload persistence.
- DEC-015 và foundation AFF-US-008: persisted `ScriptGeneration`, immutable repair lineage,
  Fact revision snapshot/dependency atomic, idempotency, pending concurrency và latest usable
  artifact read model; chưa thêm provider/API/UI.
- AFF-US-006: Product Facts với schema Fact/History, search/filter/cursor pagination, tab deep-link
  trên Product Detail, drawer thêm/sửa, dialog xóa và trạng thái loading/empty/error.
- AFF-US-006 hardening: server-side evidence rule cho Fact verified, AI eligibility, demote/re-verify
  khi sửa Fact verified, snapshot history transaction và chặn xóa Product khi còn Fact/history.
- AFF-US-006 hardening tiếp: Drawer dùng Viewport đúng chuẩn Base UI và panel bên phải; update Fact
  dùng intent `preserve | verify`; tab Product Facts giữ history bằng browser back/forward/reload;
  regression E2E xác nhận không còn lỗi `Drawer.Popup` và verified content edit trở về Bản nháp.
- AFF-US-005: Product Library, Product CRUD, search/filter, archive/restore, usage count và hard-delete guard;
  Product được workspace-scope và có migration field status/source/affiliate/price/currency.
- AFF-US-005 hardening: Product Library tải thêm theo cursor và Product Detail dùng copy người dùng thay vì
  nhãn implementation; URL được kiểm tra bằng parser với allow-list protocol.
- AFF-US-003: protected Dashboard aggregate, summary cards, recent project list/activity,
  warning empty state, cost contract và loading/empty/error/retry states.
- AFF-US-004: persistence Project, Content Brief, workflow seven-step và internal
  workspace ownership.
- Form tạo project có validation, loading/error state, Product selector tạo nhanh,
  project list/empty state và redirect theo workflow state.
- Monorepo Better T Stack ban đầu gồm Next.js, oRPC, Better Auth, Drizzle, Neon,
  shared UI, Turborepo và Biome.
- Bộ tài liệu chuẩn gồm đặc tả sản phẩm, kiến trúc, hệ thống thiết kế, lộ trình,
  nhật ký quyết định, tiến trình AI và quy tắc agent toàn repository.

### Đã thay đổi

- AFF-US-010 Phase 0: khóa contract Fact Lock, tách pre-run/strict ScriptVersion
  validator, phân biệt persisted/effective stale, và chốt classification, idempotency,
  dependency, CAS resolution cùng server-side gate reason codes; chưa tạo schema/migration,
  chưa đổi Neon và chưa gọi provider/runtime.
- AFF-US-004 regression TC-026A: `/projects/{id}` nay render Project Overview persisted thay vì
  redirect về current step; nút “Tổng quan project” từ `/product` hỗ trợ refresh và browser Back.
- Cleanup sau AFF-US-003: user menu hiển thị identity từ session với fallback email; CI fail rõ ràng
  nếu authenticated E2E thiếu `E2E_AUTH_EMAIL` hoặc `E2E_AUTH_PASSWORD`.
- Dashboard chỉ đọc dữ liệu Project thật trong workspace hiện tại, không tạo mock metrics hoặc
  bảng read model riêng; link project mở đúng `currentStepKey`.
- Dashboard polish: warning điều hướng tới `targetUrl` với severity rõ ràng, action tạo project
  dùng `CardAction`, copy hướng người dùng hơn, relative time dùng chung và loading skeleton
  bám đúng layout thật; lỗi inline không tạo thêm global toast.
- Chốt authenticated E2E: Playwright tự nạp env cục bộ, fixed-account suite chạy tuần tự để
  tránh tranh chấp session/dev server; 8/8 test đạt, không còn skipped.
- Progress Dashboard được derive từ persisted completed step status và query recent projects
  được giới hạn 5 bản ghi, tránh N+1 step status query.
- Hardening AFF-US-004: migration tooling dùng direct Neon URL, workspace actor dùng internal
  workspace rõ ràng, repository update an toàn hơn và topbar hiển thị tên project persisted.
- Product Library giữ dữ liệu đã tải khi lấy trang tiếp theo; lỗi load-more hiển thị inline và có retry,
  không làm mất danh sách hiện tại.
- Bổ sung kiểm tra required fields, duplicate project name, persistence đủ brief/7 status và
  authorization chéo workspace.
- ProjectStepper đọc workflow current từ database, không coi route đang xem là
  trạng thái đã lưu.
- Bootstrap auth có thể lặp lại để bảo đảm workspace membership cho fixed user hiện có.
- Thu hẹp MVP 0 vào luồng media thật, TTS, Fact Lock và local render worker.
- Xác định tài liệu Markdown trong `docs/` là cơ sở triển khai.
- Chuyển toàn bộ tài liệu chuẩn và quy tắc agent sang tiếng Việt.
- Tinh gọn header Dashboard, Dự án và các route placeholder: bỏ nhãn chung
  chung, dùng copy tiếng Việt theo ngữ cảnh và chỉ hiển thị status khi có dữ liệu
  domain tương ứng.
- Chuyển page context dùng chung vào topbar với title và mô tả in nghiêng; bỏ
  header trùng lặp trong nội dung chính và breadcrumb cell chỉ có title.
- Sửa breadcrumb để separator và item là sibling hợp lệ trong `<ol>`; map token
  giao diện sang Navy, Cream, Orange, Green và đồng bộ font với Geist.
- Điều chỉnh light theme về nền trắng cho workspace và sidebar; giữ orange cho
  active state và primary action để giao diện nhẹ hơn.
- Đổi light theme App Shell sang hệ xanh-trắng theo visual direction mới: blue
  cho primary/active, blue-900 cho text, và các màu green/orange/purple cho
  semantic state có kiểm soát.
- Làm mềm hệ component theo hierarchy radius: control, menu và active navigation
  được bo góc nhẹ; panel/card, dialog/drawer và form tạo project có surface mềm
  hơn nhưng giữ nguyên palette xanh-trắng.
- Hardening US004 trước merge: bỏ generic workflow mutation, sửa accessible label cho
  ProductSelector/E2E, kiểm tra workspace trước fixture, dùng chung Zod validation và
  dedupe server loader bằng `React.cache()`.
- Đổi AppTopbar sang panel trắng bo tròn theo visual direction mới: title ngắn,
  notification và Account Owner; bỏ Job Center khỏi header để giữ chrome gọn.
- Gọn AppTopbar: bỏ cell title, mô tả và breadcrumb lặp lại ở đầu protected route;
  giữ lại các utility action và ProjectStepper.

### Bảo mật

- Tài liệu hóa authorization ở mức bản ghi, loại secret khỏi log, kiểm tra file
  upload, chống SSRF và tách render khỏi Vercel Functions.
- Khóa public signup trong US001; tài khoản cố định được bootstrap ngoài luồng
  public và session được kiểm tra ở server.
- Không public API nhận `currentStepKey` tùy ý; workflow transition phải được triển khai
  như business action có transaction cập nhật step hiện tại và bước tiếp theo cùng nhau.
- Thêm protected App Shell cho US002 với route map tập trung, sidebar, topbar,
  breadcrumb, Job Center/notification entry point và ProjectStepper 7 bước.
- Các route MVP chưa có business logic hiện skeleton; persistence Project/StepStatus
  được giữ lại cho US004 theo DEC-010.

## Chưa phát hành — AFF-US-008 foundation

- Thêm ScriptDraft schema/partial validation, input snapshot, canonical hashing, idempotency và generation read model.
- Thêm `script_generation` migrations `0006`/`0007`/`0008`/`0009`, dependency type `script_generation`, transaction-scoped registration/detach và deterministic provider test scenarios.
- Hardening foundation: requestHash chỉ nhận client intent; repair merge server-side với parent partial;
  provider roles/schema contract; timeout uncertain; stale pending guard; partial cross-reference/
  hashtag validation; DB state-shape CHECK; concurrency/failure integration smoke coverage.
- Chưa thêm live AI SDK, API generate, Script Studio hay ScriptVersion.

### AFF-US-008 Phase 2A — backend/domain ready for acceptance

- Thêm Channel Settings/AI Settings/Output Rules theo workspace, Media Metadata tối thiểu và
  migration `0010`/`0011`.
- Bump structured output/snapshot/prompt lên v2; `hook` đơn thành 3–5 `hookVariants` có key.
- Thêm server-owned production input snapshot, prompt role separation, provider cost estimate và
  protected oRPC estimate/generate/repair/getState.
- Hardening Phase 2A: router phân lớp lỗi preflight/provider/persistence; repair giữ root metadata và
  parent valid sections; output enforce language, affiliate disclosure và avoidWords; provider chỉ
  nhận media `ready` với rights `owned|licensed`; audit BigInt oRPC không cần đổi DTO.
- Chưa có live provider SDK, UI, ScriptVersion, Fact Lock hay migration shared Neon.

### AFF-US-008 Phase 2B — live TextProvider ready for review

- Thêm `ApikeyFunTextProvider` qua registry, dùng APIKEY.FUN Anthropic Messages/SSE
  với model cấu hình mặc định `claude-sonnet-4-6`.
- Giữ server-side prompt boundary, parse JSON rồi validate bằng ScriptDraft v2/domain;
  repair vẫn merge và enforce invariant ở server.
- Thêm server env cho API key/base URL, timeout/output budget và pricing versioned;
  thiếu key/pricing fail closed, không fallback deterministic production, không giả cost 0.
- Normalize HTTP error, timeout/network uncertain, usage/request ID và currency; không log
  secret hoặc raw provider payload. `getState` vẫn DB-only.
- Thêm mock adapter tests và smoke command opt-in; không gọi live API mặc định, không thêm
  migration hoặc Script Studio UI.

### AFF-US-008 Phase 2B — SSE/error hardening

- Nhận diện `event:error`, JSON error sau HTTP 200, malformed/incomplete SSE và không
  biến provider-side stream error thành `AI_INVALID_OUTPUT`.
- Giữ policy uncertain bảo thủ cho HTTP 408/5xx, network/abort và không automatic retry;
  dependency Product Facts chỉ bị detach ở trạng thái `failed`.
- Làm rõ exact ScriptDraft v2 JSON contract và repair allow-list trong trusted prompt;
  cập nhật audit pricing/model và kết luận không thêm `anthropic-version` khi relay không
  yêu cầu.

### AFF-US-008 Phase 3 — Script Studio UI

- Thay placeholder Content route bằng Script Studio với context đầu vào, estimate, generate,
  trạng thái polling, output bất biến, partial repair và copy actions.
- Giữ tách biệt `latestRequest`/`latestUsableArtifact`, map lỗi provider sang copy an toàn,
  chặn Generate khi không có Product Facts usable và ghi rõ claims chưa qua Fact Lock.
- Bổ sung context read model server-side có workspace authorization; chỉ đưa media
  `ready + owned|licensed` vào context. Không thêm migration và không gọi live AI trong tests.
- Runtime DB integration của Phase 2A/2B vẫn pending vì Neon branch hiện thiếu bảng tương ứng;
  E2E UI Content dùng mock boundary, không migrate shared Neon.

### AFF-US-008 Phase 3 hardening

- Chặn Repair khi `dependencyState` đã invalidated; artifact cũ vẫn hiển thị warning và hướng
  dẫn tạo generation mới. Repair chỉ mở cho partial artifact còn current dependency.
- Đổi indeterminate sang warning semantics, chặn estimate khi context chưa sẵn sàng và dùng
  generic error copy cho lỗi tải Script Studio.
- Bổ sung mocked authenticated E2E cho completed/refresh, partial repair và invalidated partial;
  full suite đạt `15/15`, không gọi paid AI và không thêm migration.

### AFF-US-008 Final Runtime Integration — 2026-08-17

- Apply migration 0006–0011 trên Neon database hiện tại sau pre-migration safety audit; không tạo
  branch, không đổi URL, không reset/drop dữ liệu và không tạo migration mới.
- Verify runtime tables `channel_settings`, `ai_settings`, `media_metadata`, `output_rules`,
  `script_generation` cùng dependency/invalidation indexes, foreign keys và state constraints.
- Thêm authenticated runtime E2E không mock RPC cho getState, estimate, deterministic generate,
  DB persistence, Fact revision snapshot, dependency registration và reopen.
- Foundation integration pass idempotency, pending uniqueness, concurrency, failed/indeterminate,
  invalidation, latest usable và immutable repair child.
- Full regression đạt `16/16` E2E, `83/83` web unit, check-types, build, db:generate, scoped Biome
  và diff check; không còn skipped authenticated E2E.
- Live full-path smoke được ghi `SKIPPED` vì `AFFICHANNEL_LIVE_AI_SMOKE=0`; không tự bật paid AI.
- AFF-US-008 đủ điều kiện đánh dấu DONE; không triển khai US9/US10.

### AFF-US-009 Phase 0 — Contract Decisions — 2026-08-17

- Chốt boundary `ScriptGeneration` immutable của US8 và `ScriptVersion` human-editable của US9;
  không mutate `script_generation.output_json`.
- Chốt `editableSnapshotJson` là canonical source of truth, không tạo segment/scene normalized
  source trong US9 v1.
- Chốt draft mutable, saved version immutable, Save Version giữ draft hiện tại, Restore không mutate
  history và mọi write dùng optimistic `baseRevision` conflict.
- Chốt source generation pinned, claims stale theo revision/matrix và downstream future dùng
  `sourceScriptVersionId`/`sourceScriptRevision`.
- Chốt Phase 0 không tạo migration, không đổi Neon, không implement editor, Fact Lock hoặc TTS/audio.

### AFF-US-009 Phase 1 — ScriptVersion Foundation — 2026-08-17

- Thêm `script_version` làm boundary editable riêng cho script, giữ generated artifact US8 immutable;
  snapshot dùng `ScriptDraft v2` + selected hook + claims revision/status.
- Thêm initialize/getCurrent/full-snapshot autosave với optimistic revision conflict, current-draft
  uniqueness, source pinning, stale claims semantics và workspace authorization.
- Apply migration 0012 trên Neon hiện tại sau safety audit additive; không tạo Neon branch, không
  reset/drop data hoặc đổi credential. Thêm runtime integration fixture có cleanup và validator tests.
- Full regression: 14 web test files/95 unit tests, check-types, build, db:generate, scoped Biome
  và diff check pass. Một full E2E run đạt 16/16; rerun cuối lặp lại flaky AFF-US-004
  `page.goBack()` (test chạy riêng pass), cần harden ngoài scope US009.
- Phase 1 hardening: autosave đối chiếu stable structure server-side, merge tường minh chỉ editable
  fields, reject `INVALID_SCRIPT_VERSION_SNAPSHOT` khi client sửa key/order/reference/claims/language
  hoặc metadata structure, và validate snapshot cuối trước CAS update. Bổ sung unit/integration proof
  cho hook/voiceover/scene/claim tampering, allowed edits, metadata preservation và `onScreenText: null`.
- Hardening verification: 14 web test files/111 tests, check-types, ScriptVersion integration, build,
  `db:generate` no schema changes, scoped Biome và diff check pass. Full E2E hiện 15 pass/1 fail do
  regression ngoài scope ở US005 Product Management; isolated US004 vẫn tái hiện flake browser Back.
- Phase 2 editor/history/restore, Fact Lock, TTS/audio và các US sau chưa triển khai.

## 0.0.0 — 2026-08-10

### Đã thêm

- Khởi tạo project bằng Better T Stack.
### AFF-US-007 — Fact Freshness và Dependency Invalidation

- Thêm policy freshness tập trung cho price/promotion, assessment verification/evidence/freshness
  và generation usability contract.
- Thêm Product Fact revision, history revision, optimistic CAS cho update/delete và mã lỗi
  `FACT_CONCURRENT_MODIFICATION` với copy tiếng Việt.
- Thêm dependency register/replace/detach, invalidation event trong cùng transaction và
  Dashboard warning deep-link về Product Facts.
- Product Facts hiển thị badge freshness/evidence; migration `0005_exotic_edwin_jarvis.sql`
  đã apply trên Neon branch hiện tại.
- AFF-US-007 hardening: khóa hàng Product Fact khi register/replace và update/delete để không
  tạo active dependency stale; evidence assessment kiểm tra supporting source cho cả Fact type
  optional; Dashboard warning test nhận ngày tường minh và có regression race.
- Regression fix AFF-US-006/007: schema API nhận `null`/rỗng cho URL nguồn của Fact optional;
  verified feature/specification/policy/other không còn bị chặn trước persistence, nhưng vẫn
  hiển thị badge `Thiếu căn cứ` và bị block generation như contract.

### AFF-US-009 Phase 2 — Script Editor & Autosave UI — 2026-08-17

- Thêm Script Editor trên `/projects/[projectId]/content` cho draft hiện tại, gồm chọn/sửa hook,
  voiceover, scene fields, CTA, caption, hashtags, disclosure và claims read-only.
- Thêm autosave full snapshot phía client: debounce 1000ms, một request in-flight, giữ edit local
  khi response cũ về, trạng thái dirty/saving/saved/error/conflict và explicit reload khi conflict.
- Generation AI mới chỉ tạo notice; không auto-rebase/ghi đè draft. Không có structural controls,
  Fact Lock execution, TTS/audio, schema change, migration hoặc paid AI call từ editor.
- Bổ sung unit controller tests và authenticated mocked E2E cho initialize, edit, autosave, reload,
  claims stale/current boundary và newer-generation notice.
- Phase 3 history/restore chưa triển khai.

### AFF-US-009 Phase 2 final hardening — 2026-08-17

- Controller local giữ quyền sở hữu working snapshot sau khi mount; refetch nền hoặc `revision`
  mới của cùng `scriptVersionId` không reset local edits. Chỉ draft ID mới hoặc thao tác
  `Tải bản mới nhất` mới thay snapshot.
- Điều hướng nội bộ best-effort flush dirty autosave ngay khi unmount; nếu A đang in-flight và
  local có B mới hơn, A hoàn tất trước rồi B được gửi với base revision mới. Strict Mode cleanup
  giả không tạo duplicate request.
- Thêm regression unit/E2E cho same-ID refetch, clean navigation, dirty navigation flush và
  in-flight A → B; không thay đổi schema, migration, backend semantics, Product Facts, US007 hoặc
  AI provider.

Trạng thái: **AFF-US-009 Phase 2 Script Editor & Autosave is ready for final acceptance.**

### AFF-US-010 Phase 2 — Fact Lock Review & Resolution — 2026-08-18

- Thêm Review UI responsive tại `/projects/[projectId]/fact-lock`: claims list, filter,
  classification/review status, reason/confidence, suggestion và Product Facts evidence
  theo revision snapshot.
- Thêm manual approve, edit source, safe delete và apply stored suggestion qua
  workspace-scoped transactional API với optimistic CAS; run cũ tự chuyển effective
  stale sau khi ScriptVersion hoặc Product Fact thay đổi.
- Thêm UI/unit, integration và authenticated E2E proof; không tạo migration, không
  đổi schema, không triển khai FactLockGate/Voice/Render/TTS.

Trạng thái: **AFF-US-010 Phase 2 Review & Resolution is ready for acceptance.**

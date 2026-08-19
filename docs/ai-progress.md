# Tiến trình AI agent

- Trạng thái: AFF-US-011 Phase 2 TTS Preview Runtime đã triển khai; Phase 3 chưa bắt đầu.
- Cập nhật lần cuối: 2026-08-19

## 2026-08-19 — AFF-US-011 Phase 2 TTS Preview Runtime

Đã nối `TtsProvider` server-only với registry và adapter `ApiKeyFunTtsProvider`.
Adapter gửi một request `POST /v1/tts`, dùng TTS credential riêng, timeout bounded,
không retry, strict `audio/mpeg`, empty/5 MiB size guard và error mapping không
leak response body. Bổ sung server env contract cho TTS key/base URL/timeout/max
chars và live smoke flag `AFFICHANNEL_LIVE_TTS_SMOKE=0` mặc định.

Đã thêm `previewVoice()` derive text từ current ScriptVersion, normalize/truncate
server-side, enforce Fact Lock trước và ngay trước provider, kiểm tra lại
ScriptVersion/gate/VoiceConfig revision và trả binary protected qua
`POST /api/projects/:projectId/voice/preview`. Không persist audio, không thêm
migration, UI, full voiceover, cache, usage/billing hoặc render.

Đã bổ sung unit provider/route/domain tests và deterministic integration proof cho
5 preset, PASS, stale Script, stale Product Fact, rerun, missing config và
cross-workspace isolation. Live smoke không chạy vì flag mặc định `0`.

Trạng thái: **AFF-US-011 Phase 2 TTS Preview Runtime is ACCEPTED. Phase 3 chưa bắt đầu.**

Tài liệu chi tiết: `docs/aff-us-011-phase-2-tts-preview-runtime.md`.

## 2026-08-19 — AFF-US-011 Phase 1 Voice Foundation

Đã triển khai `voice_config` với migration additive `0015_last_gunslinger.sql`,
verified server-owned catalog `ara/eve/leo/rex/sal`, provider-neutral TTS contract
và protected API `voice.listPresets`, `voice.getConfig`, `voice.saveConfig`.
Save dùng server-owned provider `apikeyfun`, validation code contract, project row
lock và revision CAS; get/save bắt buộc `FactLockGate.assertPassed(actor,
projectId)`. Không có secret/audio/raw response trong schema và không có client
provider override.

Neon preflight/postflight khớp journal 0014→0015; `db:generate` sau migrate không
còn schema changes. Unit, protected RPC, VoiceConfig integration, Fact Lock,
ScriptVersion và ScriptGeneration integration đều đạt; web build và type-check
đạt. Phase 1 không gọi TTS relay, không tạo preview binary, UI panel hoặc full
voiceover artifact.

Trạng thái: **AFF-US-011 Phase 1 Voice Foundation is ACCEPTED. Phase 2/3 chưa bắt đầu.**

Tài liệu chi tiết: `docs/aff-us-011-phase-1-foundation.md`.

## 2026-08-19 — AFF-US-011 Phase 0 Contract & Architecture Freeze

Đã ghi nhận capability probe trước đó cho production TTS qua APIKEY.FUN relay:
`POST /v1/tts` dùng TTS key riêng, voice `eve`, language `vi`, speed `1.0`,
trả `audio/mpeg` hợp lệ 17.280 bytes trong khoảng 820 ms. Relay không expose
`/v1/tts/voices` hoặc `/v1/audio/speech`; catalog được khóa là server-owned
verified catalog theo provider documentation. Pricing APIKEY.FUN TTS vẫn
`UNVERIFIED`.

Đã khóa VoiceConfig mutable theo workspace/project với revision CAS, language
canonical `vi`, speed `0.7..1.5`, route locked theo Fact Lock và server
enforcement bằng `FactLockGate.assertPassed(actor, projectId)`. Preview text sẽ
do server derive từ current ScriptVersion và audio chỉ trả binary tạm thời,
không persist.

Phase 0 chỉ cập nhật contract/decision/roadmap/changelog; không tạo schema,
migration `0015`, provider/API/UI và không gọi thêm paid TTS.

Trạng thái: **AFF-US-011 Phase 0 Contract & Architecture is ACCEPTED. Phase 1 chưa bắt đầu.**

## 2026-08-18 — AFF-US-010 Phase 1 final hardening

Đã chuẩn bị execution claim atomic cho pending Fact Lock để chỉ một request gọi
provider; stale claim được kết thúc `indeterminate` bảo thủ. Đã siết review matrix
và metadata constraint, đổi `context` legacy sang `related`, bỏ top-level Fact
revision khỏi domain/read model và giữ revision trong từng mapping. Đã thêm regression
proof cho concurrency, replay, stale claim, review matrix, relation và multi-revision.

Đã pre-audit và apply migration additive `0014_fact_lock_phase_one_hardening.sql` trên
Neon hiện tại. Ledger trước migrate ở 0013, không có dòng `context` hoặc review state
không hợp lệ; không sửa migration 0013, không reset/drop dữ liệu, không gọi paid AI,
không triển khai Phase 2.

Verification cuối: check-types, web unit 127 tests, Fact Lock/ScriptVersion/
ScriptGeneration integration, authenticated E2E 21/21 không skip, db:generate và
git diff --check đạt. Build đã compile/type-check/static export thành công; wrapper
Turbo không tự thoát sau summary nên cần theo dõi riêng exit code trong CI.

- Trạng thái: AFF-US-009 Phase 3 đã hoàn thành phần History/Save Version/Restore trên branch
  hiện tại; chưa commit/push/merge/deploy.
- Cập nhật lần cuối: 2026-08-17

## 2026-08-17 — Hoàn thiện AFF-US-009 Phase 3

Đã thêm protected API `scriptVersion.saveVersion`, `listHistory`, `getVersion` và `restore`.
Save Version lấy snapshot draft authoritative ở server, validate canonical snapshot, lock project
row trong transaction và cấp version number an toàn; saved history immutable. Restore dùng
`baseRevision`, lock cùng aggregate, chỉ copy vào draft, tăng revision và giữ source generation
pinned. Claims current được normalize theo revision mới, claims stale giữ nguyên stale/source revision.

UI Script Editor có nút Lưu phiên bản, drawer lịch sử newest-first, snapshot read-only và dialog
xác nhận Restore. Nút Save Version flush autosave trước; dirty/error/conflict không được đi tiếp.
Autosave controller có Promise flush để chờ cả request đang bay và edit mới nhất.

Đã bổ sung integration proof cho save/history/get/restore, immutable history, CAS conflict,
cross-workspace authorization và claims current/stale; authenticated E2E cho save v1/v2, preview,
restore và reload persistence. Schema Phase 1 đủ nên không tạo migration.

Kiểm tra tại thời điểm cập nhật:

- `pnpm check-types`: đạt.
- `pnpm --filter web test`: 15 file / 120 test đạt.
- `pnpm test:integration:script-version`: đạt trên Neon và cleanup fixture.
- `pnpm --filter web test:e2e`: 21/21 đạt, 0 failed, 0 skipped.

Tài liệu chi tiết: `docs/aff-us-009-phase-3-history-restore.md`.

- Mốc lịch sử trước Phase 3: AFF-US-007 đã hoàn thành sau hardening và fix regression TC-021 trên branch
  `feat/us006-product-facts`; chưa commit/push/merge/deploy.
- Cập nhật lần cuối: 2026-08-13

File này ghi lại công việc đáng kể do AI agent thực hiện. Đây không phải chain of
thought hoặc bản sao terminal. Mỗi bản ghi chỉ tóm tắt mục tiêu, thay đổi, bằng
chứng kiểm tra, quyết định, blocker và hành động an toàn tiếp theo.

## Mốc tiến độ trước AFF-US-009

AFF-US-007 Fact Freshness & Dependency Invalidation đã hoàn thành trên branch
`feat/us006-product-facts`; TC-021 verified Feature không source đã được sửa và xác nhận.

### 2026-08-13 — Fix regression TC-021 Product Facts

Root cause là `nullableSourceUrl` ở shared Product Fact schema chỉ nhận `string | undefined`,
trong khi form normalize URL rỗng thành `null`. Vì vậy request browser bị oRPC reject ở input
validation trước khi tới persistence service; đây không phải lỗi của `factRequiresEvidence()`.

Đã sửa schema để URL nguồn nhận `null`/rỗng và vẫn kiểm tra protocol `http/https` khi có giá trị.
Persistence tiếp tục chỉ yêu cầu evidence cho `price`, `promotion`, `claim`; supporting-source
assessment và generation usability của US007 không đổi.

Đã bổ sung regression coverage cho verified `feature`, `specification`, `policy`, `other` không
source; kiểm tra assessment `evidence=missing`, freshness `not_applicable`, generation `blocked`,
source được thêm thì generation `allowed`; đồng thời giữ các required-evidence case price/
promotion/claim bị reject.

Kiểm tra:

- `pnpm run check-types`: đạt.
- `pnpm --filter web test`: 40/40 đạt.
- `pnpm run test:integration:product-facts`: đạt trên Neon.
- `pnpm --filter web test:e2e -- tests/e2e/product-facts.spec.ts`: 1/1 đạt.
- `pnpm --filter web test:e2e`: 12/12 đạt, 0 failed, 0 skipped.

### 2026-08-12 — Hardening AFF-US-006 Product Facts

Đã xử lý:

- Shared Base UI Drawer dùng đúng anatomy `Drawer.Portal > Drawer.Viewport > Drawer.Popup`;
  panel vẫn mở từ bên phải và `swipeDirection="right"` khớp với layout.
- Update Fact nhận `verificationIntent: preserve | verify`. Sửa sensitive field của Fact đang
  `verified` với intent mặc định sẽ chuyển về `draft` dù payload status cũ vẫn là `verified`;
  notes-only giữ `verified`; re-verify phải là action rõ ràng và chạy lại evidence validation,
  kể cả khi đổi `feature` sang `price` hoặc khôi phục từ `inactive`.
- Fact drawer hiển thị cảnh báo demote và action `Xác minh lại & Lưu`; form dùng submitter để
  truyền intent, không suy luận re-verify từ select status.
- Click tab Product Detail dùng `router.push`; URL `?tab=facts` tiếp tục là source of truth cho
  reload, back và forward.
- Bổ sung regression cho Base UI console error, URL history, verified lifecycle, notes-only,
  feature→price và inactive→verified evidence rules; siết E2E URL về UUID và cleanup test
  theo thứ tự FK.

Kiểm tra hardening:

- `pnpm run check-types`: đạt.
- `pnpm --filter web test`: 34/34 đạt.
- `pnpm test:integration:product`: đạt.
- `pnpm test:integration:product-facts`: đạt; gồm notes-only preserve, sensitive demote,
  explicit re-verify, feature→price và inactive evidence validation.
- `pnpm --filter web test:e2e`: 11/11 đạt, 0 failed, 0 skipped; authenticated flow chạy thật,
  Drawer không còn console error `Drawer.Popup`, tab Facts chạy được back/forward/reload và
  sửa verified content hiển thị `Bản nháp`.
- `pnpm --filter web build`: đạt.
- Biome scope 11 file hardening: đạt.
- Root `pnpm exec biome check .` vẫn có diagnostics/warnings baseline ngoài phạm vi; không chạy
  script root `pnpm run check` để tránh ghi formatting lan sang các file người dùng đang sửa.

Trạng thái hardening: Done trong phạm vi AFF-US-006. Không commit/push/merge/deploy.

### 2026-08-12 — Hoàn thiện AFF-US-006 Product Facts

Thay đổi:

- Thêm `product_fact` và `product_fact_history`, migration `0004_military_joystick` đã apply
  trên Neon bằng migration tooling dùng `DATABASE_URL_DIRECT`.
- Thêm core contract cho Fact type/status/source, ngày lịch, evidence verification, status transition
  và AI eligibility. Verified sensitive edit được demote hoặc re-verify; lỗi API được map sang copy
  tiếng Việt thân thiện.
- Thêm protected oRPC CRUD/list/history với workspace + Product hierarchy authorization, search/filter,
  cursor pagination và transaction snapshot create/update/delete.
- Product Detail có tab `/products/{id}?tab=facts`, Fact list, filter, drawer thêm/sửa, delete dialog,
  history summary và count thật; URL giữ được reload/back/forward.
- Mở rộng Product delete guard: còn Project, Fact hoặc Fact history đều trả `PRODUCT_IN_USE`; archive
  vẫn giữ dữ liệu. Product `priceAmount` không đồng bộ Fact `price`.
- Cập nhật DEC-012, product spec, roadmap, changelog và AGENTS; không triển khai US007 freshness,
  scheduler/stale detection hay US008 Fact Lock/provider.

Kiểm tra:

- `pnpm --filter @affichannel/db db:migrate`: đạt.
- `pnpm run check-types`: đạt.
- `pnpm --filter web test`: 33/33 đạt.
- `pnpm test:integration:product-facts`: đạt; gồm evidence, transition, pagination/filter, history,
  workspace isolation, Product delete guard và archive regression.
- `pnpm --filter web test:e2e`: 11/11 đạt, 0 failed, 0 skipped; authenticated Product Facts flow chạy thật.
- `pnpm --filter web build`: đạt.
- Biome scope các file US006: đạt.
- `pnpm exec biome check .`: không đạt do 46 diagnostics/18 warnings baseline ở nhiều file cũ và
  một cảnh báo cấu hình deprecated; lệnh không ghi thay đổi. Không sửa lan sang phạm vi ngoài US006.

Trạng thái story: AFF-US-006 Done trong phạm vi đã chốt. Không commit/push/merge/deploy theo yêu cầu.

### 2026-08-12 — Hoàn thiện cuối AFF-US-005

Thay đổi:

- Bỏ copy kỹ thuật khỏi Product Detail; chỉ giữ trạng thái dữ liệu người dùng có thể hành động,
  gồm Product Facts và Media đang chưa có dữ liệu.
- Hoàn thiện Product Library với cursor pagination: nút `Tải thêm` chỉ hiện khi API trả `nextCursor`,
  nối dữ liệu vào danh sách hiện tại, giữ dữ liệu cũ khi lỗi và cho phép retry.
- Đổi validation URL dùng `new URL()` cùng allow-list protocol: thumbnail chỉ HTTPS; source và affiliate
  chấp nhận HTTP/HTTPS; giá trị rỗng sau trim được normalize thành `undefined`.
- Bổ sung unit test cho URL, integration test kiểm tra cursor không trùng bản ghi và authenticated E2E
  kiểm tra load trang kế tiếp với 51 Product tạm thời.

Kiểm tra:

- `pnpm run check-types`: đạt.
- `pnpm --filter web test`: 28/28 đạt.
- `pnpm test:integration:product`: đạt.
- `pnpm --filter web test:e2e`: 10/10 đạt, 0 failed, 0 skipped.
- Biome scope cho các file US005: đạt.
- `pnpm run check`: còn lỗi baseline ngoài US005 tại shared `packages/ui/src/components/label.tsx`
  (`noLabelWithoutControl`); root script cũng phát hiện hai cảnh báo unused import không liên quan.

Trạng thái story: AFF-US-005 Done. Bước tiếp theo là AFF-US-006 Product Facts; không triển khai
Product Facts, media upload hoặc R2 trong cleanup này.

### 2026-08-11 — Triển khai AFF-US-005 Product Management

Phạm vi đã làm:

- Mở rộng Product schema với `status`, link nguồn, thumbnail HTTPS, giá integer nullable và currency VND;
  tạo migration `0003_unusual_maria_hill` và apply vào Neon development.
- Hoàn thiện Product domain validation, list/search/filter, detail, create, update, archive, restore và
  hard delete có chặn khi Product còn được Project tham chiếu.
- Thêm Product Library, form, detail page, status badge, usage count, related projects, loading/empty/error
  state và dialog xác nhận xóa.
- Giữ `listMinimal({ selectableOnly: true })` cho Project selector; Product inactive/archived không được
  chọn cho Project mới, nhưng Project cũ vẫn đọc/lưu được Product đang giữ liên kết.
- Bổ sung unit test domain và integration test DB thật cho reuse, archive, restore, delete và workspace isolation.

Kiểm tra:

- `pnpm --filter @affichannel/core check-types`, `@affichannel/db check-types`, `@affichannel/api check-types` và
  `pnpm --filter web check-types`: đạt.
- `pnpm --filter web test`: 26/26 đạt.
- `pnpm test:integration:product`: đạt và đã cleanup dữ liệu test.
- Biome scope US005: đạt.

Trạng thái story: đủ điều kiện đánh Done trong phạm vi US005. Authenticated E2E chạy bằng fixed
account đạt 9 passed, 0 failed, 0 skipped; build production và visual QA desktop/mobile đã đạt.

### 2026-08-11 — Cleanup sau AFF-US-003

Mục tiêu:

- Đồng bộ current status sau khi Dashboard đã dùng dữ liệu Project thật.
- Hiển thị identity từ session trong user menu, có fallback an toàn về email.
- Đảm bảo CI fail rõ ràng nếu authenticated E2E thiếu credentials bắt buộc.

Thay đổi:

- Bỏ label `Account Owner` hardcoded; dùng `session.user.name` sau khi trim, fallback về email.
- Dùng accessible label ổn định `Mở menu tài khoản` cho trigger và cập nhật E2E locator.
- Playwright vẫn tự load `apps/web/.env` ở local; khi `CI` truthy, thiếu
  `E2E_AUTH_EMAIL` hoặc `E2E_AUTH_PASSWORD` sẽ dừng test ngay sau bước load env.
- Giữ nguyên các entry lịch sử bên dưới để phân biệt blocker tại thời điểm cũ với trạng thái hiện tại.

Kiểm tra:

- Authenticated Playwright: 8 passed, 0 failed, 0 skipped với fixed account đã cấu hình ngoài repository.
- Unit test cho display name/fallback, check-types, build và Biome scoped đạt.

### 2026-08-11 — Triển khai AFF-US-003 Dashboard Overview

Thay đổi:

- Thêm contract và domain service Dashboard trong `packages/core`, gồm progress theo step status,
  status/activity mapping và default cost/warning trung thực.
- Thêm protected `dashboard.getOverview()` cùng Drizzle repository: query workspace-scoped,
  recent project limit 5, order theo `updatedAt DESC`, step status tải theo một query `IN`.
- Thay màn debug bằng summary cards, recent projects có link tới current step, activity, warning,
  loading, empty, error/retry và route-level error boundary.
- Thêm integration test kiểm tra workspace isolation, ordering, limit và current step; thêm E2E
  click Dashboard → project current step khi fixed account được cấu hình.
- Global query error chuyển sang message generic, không lộ raw server error.

Kiểm tra:

- `pnpm check-types`, `pnpm --filter web test` 16/16, `pnpm test:integration:dashboard`,
  `pnpm --filter web build` và Biome scoped: đạt.
- Playwright: 3 pass, 5 skipped vì thiếu fixed E2E credentials; Browser plugin không có nên
  visual QA dùng Chrome cài sẵn qua Playwright fallback, chỉ xác nhận được unauthenticated redirect.

Blocker:

- Cần `E2E_AUTH_EMAIL`/`E2E_AUTH_PASSWORD` và cặp Neon pooled/direct cùng project để chốt gate.

### 2026-08-11 — Hardening theo review AFF-US-004

Thay đổi:

- Drizzle migration ưu tiên `DATABASE_URL_DIRECT`, còn runtime tiếp tục dùng pooled
  `DATABASE_URL`; cập nhật cảnh báo cấu hình hai Neon project khác nhau.
- Workspace actor chỉ resolve membership ở `INTERNAL_WORKSPACE_ID`, không lấy membership
  cũ nhất một cách ngầm định.
- Repository update kiểm tra project update thành công trước khi ghi Content Brief.
- Topbar lấy tên project thật qua protected query cho project persisted; demo fixture chỉ
  được dùng ngoài production.
- Bổ sung unit test cho required fields/duplicate name, mở rộng E2E persistence assertions và
  thêm `pnpm test:integration:project-auth` cho kiểm tra chéo workspace.

Blocker:

- Chưa thể xác nhận E2E happy path với 0 skipped vì môi trường chưa có
  `E2E_AUTH_EMAIL`/`E2E_AUTH_PASSWORD`; không ghi credential vào repository.
- Chưa thể coi database config hoàn tất cho đến khi user thay hai URL bằng pooled/direct của
  cùng một Neon project/branch.

### 2026-08-11 — Gọn AppTopbar theo phản hồi giao diện

- Xóa cell title, mô tả và breadcrumb ở đầu các protected route để tránh lặp nội dung
  và tạo khoảng trống không đem lại giá trị.
- AppTopbar dùng panel trắng bo tròn với title ngắn theo route, thông báo và tài khoản;
  project stepper vẫn giữ vai trò điều hướng quy trình ở các trang project.
- Cập nhật route test/E2E và `AGENTS.md` để không tự thêm lại page header chung.

### 2026-08-11 — Triển khai AFF-US-004 Project + Content Brief

Thay đổi:

- Thêm shared domain package cho Project/Product validation, workflow contract và service.
- Thêm workspace nội bộ, membership, Product tối thiểu, Project, ContentBrief và
  ProjectStepStatus; migration `0001_orange_nocturne` và migration sửa check constraint
  `0002_polite_invaders`.
- Create Project dùng transaction để ghi project, brief và đủ bảy step status cùng lúc.
- oRPC có product minimal list/create cùng project list/get/create/update/archive;
  mọi access kiểm tra workspace membership ở server. Workflow mutation chưa public
  trong US004 vì `currentStepKey` là source of truth và transition phải là business action
  transaction đầy đủ.
- Thêm `/projects/new`, selector tạo nhanh product, validation/loading/error/empty state,
  danh sách project thật và redirect/mở lại theo `currentStepKey` được lưu.

Quyết định:

- DEC-008: một internal workspace dùng chung, membership là lớp ownership;
  `createdByUserId` chỉ audit. Chưa thêm organization/role administration.
- Không unique tên project toàn cục hoặc theo workspace.
- AFF-US-005 chưa được làm đầy đủ; only minimal Product prerequisite nằm trong US004 form.

Kiểm tra:

- `pnpm db:generate`, review migration và `pnpm db:migrate` đã chạy trên database app đang dùng.
- `pnpm auth:bootstrap` đã đảm bảo membership của fixed account.
- Database transaction smoke test tạo/đọc/kiểm tra 7 status rồi xóa đúng các record test: đạt.
- `pnpm check-types`, `pnpm --filter web test` và `pnpm --filter web build`: đạt.
- Playwright đạt 3 test public/auth; happy path navigation và US004 create bị skip cho đến khi
  cấu hình `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD`.

### 2026-08-11 — Hardening review trước merge AFF-US-004

Thay đổi:

- Gỡ endpoint `updateWorkflow` generic và contract repository tương ứng; không cho client
  gửi thẳng `currentStepKey` để bỏ qua các step status.
- Sửa ProductSelector dùng label có liên kết thật với input tạo sản phẩm mới; E2E dùng
  accessible locator `getByLabel("Tên sản phẩm mới")`.
- Workspace authorization được kiểm tra trước demo fixture; fixture `demo` chỉ còn tồn tại
  ngoài production.
- Form tạo project dùng trực tiếp `createProjectInputSchema.safeParse()`, normalize
  description toàn dấu cách thành `undefined` và map lỗi API sang thông báo tiếng Việt.
- Dùng `React.cache()` cho session, workspace actor và project loader để tránh query lặp
  trong cùng request ở nested layout/page.

Kiểm tra sẽ chạy sau khi hoàn tất thay đổi: `pnpm check-types`, unit test, build và E2E
US004 khi có fixed credentials.

Lưu ý môi trường:

- `.env` hiện có `DATABASE_URL` và `DATABASE_URL_DIRECT` khác Neon project. Runtime/migration
  dùng `DATABASE_URL` để giữ account/session hiện có; cần thay cả hai URL bằng cặp pooled/direct
  của cùng một Neon project trước khi deploy hoặc chuyển database.

### 2026-08-11 — Làm mềm hình học giao diện App Shell

Mục tiêu:

- Loại bỏ cảm giác ô vuông cứng ở form, control và điều hướng mà không đổi
  palette xanh-trắng hoặc bố cục đã được duyệt.

Thay đổi:

- Shared Button, Input, Textarea, Card, Empty state, menu, overlay và feedback
  component dùng hierarchy bo góc thống nhất.
- Form tạo project, select sản phẩm, project list và active sidebar được bo góc
  nhẹ, bổ sung border/shadow tiết chế cho panel form.
- Bổ sung quy tắc UI mềm trong `AGENTS.md` và Design System; chỉ dùng góc vuông
  cho divider, bảng dày đặc hoặc phần tử lồng trong control đã có khung.

Kiểm tra:

- `pnpm exec biome check` trên 18 file UI đã thay đổi: đạt.
- `pnpm check-types`, `pnpm --filter web test` (14/14) và
  `pnpm --filter web build`: đạt.
- Playwright smoke `/login`: đạt và đã chụp rendered control. Không thể chụp
  `/projects/new` vì phiên Chrome hiện có không thể dùng lại trong Playwright và
  chưa có `E2E_AUTH_EMAIL` / `E2E_AUTH_PASSWORD`.

## Trạng thái project hiện tại

- Better T Stack scaffold đã tồn tại và dependencies đã được cài.
- Git đã có initial scaffold commit.
- Next.js web, oRPC, Better Auth, Drizzle, Neon, shared UI, Turborepo và Biome đã
  được cấu hình.
- `pnpm run check-types` đạt.
- Auth schema và business-domain schema US004 đã được generate migration, review và apply
  vào Neon development.
- AFF-US-001 Auth session, AFF-US-002 App Shell/Navigation và AFF-US-004 Project + Content
  Brief đã được triển khai.
- AFF-US-005 Product Management đã hoàn thành; AFF-US-003 Dashboard dùng dữ liệu thật và các
  feature production workflow tiếp theo vẫn chưa được triển khai.

## Hành động khuyến nghị tiếp theo

1. Mở AFF-US-006 Product Facts theo dependency của Product đã hoàn thiện.
2. Giữ nguyên `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD` ở môi trường local/CI, không đưa credential vào repository.
3. Chốt storage/media decision trước khi bắt đầu các slice media tiếp theo.

## Blocker và quyết định còn mở

- `DEC-007`: media lưu local-first hay R2-first.
- Chưa chọn TTS provider trước khi test tiếng Việt đại diện.

## Nhật ký phiên làm việc

### 2026-08-10 — Thiết lập bộ tài liệu chuẩn

Mục tiêu:

- Tạo tài liệu triển khai và quy tắc agent trước khi code.

Thay đổi:

- Thêm chỉ mục tài liệu và thứ tự nguồn sự thật.
- Thêm product spec với phạm vi theo giai đoạn và Acceptance Criteria MVP 0.
- Thêm ranh giới kiến trúc, sơ đồ hệ thống, quy tắc dữ liệu và job.
- Thêm design token, layout, trạng thái UI bắt buộc và accessibility.
- Thêm vertical-slice roadmap và Definition of Done.
- Thêm các quyết định kiến trúc đã chấp nhận và đang đề xuất.
- Thêm changelog, progress tracking và `AGENTS.md` ở root.

Kiểm tra:

- Đã kiểm tra scaffold mà không hiển thị giá trị biến môi trường.
- Đã xác nhận tên biến môi trường và Git ignore.
- Tất cả link Markdown tương đối đều trỏ đến file tồn tại.
- `git diff --check` không có lỗi whitespace.
- `pnpm run check-types` đạt sau khi thêm tài liệu.

Tiếp theo:

- Chủ dự án duyệt MVP 0 và xử lý mô hình ownership trong `DEC-008` trước khi làm
  Product schema.

### 2026-08-10 — Chuyển tài liệu sang tiếng Việt

Mục tiêu:

- Chuyển bộ tài liệu chuẩn và quy tắc agent sang tiếng Việt.

Thay đổi:

- Dịch nội dung trong `docs/`, root `AGENTS.md` và root `README.md`.
- Giữ nguyên tên file, đường dẫn, command, identifier và thuật ngữ code cần
  thiết để tránh thay đổi semantics.
- Giữ nguyên `apps/web/AGENTS.md` vì file này do Next.js tự sinh và quản lý.

Kiểm tra:

- Tất cả link Markdown tương đối đều hợp lệ.
- Không còn heading hoặc nhãn tài liệu tiếng Anh ngoài thuật ngữ kỹ thuật được
  giữ lại có chủ đích.
- `git diff --check` không có lỗi whitespace.
- `pnpm run check-types` đạt sau khi dịch.

Tiếp theo:

- Chủ dự án review nội dung và chốt các quyết định đang đề xuất trước khi code.

### 2026-08-10 — Triển khai AFF-US-001 Auth session

Mục tiêu:

- Hoàn thiện đăng nhập email/password và session cho thành viên cố định.

Thay đổi:

- Khóa public signup trong production bằng Better Auth `disableSignUp`.
- Thêm bootstrap script non-production cho fixed account, không nhận credential
  từ source code.
- Hoàn thiện login UI tiếng Việt, neutral auth error, logout về `/login` và
  optimistic `proxy.ts` cho `/dashboard`.
- Thêm Vitest unit test, Playwright E2E spec và migration Auth.
- Cập nhật product spec, roadmap, decision log và changelog theo DEC-009.

Kiểm tra:

- `pnpm run check-types` đạt.
- `pnpm --filter web test` đạt.
- `pnpm --filter web build` đạt; Next nhận diện `proxy.ts` cho `/dashboard`.
- `pnpm run db:generate` tạo migration Auth và `pnpm run db:migrate` apply thành công
  vào Neon development.
- `pnpm --filter web test:e2e` đạt 3 test; 1 test happy path fixed account được skip
  khi chưa có `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD`.
- `pnpm auth:bootstrap` không có confirmation bị từ chối trước khi tạo account.
- Biome scope của Auth đạt. Root `pnpm run check` vẫn còn lỗi lint nền trong
  `packages/ui` (`input-group.tsx`, `label.tsx`) và cảnh báo cấu hình `biome.json`.

Quyết định:

- DEC-009 — Tài khoản cố định, không public signup trong MVP 0.

Tiếp theo:

- Cấu hình test account và chạy happy path E2E; sau đó xử lý DEC-008 trước Slice 2.

### 2026-08-10 — Triển khai AFF-US-002 App Shell và Navigation

Mục tiêu:

- Tạo protected app shell dùng chung và contract điều hướng cho các slice sau.

Thay đổi:

- Chuyển các protected route vào layout dùng chung với AppSidebar, AppTopbar và
  breadcrumb từ route config tập trung.
- Thêm skeleton route cho Dashboard, Dự án, Sản phẩm, Media Library, Analytics,
  Chi phí & Usage và Cài đặt.
- Thêm project fixture/demo với ProjectStepper 7 bước và 5 trạng thái; `current`
  được suy ra từ URL, chưa persist vào database.
- Bổ sung Badge, Breadcrumb, Dialog và Drawer primitive trong `packages/ui`;
  Job Center/notification mới là entry point placeholder.
- Cập nhật roadmap, design system, DEC-010 và changelog để tách US002 khỏi
  persistence Project/StepStatus của US004.

Kiểm tra:

- `pnpm run check-types` đạt.
- `pnpm --filter web test` đạt 9 test.
- Playwright auth/navigation chưa chạy happy path nếu thiếu `E2E_AUTH_*`; các
  test unauthenticated, public signup và invalid credentials đạt.
- `pnpm --filter web build` đạt; Next nhận diện toàn bộ protected routes và Proxy.

Quyết định:

- DEC-010 — App Shell trước persistence Project.

Tiếp theo:

- Chốt DEC-008 trước khi bắt đầu Product schema; dùng E2E fixed account để chạy
  đầy đủ navigation flow.

### 2026-08-11 — Tinh gọn nội dung đầu trang App Shell

Mục tiêu:

- Loại bỏ copy trang trí không giúp điều hướng hoặc ra quyết định trong US002.

Thay đổi:

- Dashboard dùng title và mô tả theo ngữ cảnh workspace; bỏ `Workspace overview`.
- Trang Dự án bỏ `Workflow`, làm rõ mục đích danh sách và đổi entry point demo
  thành dự án mẫu.
- Placeholder bỏ badge `Đang chuẩn bị` ở đầu trang; mô tả rõ khung đã có và phần
  nghiệp vụ còn chờ slice tương ứng.
- Chuyển page context vào topbar với title và mô tả in nghiêng; bỏ header trùng
  lặp trong main content và breadcrumb cell chỉ có title.
- Bổ sung quy tắc copy header, badge status và semantics `Button`/`Link` vào
  `AGENTS.md` và Design System để các agent áp dụng thống nhất.

Kiểm tra:

- `pnpm run check-types` đạt trên toàn bộ workspace.
- Biome scope của các file TypeScript đã thay đổi đạt.
- `pnpm --filter web test -- routes.test.ts` đạt 4 test, gồm mapping page context
  cho route top-level và project.
- Chưa kiểm tra trực quan trong browser; cần reload các route để review copy sau HMR.

### 2026-08-11 — Hoàn thiện semantic breadcrumb và design baseline US002

Mục tiêu:

- Sửa các điểm còn lại của App Shell theo DEC-010 mà không mở rộng sang business
  persistence của US004.

Thay đổi:

- `app-breadcrumb.tsx` dùng `Fragment` để `BreadcrumbSeparator` và
  `BreadcrumbItem` là sibling `<li>` hợp lệ.
- AppTopbar hiển thị breadcrumb cho nested project route để giữ context điều
  hướng; top-level route không lặp breadcrumb chỉ có title.
- Map global UI token sang `#17212B`, `#F6F3EC`, `#F2A541`, `#2F7D64`; primary
  action và active sidebar dùng orange; sidebar dùng navy.
- Map `--font-sans` và `--font-mono` sang biến Geist đang được load.
- Đồng bộ roadmap rằng US002 chỉ cung cấp `ProjectStepKey`, status mapping và
  persistence contract; lưu dữ liệu thật deferred sang US004 theo DEC-010.

Kiểm tra:

- `pnpm run check-types`: đạt, 2 package typecheck thành công.
- `pnpm --filter web build`: đạt; production build và TypeScript hoàn tất.
- `pnpm --filter web test`: đạt 10/10 test.
- `pnpm --filter web test:e2e`: 3 pass, 4 skipped; 4 test auth/navigation happy
  path chưa chạy vì thiếu `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD`.
- `pnpm run check`: chưa đạt do 4 lỗi lint nền trong `packages/ui` và 2 warning
  unused import ngoài phạm vi US002; các file US002 đã được format/check theo scope.
- Browser visual screenshot chưa hoàn tất vì Browser plugin không có trong môi
  trường và Playwright screenshot CLI thiếu executable headless riêng.

Blocker:

- Cần cung cấp fixed E2E account qua biến môi trường rồi chạy lại auth/navigation
  happy path. US002 chưa đủ điều kiện Done khi blocker này còn tồn tại.

Deferred:

- Project, ContentBrief, ProjectStepStatus persistence và CRUD giữ lại cho US004.

### 2026-08-11 — Khôi phục màu light theme như giao diện cũ

Mục tiêu:

- Giữ bố cục App Shell hiện tại nhưng khôi phục chính xác cảm giác trắng/xám nhẹ
  của giao diện cũ theo phản hồi trực quan.

Thay đổi:

- Workspace, card, popover và sidebar dùng lại bộ token light cũ.
- Active sidebar dùng `secondary` như trước; giữ `nativeButton={false}` và Geist là
  các sửa kỹ thuật độc lập với màu sắc.
- Cập nhật design system để light theme không còn mô tả nền Navy/Cream/Orange.

Kiểm tra:

- `pnpm run check-types`: đạt.
- `pnpm --filter web test`: đạt 10/10 test.
- `pnpm --filter web build`: đạt.
- HTTP smoke check `/dashboard`: trả về 200.
- Chưa có browser visual screenshot trong môi trường này; cần reload `/dashboard`
  và các route protected để review trực quan sau HMR.

### 2026-08-11 — Áp dụng blue-white visual direction cho App Shell

Mục tiêu:

- Đồng bộ màu App Shell với visual reference xanh-trắng được duyệt, không mở rộng
  sang dashboard metrics hoặc dữ liệu giả.

Thay đổi:

- Thêm token blue, blue-900, blue-soft, green, orange và purple trong shared CSS.
- Đặt workspace ở `#F7FAFF`, surface ở trắng, primary/active navigation ở
  `#1677F2`, text chính ở `#122D58`.
- Đưa active sidebar về primary blue; giữ semantic màu phụ cho success, cost và
  grouping, không dùng chúng làm primary action.
- Cập nhật design system, changelog và AGENTS để tránh quay lại palette Navy/Cream
  hoặc thêm gradient/glow ngoài reference.

Kiểm tra:

- `pnpm run check-types`: đạt.
- `pnpm --filter web test`: đạt 10/10 test.
- `pnpm --filter web build`: đạt.
- Scoped Biome check cho App Shell và route config: đạt.
- HTTP smoke check `/login`: trả về 200.
- `pnpm --filter web test:e2e`: 3 pass, 4 skipped vì chưa có fixed E2E account;
  không phát hiện failure mới sau đổi màu.
- Browser plugin không có trong môi trường; fallback Playwright/system Chrome đã
  chụp được `/login` với palette mới. App Shell authenticated chưa chụp được vì
  fixed E2E account chưa được cấu hình.

### 2026-08-11 — AFF-US-003 Dashboard polish theo review

Mục tiêu:

- Đóng các lỗi UI/UX nhỏ còn lại trước khi review lại US003, không thay đổi read model
  backend đã được phê duyệt.

Thay đổi:

- Warning hiển thị theo severity và mở `targetUrl` tới màn hình xử lý.
- Đưa action tạo dự án vào `CardAction` để không lệch grid header.
- Đổi copy kỹ thuật sang ngôn ngữ người dùng, dùng chung helper relative time và sửa
  skeleton theo layout summary → recent projects → activity/warnings.
- Suppress global error toast cho Dashboard vì trang đã có inline error/retry.

Kiểm tra:

- `pnpm check-types`: đạt.
- `pnpm --filter web test`: 16/16 đạt.
- `pnpm --filter web test:e2e`: 3 pass, 5 skipped do thiếu fixed E2E account.
- Biome scoped cho Dashboard: đạt.
- Playwright/system Chrome: `/dashboard` redirect đúng `/login`, không có console error.

Blocker:

- Cần cấu hình `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD`, sau đó chạy lại authenticated E2E
  với mục tiêu `0 skipped` trước khi đánh dấu US003 Done.

### 2026-08-11 — Đóng authenticated E2E gate cho AFF-US-003

Mục tiêu:

- Chạy thật toàn bộ authenticated flow với fixed account và đạt 0 failed, 0 skipped.

Thay đổi:

- Đồng bộ locator menu tài khoản với accessible name `Account Owner` của AppTopbar hiện tại.
- Cho Playwright tự nạp `apps/web/.env` và chạy một worker vì suite dùng chung account/session
  và dữ liệu Project.

Kiểm tra:

- `pnpm --filter web test:e2e`: 8/8 đạt, 0 failed, 0 skipped.
- Flow create Project → Dashboard → Recent Project → `/projects/{id}/product` →
  ProjectStepper đã chạy thật.

Quyết định:

- AFF-US-003 đủ điều kiện Done. Chỉ bật parallel E2E khi đã có isolation theo worker.

## Mẫu bản ghi

```text
### YYYY-MM-DD — Tiêu đề task ngắn

Mục tiêu:
- Kết quả được yêu cầu.

Thay đổi:
- File hoặc hành vi quan trọng đã thay đổi.

Kiểm tra:
- Command, test hoặc manual check và kết quả.

Quyết định:
- Decision ID đã thêm hoặc thay đổi, nếu có.

Blocker:
- Vấn đề thực sự chưa giải quyết; bỏ qua nếu không có.

Tiếp theo:
- Hành động an toàn nhỏ nhất tiếp theo.
```

## Quy tắc ghi tiến trình

- Thêm một bản ghi cho mỗi task đáng kể đã hoàn thành, không ghi từng tool call.
- Không ghi secret, credential, giá trị env, private prompt hoặc hidden reasoning.
- Nêu rõ nếu chưa thực hiện kiểm tra.
- Không đánh dấu hoàn thành khi Acceptance Criteria chưa đạt.
- Nếu agent hoàn tác hoặc thay thế công việc trước, giữ lịch sử và giải thích.
### 2026-08-12 — Triển khai AFF-US-007 Fact Freshness & Dependency Invalidation

Đã triển khai policy freshness tập trung cho price/promotion, assessment verification/evidence/
freshness và generation usability; thêm revision/history revision, optimistic CAS, dependency
register/replace/detach và invalidation audit event cùng transaction. Product Facts có badge
freshness/evidence; Dashboard có warning theo Product và deep-link về tab Facts.

Kiểm tra:

- `pnpm run check-types`: đạt.
- `pnpm --filter web test -- src/features/product-facts/fact-freshness.test.ts src/features/dashboard/dashboard-service.test.ts`: 8/8 đạt.
- `pnpm run test:integration:product-facts`: đạt.
- `pnpm run test:integration:product-fact-freshness`: đạt trên Neon, gồm revision, dependency,
  invalidation, delete và concurrency.
- `pnpm --filter web test:e2e tests/e2e/product-fact-freshness.spec.ts`: 1/1 đạt, 0 failed, 0 skipped.
- Migration `0005_exotic_edwin_jarvis.sql` đã review và apply bằng `DATABASE_URL_DIRECT`.

Trạng thái story: AFF-US-007 đã hoàn tất trong phạm vi đã chốt. Chưa commit/push/merge/deploy.

### 2026-08-12 — Hardening AFF-US-007 Fact Freshness & Dependency Invalidation

Đã xử lý ba blocker cuối:

- Register/replace dependency và update/delete Product Fact cùng khóa hàng Fact bằng `FOR UPDATE`;
  replace khóa nhiều Fact theo thứ tự ổn định. Bổ sung integration race test cho register-vs-update
  và replace-vs-update, kiểm tra không còn active dependency stale sau commit.
- Tách `hasSupportingSource()` khỏi `hasFactEvidence()`: assessment kiểm tra source thực tế cho
  mọi Fact type, gồm source label hoặc URL `http/https` hợp lệ; generation usability chặn evidence
  missing dù `isFactEligibleForAi()` vẫn giữ nguyên rule US006.
- Tách pure `buildDashboardFactWarnings({ records, today, policy })`; runtime mới inject business
  date theo timezone. Unit test cố định ngày `2026-08-12` và `2026-08-10`.

Kiểm tra:

- `pnpm run check-types`: đạt.
- `pnpm --filter web test`: 40/40 đạt.
- `pnpm run test:integration:product-facts`, `dashboard`, `product` và `project-auth`: đều đạt.
- `pnpm run test:integration:product-fact-freshness`: đạt trên Neon, gồm register/replace race,
  revision, invalidation, delete và concurrency.
- `pnpm --filter web test:e2e`: 12/12 đạt, 0 failed, 0 skipped; authenticated flow chạy thật.
- `pnpm run build`: đạt.
- Biome scope 8 file hardening và `git diff --check`: đạt.

Trạng thái hardening: Done trong phạm vi AFF-US-007. Chưa commit/push/merge/deploy.

### 2026-08-13 — Sửa regression TC-026A Project Overview

Đã xác định nút “Tổng quan project” trỏ đúng `/projects/{id}`, nhưng route này tự redirect
về `currentStepKey`, khiến người dùng quay lại `/product`. Route hiện có được đổi thành
Project Overview thật, hiển thị Project, Product liên kết, platform, current step và Content
Brief persisted; không tạo route trùng và không thay đổi logic Product Facts/US007.

Kiểm tra:

- `pnpm check-types`: đạt.
- `pnpm --filter web test`: 40/40 đạt.
- `pnpm test:integration:project-auth`: đạt, cross-workspace read vẫn bị chặn.
- `pnpm --filter web test:e2e`: 12/12 đạt, gồm click overview, refresh và browser Back.
- `pnpm --filter web build`: đạt.
- `git diff --check`: đạt.

Trạng thái regression: đã sửa. Chưa commit/push/merge/deploy.

### 2026-08-14 — Chốt foundation AFF-US-008 Structured Script Generation

Mục tiêu:

- Audit source sau US7 và khóa kiến trúc ScriptGeneration trước implementation DB/API/provider.

Thay đổi:

- Chấp nhận DEC-015: US8 lưu generated artifact read-only, US9 mới tạo ScriptVersion và US10 mới
  làm Fact Lock.
- Thiết kế strict ScriptDraft/partial sections, exact input snapshot, canonical hashing,
  idempotency, một pending request mỗi Project, immutable repair lineage và stale pending
  `indeterminate`.
- Thiết kế Transaction A khóa/snapshot Fact và ghi dependency bằng cùng revision, provider call
  ngoài transaction, Transaction B conditional-finalize; thêm dependent type
  `script_generation` trong migration tương lai.
- Chốt read model `latestRequest + latestUsableArtifact`, database/index/constraint proposal,
  file change map và foundation test plan trong `docs/aff-us-008-foundation.md`.
- Cập nhật product spec, architecture và roadmap để tách rõ US8 khỏi editor/ScriptVersion US9.

Kiểm tra:

- Audit schema/migration 0000–0005, US7 freshness/dependency repository, workspace authorization,
  Project/ContentBrief và transaction convention hiện tại.
- `pnpm check-types`: đạt.
- Chưa tạo hoặc apply migration; chưa thêm provider SDK, API, UI hay ScriptVersion.
- `git diff --check`: đạt.

Quyết định:

- DEC-015 đã chấp nhận. Live provider/model và khả năng provider idempotency/retrieve là blocker
  duy nhất trước phase live adapter, không chặn foundation implementation.

Implementation update:

- Đã triển khai core contract, canonical JSON/SHA-256, migrations `0006`–`0009`, repository/read model, transaction-scoped dependencies và deterministic provider.
- AFF-US-008 hardening đã tách client intent/server config, khóa repair subset + server-side merge,
  tách provider catch khỏi finalize, thêm timeout uncertain/indeterminate, stale guard, partial
  cross-reference validation và DB state-shape CHECK.
- Unit test foundation pass; migration SQL đã được apply thử trên Postgres local cô lập. Shared Neon chưa bị migrate.
- Integration smoke script đã bổ sung concurrency, repair, idempotency, read model và failure cases;
  chưa claim runtime integration pass vì Neon serverless driver không kết nối Docker localhost.
- Chưa triển khai live provider/API/UI/ScriptVersion/Fact Lock.

Tiếp theo:

- Implement domain schemas/policy/hashing và generate/review migration theo file map foundation;
  không gọi live AI cho tới phase provider.

### 2026-08-14 — AFF-US-008 Phase 2A backend/domain

Mục tiêu:

- Đưa input AI production về server-owned settings, mở rộng snapshot/output contract và khóa cost
  preflight trước provider request.

Thay đổi:

- Thêm core schemas cho Channel Settings, AI Settings, Media Metadata và Output Rules.
- Thêm bảng `channel_settings`, `ai_settings`, `media_metadata`, `output_rules` và migration
  `0010_stormy_groot.sql`/`0011_keen_king_bedlam.sql`;
  không apply shared Neon.
- Bump `script-input.v2`, `script-draft.v2`, `script-prompt.v2`; đổi hook thành 3–5
  `hookVariants`, validate unique key và hook claim locator.
- Snapshot v2 lưu Content Brief tách khỏi Project, settings, media, rules và config identity;
  prompt builder tách trusted instructions/output schema/untrusted input data.
- Mở rộng TextProvider với `estimateCost()`, provider registry fail-closed production và protected
  oRPC `estimate`, `generate`, `repair`, `getState`.

Kiểm tra:

- `pnpm check-types`: đạt.
- `pnpm --filter web test`: 51/51 đạt.
- `pnpm db:generate`: đạt, migration `0010` và `0011` đã review SQL; chain local đã apply tới `0011`.
- Integration runtime chưa claim pass vì Neon serverless driver chưa kết nối Docker localhost;
  không dùng test driver mới nếu chưa sạch.

Trạng thái:

- Phase 2A backend/domain ready for review; chưa đánh dấu AFF-US-008 Done. Chưa commit/push/merge/deploy.

### 2026-08-15 — Final hardening AFF-US-008 Phase 2A

Mục tiêu:

- Đưa các invariant còn thiếu của Phase 2A vào router/service/domain và giữ docs khớp implementation.

Thay đổi:

- Tách router preflight error boundary khỏi provider execution; record estimate/finalize persistence
  error được propagate, preflight failure chỉ finalize một lần và provider definite/uncertain giữ
  đúng semantics.
- Repair merge giữ root `schemaVersion`/`language`, chỉ thay requested sections và đối chiếu nội dung
  parent valid sections từ `baseValidSections`.
- Enforce Output Rules language, non-empty exact affiliate disclosure và `avoidWords` ở prompt/domain;
  lọc provider media còn `ready + owned|licensed`.
- Audit BigInt: oRPC standard serializer built-in giữ precision bằng metadata + string transport;
  không đổi DTO/database.

Kiểm tra:

- `pnpm check-types`: đạt.
- `pnpm --filter web test`: 60/60 đạt, gồm hardening unit/service boundary tests.
- Runtime DB integration và live provider smoke chưa chạy trong vòng này; không claim pass vì Neon
  serverless driver hiện không kết nối Docker localhost.
- `pnpm --filter web test:e2e`: 11/12 pass, 1 fail ở test AFF-US-004 browser Back. Trace cho thấy
  browser back đi tới `/projects/{id}/product` rồi route quay lại `/projects/{id}`; đây là regression
  ngoài scope Phase 2A, không thay đổi US1–US7 trong vòng này.
- Chưa tạo migration; chưa commit/push/merge/deploy.

Trạng thái:

- AFF-US-008 Phase 2A backend/domain is ready for acceptance. AFF-US-008 tổng thể chưa Done.

### 2026-08-15 — AFF-US-008 Phase 2B live TextProvider

Mục tiêu:

- Nối provider text thật qua abstraction hiện có mà không phá invariant Phase 2A.

Audit/API contract:

- APIKEY.FUN Docs chính thức xác nhận `POST /v1/messages`, Bearer auth, SSE và
  model `claude-sonnet-4-6` cho Anthropic Messages.
- Docs không công bố structured JSON Schema hoặc pricing/usage-cost contract đủ
  để tự động preflight. Quyết định là prompt JSON + server Zod validation và
  pricing config versioned; không giả cost zero.

Implementation:

- Thêm `ApikeyFunTextProvider` và registry entry `apikeyfun`; map system/developer/user,
  SSE text, usage/request ID khi có, provider/model/finish reason và currency.
- Thêm server env cho default provider/model, API key/base URL, timeout, output budget
  và pricing config. Production thiếu key hoặc pricing fail closed; deterministic không
  fallback implicit.
- Thêm live smoke opt-in `AFFICHANNEL_LIVE_AI_SMOKE=1`; mặc định không gọi API có phí.
- Không đổi Product Facts, freshness, dependency, auth/workspace, Script Studio UI,
  migration hoặc video/TTS.

Kiểm tra trong vòng:

- Adapter tests dùng mock fetch: SSE/structured extraction, malformed JSON, HTTP 400/401/403/404/408/429/5xx,
  timeout/network uncertain, missing/present usage, request ID và cost fail-closed.
- Live smoke chưa bật; không gọi API thật.

### 2026-08-15 — AFF-US-008 Phase 2B SSE/error hardening

Mục tiêu:

- Đóng các gap trước live call mà không mở rộng sang Script Studio hoặc migration.

Thay đổi:

- SSE parser không còn bỏ qua malformed data; nhận `event:error`, JSON error sau HTTP
  200, stream đóng trước completion và phân biệt empty completed stream với provider error.
- HTTP 408/5xx và các relay/network state không chứng minh được delivery chuyển sang
  uncertain/indeterminate; không automatic retry và chỉ detach Fact dependency ở `failed`.
- Prompt builder gửi exact ScriptDraft v2 contract, repair section allow-list và
  trusted/untrusted separation rõ hơn; thêm base invalid section metadata vào repair snapshot.
- Pricing audit ngày 2026-08-15 ghi nhận public APIKEY.FUN pricing metadata cho
  `claude-sonnet-4-6`: USD 3/1M input, USD 15/1M output; runtime vẫn fail-closed nếu
  pricing config thiếu.
- APIKEY.FUN audit không yêu cầu `anthropic-version`, nên adapter không thêm header mù.

Kiểm tra:

- Provider test bổ sung SSE error/malformed/incomplete/empty, JSON error, HTTP 408/500/502/503,
  network/abort uncertain và request ID/usage mapping.
- Live paid smoke chỉ chạy khi `AFFICHANNEL_LIVE_AI_SMOKE=1` và server key/pricing đầy đủ;
  nếu chưa bật thì ghi `LIVE SMOKE PENDING`, không giả PASS.
- `pnpm test:integration:script-generation` chưa chạy qua: configured Neon runtime trả
  `42P01 relation "channel_settings"/"script_generation" does not exist`; cleanup cũng
  không tạo được dữ liệu. Không migrate shared Neon trong task này.
- Authenticated E2E chạy thật `12 passed`; không phát sinh regression từ Phase 2B.

### 2026-08-16 — AFF-US-008 Phase 3 Script Studio UI

- Thay placeholder `/projects/[projectId]/content` bằng Script Studio production UI với
  context read-only, estimate, generate, polling terminal-state, empty/completed/partial/
  failed/indeterminate và repair theo section.
- Giữ invariant `latestRequest` tách khỏi `latestUsableArtifact`: request mới pending/failed/
  indeterminate không che artifact usable cũ. Claims hiển thị `Chưa qua Fact Lock`; không có
  selectedHook, editor, Fact Lock, TTS hoặc Video AI.
- Bổ sung authorized context read model tối thiểu cho Product Facts/freshness/evidence,
  Channel Settings, Content Brief, Product, usable media, Output Rules và AI config; không thêm
  schema hoặc migration.
- Unit/state tests đạt `13 files / 83 tests`; authenticated E2E UI Content dùng mock `getState`
  vì Neon runtime còn thiếu bảng Phase 2A/2B. Không gọi lại live AI smoke.

### 2026-08-17 — AFF-US-008 Phase 3 hardening

- Repair UI chỉ hoạt động khi artifact `partial`, section nằm trong `invalidSections` và
  read model trả `dependencyState.state = current`. Partial artifact đã invalidated vẫn giữ
  content cũ, hiển thị cảnh báo và hướng dẫn tạo generation mới; không gọi repair.
- Estimate/Generate dùng readiness state từ context, indeterminate dùng warning semantics,
  page-load error dùng copy generic không suy đoán authorization.
- Thêm mocked authenticated E2E cho Generate → completed → refresh, Partial → Repair → child
  artifact và invalidated partial không Repair. Full E2E đạt `15 passed`, `0 failed`, `0 skipped`;
  web unit đạt `83 passed`.
- Không migration, không đổi runtime DB debt và không gọi live AI.

### 2026-08-17 — AFF-US-008 Final Runtime Integration

Mục tiêu:

- Chạy migration 0006–0011 trên đúng Neon database hiện tại sau khi audit an toàn.
- Chứng minh runtime production của `getState`, `estimate`, `generate`, persistence, dependency,
  invalidation, idempotency, concurrency và immutable repair.

Kết quả:

- Neon project `shy-bird-50440649`, branch `br-long-flower-azjrci1g`, database `neondb`, schema
  `public` đã apply đủ migration 0000–0011. Không đổi URL, không tạo branch, không reset/drop data.
- Audit migration không phát hiện DROP TABLE/COLUMN, TRUNCATE, DELETE FROM hoặc data rewrite nguy hiểm;
  các DROP CONSTRAINT đều là bước thay constraint mở rộng, không có dữ liệu bị rewrite.
- Deterministic foundation integration pass toàn bộ idempotency, concurrency, failure/indeterminate,
  dependency, invalidation, latest usable và immutable repair scenarios.
- Authenticated runtime E2E không mock RPC: production getState + estimate + deterministic generate,
  DB persistence, exact Fact revision snapshot, dependency registration và reopen đều pass.
- Sau cleanup, các bảng runtime/fixture và settings tạm đều về 0 row.

Kiểm tra:

- `pnpm check-types`: pass, 5/5 package tasks.
- `pnpm --filter web test`: pass, 13 files / 83 tests.
- `pnpm test:integration:script-generation`: pass.
- `pnpm --filter web test:e2e`: pass, 16/16, failed 0, skipped 0.
- `pnpm build`, `pnpm db:generate`, scoped Biome và `git diff --check`: pass.
- `AFFICHANNEL_LIVE_AI_SMOKE=0`: `FULL-PATH LIVE SMOKE SKIPPED`, không tự bật và không gọi live AI.

Trạng thái:

- **AFF-US-008 is ready to be marked DONE.**
- Không triển khai US9/US10; ScriptVersion, Fact Lock, TTS và Video AI vẫn để backlog sau.

### 2026-08-17 — AFF-US-009 Phase 0 Contract Decisions

- Audit DEC-005/014/015, architecture, product spec, roadmap và toàn bộ AFF-US-008; xác nhận
  `ScriptGeneration` là generated artifact immutable và `ScriptVersion` là boundary riêng cho
  human-edited script trước Fact Lock.
- Chốt `script_version.editable_snapshot_json` là canonical source of truth; không tạo segment/scene
  normalized source trong v1.
- Chốt lifecycle draft mutable + saved immutable, một draft/project, Save Version giữ draft hiện tại,
  Restore copy vào draft và không mutate history.
- Chốt full-snapshot autosave với `baseRevision`, `SCRIPT_VERSION_CONFLICT`, không silent overwrite,
  không merge; initialize race phải được bảo vệ bằng DB uniqueness + transaction.
- Chốt source generation pinned, claims dùng field `claims` theo ScriptDraft v2 với
  `claimsSourceRevision`/`claimsStatus`, cùng claim invalidation matrix; downstream tương lai dùng
  `sourceScriptVersionId`/`sourceScriptRevision`.
- Chốt draft validator và strict Fact-Lock readiness validator trong core; không implement Fact Lock,
  audio/TTS, UI, migration hoặc Neon change ở Phase 0.
- Thêm DEC-020 và contract artifact tại `docs/aff-us-009-phase-0-contract-decisions.md`.

Trạng thái: **AFF-US-009 Phase 0 contract is ready for acceptance. Phase 1 may begin.**

### 2026-08-17 — AFF-US-009 Phase 1 ScriptVersion Foundation

- Thêm `script_version` aggregate và migration additive `0012_unusual_prowler.sql`; giữ
  `script_generation` immutable, canonical source là `editable_snapshot_json`, có partial unique
  current draft, saved-number unique, status-shape/revision checks và FK/index cần thiết.
- Thêm core snapshot contract/validator, strict Fact-Lock readiness validator, claims stale matrix
  và server-owned merge semantics; chưa triển khai editor, Fact Lock, TTS/audio hoặc history UI.
- Thêm protected `scriptVersion.initialize`, `getCurrent`, `autosave`; initialize pin completed
  generation chưa invalidated, cùng source idempotent, source khác bị reject, full snapshot autosave
  dùng `baseRevision` và conflict không silent overwrite.
- Neon safety audit pass: project `shy-bird-50440649`, branch `br-long-flower-azjrci1g`, database
  `neondb`, schema `public`; 0012 không có destructive DDL và đã apply thành công; không đổi URL,
  không tạo branch/reset/drop data, fixture integration cleanup về 0 row.
- Runtime integration pass initialize/concurrency/idempotency/getCurrent/autosave/conflict/claims
  stale/immutable/invalidation/authorization; unit 14 files/95 tests, check-types, build,
  db:generate, scoped Biome và diff check pass. Authenticated E2E có một full run 16/16 pass;
  lần rerun cuối lặp lại flaky AFF-US-004 `page.goBack()` (15 pass/1 fail), còn chạy riêng test
  project-create pass. Đây là regression test nền ngoài file US009 và cần harden riêng.

### 2026-08-17 — AFF-US-009 Phase 1 hardening

- Root cause: autosave trước đây validate snapshot client rồi spread toàn bộ snapshot và chỉ khôi phục
  một phần metadata. Client có thể đổi key/reference/claim occurrence đồng thời để tạo canonical snapshot
  cuối không còn nhất quán.
- Đã thêm stable-structure guard cho schema version/language, hook key, voiceover key, scene order và
  voiceover reference, cùng claims list/occurrence. Structural tampering trả
  `INVALID_SCRIPT_VERSION_SNAPSHOT`, không silent normalize.
- Đã đổi sang explicit server-side merge: chỉ nhận selected hook, text, scene editable fields, CTA,
  caption, hashtags và disclosure; claims cùng metadata server-owned được giữ từ snapshot authoritative.
  `validateScriptVersionDraft()` chạy lại trên snapshot sau merge trước CAS update.
- Bổ sung unit/integration regression cho tamper hook/voiceover/scene/claims/language, allowed edits,
  metadata preservation, final validation, conflict/immutability/authorization và claims stale matrix.
- Không tạo/sửa migration, không chạy migration, không đổi Neon hoặc Product Facts/US007/US008 logic.

Kiểm tra:

- `pnpm check-types`: đạt, 5/5 package tasks.
- `pnpm --filter web test`: đạt, 14 files / 111 tests.
- `pnpm test:integration:script-version`: đạt, fixture cleanup trong `finally`.
- `pnpm build`: đạt; `pnpm db:generate`: đạt, không có schema change.
- Full authenticated E2E: 15 pass/1 fail ở regression ngoài scope US005 Product Management.
- Isolated AFF-US-004 `project-create.spec.ts`: vẫn fail tại browser Back, URL giữ
  `/projects/{id}`; không sửa trong US009.
- Scoped Biome và `git diff --check`: đạt.

Trạng thái: **AFF-US-009 Phase 1 ScriptVersion Foundation is ready for final acceptance.**

### 2026-08-17 — AFF-US-009 Phase 2 Script Editor & Autosave UI

- Dùng lại `/projects/[projectId]/content`: draft chưa tồn tại vẫn là Script Studio read-only;
  `Bắt đầu chỉnh sửa` gọi initialize với completed usable generation được pin. Draft hiện tại mở
  Script Editor, không tự rebase hoặc auto-apply generation AI mới.
- Thêm editor cho selected hook, hook/voiceover text, scene duration/visual direction/on-screen
  text, CTA, caption, hashtags và disclosure. Key/order/reference/claims/occurrence giữ read-only;
  không có add/delete/reorder structural control và không gọi paid AI từ editor.
- Thêm local autosave controller full snapshot với debounce chính xác 1000ms, một request in-flight,
  sequencing giữ local edits trong request trước, revision/server metadata update, error retry và
  conflict pause + explicit `Tải bản mới nhất`.
- Hiển thị claims current/stale, Fact Lock readiness read-only và notice generation mới mà không
  thay đổi draft. Không tạo schema/migration hoặc đổi backend Phase 1.
- Bổ sung unit controller tests và authenticated mocked E2E cho initialize/edit/autosave/reload,
  claims stale và newer-generation notice. Tài liệu chi tiết tại
  `docs/aff-us-009-phase-2-editor-autosave.md`.
- Verification: web unit `15 files / 116 tests` pass, ScriptVersion integration pass, focused
  Script Studio E2E `5/5` pass; full authenticated E2E `17 pass / 1 fail` do regression AFF-US-004
  browser Back ngoài scope. Check-types, build, db:generate, Biome và diff check pass.
- Phase 3 history/restore, Fact Lock, TTS/audio và các US sau chưa triển khai.

Trạng thái: **AFF-US-009 Phase 2 Script Editor & Autosave is ready for review.**

### 2026-08-17 — AFF-US-009 Phase 2 final hardening

- Sửa quyền sở hữu state: `useScriptAutosave` chỉ tạo controller mới khi
  `scriptVersionId` đổi; cùng draft ID nhận refetch/revision mới không reset local working
  snapshot. `Tải bản mới nhất` vẫn là hành động duy nhất thay local snapshot.
- Sửa lifecycle navigation: unmount điều hướng nội bộ best-effort flush dirty snapshot; request A
  đang chạy không làm mất edit B, B được gửi tiếp với base revision từ response A. Deferred cleanup
  giữ an toàn cho React Strict Mode và không tạo duplicate request.
- Bổ sung 3 unit regression và 2 authenticated mocked E2E: same-ID background refetch, clean/dirty
  navigation flush và in-flight A → B.

Kiểm tra focused hardening:

- Autosave unit: 7/7 đạt.
- Script Studio E2E: 7/7 đạt, gồm refetch ownership và navigation flush.
- Không tạo migration, không đổi schema/backend semantics, không chạm Product Facts/US007 hoặc
  AI provider.

Trạng thái: **AFF-US-009 Phase 2 Script Editor & Autosave is ready for final acceptance.**

### 2026-08-17 — AFF-US-010 Phase 0 Contract Hardening

- Audit DEC-005/014/015/020, Product Spec, Architecture, Roadmap, ScriptVersion,
  Product Fact dependency và ScriptGeneration hashing; xác nhận có thể reuse
  `fact_dependency` cho `fact_lock/voice/render`, transaction helpers và canonical
  SHA-256 convention của US8.
- Tách `validateScriptVersionForFactLockRun()` cho pre-run (`claimsStatus=current|stale`)
  khỏi strict `validateScriptVersionForFactLock()` (`current` bắt buộc). Cả hai giữ
  structural validation và selected hook/reference invariant.
- Khóa Fact Lock contract: bốn immutable classifications, review transitions,
  persisted/effective status với `stale` dẫn xuất, ba revision semantics, input/hash/
  idempotency, semantic mapping/occurrence, server authority cho `PROHIBITED`, CAS
  resolution và server-side gate reason codes.
- Thêm DEC-021 và tài liệu source of truth tại
  `docs/aff-us-010-phase-0-contract-hardening.md`; cập nhật Product Spec, Architecture
  và Roadmap để không coi `STALE` là claim classification.
- Không tạo schema/migration, không đổi Neon, không provider/runtime DB/UI và không bắt
  đầu Phase 1.

Kiểm tra Phase 0: thêm unit regression cho stale pre-run validator và giữ strict
validator chặn stale.

Trạng thái: **AFF-US-010 Phase 0 Contract Hardening is ready for acceptance.**

### 2026-08-17 — AFF-US-010 Phase 1 Foundation & Classification

- Audit migration state trên `DATABASE_URL_DIRECT`: Neon database/schema/ledger khớp
  repo ở 0012; migration 0013 chỉ additive và đã apply thành công.
- Thêm `fact_lock_run`, `fact_lock_claim`, `fact_lock_claim_fact`, API protected
  `factLock.run/getState`, deterministic provider path, exact snapshot/hash/dependency
  semantics và server-side classification/policy validation.
- Bổ sung integration proof cho idempotency, pending uniqueness, failed/indeterminate,
  latest applicable, Fact revision invalidation, Script revision race, reopen và
  workspace scoping; không seed dữ liệu production ngoài fixture tạm có cleanup.
- Phase 2 review UI, manual transitions, Voice/Render gate và TTS/audio vẫn chưa bắt đầu.

Trạng thái: **AFF-US-010 Phase 1 Foundation & Classification is ready for acceptance.**

### 2026-08-18 — AFF-US-010 Phase 2 Fact Lock Review & Resolution

- Thêm `/projects/[projectId]/fact-lock` với three-pane Review responsive: claims,
  review detail và Product Facts evidence theo exact `factId + factRevision` snapshot.
- Thêm protected business actions `manualApprove`, `editClaimSource`,
  `deleteClaimSource` và `applySuggestion`. Manual approve giữ classification
  `NEEDS_REVIEW`, ghi reviewer/time/note và atomically chuyển run sang `passed` khi đủ
  claim resolved. Source mutation dùng exact occurrence locator, CAS revision, không
  mutate Fact Lock audit và làm run cũ effective stale.
- Không tạo migration/schema change, không đụng Product Facts/US007, không triển khai
  FactLockGate, Voice/Render, TTS hoặc US sau.
- Bổ sung core resolution helper, UI state tests, Fact Lock integration proof và
  authenticated E2E fixture cho load/approve/refresh/reopen; mọi fixture có cleanup.

Kiểm tra Phase 2:

- `pnpm check-types`: đạt, 5/5 package tasks.
- `pnpm --filter web test`: đạt, 17 files / 131 tests.
- `pnpm test:integration:fact-lock`: đạt, gồm resolution proof.
- Authenticated focused E2E `fact-lock-review.spec.ts`: 2/2 pass, 0 skipped, 0 failed;
  gồm unsafe whole-field delete error UX và browser console error check pass.
- Full authenticated E2E rerun: 23/23 pass, 0 skipped, 0 failed; gồm test AFF-US-010
  load/approve/refresh/reopen và unsafe whole-field delete. Một số log `ECONNRESET`/Drawer warning hiện hữu ở các
  suite Script Editor nhưng không làm test fail và không nằm trong route Phase 2.
- `pnpm --filter web build`: đạt, route `/projects/[projectId]/fact-lock` được build
  dynamic thành công.
- `pnpm db:generate`: đạt, `No schema changes, nothing to migrate`.
- Scoped Biome và `git diff --check`: đạt; test artifacts đã restore về baseline.

Trạng thái: **AFF-US-010 Phase 2 Review & Resolution is ready for acceptance.**

### 2026-08-18 — AFF-US-010 Phase 2 safe-delete hardening

- Audit delete path xác nhận editable snapshot schema cho phép intermediate empty text ở
  required fields; đây chưa đủ để đảm bảo ScriptVersion sẵn sàng chạy Fact Lock.
- Thêm `validateScriptVersionForFactLockRun()` sau editable schema validation và trước CAS,
  chỉ áp dụng cho action `delete`. Whole selected hook/voiceover/CTA/caption invalid bị trả
  `FACT_LOCK_CLAIM_DELETE_REQUIRES_EDIT`; không update ScriptVersion, không tăng revision,
  không mutate FactLockClaim/run. Optional `scene.onScreenText` delete vẫn thành công và
  làm run cũ effective stale.
- Bổ sung core unit, Fact Lock integration và authenticated E2E cho required whole-field
  rejection, optional scene delete, DB immutability/rollback và actionable UI error.
- Không tạo schema/migration 0015, không đổi Neon, không bật paid AI và không bắt đầu Phase 3.

Trạng thái: **AFF-US-010 Phase 2 Review & Resolution is ready for final acceptance.**

### 2026-08-18 — AFF-US-010 Phase 3 Fact Lock Gate & downstream runtime

- Thêm pure `evaluateFactLockGate()` và server application service
  `FactLockGate.evaluate/assertPassed()`; gate tự resolve workspace/project/current
  ScriptVersion, strict readiness, Fact Lock run, dependency state và Product Fact
  revision/status. Client không được quyết định unlock.
- Thêm protected `factLock.getGate`. Voice, Video và Preview/Render direct route
  dùng cùng gate server-side để hiển thị locked/unlocked state; chưa có TTS/render
  mutation nên không tạo dependency giả hoặc provider mới.
- Bao phủ reason code, stale script/facts precedence, failed/indeterminate retry
  không che PASS cũ, workspace isolation và Product Fact revision invalidation.
- Không tạo schema/migration 0015, không sửa Product Facts/US007, không gọi paid AI.

Verification Phase 3:

- `pnpm check-types`: đạt, 5/5 package tasks.
- `pnpm --filter web test`: đạt, 18 files / 137 tests.
- `pnpm test:integration:fact-lock`: đạt, gồm `FactLockGate.evaluate/assertPassed`,
  PASS retry semantics và `STALE_FACTS`.
- Authenticated Playwright gate E2E: 1/1 pass; AFF-US-010 regression suite 3/3
  pass, 0 skipped, 0 failed. Browser plugin không khả dụng nên dùng Playwright CLI.
- Không migration; `db:generate`/build/Biome/diff check thực hiện ở final verification.

Trạng thái: **AFF-US-010 Phase 3 Gate & Runtime is ready for final acceptance.**

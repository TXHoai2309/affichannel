# Lộ trình triển khai AffiChannel

- Trạng thái: Đã chấp nhận ở cấp tài liệu; execution theo acceptance gate
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-24

## CURRENT EXECUTION ORDER — CANONICAL v0.8

Đây là thứ tự duy nhất dùng để chọn công việc mới. Implementation/acceptance của
`AFF-US-001–012` được giữ nguyên làm historical/golden baseline. Các định nghĩa
pre-v0.8 của `AFF-US-013–030` chỉ là backlog chưa triển khai và đã bị supersede;
**không tiếp tục triển khai theo scope cũ**.

1. Freeze US12 baseline.
2. Domain Evolution.
3. ClaimManifest / Fact Lock evolution.
4. Quick Image.
5. Channel-first UI.
6. Library / Calendar.
7. Analytics.
8. AI Visual.

Current pointer: US12 baseline frozen/completed; AFF-US-013 M1 và AFF-US-016
M2A/M2B/M2C/M3A/M3B đã accepted, migration `0017` và legacy reconciliation đã
hoàn tất. AFF-US-014 M4 repository audit/acceptance contract đã khóa qua DEC-028;
runtime Resolver/shadow comparison chưa triển khai và chưa authority cutover.

Chi tiết dependency và acceptance của thứ tự này nằm tại “Chuỗi kích hoạt
canonical v0.8” trong tài liệu này, `docs/domain-evolution-plan.md` và
`docs/domain-evolution-acceptance.md`.

## CANONICAL v0.8 BACKLOG — AFF-US-013–030

Theo DEC-027:

> Pre-v0.8 definitions of AFF-US-013–030 are superseded before implementation.
> Their IDs are retained and reassigned to the v0.8 Channel-First backlog. No
> completed implementation history is overwritten.

| ID | Canonical User Story v0.8 |
|---|---|
| `AFF-US-013` | Là người dùng, tôi muốn tạo Project Organic hoặc Affiliate với CreationPath và ContentFormat phù hợp để có thể bắt đầu xây kênh mà không bị bắt buộc phải chọn Product cho mọi nội dung. |
| `AFF-US-014` | Là người dùng, tôi muốn hệ thống tự xác định Product, Script, Fact Lock, Voice và các bước khác là bắt buộc, tùy chọn, không áp dụng hay đang bị chặn để workflow phù hợp với từng loại nội dung. |
| `AFF-US-015` | Là người dùng, tôi muốn giao diện workflow tự thích ứng theo kết quả Applicability Resolver và phân biệt rõ bước cần làm, không cần làm và đang bị chặn để không phải đi qua các bước không liên quan. |
| `AFF-US-016` | Là người dùng hiện tại, tôi muốn các Project Affiliate đã tạo trước canonical v0.8 tiếp tục hoạt động đúng sau khi hệ thống chuyển sang kiến trúc Channel-First để không mất dữ liệu hoặc phá workflow cũ. |
| `AFF-US-017` | Là người dùng, tôi muốn các claim cần kiểm chứng được hệ thống tạo và lưu thành ClaimManifest bất biến để việc kiểm tra nội dung không còn phụ thuộc bắt buộc vào việc Project có ScriptVersion hay không. |
| `AFF-US-018` | Là người dùng, tôi muốn Fact Lock kiểm tra claim từ ClaimManifest và liên kết chính xác với Product Facts khi applicable để cả nội dung có Script và không có Script đều được kiểm chứng nhất quán. |
| `AFF-US-019` | Là người dùng, tôi muốn tạo nội dung Organic có Script mà không cần chọn Product để có thể làm video kiến thức, kể chuyện, chia sẻ, giải trí hoặc nội dung xây kênh trước khi triển khai Affiliate. |
| `AFF-US-020` | Là người dùng, tôi muốn lưu và quản lý ảnh, video và audio trong một Media Library dùng chung để có thể tái sử dụng tài nguyên giữa Organic, Affiliate và các CreationPath khác nhau. |
| `AFF-US-021` | Là người dùng, tôi muốn tạo một video dọc ngắn từ một ảnh bằng chuyển động local deterministic đơn giản để có thể sản xuất nhanh các video bình thường, nhẹ nhàng và tiết kiệm chi phí để xây kênh. |
| `AFF-US-022` | Là người dùng, tôi muốn tùy chỉnh thời lượng, zoom, pan, crop, text và audio cho video tạo từ ảnh để có thể tạo nhiều biến thể nội dung từ cùng một tài nguyên. |
| `AFF-US-023` | Là người dùng, tôi muốn hoàn thiện cả Organic và Affiliate video trong một Video Studio thống nhất theo các vùng Content, Resources, Compose và Export để không phải sử dụng các workflow dựng video riêng biệt. |
| `AFF-US-024` | Là người dùng, tôi muốn theo dõi toàn bộ Organic và Affiliate Content theo ContentType, CreationPath, ContentFormat và trạng thái sản xuất để quản lý lịch sử nội dung trong cùng một thư viện. |
| `AFF-US-025` | Là người dùng, tôi muốn thiết lập chiến lược kênh gồm niche, audience, content pillars, series, phong cách và các kiểu nội dung ưu tiên để AffiChannel có định hướng nhất quán khi hỗ trợ tôi xây kênh từ đầu. |
| `AFF-US-026` | Là người dùng, tôi muốn lập kế hoạch nội dung 7/30 ngày dựa trên Channel Strategy, Pillars, Series và tỷ lệ Organic/Affiliate để duy trì lịch đăng đều và không biến kênh thành kênh chỉ đăng sản phẩm. |
| `AFF-US-027` | Là người dùng, tôi muốn phân tích cả hiệu quả xây kênh và hiệu quả Affiliate theo ContentType, Pillar, Series, ContentFormat và Product để biết nội dung nào nên tiếp tục, điều chỉnh hoặc dùng để kiếm tiền. |
| `AFF-US-028` | Là người dùng, tôi muốn có thể dùng provider AI để tạo hoặc làm chuyển động visual từ ảnh khi cần để tạo video sinh động hơn các chuyển động local deterministic. |
| `AFF-US-029` | Là người dùng nội bộ, tôi muốn các provider AI, model, giới hạn chi phí và chính sách sử dụng được quản lý tập trung để có thể sử dụng AI mà không phát sinh chi phí ngoài dự kiến. |
| `AFF-US-030` | Là người dùng nội bộ, tôi muốn theo dõi request AI, usage, lỗi, retry và các trạng thái không xác định để có thể phát hiện sự cố, phục hồi an toàn và tránh tạo trùng các tác vụ có tính phí. |

Ranh giới tránh overlap:

- `AFF-US-013` khóa capability/domain contract của Project và conditional Product;
  `AFF-US-016` giữ compatibility cho legacy Affiliate trong rollout.
- `AFF-US-014` là server-authoritative Applicability Resolver;
  `AFF-US-015` là adaptive workflow presentation/navigation dùng resolver đó.
- `AFF-US-017` sở hữu ClaimManifest foundation; `AFF-US-018` chuyển Fact Lock sang
  Manifest-first mà không nhập hai lifecycle thành một.
- Shared composition pipeline là technical enabler của Video Studio/Quick Image,
  không phải ContentFormat hoặc một User Story thay thế.
- `AFF-US-029` sở hữu provider governance/cost guardrails; `AFF-US-030` sở hữu
  operational monitoring/recovery. Mọi story gọi paid provider phải đạt safety
  acceptance liên quan trước khi bật provider.

AFF-US-014/M4 dùng contract tại
`docs/aff-us-014-m4-applicability-resolver-shadow.md`. M4 chỉ compute/compare
shadow trên golden Affiliate identity; legacy gates vẫn authority, Resolver không
mutate `currentStepKey`, UI chưa chuyển sang adaptive workflow và current
Video/Render placeholder phải được biểu diễn
`BLOCKED + RENDER_FEATURE_NOT_IMPLEMENTED` khi upstream ready.

## 1. Phương pháp triển khai

Làm theo vertical slice. Mỗi slice gồm database, domain logic, API, UI, các trạng
thái và test tối thiểu để demo một kết quả cho người dùng.

Không làm toàn bộ UI trước hoặc toàn bộ backend trước. Không triển khai backlog
spreadsheet cứng nhắc theo thứ tự từng dòng.

Giới hạn công việc đang làm:

- một User Story đang thực hiện;
- một luồng chính có thể demo;
- một người chịu trách nhiệm cho mỗi quyết định chưa xử lý.

## 2. Điều kiện bắt đầu một slice

Slice chỉ bắt đầu khi có:

- kết quả người dùng;
- Acceptance Criteria rõ ràng;
- dependency đã xác định;
- phạm vi bao gồm và không bao gồm;
- tác động dự kiến lên schema/API;
- cách kiểm thử;
- không còn quyết định chưa xử lý có thể làm thay đổi lớn implementation.

## Pre-v0.8 implementation baseline và backlog context

> `AFF-US-001–012` là historical implemented/golden baseline và được giữ để
> regression. Mọi definition pre-v0.8 của `AFF-US-013–030` trong phần planning cũ
> là unimplemented backlog đã superseded theo DEC-027, không phải completion evidence.

Kết quả: có cơ sở triển khai được thống nhất trước feature code.

- Đặc tả sản phẩm chuẩn.
- Ranh giới kiến trúc và bảo mật.
- Hệ thống thiết kế và quy tắc trạng thái UI.
- Quy tắc vận hành AI agent.
- Quy trình changelog và progress tracking.
- Type-check baseline đạt.
- Việc áp dụng Neon schema phải do chủ dự án chủ động quyết định.

Điều kiện hoàn thành:

- Link tài liệu hợp lệ.
- `pnpm run check-types` đạt.
- Chủ dự án duyệt hoặc sửa phạm vi MVP 0.

## Historical — Slice 1: Authentication

Backlog liên quan: `AFF-US-001`.

```text
Bootstrap tài khoản cố định → đăng nhập → mở Dashboard được bảo vệ → refresh → đăng xuất
```

Acceptance Criteria:

- Tài khoản cố định được bootstrap ngoài luồng public và đăng nhập email/mật khẩu hoạt động.
- Session hợp lệ tồn tại sau refresh.
- Người chưa đăng nhập bị chuyển khỏi protected page.
- Protected procedure từ chối unauthenticated request.
- Trạng thái error, loading và sai thông tin đăng nhập dễ hiểu.
- Public signup bị vô hiệu hóa ở server và không có UI `/register`.

Không bao gồm social login, organization/role và account administration UI.

## Historical — Slice 2: App Shell và Navigation

Backlog liên quan: `AFF-US-002`.

```text
Đăng nhập → protected app shell → mở project demo → chuyển 7 bước → back/forward/refresh
```

Acceptance Criteria:

- App dùng chung sidebar và topbar dạng panel trong protected layout.
- Sidebar có Dashboard, Dự án, Sản phẩm, Media Library, Analytics, Chi phí & Usage
  và Cài đặt.
- Topbar có title ngắn theo route, notification entry point và profile; không lặp mô tả
  dài hoặc breadcrumb ở đầu trang.
- ProjectStepper có 7 bước và 5 trạng thái hiển thị bằng chữ/icon, không chỉ bằng màu.
- Direct URL, browser back/forward và refresh giữ đúng shell, route và active step.
- Route chưa có business logic hiển thị skeleton/placeholder rõ ràng.

US002 không tạo Project CRUD, business schema hoặc persistence StepStatus. Slice
này chỉ định nghĩa `ProjectStepKey`, `ProjectStepStatus` và persistence contract
để US004 triển khai lưu trạng thái theo project. Từ US004, workflow current được
lưu tại `Project.currentStepKey`; URL chỉ xác định bước đang được xem, còn
`Project/ContentBrief/StepStatus` là persistence domain thực.

## Historical — Slice 3: Product

Backlog liên quan: `AFF-US-005`.

```text
Mở Products → tạo product → sửa product → archive product
```

- Dữ liệu Product tồn tại trong Neon.
- Mọi thao tác đều kiểm tra ownership.
- List/detail có loading, empty, error và unauthorized.
- Product có dependency được archive thay vì xóa cứng.

Trạng thái AFF-US-005 (2026-08-11): đã triển khai vertical slice Product Library. Đã có
schema/migration, domain validation, workspace-scoped API, search/filter, create/update/detail,
archive/restore/delete và UI states. Invariant MVP: Product mới chỉ được chọn khi `status=active`
và `archivedAt IS NULL`; archive không tháo liên kết Project; hard delete chỉ khi reference count bằng 0.

Cập nhật hoàn thiện (2026-08-12): Product Library dùng cursor pagination với load-more/retry,
Product Detail không hiển thị copy implementation, và URL validation dùng parser cùng allow-list
protocol. Story đã đủ điều kiện chuyển sang AFF-US-006 Product Facts.

## Historical — Slice 4: Product Facts

Backlog liên quan: `AFF-US-006`.

```text
Mở product → mở tab Facts → thêm draft/verified Fact → lọc/tìm kiếm → sửa/xóa Fact
```

AFF-US-006 đã triển khai schema `ProductFact`/`ProductFactHistory`, workspace-scoped CRUD,
search/filter/cursor pagination, verification evidence, AI eligibility, history transaction
và Product delete guard. Product Detail dùng URL tab làm source of truth; archive Product
không làm mất Facts. `priceAmount` của Product không đồng bộ với Fact giá.

Không thuộc slice này: freshness automation, stale/expired status, scheduler, invalidation,
scraping/fetching, provider AI, Fact Lock và restore/diff UI. Các phần này chỉ bắt đầu khi
story tương ứng có contract riêng.

## Historical — Slice 5: Project và Content Brief

Backlog liên quan: `AFF-US-004`.

```text
Tạo project → chọn product → khai báo brief → lưu → mở lại
```

- Project scope và ownership được lưu.
- Required field của brief được validate.
- Project mở lại với workflow state hiện tại.
- Dashboard ban đầu có thể hiển thị recent projects.

Trạng thái AFF-US-004 (2026-08-11): đã triển khai vertical slice tạo/list/mở lại
project. Để không chặn flow, slice có Product prerequisite tối thiểu (chọn hoặc tạo
product trong form); Product management đầy đủ vẫn thuộc AFF-US-005. Tên project được
phép trùng trong workspace. `currentStepKey` là workflow source of truth; các dòng
`project_step_status` chỉ lưu `not_started`, `completed`, `needs_review` hoặc `blocked`.

Trạng thái AFF-US-003 (2026-08-11): đã triển khai Dashboard read model từ Project thật.
Dashboard dùng protected aggregate query, không thêm bảng riêng, hiển thị 4 summary card,
recent projects giới hạn 5, activity derive từ created/updated timestamps, warnings/cost/job
placeholder trung thực và mở project theo current step. Authenticated E2E đã đạt 8/8, gồm
flow tạo project → Dashboard → mở Recent Project → current step → ProjectStepper.

## Historical — Slice 6: Structured Script

Backlog liên quan: `AFF-US-008` và `AFF-US-009`.

```text
US8: Mở project → tạo persisted structured generation → reload/repair phần lỗi
US9: Chọn/chỉnh artifact → lưu immutable ScriptVersion
```

AFF-US-008 triển khai theo thứ tự schema/refinement → deterministic provider → persisted
`ScriptGeneration` → idempotency/dependency → generate/repair/read model → Script Studio read-only
→ live adapter cuối cùng. Generation có hook, voice segment, scene, CTA, caption, hashtag,
disclosure và candidate claim riêng; completed/partial artifact được lưu và provider failure không
che artifact usable trước đó.

AFF-US-009 đã hoàn thành editor, autosave, selection, immutable `ScriptVersion`, history và
restore theo Phase 0/1/2/3; saved history vẫn read-only và Restore dùng optimistic concurrency.
US8 không tự advance workflow hoặc tạo Fact Lock. Contract foundation được chốt tại DEC-015 và
`docs/aff-us-008-foundation.md`.

AFF-US-008 Phase 2B nối live TextProvider qua registry với APIKEY.FUN +
`claude-sonnet-4-6` là default cấu hình. Adapter dùng Anthropic Messages/SSE,
server-side pricing preflight và fail-closed error/timeout mapping. Script Studio,
ScriptVersion, Fact Lock, TTS, video và authenticated/live acceptance vẫn là các
phần sau phase này; video default được giữ ở APIKEY.FUN + Grok 720p theo adapter,
không triển khai trong Phase 2B.

## Historical — Slice 7: Fact Lock

Backlog dự kiến: `AFF-US-010`; phải sửa khoảng trống ID hiện có trước triển khai.

AFF-US-010 Phase 0 contract hardening (2026-08-17) đã khóa validator split,
claim classification/review state, persisted/effective run status, revision và
dependency semantics, input/hash/idempotency contract, deterministic
`PROHIBITED` authority, resolution CAS và gate reason codes. Phase 1 mới tạo
schema/runtime. Phase 1 foundation/classification đã apply additive migration,
đưa protected run/getState và deterministic runtime proof vào source; Phase 2
review UI/manual transition và Phase 3 gate/runtime đã hoàn tất. Phase 2–3
không tạo migration mới: dùng read model Fact Lock hiện có, Product Fact snapshot
theo mapping revision và ScriptVersion CAS.

AFF-US-010 Phase 2 (2026-08-18) đã thêm `/projects/[projectId]/fact-lock` với
three-pane Review: claim list, review detail và Product Facts evidence. Manual
approve giữ nguyên classification `NEEDS_REVIEW`, ghi reviewer/time/note và chỉ
chuyển run sang `passed` khi mọi claim resolved. Edit/delete/apply suggestion là
business mutations transactional, exact occurrence + optimistic `baseRevision`,
không mutate claim audit và làm run cũ effective `stale`.

Phase 2 hardening bổ sung strict pre-run validation trước CAS cho safe delete: whole-field
delete của selected hook, voiceover, CTA hoặc caption bắt buộc bị từ chối; optional
`scene.onScreenText` vẫn có thể chuyển thành `null`. Không tạo migration 0015.

Phase 3 thêm `FactLockGate.evaluate/assertPassed` server-side, protected
`factLock.getGate` và locked state cho Voice, Video, Preview/Render. Gate resolve
current ScriptVersion, strict readiness, exact script revision, active/current Fact
dependencies và Product Fact status từ workspace actor; stale script được ưu tiên
trước stale facts. Retry failed/indeterminate không che PASS cũ còn applicable. Vì
chưa có TTS/render mutation nên không tạo dependency giả; mutation downstream sau này
phải gọi `FactLockGate.assertPassed()` trong application service.

```text
Chạy kiểm tra → xem claim → liên kết bằng chứng → xử lý review → pass hoặc blocked
```

Acceptance Criteria tuân theo `product-spec.md`. TTS và Render bị khóa nếu
version hiện tại chưa có run đạt. Chi tiết Phase 3 tại
`docs/aff-us-010-phase-3-gate-runtime.md`.

## Historical implemented — Slice 8: Voice

Implementation history trong slice này chỉ thuộc `AFF-US-011–012`. Các definition
pre-v0.8 từng dự kiến cho `AFF-US-013–014` chưa được triển khai và đã superseded
trước implementation theo DEC-027.

AFF-US-011 Phase 0 — Contract & Architecture Freeze đã được chấp nhận ngày
2026-08-19. Capability probe xác nhận APIKEY.FUN relay được Grok/xAI TTS qua
`POST /v1/tts` bằng TTS key riêng; tiếng Việt dùng `vi`, speed dùng range
`0.7..1.5`, default `1.0`. Relay không expose `/v1/tts/voices`, nên catalog
voice là server-owned verified catalog. Chi tiết contract tại
`docs/aff-us-011-phase-0-contract-decisions.md` và DEC-023.

Trạng thái AFF-US-011:

Phase 0 — Contract & Architecture ✅
Phase 1 — Voice Foundation ✅
Phase 2 — TTS Preview Runtime ✅
Phase 3 — Voice Studio Configuration & Preview ✅

Phase 1 đã tạo migration additive `0015`, server-owned catalog, protected
`voice.listPresets/getConfig/saveConfig`, validation, CAS và workspace isolation.
`voice.getConfig/saveConfig` vẫn gọi `FactLockGate.assertPassed(actor, projectId)`
ở server. Phase 1 không gọi paid TTS, không tạo UI hoặc audio artifact. Phase 2
đã nối server-derived preview text, real provider adapter boundary, protected
binary endpoint, timeout/MIME/size/error mapping và deterministic integration
proof; không persist audio. Phase 3 đã thêm Voice Studio client, dirty/CAS
conflict UX, server-catalog preset/language/speed controls, protected binary
preview, Blob URL cleanup, loading/error states và authenticated E2E qua nhiều
preset với relock/reopen sau Fact Lock rerun. Full voiceover vẫn chưa thuộc
phạm vi đã hoàn thành.
Chi tiết tại `docs/aff-us-011-phase-1-foundation.md` và
`docs/aff-us-011-phase-2-tts-preview-runtime.md` và
`docs/aff-us-011-phase-3-voice-studio.md`.

### AFF-US-012 — Segment Voiceover Generation

Phase 0 — Contract & Architecture Lock đã được chấp nhận ngày 2026-08-21.
Phase 1 — Foundation đã triển khai schema `voice_segment_artifact`, migration
`0016`, fingerprint/read model, local/R2 storage foundation, checksum và
server-side MP3 duration. Contract khóa `VoiceSegmentArtifact` theo full
ScriptVersion/VoiceConfig fingerprint, immutable generation history, idempotency
và pending concurrency, server-authoritative MP3 duration, local/private-R2
storage, protected stream, failure taxonomy, race semantics và current/stale
read model. Workflow tiếp tục dùng `project.currentStepKey` và
`project_step_status` hiện có; không tạo status source of truth mới.

Phase 1 không gọi paid TTS/R2 thật và chưa tạo provider generation API, UI,
protected stream hoặc workflow mutation. Chi tiết tại
`docs/aff-us-012-phase-0-contract-decisions.md`,
`docs/aff-us-012-phase-1-foundation.md` và DEC-024.

Phase 2 đã triển khai segment generation runtime/API/provider, server-authoritative
input và MP3 duration, idempotency/coalescing với DB race handling, local/private-R2
storage registry, protected state/audio endpoints và failure/cleanup semantics.
Không tạo migration `0017`, không gọi live APIKEY.FUN hoặc R2 trong test. Phase 2
đã được chấp nhận. Phase 3 đã triển khai UI/player/waveform và Phase 4 đã hoàn tất
workflow readiness, tổng duration, Video gate, storage-provider read resolution,
waveform cache hardening và acceptance E2E. AFF-US-012 đã hoàn thành.

Các phase dự kiến:

```text
Phase 1 — schema/repository/storage/duration foundation
Phase 2 — segment generation API/provider/protected stream ✅
Phase 3 — segment list/player/basic waveform ✅
Phase 4 — duration/workflow hardening và acceptance E2E ✅
```

Phase 3 giữ nguyên VoiceConfig/gate của US11, dùng server read model cho từng
segment, generate/regenerate với idempotency key mới, protected audio endpoint,
server duration và waveform derived cache memory. Không mutate workflow completion,
không tạo migration mới và không gọi paid TTS/R2 trong test. Chi tiết tại
`docs/aff-us-012-phase-3-ui.md`.

Phase 4 dùng evaluator server-side làm nguồn readiness duy nhất, cộng duration
chỉ từ current usable artifact, reconcile `project_step_status` sau mutation và
chuyển `currentStepKey` từ Voice sang Video khi đủ điều kiện. Video bị khóa nếu
Fact Lock hoặc Voice chưa đạt; thay đổi script/config không rollback current step
nhưng làm gate và persisted status phản ánh trạng thái cần xem lại. Chi tiết tại
`docs/aff-us-012-phase-4-final-acceptance.md`.

- Test TTS tiếng Việt và segment voice cache thuộc acceptance đã hoàn thành của
  `AFF-US-011–012`.
- Upload/validate media và gắn media vào scene trong definition cũ của
  `AFF-US-013–014` chưa được triển khai; scope mới nằm trong canonical backlog ở
  đầu tài liệu.

## Superseded before implementation — pre-v0.8 Slice 9: Preview và render

Các definition pre-v0.8 từng gắn với `AFF-US-015–020` chỉ là backlog chưa triển
khai và đã superseded theo DEC-027. Các bullet dưới đây được giữ như planning
context cũ, không phải completed scope hoặc current acceptance source:

- Scene editor tuần tự cố định.
- Overlay, subtitle, CTA và audio preset cơ bản.
- Một Remotion composition dùng chung cho preview/render.
- Local worker riêng và persistent render job.
- MP4 retry được và có render version history.

Slice cũ chưa đạt end-to-end và không còn là current execution scope.

## Chuỗi kích hoạt canonical v0.8 — chi tiết

Implementation/acceptance của `AFF-US-001–012` ở các slice trên là golden
affiliate baseline. Definitions pre-v0.8 của `AFF-US-013–030` là unimplemented
backlog đã superseded; numbering được tái gán theo DEC-027 mà không rewrite
implementation history. Công việc mới đi theo thứ tự phụ thuộc:

### 1. Freeze baseline AFF-US-012

- Trạng thái: hoàn tất/frozen tại migration `0016_gifted_microbe.sql`.
- Giữ acceptance evidence Phase 4 và regression golden affiliate flow.
- Không thay đổi schema/contract khi baseline chưa xanh.

### 2. Domain Evolution

- Additive migration cho `content_type`, `creation_path`,
  `content_format_key`, `content_format_version`; backfill project cũ thành
  `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1` theo DEC-026.
- Cho `productId` nullable ở DB, giữ service invariants cho Affiliate/Product claim.
- Thêm Applicability Resolver dùng chung cho UI/API/worker và transactional
  `nextApplicableStep`; không sửa enum persisted step status.
- Thêm ScriptGeneration input source mode
  `PRODUCT_BACKED | ORGANIC_NO_PRODUCT`; không thay persisted operation mode
  `full | repair` hiện hữu.

### 3. ClaimManifest và Fact Lock Manifest-first

- Tạo immutable server-built ClaimManifest từ mọi output-bearing source.
- Mở rộng FactLockRun new writes bằng Manifest ID/fingerprint; giữ read adapter cho
  Script-linked legacy rows.
- Áp dụng conditional gate: Affiliate và Organic Product claim cần Fact Lock;
  Organic claimless là `NOT_REQUIRED`, kể cả khi opt-in Voice.

### 4. Quick Image vertical slice

- Hoàn thiện `ORGANIC + QUICK_IMAGE` không Product/Script/Fact Lock.
- Một ảnh 9:16, motion local deterministic, text/music/voice tùy chọn.
- Shared composition/preview/render, immutable variation và retry không overwrite.

### 5. Channel-first UI

- Một Channel Strategy/workspace và defaults tái sử dụng.
- Video Studio có bốn tab Content → Resources → Compose → Export; bảy persisted
  project steps vẫn là workflow storage.
- UI hiển thị rõ `NOT_REQUIRED`, `OPTIONAL`, `BLOCKED`, `STALE` và lý do.

### 6. Library và Calendar

- Content Library theo lifecycle tách biệt khỏi production readiness.
- Calendar/lịch bảy ngày và publication record.

### 7. Analytics

- Import metrics CSV/XLSX, analytics mô tả và hiệu quả chi phí.

### 8. Post-MVP AI Visual

- Bật một Video AI provider qua adapter/feature flag sau khi Quick Image ổn định.
- Giữ cost confirmation, retry hữu hạn, immutable outputs và manual publishing.

Mỗi phase phải đạt `docs/domain-evolution-acceptance.md` và giữ regression của
golden affiliate flow trước khi bắt đầu phase kế tiếp.

## 14. Backlog trì hoãn

- Routing fallback nhiều provider.
- Premium Video AI adapter.
- Auto-post.
- Recommendation engine.
- Mobile editing nâng cao.
- Quản trị team/workspace.
- `HYBRID` Content Type và nhiều channel/workspace.

## 15. Definition of Done của một slice

- Acceptance Criteria đã demo đạt.
- Domain invariant được thực thi ở server.
- Authorization và truy cập chéo người dùng được test.
- Có loading, empty, validation, error, unauthorized và success.
- Type-check và Biome đạt.
- Migration được tạo và review khi phù hợp.
- Changelog và AI progress được cập nhật.
- Slice sau không phụ thuộc hành vi chưa được tài liệu hóa.
## Historical — AFF-US-007: Fact Freshness và Dependency Invalidation

Trạng thái (2026-08-12): đã triển khai vertical slice domain/API/UI/test. Đã có policy freshness
tập trung cho price/promotion, assessment và generation usability, Product Fact revision với
optimistic concurrency, dependency register/replace/detach, invalidation audit event và
Dashboard warning theo Product. Migration `0005_exotic_edwin_jarvis.sql` đã được review và
apply bằng `DATABASE_URL_DIRECT`. Authenticated E2E đã chạy thật trên `3002`; scheduler,
notification, scraping và provider AI vẫn để ngoài slice.
AFF-US-008 foundation hardening is complete only for domain/persistence contracts: repair merge,
idempotency intent hash, provider error boundary, stale/uncertain timeout semantics, cross-field
validation và DB state checks. Runtime live provider, production API và Script Studio remain later
work and are not implied by this foundation.

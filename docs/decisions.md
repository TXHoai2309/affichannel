# Các quyết định kiến trúc AffiChannel

- Trạng thái: Đang áp dụng
- Cập nhật lần cuối: 2026-08-25

Đây là nhật ký ADR dạng gọn. Không đánh lại số quyết định đã chấp nhận. Khi có
thay đổi quan trọng, hãy tạo quyết định mới thay thế thay vì âm thầm sửa lịch sử.

DEC-025 là canonical direction hiện tại cho Channel-first v0.8. Các ADR cũ mô tả
Fact Lock/Voice/Product bắt buộc theo golden affiliate flow được giữ làm lịch sử;
chúng không override conditional applicability và Manifest-first contract của
DEC-025 cho công việc mới.

## DEC-030 — M5 enforces persisted identity without activating future flows

- Trạng thái: Đã chấp nhận ở cấp tài liệu; implementation pending
- Ngày: 2026-08-25
- Mở rộng: DEC-025, DEC-026, DEC-028, DEC-029

M5 đặt `content_type`, `creation_path`, `content_format_key` và
`content_format_version` thành NOT NULL sau fresh zero-blocker preflight. Không có
DB default, enum hoặc registry table; `product_id` tiếp tục nullable với FK,
`ON DELETE RESTRICT` và index hiện hữu.

Legacy request shape tiếp tục được chấp nhận và canonicalize thành
`AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1` trước persistence; legacy all-null
persisted state bị cấm. Defensive legacy read projection, identity CAS, M2 tooling
và M4 shadow được giữ qua rollback window. M5 không activate Organic, Quick Image,
Media First hoặc ClaimManifest và không đồng bộ/xóa `currentStepKey` hay
`project_step_status`. Chi tiết và `AC-M5-01–20` tại
`docs/domain-evolution-m5-enforcement-contract.md`.

DEC-030 thay phần shorthand cũ mô tả M5 gộp Organic/Quick Image/Manifest-first.
Các capability đó vẫn thuộc story kế tiếp theo roadmap.

## DEC-029 — Adaptive Workflow UI read authority

- Trạng thái: Runtime/presentation cutover DONE qua AFF-US-015
- Ngày: 2026-08-24
- Mở rộng: DEC-025, DEC-028

### Bối cảnh

Current Project UI dùng bảy step hardcode, persisted `currentStepKey`/
`project_step_status`, Fact Lock gate và Voice summary để tự suy trạng thái hiển
thị. `/video` và `/preview` mới là placeholder nhưng có thể bị báo “Có thể tiếp
tục”. RSC Project layout còn gọi Voice reconciliation trong read/render path. M4
Resolver đã đạt shadow parity nhưng chưa là UI authority.

### Quyết định

- Adaptive Workflow read model là derived, typed, serializable và read-only. Nó
  map một Resolver result cho đúng năm capability, route descriptors, visibility,
  navigation/action kind và `nextApplicableStep`; không persist hoặc chứa UI prose.
- `currentStepKey` là legacy progress/landing cursor;
  `project_step_status` là legacy completion projection. Cả hai không phải
  applicability truth và không bị mutate bởi GET/page render/navigation.
- `NOT_REQUIRED` ẩn khỏi primary stepper, direct URL hiện controlled N/A state và
  numbering dùng visible order liên tục. `OPTIONAL` chỉ vào primary flow sau durable
  server-owned opt-in; current Affiliate baseline không có OPTIONAL.
- Applicability và completion trình bày riêng. BLOCKED dùng typed remediation;
  STALE giữ warning/rerun riêng. Reason-code-to-copy thuộc web presentation layer.
- `SCRIPT` map route lịch sử `content`. Một `RENDER` capability map primary
  `/video` và secondary `/preview`; `/completed` là terminal presentation, không
  phải capability. Current Render hiển thị `Sắp có`, không execution CTA.
- Deep links không bị đổi tên hoặc auto-redirect. Mỗi state render controlled route
  view; execution guard/authorization vẫn kiểm tra server-side.
- Target aggregation là một protected, workspace-authorized, request-owned
  adaptive snapshot được reuse bởi stepper/landing/routes và M4 comparison; không
  chạy `project.get + shadow gather + adaptive gather` riêng lẻ. Adaptive reads
  dùng Voice read snapshot, không gọi reconciliation.
- M4 shadow được giữ trong rollout 15A–15D và chỉ reduce/remove sau quyết định riêng
  với parity/zero-mismatch evidence.

Contract đầy đủ, audit matrix, Affiliate A–J presentation và `AC-015-01–18` nằm tại
`docs/aff-us-015-adaptive-workflow-ui.md`.

### Hệ quả

AFF-US-015 implementation phải cut over presentation theo phase, không biến UI
resolver thành authorization và không activate Organic/Quick Image/Media First.
Persisted workflow synchronization, nếu cần, là explicit transactional command
được phê duyệt riêng.

## DEC-028 — Applicability Resolver M4 shadow contract

- Trạng thái: Runtime shadow đã accepted; legacy behavior vẫn authority
- Ngày: 2026-08-24
- Mở rộng: DEC-025, DEC-026

### Bối cảnh

Golden Affiliate flow hiện có nhiều authority riêng: Project service enforce
Product, Script service/validator quyết readiness, Fact Lock có pure gate riêng,
Voice có fingerprint/readiness và reconciliation riêng, còn Video/Preview mới là
route có gate kèm placeholder. `currentStepKey` không phải comprehensive
applicability authority: create khởi tạo ở Product và Voice reconciliation hiện
chỉ có thể tiến `voice -> video`.

### Quyết định

- Applicability Resolver là pure, deterministic, server-owned derived policy cho
  đúng năm capability `PRODUCT | SCRIPT | FACT_LOCK | VOICE | RENDER`.
- Canonical state union có đúng
  `NOT_REQUIRED | OPTIONAL | REQUIRED | READY | BLOCKED | STALE`; completion là
  summary riêng, không thêm `COMPLETED` vào union và không persist state này vào
  `project_step_status` hoặc bảng/JSON mới.
- `REQUIRED` là mandatory nhưng chưa actionable do normal upstream work;
  `BLOCKED` là concrete invalid/error/unsupported condition cần remediation;
  `READY` không đồng nghĩa complete; `STALE` yêu cầu prior usable/current output
  đã mất freshness do dependency/fingerprint đổi.
- Repository/service gather authenticated domain summaries; Resolver không query
  DB, gọi provider/storage, mutate state, ghi `currentStepKey` hoặc chứa raw ORM/
  user-authored text.
- ContentFormat chỉ là resolved semantic/presentation input theo DEC-026; registry
  không sở hữu applicability rule.
- M4 production chạy shadow trên
  `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1`: legacy behavior vẫn authority,
  Resolver chỉ compute/compare. Mismatch không đổi API/UI/worker behavior.
- Current Render capability trả
  `BLOCKED + RENDER_FEATURE_NOT_IMPLEMENTED` khi upstream ready. Route accessible
  không chứng minh capability READY.
- Resolver derive `nextApplicableStep` theo capability order và bỏ qua
  `NOT_REQUIRED`/unselected `OPTIONAL`, nhưng không mutate `currentStepKey`. Future
  synchronization là explicit transactional write operation riêng.
- `ORGANIC`, `QUICK_IMAGE` và `MEDIA_FIRST` có thể được model trong pure fixtures
  khi canonical policy đã định nghĩa, nhưng M4 không production-activate chúng.
- Chi tiết reason precedence, matrix A–J, mismatch taxonomy và stable AC nằm tại
  `docs/aff-us-014-m4-applicability-resolver-shadow.md`.

### Exit gate

M4 chỉ đạt khi 100% golden Affiliate scenarios khớp state/completion/reason/
`nextApplicableStep`, không còn Resolver exception hoặc legacy-unmapped case,
không có mutation/provider call/UI behavior change và golden suites vẫn xanh.
Authority cutover là task được phê duyệt riêng; không nằm trong quyết định này.

## DEC-027 — Supersede và tái sử dụng backlog ID AFF-US-013–030

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-22
- Liên quan: DEC-025, canonical roadmap v0.8

### Bối cảnh

Implementation và acceptance history thực tế mới hoàn thành đến `AFF-US-012`.
Các định nghĩa pre-v0.8 mang ID `AFF-US-013–030` trong roadmap/Lark chỉ là backlog
cũ chưa triển khai: không có completed acceptance, migration hoặc source change
được ghi nhận cho các story đó. Giữ các định nghĩa cũ chỉ để bảo toàn số thứ tự sẽ
tạo khoảng trống và buộc canonical backlog nhảy ID không cần thiết.

### Quyết định

> Pre-v0.8 definitions of AFF-US-013–030 are superseded before implementation.
> Their IDs are retained and reassigned to the v0.8 Channel-First backlog. No
> completed implementation history is overwritten.

- `AFF-US-001–012` giữ nguyên ID, definition và implementation/acceptance history.
- Định nghĩa pre-v0.8 của `AFF-US-013–030` mất hiệu lực trước implementation;
  không được dùng làm current scope hoặc acceptance source.
- `AFF-US-013–030` được gán lại liên tục cho 18 User Story canonical v0.8 theo
  bảng trong `docs/roadmap.md`.
- Snapshot roadmap/Lark cũ có thể được giữ làm planning history nhưng phải mang
  nhãn `superseded before implementation`, không phải historical completed work.
- Từ quyết định này, commit, branch, migration plan, acceptance evidence và tài
  liệu story mới dùng definition v0.8 tương ứng với ID đã gán lại.

### Hệ quả

- Không đánh lại số hoặc sửa lịch sử hoàn thành của `AFF-US-001–012`.
- Không có implementation history nào bị overwrite vì range cũ `013–030` chưa
  từng được triển khai.
- Việc tái gán ID chỉ đổi backlog/document contract; không ngụ ý code, schema hay
  migration của `AFF-US-013–030` đã tồn tại.

## DEC-026 — ContentFormat registry, identity và migration contract

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-22
- Mở rộng: DEC-025 (`V08-DEC-003`, `V08-DEC-004`, `V08-DEC-009`, `V08-DEC-010`)

### Bối cảnh

Domain Evolution M1 cần persist ContentFormat nhưng canonical v0.8 mới chỉ khóa
khái niệm “preset cấu trúc/UI hint có version”. Source hiện tại chưa có
ContentFormat: `project.product_id` còn `NOT NULL`, Project create/update luôn yêu
cầu Product, read models dùng inner join Product và workflow luôn khởi tạo tại
step `product`. Migration head là `0016_gifted_microbe.sql`.

MVP là internal tool cho hai đến ba người; format là product-owned preset cần
deterministic versioning, không phải dữ liệu SaaS do người dùng cấu hình. Vì vậy
database registry/runtime editor không đem lại giá trị tương xứng ở M1.

### Định nghĩa và ranh giới

`ContentFormat` là semantic content/presentation preset được pin trên Project. Nó
mô tả cách một content item được tổ chức và gợi ý UI phù hợp với một hoặc nhiều
CreationPath.

`ContentFormat` không phải:

- `ContentType`: Organic/Affiliate và policy/monetization intent;
- `CreationPath`: cách content/asset được sản xuất;
- `Content Pillar`: chủ đề chiến lược của channel;
- `Series`: nhóm content lặp lại theo concept;
- user-editable `Template` hoặc admin format builder;
- `CompositionTemplate`: implementation/render template hoặc Remotion ID;
- workflow state hay authority quyết Product, Script, Fact Lock, Voice hoặc Render.

Một ContentFormat có thể map tới nhiều CompositionTemplate implementation version
trong tương lai. M1 chỉ ghi conceptual boundary, không tạo schema cho
CompositionTemplate.

### Representation và ownership

Identity canonical là cặp bất biến:

```ts
type ContentFormatRef = {
  key: string;
  version: number;
};

type ContentFormatDefinition = {
  ref: ContentFormatRef;
  label: string;
  description?: string;
  supportedCreationPaths: readonly CreationPath[];
  availability: "active" | "deprecated";
};
```

Registry là readonly, server-owned và đặt trong `packages/core` để giữ pure
lookup/validation/default policy dùng chung. API/server là authority; frontend có
thể nhận definition để hiển thị nhưng không tự xác nhận compatibility. MVP không
có registry table, user-created format, runtime editing hoặc admin builder.

Không encode `SCRIPTED_STANDARD@1` trong một cột. M1 dùng:

```text
project.content_format_key      TEXT
project.content_format_version  INTEGER
```

TEXT được chọn thay database enum để thêm key/version additive mà không cần
migration cho mỗi preset. Version phải là integer dương. Hai cột cùng null hoặc
cùng có giá trị; partial pair là invalid. M1 chưa cần index riêng cho ContentFormat
vì Library/filter chưa nằm trong slice và dataset MVP nhỏ; thêm index theo query
evidence ở Library phase.

### Initial registry và defaults

| CreationPath | Default ContentFormat | ContentType support |
|---|---|---|
| `SCRIPTED` | `SCRIPTED_STANDARD v1` | Organic và Affiliate |
| `QUICK_IMAGE` | `QUICK_IMAGE_STANDARD v1` | Organic và Affiliate |
| `MEDIA_FIRST` | `MEDIA_FIRST_STANDARD v1` | Organic và Affiliate |

Ba definition ban đầu đều `active`; mỗi CreationPath có đúng một default. Initial
registry chỉ có ba definition trên. Format chuyên biệt như review,
unboxing, tips, quote hoặc storytelling được thêm additive khi có user outcome
thực tế. Key không encode ContentType; applicability xử lý khác biệt Organic và
Affiliate.

### Version semantics

- Mỗi `key` đại diện một format family và có thể có nhiều version. Chỉ
  `(key, version)` là immutable unique identity; version là integer bắt đầu từ 1
  và không được trùng trong cùng key.
- Thay đổi cấu trúc, semantic preset, validation hoặc default ảnh hưởng generated/
  rendered output phải tạo version mới; không mutate version cũ.
- Sửa label, description, icon hoặc copy cosmetic không làm thay semantic output
  thì không cần bump version.
- Registry phải giữ reader cho mọi version còn được Project tham chiếu.
- `deprecated` vẫn resolve/read được nhưng không được chọn cho Project mới.
- Không tự upgrade Project lịch sử và không fallback sang latest version.

### Legacy backfill và rollout

- M1 expand: thêm `content_format_key` và `content_format_version` nullable, không
  đặt database default.
- M2 backfill idempotent/deterministic mọi Project lịch sử thành
  `SCRIPTED_STANDARD v1`, cùng `AFFILIATE + SCRIPTED`; không đọc Script để đoán.
- Backfill không thay Product, Script, FactLockRun, Voice artifact,
  `project_step_status` hoặc `currentStepKey`.
- M3 dual read/write: all-null legacy row được compatibility adapter project thành
  default legacy triple với `isLegacyProjection=true` hoặc metadata provenance
  tương đương. Partial ref trả `unsupported` với
  `reasonCode=PARTIAL_CONTENT_FORMAT_REF`; version không hợp lệ trả `unsupported`
  với `reasonCode=INVALID_CONTENT_FORMAT_VERSION`. Legacy provenance không được
  overload `resolution`.
- M5 enforce, sau M4 resolver shadow: khi zero legacy-null/invalid row được chứng
  minh, đặt hai cột
  `NOT NULL` nhưng vẫn không đặt database default; server default là authority.

### New Project và update behavior

- Create không gửi ContentFormat: server chọn default theo CreationPath.
- Create/update gửi ref: server yêu cầu registry entry/version tồn tại, active khi
  gán mới và support CreationPath.
- Đổi ContentType: không đổi ContentFormat nếu CreationPath không đổi và ref vẫn
  compatible; format orthogonal với Organic/Affiliate.
- Đổi CreationPath: giữ format nếu compatible. Nếu không compatible, mutation phải
  gửi replacement ref hợp lệ; server không silently rewrite sang default.

Write DTO dùng optional `contentFormat?: ContentFormatRef` khi create. Read DTO
dùng nested value `contentFormat: { key, version, resolution, definition }`, phù
hợp Project DTO hiện có; `resolution` là `resolved | deprecated | unsupported` và
`definition` nullable. Frontend không lookup registry làm authority duy nhất.

### Unknown/deprecated fail-safe

Unknown `(key, version)` vẫn được đọc raw và Project page không crash. Read model
trả `unsupported`, không tự fallback/upgrade. Các mutation hoặc render action cần
format definition bị block bằng typed reason; safe read/archive và metadata action
không phụ thuộc definition vẫn có thể tiếp tục. Deprecated version trả
`deprecated`, vẫn đọc/render theo definition cũ nếu downstream contract hỗ trợ,
nhưng không được gán mới.

### Applicability separation

Registry chỉ xác nhận identity và CreationPath compatibility. Nó không chứa rule
`productRequired`, `scriptRequired`, `factLockRequired`, `voiceRequired` hoặc
render gate. Applicability Resolver vẫn là authority và có thể đọc format như một
input có kiểu khi policy được canonical hóa rõ; format không trở thành hidden
workflow state.

### Acceptance cho implementation sau

- mỗi key là một format family có thể có nhiều version; chỉ `(key, version)`
  unique, version không trùng trong cùng key và luôn dương;
- mỗi MVP CreationPath có đúng một default active và default support path đó;
- legacy backfill target tồn tại và old versions còn resolve được;
- invalid key/version và format/path mismatch bị từ chối;
- unknown/deprecated behavior fail-safe đúng contract;
- registry không chứa applicability rule.

### Hệ quả

- ContentFormat blocker trước M1 đã đóng ở cấp ADR; M1 đủ điều kiện review nhưng
  task này không tạo/apply migration.
- Không thêm flexibility architecture ngoài nhu cầu MVP.
- Quick Image Phase 0 chỉ dùng `QUICK_IMAGE_STANDARD v1` như preset/config hint;
  motion/timeline/composition/storage/AI image-to-video vẫn thuộc slice sau.

## DEC-025 — Kích hoạt contract channel-first của Product Specification v0.8

- Trạng thái: Đã chấp nhận ở cấp tài liệu; implementation đi qua migration và regression gate
- Ngày: 2026-08-22
- Mở rộng: DEC-005, DEC-006, DEC-009, DEC-015, DEC-016, DEC-020, DEC-021, DEC-023, DEC-024

### Bối cảnh

Baseline hiện tại được xây theo golden affiliate flow, trong đó Project luôn có
Product, ScriptVersion là nguồn claim duy nhất và Fact Lock/Voice là các bước cố
định. Product Specification v0.8 chuyển AffiChannel Personal sang channel-first,
cho phép Organic content và nhiều creation path nhưng phải giữ nguyên tính an toàn,
khả năng truy vết và dữ liệu lịch sử của flow affiliate đã hoàn thành.

Các mã `V08-DEC-*` dưới đây là mã cục bộ của Product Specification v0.8. Chúng
không thay thế hoặc đánh lại số ADR hiện hữu trong file này.

### Quyết định

| Contract v0.8 | Quyết định được áp dụng trong repo |
|---|---|
| `V08-DEC-001` | `Project` tiếp tục là content production unit và đóng vai trò Content Item trong MVP; chưa tạo bảng ContentItem riêng. |
| `V08-DEC-002` | `contentType` chỉ gồm `ORGANIC | AFFILIATE`; chưa có `HYBRID`. |
| `V08-DEC-003` | `creationPath` gồm `QUICK_IMAGE | SCRIPTED | MEDIA_FIRST`; `AI_VISUAL` là Post-MVP. |
| `V08-DEC-004` | Bốn tab Video Studio là presentation layer; không thay thẳng bảy persisted project step keys. |
| `V08-DEC-005` | Một channel trên mỗi workspace trong MVP. |
| `V08-DEC-006` | Affiliate luôn cần Product và Fact Lock trước TTS/render. Organic chỉ được `productId=null` khi không có Product claim; mọi Product claim đều cần accessible Product, Product Facts evidence và Fact Lock. |
| `V08-DEC-007` | Content lifecycle tách khỏi production readiness, artifact status, publication status và analytics import status. |
| `V08-DEC-008` | Giữ fixed internal accounts và public signup disabled. |
| `V08-DEC-009` | Project lịch sử được backfill thành `AFFILIATE + SCRIPTED`, giữ nguyên Product và artifacts. |
| `V08-DEC-010` | Applicability/readiness states là runtime-derived DTO; không thêm `NOT_REQUIRED`, `OPTIONAL`, `REQUIRED`, `READY`, `STALE` vào `project_step_status.status`. |
| `V08-DEC-011` | Server-built immutable ClaimManifest là nguồn claim canonical cho Fact Lock; ScriptVersion chỉ là một source adapter. |
| `V08-DEC-012` | Script generation hỗ trợ server-selected input source mode `PRODUCT_BACKED` và `ORGANIC_NO_PRODUCT`; đây không thay persisted operation mode `full | repair`. Output ScriptDraft/versioning hiện tại giữ nguyên. |
| `V08-DEC-013` | FactLockRun new writes lưu ClaimManifest ID/fingerprint; Script fields là optional provenance. Legacy Script-linked rows tiếp tục đọc được; pending/idempotency của new writes dựa trên Manifest fingerprint. |

Resolver là derived policy dùng chung cho UI, API readiness và worker preflight.
Nó tính `nextApplicableStep` nhưng không mutate `currentStepKey`. Khi authority
cutover được phê duyệt sau M4, một business action riêng mới được khóa Project và
đồng bộ `currentStepKey` trong transaction; step bị bỏ qua không được đánh dấu giả
là `completed`. Golden affiliate flow không đổi vì các step cũ vẫn applicable.

ClaimManifest phải được build phía server từ mọi output-bearing source, gồm
ScriptVersion, overlay, caption, CTA, voice text, declared claim và composition
version. Client không cung cấp `isEmpty` hoặc fingerprint làm source of truth.
Extraction/normalization lỗi hoặc không chắc chắn phải fail closed thành
`indeterminate`/`blocked`; không được biến thành empty manifest để PASS.

### Hệ quả

- Tài liệu triển khai chi tiết nằm tại `docs/domain-evolution-plan.md`,
  `docs/claim-manifest-fact-lock-contract.md` và
  `docs/domain-evolution-acceptance.md`.
- Migration phải additive và được review; không bulk rewrite US1–US12 hoặc dữ
  liệu FactLockRun lịch sử.
- Chỉ coi repo đã canonical-activated sau khi product spec, architecture,
  design system và roadmap đồng bộ, migration plan được duyệt và regression
  baseline trong acceptance document đạt.
- Các tài liệu phase AFF-US-008 đến AFF-US-012 tiếp tục là bằng chứng lịch sử
  của golden affiliate flow; DEC-025 mở rộng chúng thay vì sửa lại lịch sử.

## DEC-024 — AFF-US-012 VoiceSegment artifact và generation contract

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-21

### Bối cảnh

AFF-US-011 đã khóa VoiceConfig và preview tạm thời nhưng chưa có audio artifact.
AFF-US-012 cần tạo TTS theo từng voiceover segment, giữ lịch sử generation,
không gọi lại một request có thể đã tính phí và không để audio của ScriptVersion
hoặc VoiceConfig cũ làm unlock workflow hiện tại.

### Quyết định

- `VoiceSegmentArtifact` là một immutable generation attempt; một logical segment
  có nhiều attempt/history. Chỉ lifecycle của pending attempt được chuyển một
  chiều sang `completed`, `failed` hoặc `indeterminate`; không mutate history để
  gắn `stale`.
- Fingerprint server-owned gồm workspace/project, ScriptVersion ID/revision,
  segment key/text hash, VoiceConfig revision và provider/voice/language/speed.
  `requestHash` được server tính từ fingerprint; client chỉ gửi project, segment
  key và idempotency key.
- Cùng idempotency key + request hash trả cùng attempt; cùng key + khác hash là
  conflict. Failed/indeterminate và explicit regenerate bắt buộc key mới. Pending
  cùng request hash nhưng khác key trả `VOICE_SEGMENT_ALREADY_PENDING` thay vì bind
  key mới vào artifact cũ; partial unique index vẫn chống duplicate provider call
  trong race. Completed/failed/indeterminate không chặn key mới tạo attempt lịch sử.
- Mở rộng `TtsProvider` bằng `generateSegment()` và giữ `preview()` nguyên vẹn.
  Provider trả audio/mpeg và duration nếu có chỉ là advisory; server parse MP3
  bytes và persist duration authoritative.
- Audio dùng `VoiceAudioStorage` abstraction; dev/test local, production private
  R2. Database chỉ lưu metadata/object key. Protected stream kiểm tra actor,
  workspace, project, artifact và storage-key ownership, đồng thời resolve backend
  từ persisted `storageProvider`; không nhận arbitrary path.
- Current/stale, `latestRequest`, `latestUsableArtifact`, effective status và
  total duration đều là server read model. `stale` không phải persisted status.
- Workflow tiếp tục dùng `project.currentStepKey` và `project_step_status`; không
  tạo status source of truth mới hoặc generic workflow mutation. Voice readiness
  chỉ đạt khi Fact Lock PASS, config current và mọi segment current có usable
  artifact khớp đầy đủ fingerprint.
- Provider/network uncertainty, invalid audio, metadata parse, storage và
  persistence failure có error taxonomy riêng; không blind retry.

### Hệ quả

Chi tiết audit, schema/index đề xuất, race semantics, storage contract, test plan
và Phase 1–4 nằm tại
`docs/aff-us-012-phase-0-contract-decisions.md`. Phase 0 không tạo migration,
schema, runtime, API, UI hoặc paid TTS. Phase 1 đã đưa schema/storage/duration
foundation vào migration `0016`; Phase 2 triển khai provider generation,
runtime/API, protected audio, R2 fail-closed và reconciliation semantics mà
không tạo migration `0017`. Các phase sau vẫn phải review UI, workflow và
acceptance E2E trước khi mở rộng phạm vi.

## DEC-023 — AFF-US-011 TTS provider và Voice Studio Phase 0 contract

- Trạng thái: Đã chấp nhận cho Phase 0
- Ngày: 2026-08-19

### Bối cảnh

AFF-US-010 đã có server-side Fact Lock gate cho Voice, nhưng TTS provider,
VoiceConfig, voice catalog, preview text và audio transport chưa được khóa. Capability
probe xác nhận APIKEY.FUN relay được Grok/xAI TTS qua POST /v1/tts bằng TTS key
riêng; relay không expose /v1/tts/voices hoặc /v1/audio/speech, còn pricing relay
chưa được xác minh.

### Quyết định

- AFF-US-011 dùng logical provider apikeyfun, credential
  TTS_APIKEY_FUN_API_KEY, base URL TTS_APIKEY_FUN_BASE_URL và canonical endpoint
  POST /v1/tts. Không dùng Text AI key và không triển khai /v1/audio/speech.
- Voice catalog là server-owned verified catalog với các voice provider-documented
  ara, eve, leo, rex, sal. Client không gửi arbitrary voice ID hoặc provider để
  forward thẳng.
- Language canonical cho tiếng Việt là vi. Speed canonical là 0.7..1.5, default
  1.0; server validate và UI không được dùng range khác.
- VoiceConfig là mutable current configuration, duy nhất theo
  (workspaceId, projectId), không lưu secret/audio/raw provider response. Save dùng
  baseRevision CAS; mismatch trả VOICE_CONFIG_CONFLICT, không last-write-wins.
- Voice Studio dùng route hiện tại và locked state của GatedProjectStepPage khi
  Fact Lock chưa PASS. Interactive config read/save và preview chỉ mở khi PASS;
  preview bắt buộc gọi FactLockGate.assertPassed(actor, projectId) ở server.
- Preview text do server lấy từ current ScriptVersion, ưu tiên voiceover segment đầu
  tiên có nội dung, normalize và giới hạn bởi TTS_PREVIEW_MAX_CHARS; client không
  được gửi arbitrary text. Script/gate identity phải được kiểm tra lại ngay trước
  provider call; preview không trở thành artifact nếu revision đổi trong lúc chạy.
- Provider trả binary audio qua protected authenticated endpoint, canonical v1 là
  audio/mpeg. Empty body, MIME không hợp lệ, JSON error và HTML challenge bị
  reject; preview audio không persist.
- Timeout dùng TTS_PREVIEW_TIMEOUT_MS, không auto-retry billable request; retry chỉ
  sau thao tác rõ ràng của người dùng. Pricing APIKEY.FUN TTS là UNVERIFIED, cost
  chỉ nullable và không dùng giá xAI direct.
- Phase 0 chỉ cập nhật contract/tài liệu. Schema, migration 0015, provider, API,
  UI và runtime test bắt đầu từ các phase sau.

### Hệ quả

Chi tiết semantic shape, error taxonomy, phase boundary, deterministic provider và
out-of-scope nằm tại
docs/aff-us-011-phase-0-contract-decisions.md. Phase 1 phải review migration và
workspace authorization trước khi tạo voice_config; Phase 2 mới được gọi provider
live trong runtime. Không renumber các DEC lịch sử.

## DEC-022 — Fact Lock execution ownership và review evidence

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-18

### Bối cảnh

Một pending Fact Lock có thể được nhiều request cùng quan sát trong khoảng thời
gian provider đang chạy. Nếu mỗi request tự gọi provider, cùng một intent có thể
tạo nhiều side effect và nhiều chi phí. Review state cũng cần được bảo vệ ở cả
database boundary, không chỉ ở UI.

### Quyết định

`fact_lock_run.execution_claimed_at` được dùng làm execution ownership bằng một
UPDATE atomic. Chỉ owner gọi estimate/provider; claim quá timeout chuyển run sang
`indeterminate`, không tự retry. Relation canonical là `supports`, `related`,
`contradicts`; Fact revision chỉ nằm ở mapping. Database chỉ cho phép review
combination hợp lệ và yêu cầu reviewer metadata cho `MANUAL_APPROVED`.

### Hệ quả

Replay và concurrent request không gọi provider lần hai. Crash sau claim được xử
lý bảo thủ, nên người dùng phải tạo idempotency key mới sau khi run indeterminate.
Migration 0014 chỉ thêm cột/constraint và chuyển dữ liệu `context` sang `related`;
không sửa migration cũ hoặc reset dữ liệu.

## Mẫu quyết định

```text
### DEC-NNN — Tiêu đề

- Trạng thái: Đề xuất | Đã chấp nhận | Đã thay thế
- Ngày: YYYY-MM-DD
- Thay thế: mã quyết định nếu có

Bối cảnh
Quyết định
Hệ quả
```

## DEC-001 — Tài liệu triển khai chuẩn

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Các tài liệu Word và spreadsheet lịch sử có nhiều chi tiết hữu ích nhưng khác
nhau về phạm vi và cách gọi tên.

### Quyết định

Các file Markdown trong `docs/` là nguồn sự thật trực tiếp để triển khai, theo
thứ tự ưu tiên trong `docs/README.md`.

### Hệ quả

Agent phải cập nhật tài liệu Markdown chuẩn khi hành vi hoặc kiến trúc thay đổi.
Tài liệu lịch sử chỉ còn vai trò tham khảo.

## DEC-002 — Full-stack Next.js cho thao tác web đồng bộ

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Ứng dụng cần private web UI, authentication, CRUD và typed browser operation cho
một nhóm người dùng cố định nhỏ.

### Quyết định

Dùng Next.js App Router trên Vercel cùng oRPC, Better Auth, Drizzle và Neon.
Không tạo general-purpose API server riêng trong MVP 0.

### Hệ quả

`runtime: none` trong Better T Stack vẫn đúng. Công việc dài hạn vẫn bị loại khỏi
Vercel request handler.

## DEC-003 — Render worker riêng

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Remotion và FFmpeg chạy lâu, dùng nhiều tài nguyên và cần job state bền vững cùng
file tạm.

### Quyết định

Chạy render trong `apps/worker`, ban đầu chạy local cho MVP 0 nếu chủ dự án chưa
chọn nơi deploy. Vercel tạo/đọc job nhưng không render.

### Hệ quả

Repository tiếp tục dùng Turborepo. Render input và state phải serialize được và
dùng chung mà không import Next.js.

## DEC-004 — Triển khai theo vertical slice

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Backlog hiện tại quá rộng để triển khai hiệu quả theo các giai đoạn frontend và
backend tách rời.

### Quyết định

Làm từng User Story với database, domain logic, API, UI, trạng thái và test. Chỉ
giữ một story đang thực hiện.

### Hệ quả

Dashboard và summary screen chỉ hoàn thiện sau khi có dữ liệu nguồn. Có thể dùng
mock provider response để xác minh contract trước live AI integration.

## DEC-005 — Product Facts và Fact Lock

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Nội dung affiliate có thể chứa claim cũ, phóng đại hoặc không được hỗ trợ.

### Quyết định

Product Facts là nguồn sự thật. Fact Lock bắt buộc cho đúng script version hiện
tại trước TTS và render. AI được đề xuất bằng chứng nhưng không tự duyệt claim.

### Hệ quả

Fact phải có provenance và freshness metadata. Thay đổi script/fact làm kết quả
phụ thuộc mất hiệu lực. Trạng thái claim và evidence link được lưu lại.

## DEC-006 — MVP 0 không có Video AI và analytics nâng cao

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

Provider integration, generation bất đồng bộ, import analytics và recommendation
sẽ làm phiên bản đầu quá rộng.

### Quyết định

MVP 0 kết thúc bằng video render từ media thật, TTS, Fact Lock, Remotion
composition cố định và đăng thủ công. Video AI và analytics chỉ làm sau khi có
dữ liệu sử dụng thực tế.

### Hệ quả

Không thêm Video AI SDK, tạo calendar hoặc analytics dashboard trong MVP 0 nếu
quyết định này chưa bị thay thế.

## DEC-007 — Chiến lược storage của MVP 0

- Trạng thái: Đề xuất
- Ngày: 2026-08-10

### Bối cảnh

Web app cuối cùng sẽ cần R2, nhưng local render worker có thể bắt đầu nhanh hơn
với local file.

### Quyết định đề xuất

Định nghĩa storage adapter trước khi làm media. Chọn local-first hoặc R2-first
khi bắt đầu Slice 7 mà không thay đổi domain record hoặc object-key semantics.

### Hệ quả

Không bắt đầu media implementation trước khi chủ dự án chấp nhận một lựa chọn.

## DEC-008 — Mô hình ownership cho nhóm cố định

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-11

### Bối cảnh

Ứng dụng có hai hoặc ba tài khoản cố định, không cần organization/role nâng cao,
nhưng vẫn phải kiểm tra quyền ở mức bản ghi.

### Quyết định

Mọi tài khoản cố định thuộc một internal workspace chung. Mỗi protected read/mutation
xác định workspace từ `workspace_member` ở server; client không gửi workspace ID.
`createdByUserId` lưu audit, không thay thế authorization. Chưa tạo organization, role,
invitations hoặc administration UI trong MVP.

### Hệ quả

Product và Project có `workspaceId`; mọi access phải lọc theo workspace. Đa workspace
hoặc role nâng cao là migration/domain slice riêng sau MVP, không thêm dần trong feature UI.

## DEC-009 — Tài khoản cố định, không public signup trong MVP 0

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

AffiChannel là ứng dụng private cho một nhóm thành viên cố định. Public signup
không cần thiết cho MVP 0 và làm tăng bề mặt tấn công cũng như chi phí vận hành
account administration.

### Quyết định

US001 chỉ hỗ trợ email/password cho các tài khoản cố định. Better Auth production
được cấu hình `disableSignUp: true`; không có route hoặc UI `/register`. Tài khoản
được tạo qua bootstrap script chỉ dành cho môi trường non-production, không qua
endpoint public và không lưu password trong repository.

Proxy chỉ làm optimistic redirect cho protected page. Dashboard page và protected
oRPC procedure vẫn bắt buộc kiểm tra session ở server. Social login, forgot
password, email verification, 2FA, organization và role nằm ngoài US001.

### Hệ quả

Acceptance Criteria của Slice 1 dùng fixed-account bootstrap thay cho đăng ký mở.
Mọi thay đổi ownership/group vẫn phải chốt trước Product schema theo DEC-008.

## DEC-011 — Vòng đời Product và liên kết Project trong AFF-US-005

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-11

### Bối cảnh

Product được tái sử dụng bởi nhiều Project. Archive Product không được làm hỏng các Project
cũ, nhưng Product đã inactive hoặc archived không được chọn cho Project mới.

### Quyết định

Giữ quan hệ `project.productId` với foreign key restrict. `Product.status` biểu diễn active/inactive;
`archivedAt` biểu diễn archive. Selector mới dùng `listMinimal({ selectableOnly: true })` và lọc
`status=active AND archivedAt IS NULL`. Khi update Project, Product hiện tại được phép giữ nguyên
dù đã inactive/archived; đổi sang Product khác vẫn phải thỏa điều kiện selectable. `referenceCount`
đếm mọi Project còn tồn tại, kể cả Project đã archive. Hard delete chỉ thực hiện khi count bằng 0.

### Hệ quả

Product detail phải hiển thị usage count và các Project liên quan. Delete bị chặn bằng lỗi domain
`PRODUCT_IN_USE`; archive/restore là action riêng. US005 không mở rộng sang Product Facts, R2,
media upload hoặc grid/list toggle.

## DEC-010 — App Shell trước persistence Project

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-10

### Bối cảnh

US002 cần route, sidebar, topbar và ProjectStepper để các màn hình sau có cùng
context. Backlog ban đầu đồng thời yêu cầu lưu StepStatus, trong khi US004 đã
được giao thiết kế Project, ContentBrief và StepStatus.

### Quyết định

US002 triển khai App Shell, route contract, fixture project và mapping trạng thái
step. Không tạo Project CRUD, business schema hoặc persistence StepStatus ở slice
này. Trạng thái `current` được suy ra từ route; các trạng thái domain còn lại sẽ
được lưu cùng Project ở US004.

### Hệ quả

US004 phải cung cấp contract persistence tương thích với `ProjectStepKey` và
`PersistedProjectStepStatus`. Fixture/demo route của US002 chỉ là navigation
scaffold, không được xem là business data.

## DEC-012 — Product Facts: verification, history và Product ownership

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-12

### Bối cảnh

Product Facts là dữ liệu nguồn để tái sử dụng trong brief và các bước kiểm tra sau này.
MVP cần lưu được nguồn, vòng đời và lịch sử thay đổi mà chưa mở rộng sang scheduler,
freshness automation hoặc provider AI.

### Quyết định

- `ProductFact.status` chỉ dùng `draft`, `verified`, `inactive`; `type` dùng `price`,
  `promotion`, `specification`, `feature`, `claim`, `policy`, `other`.
- Khi `verified`, Fact loại `price`, `promotion` hoặc `claim` bắt buộc có `sourceType`,
  `sourceLabel` hoặc `sourceUrl`, và `confirmedAt`. Server/core là nơi thực thi rule này.
- `confirmedAt` và `expiresAt` là PostgreSQL `date`/chuỗi `YYYY-MM-DD`, không chuyển timezone.
  `expiresAt` không được trước `confirmedAt`.
- Sửa sensitive field của Fact đang `verified` sẽ demote về `draft` nếu không re-verify;
  re-verify chỉ thành công khi evidence hợp lệ. Fact `verified` chỉ đủ điều kiện AI khi
  status và evidence rule đều đạt.
- Mỗi create/update/delete ghi snapshot trong cùng transaction. History không có FK tới
  `ProductFact`, nên vẫn giữ `productFactId` sau hard delete Fact. Product không hard-delete
  khi còn Project, Fact hoặc Fact history; archive vẫn được phép.
- Facts được truy cập dưới hierarchy Product và workspace authorization. UI dùng deep-link
  `/products/{productId}?tab=facts`; URL là source of truth cho tab và back/forward/reload.

### Hệ quả

US007 mới được bổ sung freshness/stale detection hoặc scheduler; US008 mới được bổ sung
Fact Lock/provider/fetching. Product `priceAmount` vẫn là metadata hiển thị, không đồng bộ
với Fact `type=price`.

## DEC-013 — Intent xác minh Fact và anatomy Drawer dùng chung

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-12

### Bối cảnh

Form chỉnh sửa Fact có thể gửi lại `status=verified` từ state cũ trong khi nội dung hoặc
evidence đã thay đổi. Base UI Drawer cũng yêu cầu `Viewport` để popup hoạt động đúng và
tránh mất swipe handling/touch scroll lock.

### Quyết định

- Update Product Fact phải có intent rõ ràng `preserve | verify`, mặc định là `preserve`.
  Sensitive edit của Fact đang `verified` với `preserve` luôn demote về `draft`; notes-only
  được giữ `verified`. Chỉ `verify` mới chuyển sang `verified`, sau khi server/core validate
  evidence theo type mới và trạng thái hiện tại.
- Shared Drawer dùng anatomy `Drawer.Portal > Drawer.Viewport > Drawer.Popup`; Drawer dạng
  panel bên phải đặt `swipeDirection="right"`. Feature không tự dựng anatomy riêng.
- Tab Product Detail dùng `router.push` cho thao tác người dùng; URL `?tab=facts` là nguồn
  sự thật để render và khôi phục bằng reload/back/forward. `replace` chỉ phù hợp cho chuẩn hóa
  URL nội bộ không tạo history entry.

### Hệ quả

UI phải tách action lưu bình thường khỏi action re-verify và hiển thị cảnh báo khi verified
data bị thay đổi. Regression phải kiểm tra console error của Drawer, lifecycle verified và
history navigation; không dùng global zero-console-errors assertion cho toàn ứng dụng.
## DEC-014 — Freshness, generation usability và dependency invalidation của Product Fact

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-12

### Bối cảnh

Price và promotion có thể trở nên lỗi thời theo thời gian. Khi Fact thay đổi, các bước
sản xuất đã tham chiếu revision cũ phải được đánh dấu cần xem lại; việc này không thể
để từng module tự suy luận riêng.

### Quyết định

- Freshness là assessment/read model, không mở rộng `ProductFact.status`. Chính sách tập
  trung dùng `priceMaxAgeDays=7`, `promotionMaxAgeDays=3`, cảnh báo trước hạn 1 ngày và
  timezone nghiệp vụ `Asia/Ho_Chi_Minh`.
- Tính ngày theo lịch `YYYY-MM-DD`, truyền rõ `today` vào evaluator và không parse date-only
  bằng `new Date("YYYY-MM-DD")`. Thứ tự kết quả là `not_applicable`, `unknown`, `expired`,
  `needs_update`, rồi `fresh`.
- Generation usability tách khỏi freshness: verified+fresh được phép, verified+needs_update
  được phép kèm cảnh báo, còn draft/inactive/thiếu evidence/unknown/expired bị chặn.
  `isFactEligibleForAi()` hiện tại vẫn giữ nguyên.
- Fact có `revision`, mặc định 1. Thay đổi content/type/status/source/date làm tăng revision;
  notes-only không tăng revision. Update/delete dùng optimistic CAS với `expectedRevision`.
- Dependency engine dùng bảng `fact_dependency` và `fact_invalidation_event`. Register phải
  tự đọc revision hiện tại ở server, idempotent; replace detach dependency bị bỏ; mutation,
  history, revision, invalidation và event nằm trong cùng transaction. Register/replace và
  mutation Product Fact cùng khóa hàng Fact bằng `FOR UPDATE`, replace khóa theo thứ tự ổn định
  để không commit active dependency stale với revision hiện tại. Clock freshness không tự
  invalidation dependency.
- Assessment evidence phản ánh supporting source thực tế cho mọi loại Fact: cần `sourceType` và
  `sourceLabel` hoặc URL `http/https` hợp lệ; rule evidence bắt buộc của US006 và
  `isFactEligibleForAi()` vẫn giữ nguyên. Generation usability vẫn chặn khi assessment thiếu source.
- Dashboard chỉ hiển thị cảnh báo aggregate theo Product và deep-link về
  `/products/{productId}?tab=facts`; không tạo warning table riêng. Logic aggregate là pure function
  nhận `today` và policy tường minh; runtime mới lấy ngày nghiệp vụ theo timezone.

### Hệ quả

US008/Fact Lock có thể dùng dependency service và generation usability contract mà không
phụ thuộc vào implementation của UI. Scheduler, notification, scraping và provider AI vẫn
nằm ngoài US007.

## DEC-015 — ScriptGeneration artifact và transaction boundary của AFF-US-008

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-14

### Bối cảnh

AFF-US-008 cần tạo structured draft từ Project, Content Brief, Product và Product Facts, đồng
thời cho phép refresh, partial repair, idempotency và truy vết Fact revision. Provider output
không phải script đã được người dùng chọn/chỉnh; nếu dùng generation ID như `ScriptVersion` hoặc
chỉ giữ draft ở client, US9 và Fact Lock sẽ không có identity/tracing đáng tin cậy.

US7 đã có dependency engine khóa Product Fact và tự đọc revision trong transaction. Tuy nhiên
public register/replace helper hiện tự mở transaction, nên không thể bảo đảm revision của một
snapshot US8 đã đọc trước đó nếu gọi helper sau snapshot. Provider call cũng không được giữ row
lock hoặc database transaction trong thời gian chờ mạng.

### Quyết định

- US8 lưu `ScriptGeneration` dưới dạng generated artifact read-only và persisted. Nó khác
  `ScriptVersion`: US8 dùng dependent type `script_generation`; US9 mới dùng `script` cho
  `ScriptVersion`.
- Một generation được tạo ở `pending` và chỉ được finalize một lần sang `completed`, `partial`,
  `failed` hoặc `indeterminate`. Sau terminal state, artifact bất biến. Repair không update parent;
  nó tạo generation mới cùng project với `parentGenerationId`.
- Transaction A authorize và khóa Project/Product Facts, evaluate generation usability, tạo exact
  input snapshot, request pending và Fact dependencies bằng chính revision đang khóa rồi commit.
  Provider call chạy sau commit. Transaction B conditional-finalize row pending và detach
  dependency nếu kết quả là failed không có usable output.
- Fact IDs được khóa theo thứ tự ổn định. Blocked Fact không xuất hiện trong snapshot, prompt hoặc
  dependency. Revision trong snapshot và `fact_dependency.factRevision` luôn lấy từ cùng locked
  row trong Transaction A.
- Idempotency key unique theo workspace. `requestHash` nhận diện normalized client intent để xử lý
  network replay; `inputHash` nhận diện canonical server snapshot; `promptHash` nhận diện exact
  rendered provider prompt. Reuse key với request hash khác trả `IDEMPOTENCY_CONFLICT`.
- Database dùng partial unique index để mỗi Project tối đa một row `pending`, kể cả full generation
  hay repair. Conflict trả `GENERATION_ALREADY_IN_PROGRESS` và không gọi provider lần hai.
- Read model trả đồng thời `latestRequest` và `latestUsableArtifact`. Latest order theo
  `createdAt` rồi ID làm tie-break, không theo completion time. Usable chỉ gồm completed/partial có
  normalized output; pending/failed/indeterminate không che artifact usable trước đó. Dependency
  invalidation được trả như trạng thái riêng: output vẫn hiển thị nhưng không còn factual-current,
  và không được dùng làm repair base giữ nguyên section cũ.
- Stale pending có thể chuyển conditional sang `indeterminate`. Không automatic resubmit nếu live
  provider chưa chứng minh idempotency/retrieve an toàn; indeterminate giữ dependency.
- Completed, partial và indeterminate giữ dependency. Failed không có usable output detach active
  dependency trong finalize transaction. Repair đăng ký dependency riêng và không mutate parent.
- Input snapshot chỉ chứa dữ liệu generation pipeline thật sự nhìn thấy. Project/Product/Fact data
  là untrusted serialized data, tách khỏi system/developer instructions. Không lưu raw provider
  response, secret, cookie hoặc authorization data.

### Hệ quả

- Thêm table `script_generation`, dependent type `script_generation`, CHECK/index/FK tương ứng và
  transaction-scoped dependency primitive khi implementation bắt đầu.
- US8 có thể reload full/partial artifact và repair theo server state mà chưa tạo `ScriptVersion`.
  Editor, autosave, version history và immutable ScriptVersion vẫn thuộc US9; Fact Lock vẫn thuộc
  US10.
- Live provider/model và policy reconcile `indeterminate` được chốt trước phase provider, nhưng
  không thay đổi artifact/transaction/read-model contract này.
- Contract chi tiết, schema proposal, migration design, file map và test plan nằm tại
  `docs/aff-us-008-foundation.md`.

### DEC-015 hardening notes — 2026-08-14

- Repair chỉ dùng parent `partial` còn usable; `repairSections` phải là tập con unique của
  `parent.invalidSections`. Provider chỉ được trả section đã yêu cầu; server merge với parent,
  validate merged output và tạo child bất biến.
- `requestHash` chỉ hash normalized `ClientGenerationIntent`; provider/model/version thuộc
  `ServerGenerationConfig`, không làm hỏng network replay cùng idempotency key.
- `AI_TIMEOUT_UNCERTAIN` chuyển `indeterminate` và giữ dependency; stale transition yêu cầu
  `expectedCreatedAt` cùng cutoff do server policy cung cấp. Không automatic retry/reconcile trong
  foundation.
- Database CHECK `script_generation_state_shape_check` khóa shape của completed/partial/failed;
  pending/indeterminate tiếp tục theo semantics DEC-015.

## DEC-016 — Production AI input contract và cost preflight của AFF-US-008 Phase 2A

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-14

### Quyết định

- Channel Settings và AI provider/model settings là server-owned, scoped theo internal workspace;
  generation không nhận provider/model từ client và thiếu Channel Settings sẽ bị chặn.
- Snapshot v2 là bản ghi exact của Project, Content Brief, Product Facts usable, Channel Settings,
  Media Metadata, Output Rules và config identity không chứa secret.
- Output dùng `hookVariants` 3–5 item unique key; không có `selectedHook`; hook claim phải trỏ tới
  `hookKey` cụ thể.
- Provider phải expose cost estimate trước generate. Deterministic adapter chỉ là dev/test
  registry entry; production thiếu live adapter/config thì fail closed. Không automatic retry.
- `script_generation` tiếp tục là usage log duy nhất; không thêm bảng usage thứ hai.
- Output Rules được giữ ở core contract với default `vi-VN`, `9:16`, `standard` safe-area semantic,
  final CTA bắt buộc và claim limit nullable; numeric safe-area/claim cap không được tự phát minh.

### Hệ quả

Phase 2A thêm migration `0010` cho Channel Settings/AI Settings/Media Metadata và `0011` cho
Output Rules, nhưng không
thêm UI hoặc provider SDK. Script schema/prompt/snapshot bump v2 sạch vì chưa có shared output cần
compatibility converter.

## DEC-017 — Phase 2A output policy, repair preservation và provider boundary

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-15

### Quyết định

- Router chỉ bắt lỗi domain ở preflight provider/estimate để finalize failure đúng code một lần.
  Lỗi ghi estimate và finalize không được map thành `AI_PROVIDER_ERROR`; provider execution tiếp tục
  do `runPreparedScriptGeneration()` chuẩn hóa definite/uncertain semantics.
- Repair phải giữ `schemaVersion` và `language` của parent, chỉ thay section được yêu cầu, và chứng
  minh nội dung của parent valid sections ngoài repair không đổi. `baseValidSections` được chụp từ
  parent artifact trong snapshot để child pending không tự chứng minh chính nó.
- `language` lấy từ Output Rules; disclosure là non-empty và phải khớp policy affiliate disclosure
  của Channel Settings. `avoidWords` được enforce sau generation với Unicode NFKC/case-insensitive
  matching và dùng partial semantics theo section.
- Chỉ media `ready` với rights `owned` hoặc `licensed` được đưa vào provider input. Media bị loại
  không được mô tả như available media; snapshot rỗng media vẫn hợp lệ.
- `estimatedCostMicros` và `actualCostMicros` tiếp tục là `bigint`. Audit package `@orpc/client`
  1.15.0 cho thấy standard RPC serializer đánh dấu BigInt và serialize bằng `toString()`, nên chưa
  cần đổi DTO hoặc schema database.

### Hệ quả

Phase 2A không thêm migration cho các hardening này. Live provider, Script Studio, runtime
integration và authenticated/live smoke vẫn là phần deferred; không đánh dấu toàn bộ AFF-US-008 Done.

## DEC-018 — APIKEY.FUN live TextProvider cho AFF-US-008 Phase 2B

- Trạng thái: Đã chấp nhận cho Phase 2B
- Ngày: 2026-08-15

### Quyết định

- APIKEY.FUN là provider text mặc định ở lớp cấu hình, với logical provider
  `apikeyfun` và model identifier đã xác minh từ Docs là `claude-sonnet-4-6`.
  Provider/model vẫn configurable qua AI Settings; default không phải business
  hard-code.
- Adapter dùng Anthropic Messages `POST /v1/messages`, Bearer auth và documented
  SSE. Structured JSON Schema không được coi là capability vì Docs không công bố
  contract đó; JSON prompt chỉ là hỗ trợ định dạng, Zod/domain validation vẫn là
  authority cuối.
- API key không lưu DB/client/log. Thiếu key production trả
  `TEXT_PROVIDER_NOT_CONFIGURED`, không fallback deterministic. Unknown provider
  cũng fail closed.
- Cost preflight bắt buộc dùng pricing config versioned server-side. Thiếu pricing
  hoặc currency thì `COST_ESTIMATE_UNAVAILABLE`; tuyệt đối không giả `0`, scrape
  pricing HTML hoặc đổi currency trong TextProvider.
- Usage/request ID chỉ map khi provider trả về; thiếu giữ `null`. Timeout/network
  không xác định delivery chuyển sang uncertain/indeterminate và không automatic
  retry. HTTP errors được normalize về error code domain, không leak provider body.
- Phase 2B không thêm migration, không đổi auth/workspace scope, không tạo UI
  Script Studio hay mở rộng sang TTS/video.

### Hệ quả

- `ApikeyFunTextProvider` là registry entry độc lập; provider khác có thể thêm mà
  không sửa ScriptGeneration workflow.
- Runtime phải cung cấp `APIKEY_FUN_API_KEY` và bộ pricing env đã xác nhận trước
  khi generate live. Live smoke chỉ chạy với `AFFICHANNEL_LIVE_AI_SMOKE=1`.
- Docs contract audit và limitation được ghi tại
  `docs/aff-us-008-phase-2b.md`; Phase 2B ready for review không đồng nghĩa
  AFF-US-008 tổng thể Done.

## DEC-019 — Conservative uncertainty cho live text relay

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-15

### Quyết định

- HTTP 408, mọi HTTP 5xx, network/AbortController timeout và SSE `event:error`,
  malformed hoặc incomplete đều được coi là delivery uncertain. Provider adapter
  dùng `AI_TIMEOUT_UNCERTAIN` hoặc `AI_PROVIDER_UNCERTAIN`; service chuyển thành
  `AI_REQUEST_STATE_UNCERTAIN` và status `indeterminate`.
- HTTP 400/401/403/404/429 chỉ là definite rejection theo status response và không
  retry tự động. Không suy diễn rằng relay chưa upstream xử lý nếu APIKEY.FUN không
  công bố bằng chứng đó.
- Empty stream chỉ được coi là provider success khi có completion event; output rỗng
  sau đó vẫn đi qua Zod/domain validation và có thể thành `AI_INVALID_OUTPUT`.
- Exact output contract được dựng từ constants/schema hiện tại ở prompt builder;
  Zod/domain validator vẫn là authority. Repair chỉ nhận requested sections và server
  merge giữ root metadata cùng parent sections.

### Hệ quả

- Dependency Fact chỉ detach ở status `failed`; `partial`, `completed` và
  `indeterminate` giữ dependency để không mất lineage khi delivery chưa rõ.
- Không có automatic retry trong adapter hoặc smoke runner.
- Pricing dùng config versioned server-side; public pricing chỉ là evidence cấu hình,
  không được scrape tại runtime.

## DEC-020 — ScriptVersion editable document và concurrency contract của AFF-US-009

- Trạng thái: Đã chấp nhận cho Phase 0
- Ngày: 2026-08-17

### Bối cảnh

`ScriptGeneration` của AFF-US-008 là generated AI artifact bất biến sau terminal state, còn
AFF-US-009 cần cho người dùng chọn hook, chỉnh text/scene, autosave và lưu lịch sử trước Fact Lock.
Nếu editor update trực tiếp `script_generation.output_json`, identity của AI artifact và script đã
được người dùng kiểm soát sẽ bị trộn lẫn.

### Quyết định

- `ScriptVersion` là aggregate riêng, pinned tới đúng `sourceGenerationId`; không update
  `script_generation.output_json` và không tự rebase khi có generation AI mới.
- `editableSnapshotJson` là source of truth duy nhất của nội dung editable trong US9 v1. Không tạo
  `script_segment`/`script_scene` làm nguồn dữ liệu thứ hai.
- Mỗi workspace/project có tối đa một current draft (`status=draft`, `versionNumber=null`). Saved
  version (`status=saved`, `versionNumber` tuần tự) là immutable; draft tiếp tục tồn tại sau Save
  Version.
- Initialize chỉ nhận generation `completed`, usable và chưa invalidated. Concurrent initialize
  phải được bảo vệ bởi DB uniqueness + transaction và trả cùng draft thay vì tạo duplicate.
- Autosave, Save Version và Restore đều dùng `baseRevision`. Autosave v1 gửi full editable snapshot,
  không patch/merge. Revision mismatch trả `SCRIPT_VERSION_CONFLICT`; không last-write-wins hoặc
  silent overwrite.
- Restore copy saved snapshot vào current draft, tăng draft revision và ghi
  `restoredFromVersionId`; saved history không bị mutate.
- Snapshot giữ shape `ScriptDraft v2` hiện tại với thêm `selectedHookKey`, `claimsSourceRevision` và
  `claimsStatus`. Field canonical vẫn là `claims`, không tạo alias `candidateClaims`.
- Claim-relevant edit làm claims stale; không auto-regenerate và không chạy Fact Lock. Hashtags,
  visual direction và duration giữ policy current ở v1 như matrix trong contract document.
- `validateScriptVersionDraft()` cho phép intermediate editing state; validator strict
  `validateScriptVersionForFactLock()` đặt trong core để US10 dùng lại.
- Phase 0 không mở rộng `fact_dependency`, không tạo generic dependency/audio table và không tạo
  TTS. Downstream tương lai phải lưu `sourceScriptVersionId` + `sourceScriptRevision` và stale khi
  revision khác current.

### Hệ quả

- Phase 1 cần migration cho ScriptVersion, partial unique draft, saved version numbering và các
  foreign key/check/index liên quan; migration chỉ được tạo khi bắt đầu implementation vertical slice.
- Phase 2 giữ route `/projects/[projectId]/content` và nâng Script Studio sang editor.
- Phase 3 mới triển khai history/restore/invalidation closure và runtime/E2E proof.
- Fact Lock, TTS, audio artifact, AI regenerate và realtime collaboration vẫn ngoài AFF-US-009.

Contract chi tiết, shape, race semantics và test matrix nằm tại
`docs/aff-us-009-phase-0-contract-decisions.md`.

## DEC-021 — Fact Lock contract hardening của AFF-US-010

- Trạng thái: Đã chấp nhận cho Phase 0
- Ngày: 2026-08-17

### Bối cảnh

Fact Lock phải kiểm tra claim trên `ScriptVersion` có thể đang mang candidate
claims stale. Nếu dùng một validator yêu cầu `claimsStatus=current` trước khi
chạy extraction thì không thể refresh claims một cách đúng revision. Đồng thời
run history cần phân biệt persisted terminal status với effective stale do script
hoặc Product Fact thay đổi.

### Quyết định

- Tách `validateScriptVersionForFactLockRun()` (cho phép `current | stale`) khỏi
  `validateScriptVersionForFactLock()` (strict, bắt buộc `current`). Cả hai dùng
  cùng structural/source validation.
- Classification claim immutable trong finalized run: `SUPPORTED`, `NEEDS_REVIEW`,
  `UNSUPPORTED`, `PROHIBITED`. Review state tách riêng:
  `AUTO_PASSED`, `UNRESOLVED`, `MANUAL_APPROVED`; chỉ `NEEDS_REVIEW` được manual
  approve.
- Persisted Fact Lock run status chỉ là `pending`, `review_required`, `passed`,
  `failed`, `indeterminate`. `stale` là effective read-model state, không mutate
  historical row.
- `ScriptVersion.revision`, `claimsSourceRevision` và
  `FactLockRun.sourceScriptRevision` là ba khái niệm riêng. Claims metadata refresh
  không sửa editable content, không tăng script revision và phải dùng CAS.
- Fact Lock reuse `fact_dependency` với `dependentType='fact_lock'`; hash reuse
  canonical JSON + SHA-256 của US8; không lưu raw provider output mặc định v1.
- AI không phải authority duy nhất cho `PROHIBITED`; kết quả này cần server/core
  deterministic policy confirmation, nếu không thì hạ thành `NEEDS_REVIEW`.
- Resolution action dùng authorization, applicability và optimistic CAS; không mutate
  Fact Lock audit claim. Gate downstream trả typed reason code và bắt buộc ở server.

### Hệ quả

- Phase 1 tạo `fact_lock_run`, `fact_lock_claim` và mapping Fact snapshot bằng
  migration additive sau khi schema recommendation được review; Phase 0 vẫn không
  tạo migration hoặc đổi Neon.
- Chi tiết state machine, occurrence, semantic validation, stale precedence,
  idempotency, gate và Phase 1 schema recommendation nằm tại
  `docs/aff-us-010-phase-0-contract-hardening.md`.
- Phase 1 đã triển khai Fact Lock provider/runtime nền tảng và protected read/run API;
  Fact Lock Review UI, Voice, Render provider/runtime và TTS vẫn ngoài phạm vi.

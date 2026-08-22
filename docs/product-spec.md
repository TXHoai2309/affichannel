# Đặc tả sản phẩm AffiChannel Personal

- Trạng thái: Đã chấp nhận ở cấp tài liệu; repo activation qua migration và regression gate
- Phiên bản: 0.8.0
- Cập nhật lần cuối: 2026-08-22
- Đối tượng đọc: chủ dự án và các agent triển khai

## 1. Tóm tắt sản phẩm

AffiChannel Personal là workspace channel-first dành cho nhóm cố định từ hai đến
ba người để lập kế hoạch, tạo, render và đánh giá video dạng ngắn. Người dùng có
thể xây kênh bằng Organic content trước và bật monetization qua Affiliate khi phù
hợp. Đây là công cụ năng suất nội bộ, không phải sản phẩm SaaS thương mại.

Giá trị cốt lõi là một quy trình có kiểm soát, giúp giảm thao tác lặp lại nhưng
không ép mọi video đi qua Product, Script, Fact Lock và Voice. Khi output có
Product claim, hệ thống vẫn phải truy vết được claim tới Product Facts và giữ
quyết định đăng bài cuối cùng ở con người.

## 2. Nguyên tắc sản phẩm

1. Channel Strategy định hướng content; Product chỉ là dependency khi policy yêu cầu.
2. `ORGANIC` và `AFFILIATE` là Content Type; Content Type độc lập với Creation Path.
3. Product Facts là nguồn sự thật cho mọi Product claim, kể cả khi Content Type vẫn là Organic.
4. AI tạo bản nháp và đề xuất; AI không tự phê duyệt fact.
5. Fact Lock đọc server-built ClaimManifest. Affiliate luôn cần policy check trước
   TTS/render; Organic chỉ cần khi có Product claim.
6. Product, Script và Voice không bắt buộc cho mọi content; UI phải phân biệt
   `NOT_REQUIRED` với `BLOCKED`.
7. Quick Image dùng local deterministic motion trong MVP; AI animation là Post-MVP.
8. Việc đăng bài vẫn được thực hiện thủ công trong MVP.
9. Artifact và render variation là bất biến; output mới không overwrite lịch sử.
10. Chi phí, số lần thử lại, nguồn dữ liệu và trạng thái job phải minh bạch.

## 3. Người dùng

### Người dùng chính

Người vận hành xác định chiến lược kênh, tạo Organic hoặc Affiliate content bằng
creation path phù hợp, xử lý policy gate khi áp dụng, ghép media, xuất video,
đăng thủ công và ghi nhận hiệu suất.

### Mô hình người dùng

- Hai hoặc ba tài khoản cố định.
- Đăng nhập bằng email và mật khẩu.
- Không có organization, billing, marketplace hoặc hệ thống role phức tạp trong
  MVP.
- Authentication không thay thế authorization: mọi thao tác được bảo vệ phải
  xác minh người dùng hiện tại có quyền truy cập bản ghi yêu cầu.

## 4. Mục tiêu

- Xây dựng kênh bằng content mix, pillar, series và format có thể tái sử dụng.
- Tạo Organic content không cần Product và Affiliate content có Product evidence.
- Hỗ trợ Quick Image, Scripted và Media First trên một render pipeline dùng chung.
- Lưu thông tin sản phẩm và bằng chứng hỗ trợ để tái sử dụng khi có Product claim.
- Chuyển Content Brief thành script có cấu trúc khi path yêu cầu.
- Phát hiện Product claim không được hỗ trợ, hết hạn hoặc bị cấm trước khi TTS/render.
- Tạo hoặc gắn voiceover và media theo từng scene.
- Preview và render MP4 dọc.
- Lưu version và trạng thái job có thể tiếp tục.
- Ghi nhận chi phí và metrics sau đăng mà không tính trùng.

## 5. Ngoài phạm vi MVP

- Bán công cụ cho khách hàng bên ngoài.
- Thanh toán, subscription, quota hoặc token nội bộ.
- Workspace nhiều tenant và phân quyền nâng cao.
- Tự động đăng production lên mạng xã hội.
- Trình chỉnh sửa phi tuyến hoàn chỉnh như CapCut hoặc Premiere.
- Tự động fallback qua nhiều Video AI provider.
- AI tạo nhạc.
- Kết luận nhân quả hoặc recommendation model nâng cao.
- Ứng dụng mobile native.

## 6. Phạm vi triển khai

### Foundation hiện tại: golden affiliate flow

Golden flow đã được triển khai và phải tiếp tục regression-test trong mọi migration:

```text
Đăng nhập
→ tạo sản phẩm
→ thêm Product Facts đã xác minh
→ tạo project và Content Brief
→ tạo nháp và chỉnh script có cấu trúc
→ duyệt Fact Lock
→ gắn media thật
→ tạo hoặc gắn TTS
→ preview template 9:16 cố định
→ render MP4
→ xuất caption và affiliate disclosure
```

Foundation không bao gồm Video AI, tạo lịch nội dung, analytics nâng cao và auto-post.

### Phase A: Domain Evolution

- Thêm `contentType`, `creationPath` và ContentFormat ref persist bằng
  `content_format_key` + `content_format_version`; backfill project cũ thành
  `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1`.
- Cho `productId` nullable ở database nhưng enforce Product cho Affiliate và mọi
  Organic Product claim.
- Thêm runtime Applicability Resolver và server transition `nextApplicableStep`;
  giữ nguyên enum của `project_step_status`.
- Hỗ trợ ScriptGeneration input source mode
  `PRODUCT_BACKED | ORGANIC_NO_PRODUCT`, tách khỏi operation mode `full | repair`.
- Thêm server-built ClaimManifest và FactLockRun Manifest-first, tương thích run cũ.

### Phase B: Quick Image

- `ORGANIC + QUICK_IMAGE` không cần Product, Script hoặc Fact Lock khi không có Product claim.
- Một ảnh 9:16, duration 5/10/15 giây, zoom/pan/Ken Burns, text/music/voice tùy chọn.
- Shared composition/render tạo immutable MP4 variation và không overwrite output cũ.

### Phase C: Channel-first UI và vận hành

- Một Channel Strategy trên mỗi workspace: niche, audience, pillars, series,
  format defaults, content mix, visual style, voice preset, CTA và disclosure.
- Video Studio trình bày theo bốn tab Content → Resources → Compose → Export,
  nhưng không thay thế bảy persisted project step keys.
- Content Library và Calendar chỉ bắt đầu sau Domain Evolution + Quick Image.
- Manual metrics import và analytics mô tả bắt đầu sau Library/Calendar.

### Post-MVP: media sinh bởi AI có kiểm soát

- Một Video AI provider qua adapter và feature flag.
- Job bất đồng bộ, idempotency, giới hạn retry và xác nhận chi phí.
- Tối đa hai scene AI và mười hai giây AI cho mỗi video.
- Có thể thay bằng media thật khi tạo AI lỗi hoặc bị từ chối.

## 7. Khái niệm domain cốt lõi

### Product

Trong AFF-US-005, Product tối thiểu có `name`, `category`, `status`, `thumbnailUrl`,
`sourceUrl`, `affiliateUrl`, `priceAmount` nullable integer và `currency=VND`. `archivedAt`
là trạng thái lưu trữ độc lập với `status`; Product có thể được archive dù đang được Project
tham chiếu. Product mới chỉ được chọn khi `status=active` và `archivedAt IS NULL`. Project cũ
không bị tháo liên kết khi Product inactive/archived và vẫn phải đọc/lưu được nếu giữ nguyên
`productId`. Xóa cứng chỉ hợp lệ khi không còn dòng Project tham chiếu; US005 chưa bao gồm
Product Facts CRUD, R2 hay media upload đầy đủ.

Product Library hỗ trợ tìm kiếm, lọc và tải thêm theo cursor khi còn dữ liệu. Thumbnail chỉ nhận
URL HTTPS hợp lệ; source URL và affiliate URL nhận HTTP hoặc HTTPS hợp lệ. Giá trị URL rỗng sau
trim được coi là chưa khai báo.

Sản phẩm affiliate tái sử dụng, gồm danh tính, link affiliate, trạng thái, media
và tham chiếu hiệu suất.

### Product Fact

Trong AFF-US-006, Product Fact là một bản ghi con của Product, dùng để lưu thông tin có cấu
trúc có thể tái sử dụng trong brief. Schema MVP lưu `content`, `type`, `status`, source metadata,
`confirmedAt`, `expiresAt`, `notes` và audit user/timestamps. `Product.priceAmount` chỉ là
metadata hiển thị của Product; Fact có `type=price` mới là nguồn Fact được phép dùng cho AI.

Type MVP: `price`, `promotion`, `specification`, `feature`, `claim`, `policy`, `other`.
Status MVP: `draft`, `verified`, `inactive`; không dùng `fresh`, `stale` hoặc `expired` trong
slice này. `confirmedAt` và `expiresAt` dùng ngày lịch `YYYY-MM-DD`; ngày hết hạn không được
trước ngày xác nhận.

Fact `price`, `promotion` và `claim` chỉ được `verified` khi có `sourceType`, có ít nhất
`sourceLabel` hoặc `sourceUrl`, và có `confirmedAt`. `feature`, `specification`, `policy` và
`other` có thể verified không cần evidence theo rule MVP. AI eligibility là server/core rule:
`verified` và thỏa evidence theo type; `draft`/`inactive` không eligible.

Sửa `content`, `type`, source hoặc ngày của Fact đang `verified` mặc định dùng intent bảo toàn và
phải tự động trở về `draft`; chỉ action re-verify rõ ràng với evidence hợp lệ mới giữ/chuyển sang
`verified`. Quy tắc này cũng áp dụng khi đổi sang type cần evidence hoặc khôi phục từ `inactive`;
sửa chỉ `notes` có thể giữ `verified`. Create/update/delete
đồng thời ghi `ProductFactHistory` theo snapshot post-create, pre-update và pre-delete. History
không phụ thuộc FK tới Fact nên vẫn truy vết được `productFactId` sau khi Fact bị xóa.

Product không hard-delete nếu còn Project reference, Product Fact hoặc Fact history; archive
không làm mất Facts. UI Product Detail có tab deep-link `/products/{productId}?tab=facts` với
search, type/status filter, cursor pagination, drawer thêm/sửa và dialog xóa. Freshness automation,
stale detection, scheduler, scraping/fetching và Fact Lock nằm ngoài AFF-US-006.

### Project

Project là content production unit và đóng vai trò Content Item trong MVP. Project
có `contentType`, `creationPath`, `contentFormat`, lifecycle riêng và các version
script, scene, asset, render, publication, analytics liên quan. `productId` nullable
chỉ với Organic không có Product claim; Affiliate và mọi Organic Product claim
đều cần accessible Product.

Content Type canonical: `ORGANIC | AFFILIATE`. Creation Path MVP:
`QUICK_IMAGE | SCRIPTED | MEDIA_FIRST`; `AI_VISUAL` bị disable đến Post-MVP.
ContentFormat là server-owned versioned semantic content/presentation preset được
pin trên Project bằng `(key, version)`. Initial registry gồm
`SCRIPTED_STANDARD v1`, `QUICK_IMAGE_STANDARD v1` và `MEDIA_FIRST_STANDARD v1`,
mỗi format là default của CreationPath tương ứng và dùng được cho cả Organic lẫn
Affiliate. ContentFormat không phải ContentType, CreationPath, Pillar, Series,
user template, CompositionTemplate/render ID hoặc workflow state; nó không tự
quyết Product, Script, Fact Lock, Voice hay Render. DEC-026 là contract chi tiết.

Applicability Resolver tính runtime state cho Product, Script, Fact Lock, Voice và
Render: `NOT_REQUIRED | OPTIONAL | REQUIRED | READY | BLOCKED | STALE`. Các state
này không được ghi trực tiếp vào enum persisted `project_step_status.status`.
Khi current step không áp dụng, server dùng business action có transaction để
chuyển `currentStepKey` tới persisted step tiếp theo thực sự áp dụng.

### Script generation

AFF-US-008 tạo generated artifact read-only theo input source mode do server
resolver chọn. `PRODUCT_BACKED` đọc Project, Brief, Channel Settings, Product,
Product Facts, Media Metadata và Output Rules. `ORGANIC_NO_PRODUCT` không lookup
Product/Facts và prompt phải cấm invent Product claim. Input source mode này là
dimension mới, không thay persisted generation operation mode `full | repair`.
Cả hai input source mode giữ output ScriptDraft, versioning, repair, idempotency,
snapshot/hash và provider metadata hiện tại.
Provider output vẫn là dữ liệu không đáng tin cậy và candidate claim chưa qua
policy gate khi gate áp dụng.

Script generation không phải nội dung đã được người dùng chọn/chỉnh và không tự hoàn tất workflow.
`pending`, `failed` hoặc `indeterminate` không được làm mất artifact completed/partial trước đó.

### Script version

Phiên bản bất biến đã lưu của hook, voiceover segment, chỉ dẫn scene, on-screen
text, CTA, caption, hashtag, disclosure và các claim đã tách.

### Claim Manifest

Immutable claim inventory do server build từ mọi output-bearing source:
ScriptVersion, overlay, caption, CTA, voice text, declared claim và composition
version. ClaimManifest có source type/version, normalized claims, `isEmpty`,
fingerprint và audit timestamp. Client không được cung cấp `isEmpty` hoặc
fingerprint làm source of truth. Lỗi extraction/normalization phải fail closed;
không được biến thành empty manifest.

### Fact Lock run

Run mới đánh giá đúng một ClaimManifest và lưu Manifest ID/fingerprint bất biến.
ScriptVersion chỉ là provenance/source adapter khi có. Run lịch sử gắn Script vẫn
đọc được mà không cần rewrite. Khi output-bearing source hoặc Product Fact
dependency thay đổi, kết quả cũ có effective state `STALE` và downstream bị khóa
theo policy.

### Scene

Một đoạn video có thứ tự, thời lượng, visual asset, voice segment, overlay text,
subtitle cue, transition preset và thông tin nguồn media.

### Render job và render version

Job bất đồng bộ được lưu bền vững và metadata đầu ra bất biến. Render lỗi hoặc
gián đoạn không được làm mất project.

### Published post và metric snapshot

Render version đã đăng và metrics tích lũy tại một thời điểm. Analytics tính phần
tăng giữa các snapshot và không cộng trực tiếp nhiều snapshot tích lũy.

## 8. Hành vi Fact Lock

Fact Lock chỉ áp dụng khi resolver trả `REQUIRED`: mọi Affiliate trước TTS/render
và mọi Organic có Product claim. Organic không Product claim trả `NOT_REQUIRED`;
factual knowledge không dựa trên Product Facts thuộc manual evidence flow riêng.

Classification của claim trong một Fact Lock run:

- `SUPPORTED`: có bằng chứng đủ và còn hiệu lực.
- `NEEDS_REVIEW`: có khả năng được hỗ trợ nhưng wording, phạm vi, nguồn hoặc hạn
  hiệu lực cần con người xử lý rõ ràng.
- `UNSUPPORTED`: không có Product Fact đủ hỗ trợ claim.
- `PROHIBITED`: vi phạm quy tắc nội dung đang áp dụng và không được override.
- `STALE` không phải classification của claim. Đây là effective status của run
  khi script revision hoặc Product Fact dependency không còn khớp snapshot; persisted
  run history không bị mutate.

Fact Lock run chỉ là `PASSED` khi:

- áp dụng cho đúng server-built ClaimManifest fingerprint hiện tại;
- không có claim `UNSUPPORTED` hoặc `PROHIBITED`;
- run không có effective status `STALE`;
- mọi claim `NEEDS_REVIEW` đã có hành động xử lý được ghi lại;
- mọi claim được hỗ trợ vẫn còn liên kết đến bằng chứng.

Affiliate claimless vẫn tạo empty ClaimManifest phía server và policy check có
thể PASS với zero claim results. Empty chỉ hợp lệ sau normalization thành công;
provider/extraction uncertainty phải trả `indeterminate` hoặc `blocked`.

Semantic matching hoặc LLM có thể đề xuất fact liên quan. Hệ thống không được
đánh dấu claim là supported nếu thiếu bằng chứng cụ thể.

### AFF-US-011 — Voice Studio Configuration & Preview

Voice Studio chỉ tương tác được khi Fact Lock đạt PASS cho ScriptVersion hiện tại.
Khi script hoặc Product Fact dependency trở nên stale, route Voice hiển thị locked
state và preview bị khóa lại. VoiceConfig là cấu hình hiện tại mutable của Project,
được lưu bằng revision CAS; audio preview là dữ liệu tạm thời, không phải artifact
và không được persist.

Production TTS của AFF-US-011 dùng APIKEY.FUN relay → Grok/xAI TTS qua
`POST /v1/tts`, với TTS credential riêng ở server. Tiếng Việt dùng language code
`vi`; speed có range `0.7..1.5`, mặc định `1.0`. Relay không expose voice
catalog runtime nên catalog verified do server sở hữu. Chi tiết contract nằm tại
`docs/aff-us-011-phase-0-contract-decisions.md`.

Phase 1 foundation đã lưu current VoiceConfig bằng revision CAS và expose catalog,
load/save API có Fact Lock/workspace authorization. UI panel, preview audio và
full voiceover vẫn chưa mở trong phase này. Phase 2 đã bổ sung server-derived
preview runtime qua protected binary endpoint; preview chỉ đọc ScriptVersion hiện
tại sau Fact Lock PASS, không nhận arbitrary client text/config và không persist
audio. Phase 3 đã mở Voice Studio với server-owned preset/language/speed controls,
dirty state, explicit save/CAS conflict reload, native audio preview và lỗi
loading/timeout/provider unavailable. Dirty config không được preview; Blob URL
được revoke khi thay thế, đổi draft hoặc unmount. Fact Lock stale khóa lại UI
nhưng giữ config đã lưu; rerun PASS mở lại. Full voiceover và audio artifact
vẫn chưa thuộc phase này.

### AFF-US-012 — Segment Voiceover Generation

AFF-US-012 tạo voiceover riêng cho từng `voiceoverSegment` của current
ScriptVersion. Người dùng chỉ được generate sau Fact Lock PASS và khi
VoiceConfig hiện tại đã lưu. Server tự lấy text theo `segmentKey`, pin
ScriptVersion ID/revision, text hash và VoiceConfig revision; client không được
gửi text hoặc voice fields làm authoritative input.

Mỗi lần TTS là một audio generation artifact bất biến có thể phát sinh nhiều
attempt/history. Audio của ScriptVersion hoặc VoiceConfig cũ vẫn được giữ để
audit nhưng không được chọn làm current, không cộng vào tổng thời lượng và
không làm Voice step ready. Audio persist qua private storage; database chỉ lưu
metadata/object key. Server parse audio metadata để xác định duration; browser
chỉ dùng cho playback.

Voiceover readiness đạt khi Fact Lock PASS, VoiceConfig current tồn tại và mọi
segment của current ScriptVersion có artifact completed khớp full source/config
fingerprint. Tổng thời lượng chỉ cộng các artifact current completed. Chi tiết
contract Phase 0 tại `docs/aff-us-012-phase-0-contract-decisions.md`; Phase 0
chưa tạo runtime, UI, schema hoặc migration.

AFF-US-012 Phase 1 đã tạo nền tảng artifact `voice_segment_artifact`, checksum,
server-side MP3 duration và local/private-storage boundary. Phase này chưa tạo
segment generation API, player/waveform UI, protected audio endpoint hoặc tự
động hoàn thành workflow.

AFF-US-012 Phase 2 đã mở rộng TTS provider bằng segment generation và application
service server-authoritative: request chỉ nhận project, segment key và idempotency
key; text, ScriptVersion, VoiceConfig, fingerprint, provider input và storage key
đều được resolve ở server. Runtime tách Tx A pending/provider-storage/Tx B finalize,
xử lý idempotency, partial-unique race, timeout uncertainty, invalid MP3, checksum,
duration authority và cleanup khi persistence lỗi. Protected oRPC list/getState/
generate và binary audio route kiểm tra workspace/project/artifact ownership,
ETag/304 và private cache. Phase này chưa có segment list/player/waveform UI hoặc
workflow completion; chưa gọi paid TTS/R2 thật trong test.

AFF-US-012 Phase 3 đã thêm Voice Segment Studio UI bên dưới VoiceConfig: danh sách
segment theo current ScriptVersion, trạng thái read model, generate/regenerate từng
đoạn, protected native player, server duration và waveform derived có cache memory.
UI giữ usable audio cũ khi regenerate, khóa khi VoiceConfig dirty hoặc Fact Lock
stale, map lỗi sanitized và không mutate workflow completion/total duration.
Waveform decode failure chỉ fallback player-only. E2E dùng deterministic TTS, không
gọi live APIKEY.FUN/R2.

AFF-US-012 Phase 4 đã hoàn tất workflow completion và final acceptance cho golden
affiliate flow. Readiness của flow này yêu cầu Fact Lock PASS,
VoiceConfig/current ScriptVersion và artifact completed usable khớp full
fingerprint cho mọi segment hiện tại. Tổng duration chỉ cộng `durationMs` của các
artifact đó. Server reconcile
`project_step_status` sau mutation và chỉ tiến `project.currentStepKey` từ `voice`
sang `video` khi ready; thay đổi script/config làm Video bị gate lại mà không tự
rollback current step. Pending quá lease thành indeterminate không retry provider.
Video của flow này yêu cầu đồng thời Fact Lock PASS và Voice ready. E2E dùng
deterministic TTS, không gọi live APIKEY.FUN/R2; không tạo migration mới.
AFF-US-012 đã DONE. Với path mới v0.8, resolver thay điều kiện Fact Lock PASS bằng
`Fact Lock PASS khi REQUIRED`; Organic claimless vẫn có thể opt-in Voice/TTS.

## 9. Các màn hình chính

US002 chuẩn hóa protected App Shell hiện tại: Dashboard, Dự án, Sản phẩm, Media
Library, Analytics, Chi phí & Usage và Cài đặt. Channel-first UI tiến hóa dần sang
Dashboard, Channel, Content/Projects, Products, Video Studio, Content Library,
Calendar, Analytics và Settings; route chưa có business logic phải dùng placeholder
trung thực.

Project tiếp tục persist bảy step keys: Sản phẩm, Nội dung, Fact Lock, Giọng đọc,
Dựng video, Preview & Render và Hoàn thành. Applicability Resolver quyết định step
nào được hiển thị, thu gọn hoặc bỏ qua. `NOT_REQUIRED` không được hiển thị như lỗi
hoặc `BLOCKED`.

Video Studio target dùng bốn tab trình bày:

```text
Content → Resources → Compose → Export
```

Bốn tab không phải state machine mới và không thay thẳng persisted step keys.

### Màn hình foundation hiện tại

1. Đăng nhập bằng tài khoản thành viên cố định được bootstrap ngoài luồng public.
2. Dashboard tối thiểu với trạng thái thiết lập và project gần đây.
3. Danh sách và chi tiết sản phẩm.
4. Trình chỉnh Product Facts.
5. Project và Content Brief.
6. Script Studio và panel Fact Lock.
7. Video workspace gồm media, TTS, preview và trạng thái render.
8. Kết quả render và gói export.

### Màn hình channel-first theo phase

- Domain Evolution: adaptive Project create/read, resolver state và gated routes.
- Quick Image: upload một ảnh, local motion, optional text/music/voice, preview/render.
- Channel Strategy và Content navigation.
- Content Library và Content Calendar.
- Analytics import/mô tả.
- Cài đặt provider, storage, voice và render.

## 10. Vòng đời nội dung

```text
IDEA
→ PREPARING
→ READY
→ IN_VIDEO
→ RENDERED
→ POSTED
→ ANALYZED
→ ARCHIVED
```

Content lifecycle tách khỏi production readiness, artifact status, publication
status và analytics import status. Fact Lock, Voice hoặc Render có thể
`NOT_REQUIRED`, `READY`, `BLOCKED` hoặc `STALE` mà không tự đổi lifecycle. Chuyển
trạng thái phải được kiểm tra ở server; UI không phải lớp kiểm soát duy nhất.

## 11. Yêu cầu UX toàn cục

- Mọi màn hình dữ liệu có trạng thái loading, empty, success, error và
  unauthorized.
- Hành động phá hủy cần xác nhận và phải tôn trọng quan hệ phụ thuộc.
- Autosave hiển thị saving, saved, offline và failed.
- Job dài vẫn tồn tại khi chuyển trang hoặc reload.
- Request tốn phí hiển thị provider, model, tham số đầu vào, chi phí dự kiến và
  chính sách retry trước khi gửi.
- Affiliate disclosure nằm trong gói export.
- Ngày giờ, múi giờ, tiền tệ, sample size và nguồn dữ liệu phải hiển thị khi ảnh
  hưởng đến cách hiểu.

## 12. Acceptance Criteria của canonical v0.8

- Thành viên cố định đăng nhập, đăng xuất và giữ session hợp lệ khi refresh.
- Người không có quyền không thể đọc hoặc sửa bản ghi được bảo vệ.
- Project cũ tiếp tục chạy như
  `AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1` và không mất Product, Script,
  Fact Lock hoặc Voice artifacts.
- Tạo được `ORGANIC + QUICK_IMAGE` không Product, Script hoặc Fact Lock khi không
  có Product claim; tạo `AFFILIATE + QUICK_IMAGE` vẫn bắt buộc Product.
- Organic có Product claim nhưng `productId=null` bị reject; link Product hợp lệ
  không làm Content Type tự chuyển thành Affiliate.
- Organic Scripted AI dùng `ORGANIC_NO_PRODUCT` mà không lookup Product Facts.
- UI phân biệt `NOT_REQUIRED` và `BLOCKED`; server bỏ qua step không áp dụng bằng
  `nextApplicableStep` mà không ghi enum mới vào `project_step_status`.
- Affiliate luôn có server-built ClaimManifest và Fact Lock policy check trước
  TTS/render; Organic no-claim không bị Fact Lock chặn.
- ClaimManifest empty chỉ PASS sau server normalization thành công; client không
  thể ép `isEmpty` hoặc fingerprint và uncertainty phải fail closed.
- FactLockRun new write persist Manifest ID/fingerprint; no-script run không cần
  ScriptVersion và legacy Script-linked rows vẫn đọc được.
- Organic no-claim có thể opt-in Voice/TTS khi Fact Lock là `NOT_REQUIRED`; khi
  Fact Lock `REQUIRED`, Voice/TTS vẫn fail closed đến khi PASS.
- Quick Image render tạo immutable MP4 variation; retry idempotent không làm mất
  Project hoặc tạo duplicate charge/output ngoài contract.
- Golden affiliate scripted regression tiếp tục đạt sau migration.
- Secret không xuất hiện trong source, client bundle, log, database hoặc file
  export.

## 13. Quyết định còn mở và migration readiness

| Phân loại | Quyết định | Gate |
|---|---|---|
| **CLOSED FOR M1 — DEC-026** | ContentFormat là server-owned versioned registry, persist bằng `content_format_key` + `content_format_version`; initial defaults và legacy backfill đã khóa. | M1 đủ điều kiện review; chưa tạo/apply migration trong Phase 0. |
| **NON-BLOCKER for Domain Evolution** | Schema chi tiết của applicability provenance snapshot trên artifact. | Trước khi ClaimManifest/Quick Image ghi artifact mới; resolver runtime và Project backfill không phải chờ. |
| **NON-BLOCKER for Domain Evolution** | MVP manual evidence review cho Organic factual knowledge không dựa trên Product Facts. | Trước khi bật factual Organic path tương ứng; Organic claimless/no-product vẫn được triển khai. |
| **NON-BLOCKER — contract đã khóa** | Conditional workflow resolver persistence. | DEC-025 đã khóa: applicability là runtime DTO, không mở rộng enum step status; chỉ `currentStepKey` transition bằng business action transactional. Chỉ còn implementation detail/audit shape. |
| **NON-BLOCKER — naming clarified** | Script generation `PRODUCT_BACKED | ORGANIC_NO_PRODUCT`. | Đây là input source mode riêng; không thay/overload operation mode `full | repair` hiện hữu. Đóng trước ScriptGeneration evolution, không chặn Project M1. |
| **NON-BLOCKER for Domain Evolution** | Nhóm Product Fact cần deterministic matching rule đầu tiên; pricing của APIKEY.FUN TTS relay. | Trước policy/provider rollout tương ứng, không chặn additive Project migration. |
| **DEFERRED** | Render worker engine, composition schema và local/private-R2 strategy cho render outputs. | Quick Image/render phase. VoiceSegment storage đã có contract riêng và không quyết định thay render storage. |
| **DEFERRED** | Analytics dedupe key. | Analytics phase sau Library/Calendar. |

Kết luận go/no-go: DEC-026 đã đóng blocker ContentFormat. **M1 READY for review**;
việc tạo/apply migration vẫn phải là task implementation riêng với preflight,
generated diff review và regression evidence.

Ownership của MVP 0 đã chốt: một internal workspace dùng chung, membership trong
`workspace_member` là ranh giới authorization và `createdByUserId` chỉ phục vụ audit.

Contract migration, Fact Lock và acceptance tương ứng nằm tại
`docs/domain-evolution-plan.md`, `docs/claim-manifest-fact-lock-contract.md` và
`docs/domain-evolution-acceptance.md`.

## Historical implementation notes — AFF-US-007 Fact Freshness

> Historical baseline before v0.8 Domain Evolution; giữ nguyên contract tại thời
> điểm story hoàn thành và không dùng làm current execution order.

AFF-US-007 mở rộng Product Facts bằng assessment freshness, không thay đổi các status
`draft | verified | inactive` của bản ghi Fact. `price` dùng tuổi tối đa 7 ngày và
`promotion` dùng tuổi tối đa 3 ngày; cảnh báo trước `expiresAt` một ngày. Các type khác
trả về `not_applicable`.

Assessment luôn tách ba trục: `verification`, `evidence` và `freshness`. Dữ liệu chưa
đủ an toàn để đánh giá trả về `unknown`; `expiresAt` đúng ngày hiện tại là `needs_update`,
không phải `expired`. Generation usability chặn draft, inactive, thiếu evidence, unknown
và expired; verified fresh được phép; verified needs_update được phép nhưng phải cảnh báo.

Mỗi Fact có `revision`. Sensitive field hoặc status thay đổi làm tăng revision; notes-only
không tăng revision. Update/delete yêu cầu `expectedRevision` và trả conflict an toàn khi
revision đã đổi. Dependency được đăng ký theo revision hiện tại, có replace/detach và audit
invalidation event khi Fact thay đổi, bị deactivate hoặc bị xóa. Dashboard nhóm cảnh báo theo
Product và dẫn tới tab Facts; Product Facts hiển thị badge `Còn hiệu lực`, `Cần cập nhật`,
`Hết hạn`, `Chưa xác định` và cảnh báo thiếu evidence.
AFF-US-008 foundation hardening: repair chỉ sửa các section invalid của parent `partial`, merge
server-side và tạo child bất biến; `requestHash` chỉ nhận client intent để replay không phụ thuộc
provider config. Generated output là untrusted, phải strict-validate cross-reference/hashtag và
state shape; live provider/API/UI vẫn chưa thuộc slice này.

## Historical implementation notes — AFF-US-008 AI input và cost visibility

Script generation chỉ được thực hiện khi workspace có Channel Settings đầy đủ và server đã resolve
provider/model. Input snapshot phải ghi lại Product Facts usable cùng revision/freshness, Content
Brief, Channel Settings, Media Metadata và Output Rules. Draft có 3–5 hook variants để người dùng
chọn ở phase editor sau; AI không tự chọn hook và không tự phê duyệt claim. Mọi request tốn phí phải
có cost estimate trước khi gửi provider; thiếu cấu hình hoặc estimate phải dừng an toàn.

### AFF-US-008 Phase 2B — live TextProvider

Text AI mặc định ở lớp cấu hình là APIKEY.FUN + Claude Sonnet 4.6; video AI vẫn
theo adapter APIKEY.FUN + Grok 720p ở roadmap, không triển khai trong phase này.
Provider/model phải có thể đổi qua adapter/AI Settings. API key, timeout và pricing
không thuộc dữ liệu người dùng hoặc client bundle. Output live vẫn phải giữ JSON
ScriptDraft v2, affiliate disclosure, claim policy, freshness và mọi validation của
server; AI không tự phê duyệt claim hoặc tự advance workflow.

# AFF-US-012 — Phase 0 Contract & Architecture Lock

- Trạng thái: Đã chấp nhận
- Ngày: 2026-08-21
- Phạm vi: khóa contract và kiến trúc cho voiceover theo segment
- Ngoài phạm vi: migration, runtime provider, storage implementation, API, UI và paid TTS

## 1. Mục tiêu và nguyên tắc

User Story:

> Là người dùng, tôi muốn tạo giọng đọc riêng cho từng đoạn để dễ nghe, sửa và
> đồng bộ với scene.

AFF-US-012 tạo một audio artifact bất biến cho từng lần gọi TTS của một
voiceover segment. Một logical segment có thể có nhiều generation attempts và
history. Audio cũ không bị sửa hoặc đổi thành `stale`; current/stale là read
model được suy ra từ fingerprint hiện tại của ScriptVersion và VoiceConfig.

Luồng chuẩn:

```text
current ScriptVersion
  → FactLockGate PASS cho đúng script revision
  → current VoiceConfig
  → client gửi segmentKey + idempotencyKey
  → server snapshot source/config và tạo pending artifact
  → provider call ngoài transaction
  → validate audio/mpeg và parse duration ở server
  → ghi audio vào storage private
  → finalize artifact
  → protected list/stream/player
  → derive total duration và Voice readiness
```

Không giữ database transaction hoặc row lock trong lúc chờ provider hay storage.
Không đưa text, voice config, script revision hoặc storage key từ client thành
authoritative input. Không auto-retry một request có thể đã tính phí.

## 2. Repo audit

### 2.1 ScriptVersion / Script Editor

- `script_version` là boundary editable riêng của AFF-US-009.
- Draft hiện tại có `status='draft'`, một draft duy nhất theo workspace/project,
  `revision` tăng bằng CAS và `editableSnapshotJson` là source of truth.
- Saved history là snapshot bất biến; không dùng saved history làm current
  ScriptVersion cho voice generation.
- `findCurrentScriptVersion()` đang resolve draft theo workspace/project và
  `updatedAt`; Phase 1 phải dùng cùng semantics hoặc đưa helper tương đương vào
  application service.
- `voiceoverSegments` có thứ tự và mỗi item có `key` cùng `text`. `segmentKey`
  do server kiểm tra trong current snapshot, không trust text từ browser.

### 2.2 FactLockGate

- `evaluateFactLockGate()` là pure gate hiện có.
- `FactLockGate.assertPassed(actor, projectId)` resolve workspace/project, current
  ScriptVersion, đúng `scriptVersionId + revision`, Fact Lock run và Product Fact
  dependencies.
- TTS generation phải gọi gate trước khi tạo pending artifact. Không dùng
  `factLockPassed`, `allowed` hoặc gate reason do client gửi.
- Nếu ScriptVersion hoặc Product Fact dependency đổi, gate không còn PASS cho
  current revision; artifact lịch sử vẫn giữ nguyên nhưng không còn current.

### 2.3 VoiceConfig / Voice Studio / Preview

- `voice_config` là current mutable configuration, unique theo
  `(workspaceId, projectId)`, revision CAS và không lưu audio.
- Catalog hiện tại là server-owned `apikeyfun`, voice `ara/eve/leo/rex/sal`,
  language `vi`, speed `0.7..1.5`, default `1.0`.
- `voice.getConfig/saveConfig` và preview đều dùng server-side Fact Lock gate.
- Preview route hiện server tự lấy text từ ScriptVersion, nhận body rỗng từ
  browser và không persist audio. Preview không được tái sử dụng như segment
  artifact.

### 2.4 TtsProvider và APIKEY.FUN

- `TtsProvider` hiện chỉ có `listVoices()` và `preview()`.
- `TtsPreviewResult` có bytes, `audio/mpeg`, provider request ID và latency;
  chưa có segment generation hoặc duration metadata.
- `ApiKeyFunTtsProvider` thực hiện một request `POST /v1/tts`, timeout preview,
  strict MIME/empty/size validation và không retry.
- Registry đã bảo vệ deterministic provider: chỉ bật khi explicit E2E flag và
  không bật trong production. Phase 1 phải giữ invariant này khi mở rộng
  generation.
- Không có paid provider call trong Phase 0.

### 2.5 Project workflow / Project steps

Repo đã có workflow source of truth, không cần tạo bảng mới:

- `project.currentStepKey` là current step key persisted.
- `project_step_status` lưu status theo `(projectId, stepKey)`, unique và có
  status `not_started | completed | needs_review | blocked`.
- `ProjectRepository` đọc cả current step và persisted step statuses.
- Web hiện derive display status từ persisted workflow cùng Fact Lock gate; route
  chỉ xác định màn hình đang xem, không tự biến thành workflow mutation.
- Chưa có Voice readiness hoặc tổng duration domain read model. Phase 4 phải
  thêm business-specific derive/action, không thêm `project_step_status` thứ hai
  và không expose generic status mutation.

### 2.6 Storage, environment và dependencies

- Architecture đã quy định database chỉ lưu metadata/object key, binary nằm ở
  storage; local/R2 adapter là boundary tương lai.
- Tracked source chưa có `VoiceAudioStorage`, local audio adapter, R2 adapter hay
  protected audio artifact stream.
- Environment hiện chỉ có TTS preview timeout/max chars và TTS credential/base
  URL; chưa có segment limit, segment timeout, storage provider/root/R2 config.
- Production manifests chưa có thư viện duration MP3/audio metadata hoặc R2/S3
  adapter được dùng cho voiceover. Phase 1 phải audit/chọn một dependency phù
  hợp; không mặc định dùng browser duration hoặc FFmpeg trong web request.

## 3. Artifact model đã khóa

Tên semantic: `VoiceSegmentArtifact`. Tên bảng đề xuất: `voice_segment` để khớp
domain hiện tại. Mỗi row là một generation attempt, không phải canonical text
segment.

### 3.1 Immutable history và lifecycle

Artifact history là append-only sau khi tạo. Lifecycle của một attempt được phép
đi theo một chiều:

```text
pending → completed
pending → failed
pending → indeterminate
```

Metadata final của attempt không được sửa để biến audio cũ thành artifact mới.
Chỉ lifecycle/error/finalization fields của một pending attempt được cập nhật
trong các transaction finalize/reconciliation cần thiết. Retry luôn tạo artifact
attempt mới.

Persisted status chỉ gồm:

```text
pending | completed | failed | indeterminate
```

`stale` không phải persisted status. Nó là effective/read-only result khi
fingerprint artifact không khớp current ScriptVersion hoặc VoiceConfig.

### 3.2 Fingerprint

Server tạo fingerprint đầy đủ từ:

```text
workspaceId
projectId
sourceScriptVersionId
sourceScriptRevision
segmentKey
textHash
voiceConfigRevision
provider
voiceId
language
speed
```

`textHash` là SHA-256 của đúng `segmentTextSnapshot` UTF-8 mà server lấy từ
current ScriptVersion. Không trim, dịch, hoặc silently normalize nội dung trước
khi hash. Line ending/canonical text representation sẽ được thống nhất ở
implementation và phải được dùng giống nhau khi hash và provider input.

Độ dài input được đếm theo Unicode code points; text rỗng hoặc chỉ whitespace bị
từ chối. Text tiếng Việt, emoji, tiền tệ, ký hiệu và brand name được giữ nguyên
trong snapshot/provider input.

`requestHash` là SHA-256 canonical serialization của fingerprint đầy đủ cộng
với operation kind `segment-generation`. Client không được gửi hoặc chọn hash.

### 3.3 Latest request, usable artifact và effective status

Đây là ba khái niệm khác nhau:

- `latestRequest`: attempt mới nhất theo `createdAt` của logical segment/current
  request fingerprint, bất kể pending/failed/indeterminate/completed.
- `latestUsableArtifact`: artifact mới nhất có `completed`, storage metadata hợp
  lệ, `audio/mpeg`, duration hợp lệ và khớp current full fingerprint.
- `effectiveStatus`: trạng thái read model của segment trong current context.
  Nếu Fact Lock/config/script không usable thì là blocked theo gate; nếu không có
  artifact current thì `not_generated`; nếu latest request đang pending thì
  `pending`; nếu latest request indeterminate/failed thì phản ánh trạng thái đó;
  nếu có completed current artifact usable thì là `completed`. UI vẫn có thể phát
  `latestUsableArtifact` khi một attempt mới failed, nhưng không được coi attempt
  failed là audio current mới.

## 4. Idempotency, retry và concurrent pending

### 4.1 Client input

Generation application API chỉ nhận:

```text
projectId
segmentKey
idempotencyKey
```

`projectId` có thể nằm trong route và body tùy convention transport, nhưng phải
được đối chiếu cùng một project. Client không authoritative cho:

```text
text
voiceId
language
speed
provider
scriptVersionId
scriptRevision
voiceConfigRevision
storageProvider
storageKey
requestHash
```

Server resolve current ScriptVersion, tìm `segmentKey`, đọc VoiceConfig và tạo
full fingerprint/requestHash.

### 4.2 Rules

```text
same workspace/project + same idempotencyKey + same requestHash
  → trả cùng artifact attempt, không gọi provider lần hai

same workspace/project + same idempotencyKey + khác requestHash
  → conflict, không gọi provider

failed hoặc indeterminate
  → request mới với idempotencyKey mới, tạo artifact mới

explicit regenerate sau artifact completed
  → idempotencyKey mới, artifact mới
```

Một request mới có cùng `requestHash` trong lúc đã có pending artifact nhưng
dùng idempotency key khác sẽ nhận `VOICE_SEGMENT_ALREADY_PENDING`, không bind key
mới vào artifact của key cũ. Đây là bảo vệ side effect/concurrent paid call mà
vẫn giữ được exact reuse cho từng idempotency key. Sau khi attempt terminal,
idempotency key mới được phép tạo attempt đầu tiên của key đó.

Database đề xuất partial unique index trên `(workspaceId, projectId, requestHash)`
cho `status='pending'`. Không tạo unique index trên full fingerprint vì nó sẽ
chặn retry và explicit regenerate.

### 4.3 Pending lease và reconciliation

Pending quá lease không được tự gọi provider lần nữa. Reconciler hoặc explicit
operator action có thể chuyển `pending → indeterminate` sau khi không còn tin
được delivery outcome. Request mới phải dùng idempotency key mới và người dùng
được cảnh báo rằng attempt cũ có thể đã tính phí.

Không dùng blind retry sau process crash, timeout hoặc network uncertainty.

## 5. TTS generation contract

Preview contract hiện tại phải giữ nguyên. Phase 1 mở rộng provider bằng primitive
riêng để không làm thay đổi `preview()`:

```ts
export type TtsSegmentInput = {
	text: string;
	voiceId: string;
	language: string;
	speed: number;
};

export type TtsSegmentResult = {
	audio: Uint8Array;
	contentType: "audio/mpeg";
	providerRequestId: string | null;
	providerDurationMs: number | null;
};

export interface TtsProvider {
	readonly providerId: string;
	listVoices(): VoicePreset[];
	preview(input: TtsPreviewInput): Promise<TtsPreviewResult>;
	generateSegment(input: TtsSegmentInput): Promise<TtsSegmentResult>;
}
```

`providerDurationMs` chỉ là advisory. Server không persist duration này làm
authoritative nếu chưa parse bytes.

Provider adapter phải:

- validate input và catalog ở server boundary;
- giới hạn Unicode input theo `TTS_SEGMENT_MAX_CHARS`;
- giới hạn bytes theo `TTS_SEGMENT_MAX_BYTES`;
- reject empty body, MIME khác `audio/mpeg`, HTML/JSON giả audio và output quá lớn;
- dùng `TTS_SEGMENT_TIMEOUT_MS` server-owned;
- thực hiện tối đa một provider request cho một artifact attempt;
- map timeout/network/unknown delivery thành uncertain/indeterminate;
- không log credential, raw provider body hoặc raw audio.

Giá trị cụ thể của ba limit/lease env phải được chốt ở Phase 1 sau khi kiểm tra
khả năng segment của relay; tên contract đã khóa là:

```text
TTS_SEGMENT_MAX_CHARS
TTS_SEGMENT_MAX_BYTES
TTS_SEGMENT_TIMEOUT_MS
TTS_SEGMENT_PENDING_LEASE_MS
```

Không được truncate text silently. Exact max boundary được chấp nhận; vượt max
phải fail trước provider.

## 6. Duration authority

Server là source of truth cho `durationMs`.

```text
provider trả audio bytes
  → validate MIME/empty/size
  → server parse MP3 metadata
  → durationMs hợp lệ mới được persist
```

`providerDurationMs` chỉ dùng đối chiếu/log an toàn hoặc telemetry nullable.
Browser/Web Audio duration không được ghi vào DB và không quyết định workflow.

Nếu server không parse được MP3 metadata:

```text
TTS_AUDIO_METADATA_INVALID
→ artifact failed
→ không lưu artifact completed
→ không tính vào tổng duration
```

Phase 1 phải audit dependency manifest trước khi chọn thư viện parser. Hiện
không có audio metadata dependency đã được repo sử dụng. Cần thêm deterministic
MP3 fixture có duration biết trước và test bytes không hợp lệ; không dùng một
frame MPEG tối thiểu chưa có duration đáng tin làm fixture completed.

## 7. Storage contract

Semantic abstraction:

```ts
interface VoiceAudioStorage {
	readonly provider: "local" | "r2";
	put(input: {
		storageKey: string;
		body: Uint8Array;
		contentType: "audio/mpeg";
		checksum: string;
	}): Promise<{ byteSize: number; checksum: string }>;
	open(storageKey: string): Promise<ReadableStream<Uint8Array>>;
	delete(storageKey: string): Promise<void>;
}
```

Implementations:

```text
development/test → LocalVoiceAudioStorage
production       → R2VoiceAudioStorage, private object
```

Storage key do server tạo, không nhận từ client:

```text
voice-segments/{workspaceId}/{projectId}/{artifactId}.mp3
```

`segmentKey` không được nối raw vào path. Local adapter phải resolve path dưới
configured root và reject path traversal; R2 adapter dùng private bucket/object
key, không public mặc định. DB lưu `storageProvider`, `storageKey`, `mimeType`,
`byteSize`, `checksum`, `durationMs`; không lưu binary/base64 hoặc arbitrary file
path.

Protected audio stream phải query artifact bằng actor workspace + project, kiểm
tra artifact ownership và chỉ mở DB-known storage key. Không có endpoint đọc path
tùy ý. Cache ban đầu dùng private/no-store semantics; signed URL chỉ được thêm
khi có decision riêng.

Nếu DB finalize thất bại sau khi storage đã ghi, cleanup object là best effort;
không gọi provider lại. Cần reconciliation/cleanup path cho orphan object trước
production readiness.

## 8. Failure ordering và taxonomy

Runtime transaction boundary:

```text
Tx A:
  validate actor/project/source/segment/gate/config
  compute snapshot + fingerprint + requestHash
  resolve idempotency/concurrent pending
  insert pending artifact
  commit

provider call ngoài transaction

validate audio bytes + parse duration

storage.put ngoài transaction

Tx B:
  finalize cùng artifact nếu lifecycle còn pending
  lưu storage metadata, provider request ID, duration và status
```

Semantic error taxonomy:

```text
TTS_PROVIDER_FAILED
TTS_PROVIDER_UNAVAILABLE
TTS_PROVIDER_TIMEOUT
TTS_PROVIDER_UNCERTAIN
TTS_INVALID_AUDIO
TTS_AUDIO_METADATA_INVALID
TTS_STORAGE_FAILED
TTS_PERSISTENCE_FAILED
TTS_IDEMPOTENCY_CONFLICT
TTS_GENERATION_CONFLICT
TTS_SEGMENT_NOT_FOUND
TTS_SEGMENT_INPUT_TOO_LONG
TTS_SEGMENT_NOT_READY
```

Mapping chính:

```text
provider reject có kết quả rõ → TTS_PROVIDER_FAILED / TTS_PROVIDER_UNAVAILABLE
timeout/network/abort/không biết delivery → TTS_PROVIDER_UNCERTAIN
MIME sai, empty, vượt byte limit → TTS_INVALID_AUDIO
MP3 metadata không đọc được → TTS_AUDIO_METADATA_INVALID
storage put/delete/read lỗi → TTS_STORAGE_FAILED
storage thành công nhưng Tx B không finalize → TTS_PERSISTENCE_FAILED
same idempotency key + khác requestHash → TTS_IDEMPOTENCY_CONFLICT
```

Provider timeout/uncertain không tự retry. Nếu artifact pending không thể
finalize sau crash, reconciliation phải bảo toàn trạng thái bảo thủ và không
gọi lại provider chỉ vì thiếu response.

## 9. Race semantics

### 9.1 Script thay đổi trong lúc TTS chạy

```text
start:    current ScriptVersion rev5, segment text hash A
provider: user sửa draft, ScriptVersion thành rev6
result:   artifact rev5/hash A vẫn có thể finalize lịch sử
          effectiveStatus không phải current
          không được tính vào Voice readiness hoặc total duration hiện tại
```

Artifact không bị delete hoặc mutate thành `stale`. Khi đọc current, server so
`sourceScriptVersionId`, `sourceScriptRevision`, `segmentKey` và `textHash` với
current snapshot.

### 9.2 VoiceConfig thay đổi trong lúc TTS chạy

```text
start:    Eve, VoiceConfig revision 1
provider: user lưu Ara, VoiceConfig revision 2
result:   artifact Eve/rev1 vẫn có thể finalize lịch sử
          không phải latest usable artifact của config hiện tại
          không unlock workflow
```

Phase 2 service phải giữ snapshot đã resolve ở Tx A và Tx B chỉ finalize đúng
artifact ID/lifecycle. Không overwrite artifact bằng VoiceConfig mới.

## 10. Current/stale read model

Current segment được resolve từ current draft ScriptVersion và current VoiceConfig:

```text
currentScript = workspace + project + status='draft'
currentSegment = currentScript.editableSnapshot.voiceoverSegments[segmentKey]
currentConfig = workspace + project voice_config
gate = FactLockGate.assertPassed(actor, projectId)
```

Current full fingerprint phải khớp tất cả:

```text
scriptVersionId
scriptRevision
segmentKey
textHash
voiceConfigRevision
provider
voiceId
language
speed
```

Read algorithm:

1. Resolve actor/project trong workspace.
2. Resolve gate/current ScriptVersion/current segment/current VoiceConfig.
3. Query attempts theo workspace/project/segment và order `createdAt DESC`.
4. Tính `latestRequest` từ request mới nhất của current fingerprint.
5. Tính `latestUsableArtifact` từ completed artifact khớp full fingerprint và
   metadata/storage còn hợp lệ.
6. Nếu artifact không khớp current fingerprint, gắn effective `stale` ở read
   model; không update lịch sử.
7. Chỉ current completed artifact được phát, tính duration và dùng cho workflow.

Artifact của ScriptVersion/VoiceConfig cũ có thể hiện trong history nhưng không
được chọn vào current list hoặc tổng duration.

## 11. Workflow completion và total duration

Workflow source of truth tiếp tục là `project.currentStepKey` và
`project_step_status`. Không thêm bảng status mới, không expose generic status
mutation và không cho route tự advance.

Voice readiness là domain/read-model predicate:

```text
FactLockGate PASS
AND current VoiceConfig tồn tại
AND current ScriptVersion có voiceover segments hợp lệ
AND mọi segment hiện tại có latestUsableArtifact completed
    khớp full fingerprint
```

Script có zero voiceover segment không được tự động coi là Voice complete; phải
bị chặn bởi strict ScriptVersion readiness hoặc lỗi domain rõ ràng.

`totalVoiceoverDurationMs` chỉ là tổng `durationMs` của current completed
artifacts theo đúng thứ tự current ScriptVersion. Historical, stale, failed,
pending và indeterminate không được cộng.

Nếu Phase 4 cần ghi `project_step_status='completed'` hoặc chuyển
`currentStepKey`, việc đó phải là business action server-side có authorization và
transaction nhất quán. Artifact finalize không tự ý gọi generic workflow update.

## 12. Proposed schema — chưa tạo migration

Tên bảng đề xuất: `voice_segment`.

| Field | Kiểu/semantic | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | text/UUID | Có | artifact attempt ID |
| `workspaceId` | text FK workspace | Có | authorization scope |
| `projectId` | text FK project | Có | project scope |
| `createdByUserId` | text FK user | Có | audit actor |
| `sourceScriptVersionId` | text FK script_version | Có | source pin |
| `sourceScriptRevision` | integer | Có | `>= 1` |
| `segmentKey` | text | Có | key từ server snapshot |
| `segmentTextSnapshot` | text | Có | exact provider input snapshot |
| `textHash` | text | Có | SHA-256 UTF-8 |
| `voiceConfigRevision` | integer | Có | `>= 1` |
| `provider` | text | Có | server catalog, hiện `apikeyfun` |
| `voiceId` | text | Có | catalog ID |
| `language` | text | Có | hiện `vi` |
| `speed` | real/numeric | Có | server range check |
| `idempotencyKey` | text | Có | scoped workspace/project |
| `requestHash` | text | Có | server-computed fingerprint |
| `status` | text | Có | pending/completed/failed/indeterminate |
| `providerRequestId` | text | Không | nullable audit |
| `errorCode` | text | Không | typed safe code, không raw body |
| `storageProvider` | text | Không | null trước storage/failure |
| `storageKey` | text | Không | server-generated private key |
| `mimeType` | text | Không | completed phải `audio/mpeg` |
| `byteSize` | bigint | Không | completed `> 0` |
| `checksum` | text | Không | checksum audio bytes |
| `durationMs` | bigint | Không | server-parsed, `>= 0` |
| `createdAt` | timestamp | Có | attempt order |
| `finishedAt` | timestamp | Không | terminal lifecycle |
| `updatedAt` | timestamp | Có | lifecycle/reconciliation |

`segmentTextSnapshot` cần được giữ để audit/replay-safe comparison; không dùng
client text để overwrite. Raw provider response, credential, signed URL và
binary không được lưu.

Indexes/constraints Phase 1 cần review trong migration:

- FK/index workspace/project, source ScriptVersion và creator.
- Unique `(workspaceId, projectId, idempotencyKey)`.
- Partial unique `(workspaceId, projectId, requestHash) WHERE status='pending'`
  để chống duplicate side effect.
- Current read index trên
  `(workspaceId, projectId, sourceScriptVersionId, sourceScriptRevision,
  segmentKey, voiceConfigRevision, createdAt)`.
- History index trên `(workspaceId, projectId, segmentKey, createdAt)`.
- Check status, revisions, speed, byteSize/duration và completed metadata shape.
- Không unique full fingerprint; regenerate/retry cần tạo history row mới.

FK không thay thế authorization. Mọi read/mutation/audio stream vẫn lọc actor
workspace + project + artifact ownership ở service boundary.

## 13. Contract acceptance tests cho Phase 1–4

### Source, validation và content preservation

- segment hợp lệ được generate từ server snapshot.
- client arbitrary text bị reject hoặc bị bỏ qua hoàn toàn.
- đúng exact max boundary được chấp nhận; vượt max fail trước provider.
- text tiếng Việt, Unicode, emoji, `150.000 ₫`, ký hiệu và brand name giữ đúng
  snapshot/hash/provider input.

### Idempotency/history/concurrency

- same idempotency + same request trả cùng artifact, provider một lần.
- same idempotency + khác request trả conflict, provider zero.
- concurrent pending cùng requestHash không tạo hai paid calls.
- retry failed/indeterminate dùng key mới và artifact mới.
- explicit regenerate tạo artifact mới nhưng giữ artifact usable cũ.
- latestRequest khác latestUsableArtifact được trả đúng.

### Provider/audio/duration

- provider success.
- provider unavailable, timeout và network uncertainty thành indeterminate đúng
  policy, không blind retry.
- invalid MIME, JSON/HTML body, empty audio và oversize audio bị reject.
- duration fixture hợp lệ được parse server-side.
- duration metadata invalid thành `TTS_AUDIO_METADATA_INVALID`.
- deterministic provider được dùng trong unit/integration/E2E; không paid call.

### Storage/authorization

- local put/open/delete.
- storage failure không gọi lại provider.
- storage thành công nhưng DB finalize lỗi không blind retry và có cleanup path.
- path traversal/arbitrary storage key bị từ chối.
- cross-workspace audio read/stream bị từ chối.
- reload vẫn load current persisted audio đúng protected endpoint.

### Races/workflow/read model

- Script rev đổi trong lúc provider chạy: artifact cũ giữ lịch sử nhưng stale,
  không unlock và không cộng duration.
- VoiceConfig rev đổi trong lúc provider chạy: artifact cũ giữ history nhưng
  không current.
- current/stale selection đúng sau reload.
- total duration chỉ sum current completed artifacts.
- Voice readiness đúng với Fact Lock, current config và mọi segment hiện tại.
- persisted workflow/current step không bị route hoặc generic client mutation
  ghi đè.

## 14. Phase 1–4 implementation plan

### Phase 1 — Foundation

- thêm core types/errors/hash/fingerprint và repository contract;
- chọn duration parser sau dependency audit, thêm deterministic MP3 fixture;
- thêm `voice_segment` schema/migration sau DB safety review;
- thêm local storage adapter và contract tests;
- thêm current/latest read helpers;
- mở rộng provider type nhưng chưa bật paid generation nếu acceptance chưa đủ.

### Phase 2 — Generation runtime

- implement `generateSegment()` cho deterministic và APIKEY.FUN adapter;
- implement protected `voiceSegment.getState/list/generate`;
- implement protected audio stream;
- enforce Tx A/provider/metadata/storage/Tx B ordering;
- thêm idempotency, pending reconciliation, error mapping và race tests.

### Phase 3 — Voiceover UI

- danh sách segment theo current ScriptVersion order;
- loading/pending/completed/failed/indeterminate/stale states;
- native player qua protected stream;
- waveform peaks derived bằng Web Audio, không lưu waveform DB;
- giữ audio usable cũ khi regenerate thất bại; revoke object URL nếu dùng Blob.

### Phase 4 — Workflow hardening và acceptance

- derive total duration/readiness từ current artifacts;
- thêm business action cụ thể nếu cần cập nhật `project_step_status/currentStepKey`;
- test reload, script/config race, workspace isolation và full acceptance flow;
- chỉ manual live smoke 1–2 segment khi được bật explicitly ngoài automated suite;
- không gọi paid TTS trong unit/integration/E2E mặc định.

## 15. Open questions/blockers trước Phase 1

Các điểm cần chủ dự án/provider review trước migration hoặc runtime:

1. Chốt giá trị production cho `TTS_SEGMENT_MAX_CHARS`,
   `TTS_SEGMENT_MAX_BYTES`, `TTS_SEGMENT_TIMEOUT_MS` và pending lease. Phase 0
   đã khóa tên/semantics nhưng chưa tự bịa giới hạn capability của relay.
2. Chọn thư viện MP3 metadata parser không phụ thuộc browser; repo hiện chưa có
   dependency phù hợp. Nếu dùng FFmpeg, phải chốt nơi chạy ngoài web request.
3. Chốt R2 bucket/credential env và local storage root/config cho deployment; R2
   phải private.
4. Chốt cleanup/reconciliation executor cho orphan object và pending
   indeterminate trước production readiness.
5. Chốt Phase 4 cập nhật `project_step_status` bằng business action nào, hay chỉ
   expose Voice readiness derived cho tới khi người dùng advance bước.
6. Chốt cache policy của protected audio stream; mặc định Phase 0 là private/no-store.

Không có blocker nào yêu cầu sửa US11, Fact Lock, VoiceConfig, preview endpoint
contract hoặc migration hiện tại. Không implement Phase 1 cho tới khi các điểm
ảnh hưởng schema/runtime được review/accepted.

## 16. Phase boundary và xác nhận thay đổi

Phase 0 này chỉ audit và cập nhật contract/architecture docs.

```text
Migration changed: NO
Schema changed: NO
Runtime code changed: NO
API/UI changed: NO
Paid TTS called: NO
Migration 0016 created: NO
```

Source of truth của Phase 0 là tài liệu này cùng DEC-024. Phase 1 chỉ bắt đầu
sau review/acceptance rõ ràng.

# AFF-US-011 — Phase 0 Contract & Architecture Freeze

- Trạng thái: Đã chấp nhận cho Phase 0
- Ngày: 2026-08-19
- Phạm vi: khóa contract và ranh giới kiến trúc; chưa triển khai Phase 1

## 1. Mục tiêu và phạm vi

User Story:

> Là người dùng, tôi muốn chọn voice preset, ngôn ngữ, tốc độ và nghe thử để xác
> nhận giọng phù hợp trước khi tạo toàn bộ voiceover.

AFF-US-011 chỉ kết thúc ở cấu hình Voice Studio đã lưu và bản nghe thử tạm thời.
Không tạo toàn bộ voiceover, không tạo audio artifact và không tạo pipeline audio
theo segment trong story này.

Luồng sản phẩm:

```text
Fact Lock PASS
  → mở Voice Studio
  → chọn language, voice preset, speed
  → lưu VoiceConfig
  → tạo preview ngắn
  → nghe audio
  → đổi cấu hình và preview lại
```

Phase 0 không tạo schema, migration, provider adapter, API, UI hoặc test runtime.

## 2. Bằng chứng capability và nguồn sự thật

Production TTS dùng đường đi:

```text
AffiChannel → APIKEY.FUN relay → Grok/xAI TTS
```

Canonical relay endpoint là `POST /v1/tts`. Capability probe trước Phase 0 đã
chứng minh:

- TTS key riêng xác thực được với `Authorization: Bearer`;
- `POST /v1/tts` với `text="Xin chào."`, `voice_id="eve"`, `language="vi"`
  và `speed=1.0` trả HTTP 200, `audio/mpeg`, 17.280 bytes trong khoảng 820 ms;
- `GET /v1/tts/voices` trả 404; relay không cung cấp voice catalog runtime;
- `POST /v1/audio/speech` trả 404; không triển khai OpenAI-compatible route;
- `/v1/models` không trả model identifier nào có dấu hiệu TTS/speech/audio/voice.

Tài liệu provider được dùng để xác minh contract upstream:

- [xAI Text to Speech](https://docs.x.ai/developers/model-capabilities/audio/text-to-speech);
- [xAI Voice REST reference](https://docs.x.ai/developers/rest-api-reference/inference/voice).

Environment separation:

```text
Text AI: APIKEY_FUN_API_KEY → Claude/TextProvider
TTS:     TTS_APIKEY_FUN_API_KEY → Grok/xAI TTS
```

TTS không được fallback sang Text AI key.

## 3. Provider contract

Provider identity và server configuration:

```text
logical provider: apikeyfun
default env:      TTS_DEFAULT_PROVIDER=apikeyfun
credential:       TTS_APIKEY_FUN_API_KEY
base URL:         TTS_APIKEY_FUN_BASE_URL
endpoint:         POST /v1/tts
```

Provider adapter chỉ chạy ở server. Client không gửi arbitrary provider, model,
base URL hoặc credential. APIKEY.FUN-specific payload không được lan vào domain
hoặc UI.

Provider-neutral contract ở mức semantic:

```ts
interface TtsProvider {
  providerId: string;
  listVoices(): VoicePreset[];
  preview(input: TtsPreviewInput): Promise<TtsPreviewResult>;
}
```

`listVoices()` của `ApiKeyFunTtsProvider` đọc verified server-owned catalog;
không gọi bắt buộc tới `/v1/tts/voices` vì relay không expose endpoint đó.

`TtsPreviewResult` chỉ là dữ liệu nội bộ gồm audio bytes, MIME đã validate,
provider request ID nếu có và latency nếu cần. Raw provider response không được
trả cho client hoặc ghi log.

## 4. VoicePreset contract

Phase 1 dùng semantic model sau:

```ts
type VoicePreset = {
  id: string;
  provider: string;
  displayName: string;
  supportedLanguages: string[];
  minSpeed: number;
  maxSpeed: number;
  defaultSpeed: number;
  previewSupported: boolean;
};
```

Verified provider-documented catalog hiện tại:

| ID | Display name | Language metadata |
| --- | --- | --- |
| `ara` | Ara | `multilingual` |
| `eve` | Eve | `multilingual` |
| `leo` | Leo | `multilingual` |
| `rex` | Rex | `multilingual` |
| `sal` | Sal | `multilingual` |

Catalog là server-owned. Frontend chỉ render dữ liệu API trả về, không có danh
sách duplicated. Server phải reject voice ID ngoài catalog trước provider call.

Không thêm `gender`, `emotion`, `pitch`, `style` hoặc `accent` khi provider
chưa có contract/metadata được xác minh.

## 5. Language và speed

Language canonical cho tiếng Việt là:

```text
vi
```

UI có thể hiển thị `Tiếng Việt`, nhưng không tự đổi thành `vi-VN`. Các language
khác chỉ được thêm khi catalog/provider adapter xác nhận.

Speed contract:

```text
min:     0.7
max:     1.5
default: 1.0
```

Server là authority cho range và preset hợp lệ. UI có thể dùng slider/select
nhưng không được dùng range khác hoặc bypass validation.

## 6. VoiceConfig

`VoiceConfig` là mutable current project configuration, không phải immutable
generation artifact và không tạo history trong US11.

Semantic shape:

```text
id
workspaceId
projectId
provider
voiceId
language
speed
revision
createdBy
updatedBy
createdAt
updatedAt
```

Cardinality và identity:

```text
Một current VoiceConfig cho mỗi workspace/project
Unique semantic: (workspaceId, projectId)
```

Không lưu trong VoiceConfig:

```text
API key, credential, audio bytes, preview history,
raw provider response, Fact Lock state boolean
```

Save contract:

```text
voice.saveConfig({
  projectId,
  baseRevision,
  voiceId,
  language,
  speed
})
```

Server tự resolve workspace, provider, revision, audit user và timestamps. Save
phải kiểm tra project ownership, voice thuộc catalog, language được voice hỗ trợ
và speed nằm trong range.

CAS semantics:

```text
baseRevision == current revision → update và tăng revision
baseRevision != current revision → VOICE_CONFIG_CONFLICT
```

Không dùng last-write-wins hoặc silent overwrite.

## 7. Fact Lock và Voice Studio UX

Route giữ nguyên:

```text
/projects/[projectId]/voice
```

Behavior:

```text
Fact Lock chưa PASS
  → route vẫn tồn tại
  → GatedProjectStepPage hiển thị locked state
  → Voice Studio không interactive

Fact Lock PASS
  → Voice Studio available
  → load/save VoiceConfig
  → preview được phép
```

Khi script hoặc Product Fact làm run stale, Voice Studio downstream readiness bị
khóa lại. Không lưu `voiceUnlocked=true` cạnh `project_step_status`.

Trong contract hiện tại, interactive `getConfig`/`saveConfig` chỉ được phép
khi Fact Lock PASS để khớp UX locked route. `voice.preview` bắt buộc gọi
server-side:

```ts
FactLockGate.assertPassed(actor, projectId)
```

Không dùng `assertPassed(projectId)` và không tin `factLockPassed`, `allowed`
hoặc `gateReason` do client gửi.

## 8. Preview semantics và revision safety

Public preview operation không nhận arbitrary text, provider hoặc voice config
được forward thẳng từ client. Application service tự resolve:

```text
current ScriptVersion
  → first suitable non-empty voiceover segment
  → normalize whitespace
  → truncate an toàn theo TTS_PREVIEW_MAX_CHARS=500
```

Nếu không có voiceover text dùng được, server dùng short localized fallback; copy
fallback không chứa product/customer PII.

Preview service giữ thứ tự logic:

```text
resolve current ScriptVersion
  → kiểm tra FactLockGate
  → derive preview text
  → resolve current VoiceConfig
  → kiểm tra lại script identity/revision và gate ngay trước provider call
  → gọi TtsProvider.preview()
```

Không giữ database transaction hoặc row lock trong lúc chờ provider. Service ghi
nhận `sourceScriptVersionId`, `sourceScriptRevision` và `configRevision`
trong response nội bộ để nhận diện dữ liệu preview. Nếu phát hiện script/gate
stale trước provider call thì không gọi provider. Nếu thay đổi xảy ra trong lúc
request đã chạy, preview vẫn không được persist và caller phải coi kết quả là tạm
thời, không phải artifact của script mới.

TTS preview input nội bộ gồm `text`, `voiceId`, `language`, `speed`;
endpoint application không nhận text tùy ý từ browser.

## 9. Audio transport và validation

`Uint8Array` chỉ tồn tại trong provider/application service. Browser nhận protected
binary response qua HTTP route-native hoặc equivalent protected endpoint; không
đưa audio base64 vào JSON.

Canonical output v1:

```text
Content-Type: audio/mpeg
binary audio body
```

Provider adapter phải reject:

- empty body;
- MIME không được hỗ trợ;
- JSON error hoặc HTML challenge giả dạng audio;
- response vượt giới hạn preview server-side.

`audio/wav` và `audio/pcm` chỉ được hỗ trợ sau khi bổ sung decision/contract rõ.
Exact byte limit là implementation parameter của Phase 2, không invent thành
product requirement trong Phase 0.

Endpoint không public và phải authenticated, workspace-scoped, project-authorized
và Fact Lock-gated. Exact route path sẽ follow convention route-native của repo;
semantic shape tương đương `POST /api/projects/:projectId/voice/preview`.

## 10. Timeout, lỗi và retry

Timeout server-owned:

```text
TTS_PREVIEW_TIMEOUT_MS=30000
```

Client không override timeout. Một click preview tạo tối đa một provider request;
không blind auto-retry. Retry chỉ xảy ra khi người dùng chủ động bấm lại.

Semantic domain errors tối thiểu:

```text
VOICE_CONFIG_NOT_FOUND
VOICE_CONFIG_CONFLICT
TTS_VOICE_NOT_FOUND
TTS_LANGUAGE_NOT_SUPPORTED
TTS_SPEED_OUT_OF_RANGE
TTS_PREVIEW_TIMEOUT
TTS_PROVIDER_UNAVAILABLE
TTS_PREVIEW_FAILED
```

Fact Lock dùng error/reason mapping hiện có của US10, không tạo một gate contract
thứ hai.

Mapping bảo thủ:

```text
timeout/network abort        → TTS_PREVIEW_TIMEOUT
429 hoặc relay/upstream 5xx  → TTS_PROVIDER_UNAVAILABLE
invalid MIME/empty output    → TTS_PREVIEW_FAILED
voice/language/speed invalid → typed validation error tương ứng
```

UI chỉ nhận copy an toàn; không hiển thị raw upstream body, stack trace, SQL hoặc
credential.

## 11. Pricing và usage

Capability probe không xác minh được APIKEY.FUN TTS billing:

```text
APIKEY.FUN TTS pricing = UNVERIFIED
```

Không dùng giá xAI direct làm giá relay và không hard-code fake cost. Nếu usage
model hiện tại cần các trường này, chúng phải nullable/configurable:

```text
estimatedCost = nullable
actualCost = nullable
pricingVersion = nullable
```

Minimum runtime metadata nếu hạ tầng usage hiện tại phù hợp:

```text
provider, latency, success/failure,
providerRequestId nếu có, cost nếu có
```

Reuse usage infrastructure hiện tại nếu phù hợp; không tạo accounting subsystem
riêng cho US11. Pricing calibration là việc cần làm trước khi dựa vào báo cáo chi
phí TTS, nhưng không block bản nghe thử.

## 12. Deterministic provider và live smoke

Unit/integration/E2E dùng `FakeTtsProvider` hoặc deterministic equivalent, có thể
mô phỏng:

- catalog và preview success;
- timeout;
- provider unavailable;
- invalid MIME/empty output.

Regular test suite không gọi paid TTS. `AFFICHANNEL_LIVE_AI_SMOKE` không được tự
reuse cho TTS; nếu cần live smoke tương lai phải có explicit flag riêng, ví dụ
`AFFICHANNEL_LIVE_TTS_SMOKE`, và không bật mặc định.

## 13. Phase boundaries

### Phase 0 — Contract & Architecture Freeze

Đã chấp nhận trong tài liệu này. Không schema, migration, provider implementation,
API, UI hoặc runtime test.

### Phase 1 — Voice Foundation

Chưa bắt đầu. Bao gồm VoiceConfig schema, migration `0015` nếu cần, verified
catalog, save/load API, server validation và workspace isolation.

### Phase 2 — Preview Runtime

Chưa bắt đầu. Bao gồm `ApiKeyFunTtsProvider`, protected preview endpoint, binary
audio, timeout/error mapping, MIME/size validation và deterministic integration.

### Phase 3 — Voice Studio UI và closure

Chưa bắt đầu. Bao gồm panel cấu hình, player, save/reload, preview nhiều preset,
locked/relock/unlock state và authenticated E2E.

## 14. Ngoài phạm vi AFF-US-011

```text
full voiceover generation
per-segment TTS artifact
persisted audio, audio history hoặc audio cache
voice_segment, voice_generation, media asset
waveform editor, audio merge, background music, normalization
Remotion, FFmpeg, Video AI, video rendering
downstream voice artifact pipeline
```

## 15. Acceptance Criteria Phase 0

Phase 0 chỉ được coi là accepted khi tài liệu repo trả lời rõ:

- provider, relay endpoint và credential riêng;
- voice catalog authority;
- canonical language và speed range;
- VoiceConfig identity, persistence semantic và CAS;
- điều kiện khóa/mở Voice Studio;
- vị trí bắt buộc của `FactLockGate.assertPassed(actor, projectId)`;
- nguồn preview text và revision safety;
- binary transport, MIME và output validation;
- timeout, provider failure và explicit retry;
- preview không persist;
- pricing/usage nullable và unverified;
- phase boundary và toàn bộ phần loại trừ.

Phase 1 chưa bắt đầu. Không tạo migration `0015` trong Phase 0.


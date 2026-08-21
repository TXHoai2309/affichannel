# AFF-US-012 Phase 3 — Voice Segment Studio UI, Player & Waveform

## Phạm vi

Phase 3 mở rộng route `/projects/{projectId}/voice` bên dưới VoiceConfig của
AFF-US-011. Phase này chỉ cung cấp trải nghiệm tạo/nghe từng voiceover segment;
không đánh dấu Voice step hoàn thành, không mutate `project.currentStepKey`,
không cộng tổng duration để mở khóa Video và không triển khai acceptance E2E
của toàn US12.

## Server state và composition

`VoiceSegmentStudio` dùng server read model từ `voiceSegment.list` và refresh
segment cụ thể qua `voiceSegment.getState`. Generate chỉ gửi:

```text
projectId
segmentKey
idempotencyKey
```

Text hiển thị lấy exact từ current ScriptVersion response, theo đúng thứ tự
server trả về. Client không gửi text, voice, language, speed, revision hoặc
storage key. `VoiceConfig` dirty hoặc chưa được lưu sẽ disable generate.

Mỗi card phân biệt `latestRequest`, `latestUsableArtifact` và
`effectiveStatus`:

```text
not_generated → Chưa tạo
pending       → Đang tạo
completed     → Đã tạo
failed        → Tạo thất bại
indeterminate → Chưa xác định
stale         → Audio đã cũ
```

Artifact usable cũ vẫn được hiển thị trong lúc regenerate pending hoặc failed.
Artifact stale không được coi là current completed.

## Generate, regenerate và polling

Mỗi explicit click tạo idempotency key mới. Mutation tắt retry tự động. Trong
lúc pending, button của logical request bị khóa; `VOICE_SEGMENT_ALREADY_PENDING`
chỉ refresh state và không tự retry. Một list query duy nhất được poll mỗi 2 giây
khi có pending hoặc mutation đang chạy; polling dừng khi không còn pending.

Sau generate, UI refresh cả list và `getState` của segment. Không optimistic
fake completed. Regenerate giữ player của `latestUsableArtifact` cũ cho tới khi
attempt mới hoàn tất.

## Player và waveform

Player dùng native `<audio controls>` với protected endpoint:

```text
/api/projects/{projectId}/voice/segments/{latestUsableArtifact.id}/audio
```

UI không expose `storageProvider` hoặc `storageKey`. Server `durationMs` là
duration hiển thị; browser duration chỉ phục vụ playback.

Waveform là derived UI only. Component fetches protected audio bytes, decode
qua `AudioContext`, downsample thành 48 peaks deterministic và render các bar
responsive. Peaks cache trong memory theo `artifactId/checksum`, không persist
DB. Decode/fetch failure fallback về player-only và không làm artifact failed.

## Gate và lỗi

Route tiếp tục đi qua `GatedProjectStepPage`/Fact Lock. Fact Lock stale trong
list hoặc generate đưa Voice Studio về trạng thái locked. Error codes được map
sang copy tiếng Việt sanitized; timeout/indeterminate dùng thông điệp bảo thủ
và không auto retry để tránh duplicate cost.

## Kiểm thử

- Unit state: status copy, server duration, payload tối thiểu, idempotency key,
  error mapping, waveform peaks/cache key và protected URL.
- Deterministic E2E: save VoiceConfig, list segment, generate, pending UI,
  completed player/duration/waveform-or-fallback, refresh persistence và
  regenerate với attempt key mới.
- Không gọi live APIKEY.FUN hoặc live R2. Không thay schema/migration.

Phase 4 tiếp tục workflow completion, total duration gating và full US12
acceptance/race E2E.

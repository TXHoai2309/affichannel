# AFF-US-012 Phase 2 — Segment TTS Runtime, API & Protected Audio

- Trạng thái: Đã triển khai, chờ review/acceptance
- Ngày cập nhật: 2026-08-21
- Phạm vi: provider generation, server orchestration, storage registry, protected API/audio
- Ngoài phạm vi: Segment UI, player, waveform, workflow completion

## 1. Provider runtime

`TtsProvider` giữ nguyên `preview()` của AFF-US-011 và được mở rộng bằng:

```ts
generateSegment(input): Promise<{
  audio: Uint8Array;
  contentType: "audio/mpeg";
  providerRequestId: string | null;
  providerDurationMs?: number | null;
}>
```

`ApiKeyFunTtsProvider` dùng cùng canonical `/v1/tts` contract, không retry,
không lưu raw response và phân loại riêng known rejection với uncertain request.
Preview contract và test regression vẫn giữ nguyên.

Provider generation chỉ nhận server-owned `text`, `voiceId`, `language`, `speed`.
Deterministic provider chỉ được registry resolve khi flag E2E bật và runtime không
phải production.

## 2. Server preparation

Generate API chỉ nhận:

```text
projectId
segmentKey
idempotencyKey
```

Server tự resolve actor/workspace, Fact Lock PASS, current ScriptVersion,
`voiceoverSegments[segmentKey]`, VoiceConfig và catalog fields. Text được giữ
nguyên byte/code point snapshot; client không thể override text, voice, speed,
revision, provider hoặc storage key.

Fingerprint gồm đầy đủ ScriptVersion/VoiceConfig identity; `textHash` và
`requestHash` được server tính lại.

## 3. Idempotency và DB race

- Cùng idempotency key + cùng hash: trả artifact hiện có, không gọi provider.
- Cùng key + khác hash: `VOICE_SEGMENT_IDEMPOTENCY_CONFLICT`.
- Pending cùng request hash: coalesce.
- Race `23505` của partial unique index được nhận diện theo đúng constraint,
  re-read theo idempotency/request hash và không trả generic 500.
- Unique violation khác không bị swallow.

Tx A khóa/recheck project, current draft và VoiceConfig trước khi tạo pending.
Provider/storage không chạy trong transaction.

## 4. Orchestration và duration

Runtime thực hiện:

```text
prepare → Tx A pending → provider → validate bytes/MIME/size
→ parseMp3DurationMs → checksum → storage.put → Tx B completed
```

Duration từ server MP3 parser là authority; `providerDurationMs` chỉ advisory.
Audio invalid hoặc metadata parse failure không được lưu.

Timeout, network, HTTP 408/5xx và stream uncertainty chuyển artifact sang
`indeterminate`; known provider rejection chuyển `failed`. Không có blind retry.

## 5. Storage registry

`createVoiceAudioStorage()` chọn:

```text
VOICE_AUDIO_STORAGE_PROVIDER=local → LocalVoiceAudioStorage
VOICE_AUDIO_STORAGE_PROVIDER=r2    → R2VoiceAudioStorage
```

Local dùng `VOICE_AUDIO_LOCAL_ROOT`; R2 dùng S3-compatible `@aws-sdk/client-s3`
với private bucket/object. Khi chọn R2 mà thiếu endpoint, bucket hoặc credentials,
runtime fail closed bằng `TTS_STORAGE_CONFIGURATION_INVALID`.

Database chỉ lưu storage provider/key, MIME, byte size, checksum và duration.
Không tạo public URL hoặc nhận arbitrary storage key từ client.

## 6. Failure và cleanup

- `storage.put` fail: artifact `failed/TTS_STORAGE_FAILED`, không gọi lại provider.
- Tx B fail sau provider + storage thành công: best-effort `storage.delete`, trả
  `TTS_PERSISTENCE_FAILED`, không retry provider.
- Cleanup failure được ghi bằng sanitized diagnostic (`cleanupFailed` và provider),
  không log secret/raw provider payload.
- Local `open()` preflight `stat()` để missing/unreadable file trở thành controlled
  `TTS_STORAGE_FAILED`, không tạo unhandled asynchronous stream error.

## 7. Pending reconciliation

`reconcileExpiredPendingVoiceSegmentArtifacts()` chuyển pending quá lease 5 phút
sang `indeterminate/TTS_REQUEST_STATE_UNCERTAIN`. Expired pending không bao giờ
được hiểu là chưa gọi provider. Retry phải dùng idempotency key mới.

Background worker/reconciliation sweep định kỳ chưa được thêm ở Phase 2; API/runtime
đã có transition bảo thủ và cleanup semantics để worker Phase 4 có thể dùng lại.

## 8. Protected APIs

oRPC protected router `voiceSegment` có:

```text
voiceSegment.list
voiceSegment.getState
voiceSegment.generate
```

Generate trả artifact/read-model metadata, không trả audio base64.

Protected binary endpoint:

```text
GET /api/projects/{projectId}/voice/segments/{artifactId}/audio
```

Endpoint kiểm tra authenticated workspace actor, artifact workspace/project,
`completed`, MIME, storage ownership và chỉ lấy key từ DB. Response có:

```text
Content-Type: audio/mpeg
ETag: "<checksum>"
Cache-Control: private, max-age=31536000, immutable
```

`If-None-Match` trả `304`; read-model/API state không dùng immutable cache.

## 9. Race semantics

Artifact cũ vẫn giữ trong history khi ScriptVersion revision hoặc VoiceConfig
revision đổi trong lúc provider chạy. Read model current mới không chọn artifact
cũ và không mở khóa workflow. Không cancel, delete hoặc rewrite fingerprint.

## 10. Tests và verification

Deterministic coverage gồm provider input/MIME/size/timeout/uncertainty, exact
Unicode/VND/brand text, idempotency conflict/coalesce, DB partial-unique race,
invalid MP3, storage/finalize/cleanup failure, expired pending, script/config race,
R2 mock/fail-closed factory, protected audio headers/ETag/304/cross-project và
preview regression.

Đã chạy:

- `pnpm --filter web test`: **30 files / 218 tests passed**;
- `pnpm test:integration:voice-segment-runtime`: passed trên Neon dev;
- `pnpm test:integration:voice-segment`: passed;
- `pnpm check-types`: passed, 5/5 type-check tasks;
- `pnpm --filter web build`: passed, route audio protected được build;
- scoped Biome: passed;
- `git diff --check`: đạt (chỉ còn cảnh báo line-ending LF/CRLF của Git);
- `pnpm db:generate`: đạt, `No schema changes, nothing to migrate`.

Không gọi live APIKEY.FUN, live TTS hoặc live R2 trong test.

## 11. Migration và Phase 3

Phase 2 không thay đổi schema nên không tạo migration `0017`; migration cuối vẫn
là `0016_gifted_microbe.sql` của Phase 1.

Phase 3 chỉ bắt đầu sau review/acceptance và sẽ triển khai Segment list/player/
waveform UI. Workflow completion, total duration workflow hardening và acceptance
E2E tiếp tục để Phase 4.

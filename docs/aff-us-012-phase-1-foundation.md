# AFF-US-012 — Phase 1 VoiceSegment Foundation, Storage & Duration

- Trạng thái: Đã triển khai, chờ review/acceptance
- Ngày: 2026-08-21
- Phụ thuộc: AFF-US-012 Phase 0 / DEC-024 đã được chấp nhận
- Ngoài phạm vi: TTS generation API, provider `generateSegment()`, segment UI,
  protected audio endpoint và workflow mutation

## 1. Phạm vi đã triển khai

Phase 1 tạo nền tảng persistence và read model cho `VoiceSegmentArtifact`:

```text
DB schema + migration 0016
core fingerprint/current-stale utilities
repository/read model
local filesystem storage
R2 adapter foundation qua injected object client
server-side MP3 duration parser
SHA-256 text/request/audio checksum
pending lease detection
deterministic unit/integration tests
```

Không gọi APIKEY.FUN, không gọi TTS provider, không gọi R2 thật và không thêm
generation API/UI.

## 2. Schema và migration

Schema nằm tại `packages/db/src/schema/voice-segment-artifact.ts`, export qua
schema index. Physical table:

```text
voice_segment_artifact
```

Field chính:

```text
id, workspaceId, projectId, createdByUserId
sourceScriptVersionId, sourceScriptRevision, segmentKey
segmentTextSnapshot, textHash
voiceConfigRevision, provider, voiceId, language, speed
idempotencyKey, requestHash, status
providerRequestId, errorCode
storageProvider, storageKey, mimeType, byteSize, checksum, durationMs
createdAt, finishedAt
```

Database checks enforce status `pending | completed | failed | indeterminate`,
revision/speed/length/hash/MIME/storage invariants, pending/terminal
`finishedAt` shape và completed audio metadata đầy đủ.

Migration mới:

```text
packages/db/src/migrations/0016_gifted_microbe.sql
```

Migration đã được generate và apply thành công vào database dev đang được cấu
hình bởi migration tooling. Ledger hiện kết thúc ở `0016`; không reset/drop dữ
liệu và không tạo migration khác.

## 3. Index và uniqueness

- Workspace-scoped idempotency: unique `(workspaceId, idempotencyKey)`.
- Concurrent pending protection: partial unique
  `(workspaceId, projectId, requestHash) WHERE status='pending'`.
- Project latest lookup: workspace/project/createdAt/id.
- Historical segment lookup: workspace/project/segmentKey/createdAt/id.
- Source lookup: workspace/sourceScriptVersionId/sourceScriptRevision/segmentKey.
- Creator audit index.

Không unique full fingerprint để failed/indeterminate retry và explicit
regenerate vẫn tạo được artifact history mới.

## 4. Fingerprint và hashing

Core types/utilities nằm tại `packages/core/src/voice-segment/`.

Full fingerprint gồm workspace/project, ScriptVersion ID/revision, segment key,
text hash, VoiceConfig revision, provider, voice, language và speed.

Text rule:

- giữ nguyên text snapshot byte-for-byte;
- không trim, collapse whitespace hoặc Unicode normalize;
- chỉ reject text rỗng/whitespace-only;
- đếm max length theo Unicode code point.

API hashing utility nằm tại
`packages/api/src/services/voice-segment-hashing.ts`:

- `textHash`: SHA-256 exact UTF-8 segment snapshot;
- `requestHash`: SHA-256 canonical JSON của operation + full fingerprint;
- audio checksum: SHA-256 exact audio bytes.

Các case tiếng Việt, emoji, `150.000 ₫`, punctuation và brand name có test
deterministic.

## 5. Repository và read model

Repository nằm tại `packages/api/src/services/voice-segment-repository.ts`.

Đã có operation foundation:

- tìm artifact theo workspace-scoped idempotency key;
- tìm pending artifact theo current request hash;
- insert pending attempt;
- complete pending artifact;
- mark pending thành failed/indeterminate;
- list artifact theo project/segment;
- derive logical segment read model;
- query pending artifact quá lease.

Read model phân biệt:

```text
latestRequest
latestUsableArtifact
effectiveStatus
```

`latestUsableArtifact` chỉ là completed artifact có metadata hợp lệ và full
fingerprint current. Nếu chỉ có artifact lịch sử không match revision/config,
`effectiveStatus` là `stale`; database row không bị update.

Failed regenerate không xóa hoặc làm mất completed artifact cũ.

## 6. Local storage

Storage abstraction và adapters nằm tại
`packages/api/src/storage/voice-audio-storage.ts`.

Contract:

```text
put({ storageKey, body, contentType, checksum })
get(storageKey)
open(storageKey)
delete(storageKey)
```

`LocalVoiceAudioStorage` có root configurable, mặc định `.data/voice-audio`,
được resolve ngoài `public/`, ghi atomically qua temporary file rồi rename,
tạo thư mục cần thiết và reject path traversal/absolute path/backslash/token
không an toàn. Absolute path không được expose.

## 7. R2 storage foundation

`R2VoiceAudioStorage` dùng `R2VoiceAudioObjectClient` injected interface:

```text
putObject({ key, body, contentType, checksum })
getObject(key)
deleteObject(key)
```

Phase 1 không thêm R2/S3 SDK vì dependency audit không tìm thấy client hiện hữu;
injected client giúp test không thể reach network. Phase 2 sẽ chọn và wire client
S3-compatible chính thức trong server runtime.

R2 adapter không public object, không log credential và validate key trước mọi
operation.

## 8. Storage key và checksum

Storage key versioned, server-generated:

```text
voice/v1/{workspaceId}/{projectId}/{artifactId}.mp3
```

Raw user text/segment key không nằm trong path. `storageKey` không bao giờ nhận
từ client. SHA-256 checksum được tính trên đúng audio bytes và được persist cùng
artifact để phục vụ integrity/ETag ở Phase 2.

Checksum không thay thế request fingerprint.

## 9. Duration authority

Parser nằm tại `packages/api/src/audio/mp3-duration.ts` và dùng dependency
server-side `music-metadata`.

Luồng:

```text
audio/mpeg bytes
  → music-metadata parseBuffer
  → duration seconds
  → positive safe integer durationMs
```

Provider duration và browser/Web Audio duration không authoritative. Empty,
invalid MP3, thiếu duration hoặc duration `<= 0` đều trả
`TTS_AUDIO_METADATA_INVALID`; không dùng fallback arbitrary duration.

Fixture deterministic gồm 40 MPEG Layer III frames, duration kỳ vọng 1.045 giây
và được test với `durationMs=1045`.

## 10. Runtime policy và environment

Policy server-side đã được thêm vào `packages/env/src/server.ts`:

```text
VOICE_SEGMENT_MAX_CHARS=4000
VOICE_SEGMENT_MAX_AUDIO_BYTES=10485760
VOICE_SEGMENT_TIMEOUT_MS=60000
VOICE_SEGMENT_PENDING_LEASE_MS=300000
VOICE_AUDIO_STORAGE_PROVIDER=local|r2
VOICE_AUDIO_LOCAL_ROOT=.data/voice-audio
```

R2 endpoint/credential contract được khai báo optional để Phase 2 validate khi
chọn provider:

```text
R2_ENDPOINT
R2_BUCKET
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

Không ghi secret vào docs, fixture hoặc snapshot.

## 11. Error và cleanup foundation

Core error types nằm tại `packages/core/src/voice-segment/errors.ts`:

```text
VOICE_SEGMENT_NOT_FOUND
VOICE_SEGMENT_IDEMPOTENCY_CONFLICT
VOICE_SEGMENT_ALREADY_PENDING
VOICE_SEGMENT_INPUT_INVALID
VOICE_SEGMENT_INPUT_TOO_LONG
VOICE_SEGMENT_STORAGE_KEY_INVALID
TTS_INVALID_AUDIO
TTS_AUDIO_METADATA_INVALID
TTS_STORAGE_FAILED
TTS_PERSISTENCE_FAILED
```

Storage adapter không collapse checksum/path/read/write failure thành provider
failure. Nếu `storage.put` thành công nhưng Tx B finalize lỗi, Phase 2 phải
best-effort `delete(storageKey)` và không gọi TTS lại. Nếu delete cũng lỗi,
cleanup state phải được surface để reconciliation.

## 12. Pending lease

`isVoiceSegmentPendingExpired()` dùng policy 5 phút và có test đúng boundary.
Repository có `listExpiredPendingVoiceSegmentArtifacts()`.

Phase 1 không tự retry hoặc tự chuyển pending thành indeterminate. Phase 2
reconciliation/provider runtime sẽ xử lý expired pending bảo thủ.

## 13. Workflow audit

Phase 1 không thay đổi workflow và không mark Voice completed. Phase 4 phải
reuse:

```text
project.currentStepKey
project_step_status
FactLockGate.assertPassed(actor, projectId)
```

Không tạo status source of truth mới và không expose generic workflow mutation.

## 14. Tests

Unit test:

```text
apps/web/src/features/voice/voice-segment-foundation.test.ts
```

Bao phủ fingerprint/current-stale/latest read model, failed regenerate, Unicode,
max code points, local put/get/open/delete, path safety, mocked R2 adapter, MP3
duration, invalid audio, checksum và pending lease.

Integration script:

```text
scripts/test-voice-segment-foundation.ts
pnpm test:integration:voice-segment
```

Bao phủ migration/schema constraints, workspace idempotency, concurrent pending
unique, completion, stale revision, failed retry và cross-workspace isolation.
Fixture cleanup chạy trong `finally`.

## 15. Verification

Đã chạy:

- focused foundation unit: **1 file / 8 tests passed**;
- `pnpm --filter @affichannel/core check-types`: passed;
- `pnpm --filter @affichannel/db check-types`: passed;
- `pnpm --filter @affichannel/api check-types`: passed;
- `pnpm --filter web check-types`: passed;
- `pnpm db:generate`: migration `0016` generated;
- `pnpm db:migrate`: migration applied successfully;
- `pnpm test:integration:voice-segment`: passed;
- `pnpm --filter web test`: **27 files / 199 tests passed**;
- `pnpm check-types`: passed (5/5 type-check tasks);
- `pnpm --filter web build`: passed;
- scoped Biome: passed;
- `git diff --check`: passed (Git only reported existing LF/CRLF normalization warnings);
- không gọi TTS/APIKEY.FUN/R2 thật.

Migration `0016` là migration cuối hiện tại; chạy lại `pnpm db:generate` báo
`No schema changes, nothing to migrate` và không sinh migration `0017`.

## 16. Docs và Phase 2 blockers

Đã cập nhật DEC-024, Phase 0 status, architecture, product spec, roadmap,
changelog, ai-progress và docs README.

Phase 2 còn cần:

1. Wire R2 adapter với S3-compatible SDK/client thật trong server runtime.
2. Mở rộng `TtsProvider` bằng `generateSegment()` nhưng giữ preview contract.
3. Implement timeout/uncertain/error mapping và không blind retry.
4. Implement Tx A → provider → metadata → storage → Tx B orchestration.
5. Protected `voiceSegment` API/audio stream và authorization.
6. Reconciliation cho expired pending/orphan storage object.

```text
Paid TTS calls: NO
Paid R2 calls: NO
Phase 2 started: NO
UI changed: NO
Workflow changed: NO
```

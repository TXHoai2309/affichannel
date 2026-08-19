# AFF-US-011 Phase 2 — TTS Preview Runtime

- Trạng thái: Đã chấp nhận
- Cập nhật lần cuối: 2026-08-19
- Phạm vi: server runtime và protected binary preview

## 1. Kết quả

Phase 2 nối VoiceConfig/Fact Lock của Phase 1 với TTS preview runtime qua
server-only `TtsProvider`. Người dùng chưa có UI panel trong phase này; route
binary đã sẵn sàng cho Phase 3 gọi từ Voice Studio.

Luồng thành công là:

```text
current ScriptVersion
→ FactLockGate.assertPassed
→ derive voiceover text ở server
→ current VoiceConfig
→ kiểm tra ScriptVersion/gate/config lần cuối
→ TtsProvider.preview một lần
→ trả audio/mpeg tạm thời
```

Không giữ database transaction hoặc row lock trong lúc chờ provider.

## 2. Provider và registry

`TtsProvider` giữ boundary tối thiểu gồm `providerId`, `listVoices()` và
`preview()`. `ApiKeyFunTtsProvider` là adapter production duy nhất hiện tại:

- endpoint được chuẩn hóa thành `POST {baseUrl}/v1/tts`;
- credential chỉ đọc từ server environment `TTS_APIKEY_FUN_API_KEY`;
- base URL dùng `TTS_APIKEY_FUN_BASE_URL`, mặc định là
  `https://api.apikey.fun`;
- payload upstream là `{ text, voice_id, language, speed }`;
- catalog voice vẫn do server sở hữu: `ara`, `eve`, `leo`, `rex`, `sal`;
- registry chỉ resolve provider theo `TTS_DEFAULT_PROVIDER`, không nhận provider
  tùy ý từ client.

Adapter thực hiện đúng một fetch cho một preview, không retry và không ghi audio
vào database, object storage, history hoặc usage ledger. Provider request ID chỉ
được lấy từ response header nếu có; không tự tạo ID và không ghi authorization
header vào log.

## 3. Validation, timeout và lỗi

Core validator phân biệt malformed input với ba lỗi field cụ thể:
`TTS_VOICE_NOT_FOUND`, `TTS_LANGUAGE_NOT_SUPPORTED` và
`TTS_SPEED_OUT_OF_RANGE`. Preview text rỗng là `VOICE_CONFIG_INPUT_INVALID`.

Timeout dùng `TTS_PREVIEW_TIMEOUT_MS`, mặc định 30 giây và bị giới hạn ở server.
Abort do timeout trả `TTS_PREVIEW_TIMEOUT`; lỗi network/reset/connect và HTTP
429/5xx trả `TTS_PROVIDER_UNAVAILABLE`. Các HTTP failure khác, MIME không phải
`audio/mpeg`, body rỗng hoặc body vượt giới hạn trả `TTS_PREVIEW_FAILED`.
Response HTML challenge được coi là provider unavailable. Upstream response body
không được đưa vào error message.

Binary guard yêu cầu MIME chính xác `audio/mpeg`, body khác rỗng và không vượt
5 MiB. Route không nhận text, voice, language, speed hoặc provider từ request
body; body có dữ liệu bị trả `BAD_REQUEST`.

## 4. Server-derived text và Fact Lock safety

Preview lấy segment voiceover đầu tiên có text dùng được từ current draft
`ScriptVersion`, chuẩn hóa NFKC/whitespace và truncate theo code point với
`TTS_PREVIEW_MAX_CHARS` mặc định 500. Nếu không có segment dùng được, server
dùng fallback tiếng Việt ngắn đã định nghĩa trong service.

`FactLockGate.assertPassed(actor, projectId)` được gọi trước khi đọc config và
lại được kiểm tra ngay trước provider. Service so sánh ScriptVersion ID/revision
và VoiceConfig ID/revision giữa hai lần đọc. Script stale hoặc Product Fact
dependency stale làm provider không được gọi; rerun Fact Lock mở lại flow.

Protected endpoint:

```text
POST /api/projects/:projectId/voice/preview
```

Endpoint yêu cầu session và workspace membership, trả `audio/mpeg` với
`Cache-Control: no-store`, không bọc base64 JSON và không persist artifact.

## 5. Environment và live smoke

Server contract bổ sung:

```text
TTS_APIKEY_FUN_API_KEY       optional ở build/test, bắt buộc khi gọi live
TTS_APIKEY_FUN_BASE_URL      optional, mặc định https://api.apikey.fun
TTS_PREVIEW_TIMEOUT_MS       integer dương, mặc định 30000
TTS_PREVIEW_MAX_CHARS        integer dương, mặc định 500
AFFICHANNEL_LIVE_TTS_SMOKE   0 mặc định; chỉ nhận 0 hoặc 1
```

`pnpm test:live:tts` mặc định **SKIPPED**. Chỉ khi chủ động đặt
`AFFICHANNEL_LIVE_TTS_SMOKE=1` script mới thực hiện đúng một request với text
`Xin chào.`, voice `eve`, language `vi`, speed `1.0`; audio không được lưu.
Các unit/integration test thông thường dùng fake provider và không gọi TTS trả
phí. Pricing relay vẫn `UNVERIFIED`; Phase 2 không thêm usage/billing schema.

## 6. Không thuộc Phase 2

Phase này không tạo migration mới (0015 vẫn là migration cuối của US11), không
đổi schema, không tạo UI Voice Studio, không tạo full voiceover, không tạo
audio artifact, không làm waveform/Remotion/FFmpeg/video, không thêm cache và
không thêm multi-provider fallback.

## 7. Verification

- `pnpm --filter web test`: unit provider, route, domain và regression đều đạt.
- `pnpm check-types`: đạt.
- `pnpm test:integration:voice-config`: đạt, gồm stale save/reopen.
- `pnpm test:integration:voice-preview`: đạt, gồm 5 preset, stale Script,
  stale Product Fact, rerun, missing config và cross-workspace isolation.
- `pnpm test:live:tts`: SKIPPED vì live flag mặc định `0`.
- Scoped Biome và `git diff --check`: đạt.

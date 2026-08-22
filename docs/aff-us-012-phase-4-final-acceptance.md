# AFF-US-012 Phase 4 — Workflow Completion, Duration & Final Acceptance

- Trạng thái: Đã chấp nhận
- Cập nhật: 2026-08-21

## Phạm vi

Phase 4 hoàn tất workflow của AFF-US-012 sau khi Phase 0–3 đã được chấp nhận.
Phase này không tạo bảng workflow mới, không thêm boolean readiness và không
thay đổi schema `voice_segment_artifact`. Nguồn sự thật vẫn là
`project.currentStepKey` kết hợp với `project_step_status` hiện có.

## Readiness và tổng thời lượng

Server dùng một evaluator canonical cho Voice. Voice chỉ `ready` khi đồng thời:

- Fact Lock PASS cho current ScriptVersion;
- VoiceConfig hiện tại tồn tại;
- current ScriptVersion tồn tại và có ít nhất một segment;
- mọi segment hiện tại có latest completed usable artifact khớp toàn bộ
  fingerprint: ScriptVersion ID/revision, segment key, text hash, VoiceConfig
  revision, provider, voice ID, language và speed.

Tổng thời lượng chỉ cộng `durationMs` của các artifact current, completed và
usable. Audio stale, pending, failed hoặc indeterminate không được cộng và
không làm Voice ready. Summary server trả số segment đã hoàn tất, tổng số,
pending/stale và tổng thời lượng; UI hiển thị summary này trong Voice Studio.

## Workflow reconciliation

Sau mutation của segment, VoiceConfig, ScriptVersion hoặc Fact Lock, server
reconcile lại từ snapshot mới và upsert `project_step_status` cho `voice` và
`video`. Reconcile khóa project row, đọc lại Fact Lock/ScriptVersion/
VoiceConfig/artifact rồi mới ghi trạng thái để tránh dùng snapshot cũ.

- Fact Lock chưa PASS: Voice và Video `blocked`.
- Có setup nhưng Voice chưa đủ: Voice `needs_review`, Video `blocked`.
- Voice đủ điều kiện: Voice `completed`, Video mở; tổng duration là dữ liệu
  derive, không persist riêng.
- `currentStepKey` chỉ tự tiến từ `voice` sang `video` khi Voice ready. Không
  tự rollback `currentStepKey` khi script/config thay đổi; trạng thái persisted
  và server gate vẫn khóa Video cho tới khi artifact hiện tại được tạo lại.

Pending quá lease 5 phút được đọc-reconcile thành `indeterminate` với
`TTS_REQUEST_STATE_UNCERTAIN`. Hệ thống không tự gọi lại provider.

## Audio và waveform hardening

Protected audio route chọn storage backend theo `artifact.storageProvider` đã
lưu, không theo ENV hiện tại, nên artifact local vẫn đọc local khi default đã
đổi sang R2 và ngược lại. Thiếu hoặc không hợp lệ provider/config thì fail
closed.

Waveform cache sở hữu loader dùng chung, cache kết quả thành công và xóa
in-flight promise khi decode thất bại. Abort/unmount của consumer này không
phá consumer khác; lỗi decode chỉ fallback player-only và có thể retry.

## Video gate

Route Video yêu cầu cả Fact Lock PASS và Voice readiness. Khi Voice chưa sẵn
sàng, direct URL và navigation đều hiển thị panel hướng về Voice Studio; không
có unlock boolean mới và không triển khai logic US13.

## Kiểm thử và an toàn chi phí

Deterministic tests giữ nguyên các case text tiếng Việt, đoạn dài tới giới hạn,
max+1, tiền tệ, ký hiệu, tên thương hiệu và emoji exact text. Authenticated E2E
kiểm tra generate/playback/reload, workflow persistence, Video gate, script
stale cycle, VoiceConfig stale cycle, failed regenerate giữ usable audio,
pending lease và workspace isolation.

Playwright luôn tự start server với deterministic TTS và local storage; test
không gọi paid APIKEY.FUN hoặc live R2. Migration cuối vẫn là
`0016_gifted_microbe.sql`; Phase 4 không tạo migration mới.

## Kết quả

AFF-US-012 Phase 4 ✅ ACCEPTED

AFF-US-012 ✅ DONE

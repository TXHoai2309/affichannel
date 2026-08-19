# AFF-US-011 Phase 3 — Voice Studio Configuration & Preview

- Trạng thái: Đã chấp nhận
- Cập nhật lần cuối: 2026-08-19

## Phạm vi

Phase 3 hoàn thiện màn hình `/projects/[projectId]/voice` cho cấu hình và nghe
thử voice. Phase này không tạo full voiceover, không lưu audio artifact, không
mutate `StepStatus`, không thêm migration và không gọi TTS trả phí trong E2E.

## Luồng người dùng

Khi Fact Lock của ScriptVersion hiện tại đạt PASS, Voice Studio tải catalog
server-owned và VoiceConfig hiện tại. Nếu chưa có config, UI dựng draft từ
preset đầu tiên (`ara`), ngôn ngữ `vi` và speed mặc định `1.0`; trạng thái là
`Chưa lưu` cho tới khi người dùng lưu rõ ràng.

Người dùng có thể chọn một trong các preset do server trả về, chọn ngôn ngữ
được preset hỗ trợ và chỉnh speed trong khoảng min/max của preset. Save gửi
`baseRevision`: `null` khi tạo mới hoặc revision hiện tại khi update. Conflict
CAS hiển thị lỗi an toàn và có action tải lại cấu hình mới nhất; UI không tự
ghi đè thay đổi của nơi khác.

Preview chỉ enable khi config đã persist và draft không dirty. Client gửi
`POST /api/projects/:projectId/voice/preview` không body, nhận binary
`audio/mpeg`, tạo Blob URL cho native `<audio controls>`, revoke URL cũ khi
preview mới hoặc draft thay đổi và revoke lần cuối khi unmount. Không có text,
provider, model hay arbitrary voice override từ browser.

Loading, timeout, provider unavailable, MIME/empty audio, config error và
Fact Lock stale đều có trạng thái inline bằng tiếng Việt. Khi Script hoặc
Product Facts stale, server gate vẫn là nguồn sự thật: UI chuyển locked, giữ
config đã lưu và cho phép mở Fact Lock/tải lại. Rerun PASS mở lại cùng config.

## Ranh giới runtime và E2E

Production tiếp tục resolve `apikeyfun` ở server và adapter thật vẫn timeout,
không retry, strict MIME/size và không log secret. Playwright đặt
`AFFICHANNEL_E2E_TTS_DETERMINISTIC=1`; env loader giữ explicit test flag để
registry dùng deterministic MPEG adapter. Adapter này chỉ trả bytes cố định,
không phải fallback production và không có network/paid TTS call.

## Files chính

- `apps/web/src/features/voice/voice-studio.tsx`: UI, query/mutation, gate UX,
  save/preview lifecycle.
- `apps/web/src/features/voice/voice-studio-state.ts`: draft, dirty, error
  mapping và Blob URL helpers.
- `apps/web/src/features/voice/voice-preview-client.ts`: protected binary
  client với credential, status/MIME/empty-body checks.
- `packages/api/src/providers/tts/deterministic-tts-provider.ts`: adapter test
  deterministic chỉ được bật bởi explicit E2E flag.
- `apps/web/tests/e2e/fact-lock-review.spec.ts`: authenticated flow qua nhiều
  preset, reload, preview, relock/reopen.

## Verification

- Web unit/component-adjacent tests: state, client binary, route/domain tests.
- Authenticated E2E: save/reload/preview hai preset, Blob audio, stale lock và
  Fact Lock rerun.
- Type-check, Biome, build, các integration script VoiceConfig/Voice Preview,
  Fact Lock, ScriptVersion và ScriptGeneration.

Kết quả cuối ngày 2026-08-19: `pnpm --filter web test` đạt 23 file/171 test;
focused Voice E2E đạt 1/1; full Playwright đạt 22/24. Hai lỗi còn lại nằm ngoài
AFF-US-011: Product Management edit heading và Script Studio Runtime fixture
không có workspace settings rỗng.

Phase 3 không thay đổi schema; migration ledger vẫn dừng ở `0015`.

# AFF-US-021 / EN001 Phase 21E-A — Prototype contracts and tooling foundation

- Trạng thái tại thời điểm snapshot: COMPLETE / READY FOR OWNER TECHNICAL REVIEW
- Cập nhật: 2026-09-11
- Branch: `TXH`

> **HISTORICAL PHASE SNAPSHOT / SUPERSEDED**
>
> Tài liệu này ghi lại trạng thái tại thời điểm đóng Phase 21E-A và được giữ để
> truy vết lịch sử. Trạng thái authoritative hiện tại là AFF-US-021 **CLOSED /
> OWNER ACCEPTED**; 21E-B **CLOSED** với approved local Windows T09 FFmpeg
> execution **VERIFIED**, 21D actual-byte proof/finalization **VERIFIED**, full
> internal E2E **PASS**, và Phase 21E-C **NOT STARTED**.
>
> Trạng thái hiện tại được duy trì trong `docs/README.md`, `docs/roadmap.md`,
> `docs/architecture.md`, `docs/ai-progress.md`, `docs/changelog.md` và
> `docs/decisions.md`. Các câu như `PENDING_BINARY_APPROVAL`, “21E-B chưa bắt
> đầu” hoặc real execution/21D proof deferred bên dưới chỉ mô tả state **tại
> thời điểm snapshot**, không phải current repository state.

## Phạm vi

Phase 21E-A chỉ tạo contract nội bộ/test harness cho T09. Nó không chạy FFmpeg,
không tạo MP4, không gọi Neon, không thêm migration/schema và không activate
Video, Preview, public Render, `startRender`, production renderer, production
profile hay MediaAsset promotion. Phase 21E-B/C/D/E chưa bắt đầu.

## Owner locks đã khóa

- Renderer là FFmpeg CLI orchestration nội bộ/test-only. Resolver chỉ nhận
  absolute configured path, không tìm FFmpeg từ `PATH`. Manifest mặc định là
  `PENDING_BINARY_APPROVAL`; execution cần version, build identity, distribution
  reference, license metadata/notice hash và binary SHA-256 được owner pin chính
  xác.
- T09 chỉ dùng local private RenderOutputStorage trong E2E tương lai; R2 vẫn là
  mocked/contract-tested.
- T09 happy path là video-only với `audioTracks: []`; không chèn silence và
  không có AAC.
- `mp4-h264-video-only-t09-v1` là profile nội bộ/test-only, không phải production
  profile. Nó khóa 1080x1920, 30/1 fps, H.264, yuv420p, BT.709, 2000 kbps,
  GOP/keyint/min-keyint 30, scenecut off, B-frames 0, closed GOP, single-thread
  và no audio. Các giá trị này không freeze production bitrate/CRF/GOP.
- Output-ready handoff chỉ mang identity của đúng Job/Attempt/reservation.
  Checksum, storage locator, bytes, proof và `RenderArtifact` vẫn thuộc trusted
  storage-backed 21D finalization.

## Evidence / implementation

### Profile and binary boundary

- T09 profile fingerprint:
  `a81616db09ba0390b90ef19efd4b20fd06886a3a3b270d053a12c5b29f0ec9ec`.
- Tool manifest schema là `affichannel-render-tool-manifest.v1`, adapter là
  `affichannel-ffmpeg-adapter-v1`, và trạng thái hiện tại là
  `PENDING_BINARY_APPROVAL` vì chưa có artifact/build/SHA/license metadata
  approval cụ thể. Resolver fail-closed trước pending manifest, relative path, missing file,
  non-file, platform mismatch và hash mismatch.

### Deterministic text layout

- Version: `affichannel-text-layout-v1`.
- Text được normalize line ending rồi NFC-normalize; shaping/measurement dùng
  fontkit `2.0.4` trên đúng Noto Sans 400/600/700 manifest đã có trong repo.
- Feature set explicit: `ccmp=true`, `kern=true`, discretionary/contextual
  ligatures `liga/clig/calt/dlig/hlig=false`.
- Greedy wrapping chỉ tại U+0020; unsupported glyph, token không fit, max-lines
  overflow và box-height overflow đều fail closed. Width, x và baseline được
  materialize thành integer pixels; alignment LEFT/CENTER/RIGHT được test.

### T09 fixture and render plan

- Fixture `t09-composition-fixture.v1` có 2 scene `[0,30)` và `[30,60)`, một
  checked-in deterministic PNG source (`68` bytes,
  SHA-256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`),
  hai text layers và `audioTracks: []`.
- Composition fixture fingerprint:
  `11cae6ae3dbccbeb754079e09ea3ad74f149809420b9739d0751a522b3f299a0`.
- Render plan ghi rõ tool identity, composition/profile fingerprints, input
  asset checksum/metadata, materialized text lines, `[startFrame,endFrame)`
  intervals, exact output reservation và expected video-only metadata.
- FFmpeg command plan trả executable path + argv array, không ghép shell command;
  dùng `-an`, `libx264`, yuv420p, BT.709, fixed 2000k, GOP 30, keyint-min 30,
  scenecut 0, B-frames 0, closed GOP, 30/1 fps và 60 frames. Text đi qua
  `drawtext=textfile=...`, không đưa raw text vào command plan.

## Test boundary

Focused contract tests: `9/9` PASS. Tests cover profile, layout normalization/
wrapping/alignment/overflow, pinned fontkit shaping, PNG hash, two-scene plan,
video-only argv, absolute-path/hash resolver, pending binary gate và
output-ready handoff không chứa proof/storage authority.

Actual FFmpeg execution, render output, storage finalization, reconciliation,
normal finalize, 21D proof and full T09 E2E remain intentionally deferred.

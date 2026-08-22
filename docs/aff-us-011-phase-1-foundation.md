# AFF-US-011 — Phase 1 Voice Foundation

- Trạng thái: Đã triển khai và xác minh
- Ngày: 2026-08-19
- Phạm vi: VoiceConfig foundation, verified catalog và protected config API
- Contract nền: [Phase 0 contract](./aff-us-011-phase-0-contract-decisions.md) và DEC-023

## Kết quả

Phase 1 lưu cấu hình voice hiện tại theo workspace/project và không tạo artifact
audio. Voice Studio vẫn phải đi qua Fact Lock hiện tại trước khi đọc hoặc ghi
cấu hình.

Schema `voice_config` gồm:

```text
id, workspaceId, projectId, provider, voiceId, language, speed, revision,
createdBy, updatedBy, createdAt, updatedAt
```

Database dùng `created_by_user_id`/`updated_by_user_id` theo convention hiện có,
FK tới workspace/project/user, unique `(workspace_id, project_id)`, revision
`>= 1`, speed `0.7..1.5` và provider canonical `apikeyfun`. Không có secret,
audio bytes, raw provider response, preview history hoặc Fact Lock boolean.

Catalog server-owned và deterministic:

```text
ara, eve, leo, rex, sal
language: vi
speed: 0.7..1.5, default 1.0
provider: apikeyfun
```

`TtsProvider` và `ApiKeyFunTtsProvider.listVoices()` chỉ cung cấp catalog ở
Phase 1. `preview()` chưa gọi relay; provider runtime thuộc Phase 2.

## API

- `voice.listPresets`: protected, trả catalog đã validate, không gọi provider.
- `voice.getConfig({ projectId })`: protected, gọi
  `FactLockGate.assertPassed(actor, projectId)`, trả config hiện tại hoặc `null`.
- `voice.saveConfig({ projectId, baseRevision, voiceId, language, speed })`:
  protected, server tự resolve workspace/provider/audit/timestamps và dùng CAS.

Create dùng `baseRevision: null` và revision `1`. Update chỉ thành công khi
`baseRevision` khớp; stale request trả `VOICE_CONFIG_CONFLICT`. Concurrent first
create được bảo vệ bởi project row lock và unique constraint, sau đó normalize
thành domain conflict. Client không thể override provider, workspace, revision
hoặc audit fields.

Validation server trả các code contract:
`TTS_VOICE_NOT_FOUND`, `TTS_LANGUAGE_NOT_SUPPORTED` và
`TTS_SPEED_OUT_OF_RANGE`.

## Migration và verification

Migration additive là `0015_last_gunslinger.sql`. Preflight Neon xác nhận journal
đến `0014`, database/schema/branch được lấy từ env mà không in credential và
`voice_config` chưa tồn tại. SQL sau review chỉ tạo bảng, constraints, FKs và
indexes; không sửa migration cũ, reset, drop hoặc truncate dữ liệu.

Postflight xác nhận ledger có 16 entries, bảng và constraints/indexes đã tồn tại.
Chạy lại `pnpm db:generate` báo không còn schema changes.

Tests bao phủ:

- domain catalog và validation;
- protected RPC unauthenticated `401` và authenticated workspace actor;
- create/load/update nhiều preset;
- stale CAS và concurrent first create;
- Fact Lock PASS, script stale, persisted config khi bị khóa và reopen sau rerun;
- cross-workspace isolation;
- regression Fact Lock, ScriptVersion và ScriptGeneration.

Phase 1 không triển khai UI panel, audio preview endpoint/binary, timeout/provider
runtime hoặc full voiceover. Các phần đó vẫn thuộc Phase 2/3 và chưa được gọi
trong test suite.

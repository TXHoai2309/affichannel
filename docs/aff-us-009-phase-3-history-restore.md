# AFF-US-009 Phase 3 — History, Save Version và Restore

## Phạm vi

Phase 3 hoàn thiện vòng đời `ScriptVersion` sau Phase 2 editor/autosave:

- lưu snapshot immutable thành saved version;
- đọc danh sách history mới nhất trước và đọc chi tiết một bản lưu;
- restore snapshot vào current draft bằng optimistic concurrency;
- giữ source generation pinned và claims current/stale đúng contract;
- nối UI Save Version, history read-only và restore confirmation.

Không triển khai Fact Lock, TTS/audio, AI provider, realtime collaboration hoặc US10.

## Audit schema và migration

Schema Phase 1 đã đủ cho Phase 3, không tạo migration mới và không thay đổi
migration cũ. `public.script_version` đã có:

- `status` draft/saved, `version_number`, `saved_at`;
- `editable_snapshot_json`, `revision`, `restored_from_version_id`;
- workspace/project/source-generation/user foreign key;
- unique draft theo workspace/project;
- unique saved version number theo workspace/project;
- project history, source generation và creator indexes;
- check constraint cho status shape và revision dương.

Saved version number được cấp trong transaction sau khi lock project row. Không dùng
`MAX + 1` ngoài transaction và không đổi dữ liệu draft khi Save Version.

## API contract

Router protected `scriptVersion` có các action:

- `saveVersion({ scriptVersionId, baseRevision })` — server lấy snapshot draft hiện tại,
  validate canonical snapshot rồi insert saved row. Draft vẫn mutable và giữ revision.
- `listHistory({ projectId })` — trả metadata saved, newest first.
- `getVersion({ projectId, versionId })` — trả snapshot saved chỉ đọc.
- `restore({ scriptVersionId, versionId, baseRevision })` — copy snapshot saved vào draft,
  tăng revision và ghi `restoredFromVersionId` trên draft.

Mọi action đều resolve workspace actor ở server. Saved row không có action update/delete.
Target restore phải là saved version cùng project/workspace; target chéo workspace trả
not found để không làm lộ dữ liệu.

## Restore và claims semantics

- Draft `sourceGenerationId` không đổi khi restore.
- Saved history không bị mutate hoặc xóa.
- Nếu snapshot restore có `claimsStatus=current`,
  `claimsSourceRevision` được chuẩn hóa thành revision mới của draft.
- Nếu snapshot restore có `claimsStatus=stale`, giữ nguyên stale và revision nguồn cũ;
  không tự regenerate claims.
- Save Version không copy `restoredFromVersionId` sang saved row; lineage restore chỉ có
  ý nghĩa trên current draft.
- Save/Restore dùng `baseRevision`; mismatch trả conflict và UI không tự ghi đè.

## UI behavior

- `Lưu phiên bản` gọi `autosave.flush()` trước, chờ mọi request đang bay và cả edit mới
  nhất hoàn tất. Nếu autosave lỗi/conflict thì không gọi Save Version.
- History chỉ fetch khi người dùng mở drawer.
- Snapshot saved được hiển thị read-only, không render textarea chỉnh sửa.
- Restore luôn mở dialog xác nhận. Bản nháp dirty được flush trước; nếu flush không thành
  công thì restore bị chặn. Sau xác nhận, response server được nạp vào editor và history
  vẫn giữ nguyên.
- Reload/reopen dùng `getCurrent` nên draft restored persisted được hiển thị lại.

## Verification

Integration runtime `pnpm test:integration:script-version` chứng minh:

- Save Version v1/v2, newest-first history và Get Version;
- saved snapshot immutable;
- restore copy + revision increment + re-query persistence;
- current claims được normalize, stale claims được giữ stale;
- stale baseRevision conflict;
- cross-workspace history/get/restore scope;
- các invariant Phase 1/2 về initialize, autosave, invalidation và structure vẫn pass.

Web tests:

- autosave controller: 8 tests, gồm flush chờ in-flight save và chain edit mới nhất;
- authenticated E2E: tạo v1/v2, history newest-first, read-only preview, restore confirmation
  và reload persistence.

Lệnh gate:

```text
pnpm check-types
pnpm --filter web test
pnpm test:integration:script-version
pnpm --filter web test:e2e
pnpm build
pnpm db:generate
git diff --check
```

Phase 3 không commit, push, merge hoặc deploy.

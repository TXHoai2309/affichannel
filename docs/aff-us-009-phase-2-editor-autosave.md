# AFF-US-009 Phase 2 — Script Editor và Autosave UI

Ngày thực hiện: 2026-08-17  
Phạm vi: editor client cho draft hiện tại, autosave debounce và authenticated E2E.

Phase này không triển khai version history, Save Version/Restore, Fact Lock execution,
TTS/audio hoặc các US sau. Không tạo migration và không thay đổi contract/backend của Phase 1.

## A. Route và boundary

Editor dùng lại route `/projects/[projectId]/content` và Script Studio hiện có. Khi chưa có
draft, Script Studio hiển thị generated artifact bất biến và nút `Bắt đầu chỉnh sửa`. Nút này
gọi `scriptVersion.initialize` với `sourceGenerationId` của completed artifact usable gần nhất.
Khi draft tồn tại, UI chuyển sang Script Editor và không tự khởi tạo lại từ generation mới.

Editor chỉ dùng `scriptVersion.getCurrent`, `initialize` và `autosave`; không gọi provider AI,
không gọi paid AI và không patch từng field.

## B. Editable surface

Người dùng có thể:

- chọn một hook và sửa text hook;
- sửa voiceover theo từng segment;
- sửa duration, visual direction và on-screen text của scene;
- sửa CTA, caption, hashtags và affiliate disclosure;
- xem claims read-only cùng trạng thái current/stale.

Key, thứ tự scene, voiceover references, claims và claim occurrence không có control chỉnh sửa.
Không có add/delete/reorder structural control. Duration chỉ có light validation phía client:
finite, integer và dương; validator/core/server vẫn là authority.

## C. Local state và autosave

Local editor state tách khỏi TanStack Query cache để giữ caret/focus ổn định. Autosave gửi full
`editableSnapshot` cùng `scriptVersionId` và `baseRevision`.

- debounce chính xác `1000ms`;
- tối đa một request in-flight;
- edit mới trong lúc request cũ chạy không bị mất; response cũ chỉ cập nhật revision/server-owned
  metadata và request tiếp theo dùng snapshot local mới nhất;
- thành công chuyển sang `saved`, đang chờ là `dirty`, đang request là `saving`;
- lỗi thường chuyển sang `error` và cho phép retry;
- `SCRIPT_VERSION_CONFLICT` chuyển sang `conflict`, dừng autosave và giữ nguyên local edits;
- chỉ nút `Tải bản mới nhất` mới refetch rồi thay thế local snapshot.

Server-side merge/structural guard và claims stale semantics vẫn thuộc Phase 1; UI không tự sửa
claims hoặc tự rebase khi có generation mới.

## D. New generation và Fact Lock boundary

Nếu latest usable AI generation khác `sourceGenerationId` của draft, editor chỉ hiển thị notice
`Có bản AI mới`; draft hiện tại không bị thay thế và không có auto-apply/rebase. Fact Lock chỉ
hiển thị readiness read-only; execution nằm ở phase sau.

## E. Verification

Unit controller tests chứng minh debounce 1000ms, coalescing, không chạy concurrent, giữ local
edit trong request cũ, cập nhật base revision, conflict pause và explicit reload.

Authenticated E2E chứng minh initialize → editor → chọn hook → sửa voiceover → autosave → claims
stale → refresh/reopen vẫn giữ snapshot, cùng notice khi generation mới xuất hiện. Test không gọi
paid AI và chỉ mock RPC boundary cho editor UI.

Kết quả verification:

- `pnpm --filter web test`: 15 files, 116 tests passed;
- `pnpm test:integration:script-version`: pass toàn bộ Phase 1 runtime proof;
- focused Script Studio E2E: 5 passed;
- full authenticated E2E: 17 passed, 1 failed ở regression AFF-US-004 browser Back ngoài scope,
  URL giữ `/projects/{id}` thay vì `/projects/{id}/product`;
- `pnpm check-types`, `pnpm build`, `pnpm db:generate`, scoped Biome và `git diff --check`: pass;
- không tạo migration, không thay Neon/database và không gọi paid AI.

## F. Files chính

- `apps/web/src/features/script-generation/script-editor.tsx`
- `apps/web/src/features/script-generation/script-editor-autosave.ts`
- `apps/web/src/features/script-generation/script-editor-autosave.test.ts`
- `apps/web/src/features/script-generation/script-studio.tsx`
- `apps/web/src/features/script-generation/script-studio-state.ts`
- `apps/web/tests/e2e/script-studio.spec.ts`

## G. Status

Phase 2 verification is complete for the editor scope. Phase 3 version history/restore chưa được
triển khai trong phạm vi này.

**AFF-US-009 Phase 2 Script Editor & Autosave is ready for review.**

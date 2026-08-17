# AFF-US-009 Phase 1 — ScriptVersion Foundation

Ngày thực hiện: 2026-08-17  
Phạm vi: schema, canonical snapshot, validator, initialize, getCurrent và full-snapshot autosave.

Phase này chưa triển khai editor UI, debounce ở browser, version-history UI, Save Version/Restore,
Fact Lock execution, TTS hoặc audio.

## A. Schema

`script_version` là aggregate riêng, không ghi ngược vào `script_generation.output_json`.
Các field chính:

- `workspace_id`, `project_id`, `source_generation_id` để giữ scope và pinned source;
- `status = draft | saved`;
- `version_number` và `saved_at` chỉ có ở saved version;
- `editable_snapshot_json` là canonical editable snapshot;
- `revision` là optimistic-concurrency revision;
- `restored_from_version_id`, creator và timestamps cho history/restore ở phase sau.

Invariant database:

- tối đa một draft cho mỗi workspace/project;
- saved version number duy nhất theo workspace/project;
- draft không có version/saved timestamp; saved version phải có cả hai;
- revision luôn lớn hơn 0;
- FK tới workspace, project, source generation, user và self-reference restore.

## B. Canonical snapshot

Snapshot tái sử dụng `ScriptDraft v2` của US8 và thêm:

- `selectedHookKey`;
- `claimsSourceRevision`;
- `claimsStatus = current | stale`.

Không tạo `script_segment` hoặc `script_scene`; không tạo alias `candidateClaims`.

## C. Migration audit và runtime result

Trước migration đã xác nhận:

- `DATABASE_URL` và `DATABASE_URL_DIRECT` đều tồn tại, không in credential;
- Neon project `shy-bird-50440649`, branch `br-long-flower-azjrci1g`, database `neondb`, schema `public`;
- ledger có 12 migration đã apply, `script_version` chưa tồn tại;
- migration `0012_unusual_prowler.sql` chỉ có `CREATE TABLE`, `ADD CONSTRAINT` và `CREATE INDEX`.

Không phát hiện `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, destructive ALTER hoặc data
rewrite. `pnpm db:migrate` đã apply thành công; ledger sau migration là 13.

Verify sau migration:

- bảng `public.script_version` tồn tại với 13 columns;
- 5 index ngoài primary key tồn tại: draft unique, saved-number unique, project history,
  source generation và creator;
- status/revision/status-shape checks và 5 FK tồn tại;
- row count production sau cleanup là 0;
- `pnpm db:generate` báo `No schema changes, nothing to migrate`.

## D. Initialize behavior

`scriptVersion.initialize` chỉ nhận source generation thuộc cùng workspace/project, project chưa archive,
status `completed`, output hợp lệ theo `scriptDraftSchema` và dependency chưa invalidated.
Initialize tạo một draft revision 1, pin source generation và server-own claims metadata.

## E. New generation policy

Source generation đã pin không tự rebase. Nếu project đã có draft từ source khác, initialize trả
`SCRIPT_VERSION_DRAFT_ALREADY_EXISTS`; draft hiện tại không bị thay thế.

## F. getCurrent

`scriptVersion.getCurrent` chỉ đọc draft theo workspace/project, trả persisted read model hoặc `null`
khi chưa initialize; không đọc trực tiếp từ generated output.

## G. Autosave

`scriptVersion.autosave` nhận full editable snapshot và `baseRevision`. Server validate snapshot,
giữ lại schema/language/claims/claims source revision do server sở hữu, rồi tăng revision bằng conditional
update. Hashtag-only edit không stale claims; claim-relevant edit stale claims.

## H. Conflict proof

Nếu `baseRevision` cũ hoặc conditional update thua race, trả `SCRIPT_VERSION_CONFLICT` kèm
`latestRevision`; không last-write-wins và không silent overwrite.

## I. Claims stale

Thay đổi selected hook, hook text, voiceover, CTA, disclosure, caption hoặc scene on-screen text
đánh dấu claims stale. Hashtag, visual direction và duration không đánh dấu stale theo contract Phase 0.

## J. Validators

- `validateScriptVersionDraft()` cho phép draft intermediate như chưa chọn hook và text rỗng trong
  những field editable, nhưng vẫn chặn key/reference/order sai.
- `validateScriptVersionForFactLock()` tái dùng strict `scriptDraftSchema`, yêu cầu selected hook và
  claims current. Fact Lock chưa được thực thi ở Phase 1.

## K. Authorization

Repository luôn scope bằng `actor.workspaceId`; router resolve actor từ authenticated session qua
`getWorkspaceActor()`. Cross-workspace source/version không lộ ra dưới dạng readable record.

## L. Runtime DB proof

`pnpm test:integration:script-version` đã pass trên Neon hiện tại với fixture tạm và cleanup trong
`finally`, chứng minh initialize, idempotency, concurrent convergence, getCurrent/reopen, autosave,
conflict, claims stale, immutable saved row, invalidated dependency guard và workspace scope.

## M. Tests/results

- `pnpm check-types`: pass, 5/5 package tasks;
- `pnpm --filter web test`: pass, 14 files / 95 tests;
- `pnpm test:integration:script-version`: pass;
- `pnpm --filter web test:e2e`: một full run pass 16/16; lần rerun cuối gặp lại flaky
  AFF-US-004 `page.goBack()` (15 pass/1 fail), trong khi chạy riêng `project-create.spec.ts`
  pass. Đây là test/routing nền ngoài file thay đổi của US009 và cần harden riêng.
- `pnpm build`: pass;
- `pnpm db:generate`: pass, no schema changes;
- scoped Biome và `git diff --check`: pass.

## N. Regression US8

Existing US8 unit/E2E paths vẫn pass trong full regression. Phase 1 không sửa Product Facts,
freshness/dependency rules của US7 hoặc ScriptGeneration provider/runtime.

## O. Security

- Không log database URL, password, cookie, API key hoặc provider payload;
- không nhận workspace ID từ client;
- không expose generic workflow mutation;
- output generated được validate trước khi trở thành editable snapshot;
- saved version immutable ở autosave boundary.

## P. Files changed

- `packages/core/src/script-version/*` và `packages/core/src/index.ts`;
- `packages/db/src/schema/script-version.ts`, schema index và migration 0012/meta;
- `packages/api/src/services/script-version-repository.ts`;
- `packages/api/src/services/script-version-service.ts`;
- `packages/api/src/routers/script-version.ts`, router index;
- `apps/web/src/features/script-generation/script-version-foundation.test.ts`;
- `scripts/test-script-version-foundation.ts`, root package script;
- progress/changelog và contract documentation.

## Q. Remaining debt

Phase 2 còn cần editor theo segment, browser debounce, Save Version, history/restore UI/API,
restore immutable child, downstream invalidation closure và authenticated UI proof. Phase 1 chưa
triển khai các phần đó theo phạm vi đã chốt.

## R. Status

**AFF-US-009 Phase 1 ScriptVersion Foundation is ready for review.**

Không triển khai US10, US11 hoặc các feature tương lai trong phase này.

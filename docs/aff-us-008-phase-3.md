# AFF-US-008 Phase 3 — Script Studio UI

Ngày: 2026-08-17
Trạng thái: ready for final acceptance review, chưa đánh dấu AFF-US-008 Done

## A. Audit

Route `/projects/[projectId]/content` trước đây chỉ render `ProjectStepPage` với
placeholder. Các procedure `scriptGeneration.estimate`, `generate`, `repair` và
`getState` đã có, nhưng read model chưa trả context đủ để render empty state và
context panel. Phase này giữ nguyên domain ScriptGeneration và chỉ bổ sung một
read-model context tối thiểu ở server.

## B. UI implementation

- `apps/web/src/features/script-generation/script-studio.tsx`: Script Studio production UI.
- `apps/web/src/features/script-generation/script-studio-state.ts`: label, safe error copy,
  cost formatting, status và invariant helpers.
- `apps/web/src/features/script-generation/script-studio-state.test.ts`: pure state tests.
- `apps/web/src/app/(protected)/projects/[projectId]/content/page.tsx`: thay placeholder bằng
  Script Studio, giữ protected App Shell và ProjectStepper.
- `packages/core/src/script-generation/types.ts`: tách `ScriptGenerationContext` và
  artifact-only read model.
- `packages/api/src/services/script-generation-service.ts`: authorized context read model,
  đánh giá Product Facts bằng policy server hiện có, lọc usable media bằng schema/policy hiện có.
- `packages/api/src/services/script-generation-repository.ts`: trả artifact read model độc lập
  với context.
- `apps/web/tests/e2e/project-create.spec.ts`: authenticated UI coverage cho Content empty state.
- `apps/web/tests/e2e/script-studio.spec.ts`: mocked authenticated coverage cho completed/refresh,
  current partial repair và invalidated partial không repair.

Không thêm ScriptVersion, editor, autosave, Fact Lock, TTS, Video AI, workflow auto-advance
hoặc migration.

## C. Screen structure

Màn hình gồm header Script Studio và status badge, cột context/estimate bên trái, output bên
phải trên desktop; tự xếp dọc trên màn hình hẹp. Panel dùng các Card/Button/Badge/Empty hiện có,
bo góc mềm theo App Shell và có trạng thái focus/loading/error rõ ràng.

## D. Input context

Read-only context hiển thị project, Product, Content Brief, Product Facts cùng freshness,
evidence và `generationUsability`, media chỉ khi `ready` và `owned|licensed`, Output Rules,
Channel Settings và AI provider/model. Không có media usable vẫn là trạng thái hợp lệ. Thiếu
facts usable hoặc Channel Settings chưa đầy đủ sẽ cảnh báo và khóa Generate theo contract.

## E. Generate flow

```text
getState/context
  → estimate (khi có usable Product Facts)
  → user bấm Tạo kịch bản với idempotency key mới
  → generate production oRPC
  → refetch/getState; chỉ poll mỗi 2 giây khi latestRequest = pending
  → dừng poll ở completed/partial/failed/indeterminate
  → render latest usable artifact
```

Frontend không gọi provider và không gửi provider/model override. Không có blind retry.

## F. State handling

| State | UI |
| --- | --- |
| empty | Empty state, không fake/sample output; Generate chỉ enabled khi context đủ |
| pending | Progress nhẹ, khóa Generate, vẫn giữ artifact cũ nếu có |
| completed | Render đầy đủ các section hợp lệ |
| partial | Render section hợp lệ, đánh dấu section lỗi; chỉ repair khi dependency state là `current` |
| failed | Copy tiếng Việt an toàn, không raw provider error, không tự retry |
| indeterminate | Cảnh báo riêng về delivery chưa xác định, không tự retry |

## G. Latest usable proof

Output chỉ lấy từ `model.latestUsableArtifact`, còn status lấy từ `model.latestRequest`.
Vì vậy request mới pending, failed hoặc indeterminate không thể làm trắng hoặc che artifact
completed/partial usable trước đó. Pure tests cover pending/failed/indeterminate, gồm partial
usable artifact trong case indeterminate.

## H. Repair proof

Với partial artifact, UI chỉ hiện `Tạo lại phần này` cho `invalidSections` khi
`dependencyState.state = current`. Artifact đã invalidated vẫn hiển thị content và warning,
nhưng không có Repair CTA; user được hướng dẫn tạo generation mới. Repair gọi
`scriptGeneration.repair` với idempotency key mới và parent generation id; UI không mutate
parent. Sau khi server tạo child, state được refetch để child usable trở thành output hiện tại.

## I. Output rendering

Đã có các section: 3–5 hook variants, voiceover segments, scenes, CTA, caption, hashtags,
affiliate disclosure và candidate claims. Claims hiển thị rõ `Chưa qua Fact Lock` cùng
occurrence như Hook/Voiceover/Cảnh/CTA/Caption; không hiển thị SUPPORTED/UNSUPPORTED và không
có selectedHook.

## J. Security

Provider và API key chỉ được resolve ở server. UI gọi protected oRPC, không đọc
`APIKEY_FUN_API_KEY`, không request APIKEY.FUN trực tiếp và không expose raw provider body.
Context và artifact đều workspace-scoped ở server.

## K. Tests

Đã chạy trong vòng này:

- `pnpm check-types` — đạt, 5/5 packages.
- `pnpm --filter web test` — đạt, 13 files / 83 tests.
- Scoped Biome cho các file source/test thay đổi — đạt.
- `git diff --check` — đạt.

Pure state tests kiểm tra empty/facts, estimate loading/success/error, cost currency-safe,
safe error copy và latest usable invariant. Không gọi live AI trong test suite.

## L. Authenticated E2E

Authenticated E2E gồm `project-create.spec.ts` và `script-studio.spec.ts`: tạo project, mở
Content, kiểm tra empty state/Generate guard, mocked Generate → completed → refresh, partial
→ repair → child artifact và invalidated partial không có Repair CTA.

Do Neon runtime hiện tại thiếu các bảng Phase 2A/2B (`channel_settings`, `media_metadata`,
và trước đó `script_generation`), test Script Studio dùng mock response ở boundary `getState`,
`estimate`, `generate`, `repair` để không gọi paid AI và vẫn kiểm tra UI. Đây là coverage UI,
chưa phải runtime DB integration.

Kết quả authenticated full suite: `15 passed`, `0 failed`, `0 skipped`.

## M. Migration

Expected: no new migration. Không migrate Neon shared và không thay đổi schema DB trong Phase 3.

## N. Regression

Không thay đổi Product Facts, freshness, dependency, auth/workspace, provider architecture,
Phase 2A hay Phase 2B. Live APIKEY.FUN smoke Phase 2B đã PASS trước đó và không chạy lại trong
Phase 3.

## O. Remaining blockers

- Xác nhận runtime DB integration sau khi môi trường có đủ migration Phase 2A/2B.
- Chạy full authenticated E2E với backend thật sau khi blocker DB được xử lý.
- Review và acceptance cuối cho toàn bộ US8.

ScriptVersion, Fact Lock, TTS và Video AI vẫn để các US sau.

## Phase 3 hardening — 2026-08-17

- Thêm helper readiness từ read model: Generate/Estimate chỉ hoạt động khi có usable Product
  Facts và Channel Settings hiện diện; không copy freshness hoặc validation business rule vào UI.
- Repair được gate bởi `partial + invalidSections + dependencyState=current`. Artifact partial
  đã invalidated vẫn render output cũ, có warning Product Facts đã thay đổi và chỉ hướng dẫn
  tạo generation mới.
- Đổi indeterminate badge sang warning và generic page-load error không còn suy đoán not-found/
  authorization từ mọi lỗi tải dữ liệu.
- Thêm authenticated mocked E2E cho completed/refresh, partial repair child và invalidated
  partial. Full suite đạt `15/15`; unit đạt `83/83`.
- Không có schema change, migration mới hoặc live AI call.

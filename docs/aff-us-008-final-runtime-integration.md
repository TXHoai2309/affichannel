# AFF-US-008 — Final Runtime Integration

Ngày kiểm tra: 2026-08-17  
Phạm vi: Final Runtime Integration trên Neon hiện tại, không triển khai US9/US10.

## A. Pre-migration audit

- `DATABASE_URL` và `DATABASE_URL_DIRECT` tồn tại trong `apps/web/.env`; credential không được
  in ra log và không thay đổi.
- Kết nối direct xác nhận Neon project `shy-bird-50440649`, branch `br-long-flower-azjrci1g`,
  database `neondb`, schema `public`, `search_path = "$user", public`, PostgreSQL 18.4.
- Trước migration, ledger `drizzle.__drizzle_migrations` có 6 bản ghi tương ứng 0000–0005.
  Các migration 0006–0011 pending; các bảng Phase 2 chưa tồn tại.
- Audit SQL 0000–0011 không có `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM` hoặc
  data rewrite. Có 5 lệnh `DROP CONSTRAINT` trong 0006/0007/0008/0009/0010 để thay constraint
  bằng phiên bản mở rộng; không có dữ liệu hiện hữu trong các bảng/quan hệ bị mở rộng và không
  có destructive data operation.
- `fact_dependency` và `fact_invalidation_event` đã tồn tại nhưng trước migration đều có 0 row;
  `script_generation` chưa tồn tại.

Kết luận audit: an toàn để chạy migration additive trên database hiện tại.

## B. Migration state before/after

| Thời điểm | State |
| --- | --- |
| Trước migrate | Applied 0000–0005, pending 0006–0011 |
| Sau migrate | Applied đủ 0000–0011, hash ledger khớp file migration |
| Chạy lại migrate | Không còn pending, command idempotent thành công |

## C. Migration command/result

Đã chạy:

```text
pnpm db:migrate
```

Kết quả: `[✓] migrations applied successfully!` với exit code 0. Chạy lại lần hai cũng exit code
0. Không thay `DATABASE_URL`, không thay `DATABASE_URL_DIRECT`, không tạo Neon branch, không reset,
drop hoặc sửa migration cũ.

## D. Tables/indexes/constraints after migration

Các bảng tồn tại và đã được verify trên `public`:

- `channel_settings`
- `ai_settings`
- `media_metadata`
- `output_rules`
- `script_generation`
- `fact_dependency`
- `fact_invalidation_event`

Đã verify các nhóm index/constraint quan trọng: unique settings theo workspace; media unique theo
workspace/project; `script_generation_idempotency_unique`; partial unique
`script_generation_pending_project_unique`; scope/latest/parent indexes; dependency active unique,
dependent, fact-revision và workspace-state indexes; invalidation dependency/dependent/fact indexes;
foreign key workspace/project/user/parent và state/status/mode/hash/output/sections/cost checks.

`pnpm db:generate` sau migration báo `No schema changes, nothing to migrate`.

## E. `getState`/`estimate` runtime proof

Authenticated Playwright chạy trên web thật, không mock RPC ở runtime test:

- đăng nhập bằng fixed E2E account;
- mở `/projects/{fixtureId}/content`;
- production `scriptGeneration.getState` trả đúng Project, Product, Product Fact, Channel Settings
  và `latestRequest = null`;
- production `scriptGeneration.estimate` dùng provider `apikeyfun`, model `claude-sonnet-4-6`,
  `estimatedCostMicros > 0` và currency 3 ký tự uppercase;
- UI hiển thị `Chi phí ước tính`.

## F. Generate persistence proof

Sau khi fixture chuyển AI Settings sang provider deterministic, click `Tạo kịch bản` qua UI. Luồng
đi qua production oRPC `scriptGeneration.generate`, tạo generation `pending`, chạy provider
deterministic và finalize thành `completed` trong DB.

Đã verify row `script_generation` có provider deterministic, `outputJson` khác null và
`finishedAt` khác null. Output gồm hook variants, voiceover, scenes, CTA, caption, hashtags,
affiliate disclosure và candidate claims; UI hiển thị `Chưa qua Fact Lock`.

## G. Dependency/revision proof

- `inputSnapshotJson` giữ đúng Product Fact `id` và `revision` tại thời điểm generate.
- `fact_dependency` được đăng ký atomic với generation, đúng `dependentType = script_generation`,
  `factRevision`, workspace và trạng thái active.
- Cross-workspace `getState`/repair bị từ chối theo authorization, không làm lộ artifact.

## H. Idempotency/concurrency proof

Deterministic integration harness pass các trường hợp:

- cùng idempotency key và cùng intent replay đúng artifact;
- cùng key nhưng khác intent trả conflict;
- pending uniqueness chặn hai pending generation cho cùng project;
- khác key concurrent chỉ có một winner;
- cùng key concurrent chỉ tạo một artifact và một bộ dependency.

## I. Failed/indeterminate proof

Harness pass:

- failed generation detach dependency;
- indeterminate generation giữ dependency;
- `completed A + failed B` vẫn chọn A là latest usable;
- `completed A + indeterminate B` vẫn chọn A là latest usable.

Không automatic retry provider uncertain.

## J. Invalidation proof

Đã verify revision change của Product Fact tạo invalidation event và làm artifact cũ invalidated.
Artifact đã invalidated bị từ chối khi repair; hệ thống yêu cầu generation mới với snapshot revision
mới.

## K. Repair immutable child proof

Đã verify controlled partial generation có thể repair phần lỗi bằng child generation immutable.
Parent không bị mutate; child giữ lineage, snapshot/dependency đúng và chỉ thay section được phép.
Cross-reference, schema và server-side merge đều được kiểm tra.

## L. Reopen/persistence proof

Sau generate, reload/reopen lại Content route. `getState` đọc lại artifact đã lưu; output vẫn hiện
đúng và `latestUsableArtifact.id` không đổi. Full E2E cũng xác nhận refresh không làm mất output.

## M. Full-path live smoke

`AFFICHANNEL_LIVE_AI_SMOKE=0`, vì vậy:

```text
FULL-PATH LIVE SMOKE SKIPPED
```

Không tự bật flag, không gọi APIKEY.FUN live, không retry và không gọi adapter trực tiếp cho smoke
final này.

## N. Unit/E2E/build results

- `pnpm check-types`: pass, 5/5 package tasks.
- `pnpm --filter web test`: pass, 13 files / 83 tests.
- `pnpm test:integration:script-generation`: pass.
- `pnpm --filter web test:e2e`: pass, 16/16; failed 0, skipped 0.
- `pnpm build`: pass; Next.js compile, TypeScript, static generation và route optimization đều đạt.
- `pnpm db:generate`: pass, không có schema change mới.
- Scoped Biome: pass.
- `git diff --check`: pass; chỉ có cảnh báo line-ending LF/CRLF của Git, không có whitespace error.

Sau test, các fixture tạm và settings tạm đã được dọn đúng scope. Row count verify về 0 cho
`channel_settings`, `ai_settings`, `media_metadata`, `output_rules`, `script_generation`,
`fact_dependency` và `fact_invalidation_event`.

## O. Security

- Không in credential, API key, password hoặc raw provider payload.
- Không đổi database URLs, không tạo branch, không reset/drop database.
- Runtime/API vẫn server-owned và workspace-scoped; provider/API key không được đọc từ browser.
- Fixture chỉ dùng fixed internal workspace và được cleanup sau test.
- Không commit, push, merge hoặc deploy.

## P. Remaining debt

- Live paid full-path smoke chưa chạy vì opt-in flag đang tắt; đây là trạng thái chủ động, không phải
  failed runtime.
- ScriptVersion, Fact Lock, TTS, Video AI và các US sau vẫn ngoài scope AFF-US-008.
- Có thể bổ sung CI job riêng cho Neon integration với database lifecycle được kiểm soát, nhưng
  không cần thay đổi trong acceptance run này.

## Q. Final recommendation

Các acceptance criteria runtime deterministic, persistence, dependency/revision, idempotency,
concurrency, failure semantics, invalidation, immutable repair, reopen, authenticated E2E và build
đều pass. Live smoke được skip đúng cấu hình `AFFICHANNEL_LIVE_AI_SMOKE=0`.

**AFF-US-008 is ready to be marked DONE.**

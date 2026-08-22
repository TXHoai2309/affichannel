# AFF-US-009 — Phase 0 Contract Decisions

Ngày: 2026-08-17  
Trạng thái: Contract ready for Phase 1 acceptance

Phase này chỉ audit và chốt contract. Không tạo migration, không sửa Neon database, không làm UI,
autosave runtime, history runtime, Fact Lock hoặc audio/TTS.

## A. Existing architecture audit

Baseline đã chốt ba boundary:

    AFF-US-008  ScriptGeneration
                generated AI artifact, persisted, immutable sau terminal state

    AFF-US-009  ScriptVersion
                human-editable current draft + immutable saved history

    AFF-US-010  Fact Lock
                kiểm tra claims trên ScriptVersion hiện tại

US9 phải giữ các invariant sau:

- Không update script_generation.output_json.
- ScriptGeneration dùng ScriptDraft v2: schemaVersion, language, hookVariants,
  voiceoverSegments, scenes, cta, caption, hashtags, disclosure và claims.
- Chỉ generation completed, có dependency hiện tại, được dùng để initialize v1.
- Partial, failed, indeterminate hoặc invalidated generation không được initialize.
- Product Facts là nguồn sự thật; AI claims chỉ là candidate, chưa qua Fact Lock.
- Mọi procedure phải authorize actor, workspace, project và source generation ở server.
- ScriptVersion không phải bản mutable của ScriptGeneration; nó chỉ tham chiếu sourceGenerationId.

Nguồn audit: DEC-005, DEC-014, DEC-015, docs/architecture.md, docs/product-spec.md,
docs/roadmap.md và toàn bộ tài liệu AFF-US-008.

## B. Canonical data decision

script_version.editable_snapshot_json là source of truth duy nhất cho nội dung editable.

US9 v1 không tạo script_segment hoặc script_scene làm source of truth riêng. Không lưu cùng một
nội dung vừa trong JSON vừa trong normalized tables. Projection/query optimization là future scope.

Shape phải derive từ ScriptDraft v2 hiện tại:

    schemaVersion
    language
    hookVariants: [{ key, text }]
    selectedHookKey: string | null
    voiceoverSegments: [{ key, text }]
    scenes: [{ order, durationSeconds, visualDirection, onScreenText, voiceoverSegmentKeys }]
    cta: { text }
    caption
    hashtags
    disclosure
    claims: [{ text, occurrence }]
    claimsSourceRevision
    claimsStatus: current | stale

Field canonical là claims vì đó là field hiện có trong ScriptDraft v2. UI có thể gọi là candidate
claims, nhưng không tạo thêm alias candidateClaims trong persisted document.

sourceGenerationId, workspace/project identity và draft revision là metadata của ScriptVersion.
schemaVersion và language được preserve từ source; client không được tự đổi chúng.

## C. Lifecycle

Một workspace/project có tối đa một current draft:

    draft:
      status = draft
      versionNumber = null
      mutable bằng autosave/restore có CAS
      revision tăng sau mỗi successful write

    saved:
      status = saved
      versionNumber = 1, 2, 3, ...
      immutable trong normal product flow
      savedAt != null

DB/service phải enforce:

- partial unique theo workspaceId, projectId cho status draft;
- unique workspaceId, projectId, versionNumber cho status saved;
- saved version không update/delete;
- sourceGenerationId của draft không đổi qua autosave;
- saved snapshot giữ đúng nội dung tại thời điểm Save Version.

## D. Initialize, Save Version và Restore

Initialize lấy latest usable ScriptGeneration đã authorize và chỉ cho phép status completed.
Hai tab initialize đồng thời phải tạo đúng một draft; unique conflict được xử lý transactionally
bằng cách đọc lại draft đã tồn tại và trả kết quả idempotent.

Save Version không biến draft thành saved và không tạo draft mới:

    draft revision 18
      -> INSERT saved version 3 với snapshot tại revision 18
      -> draft vẫn là working copy

Cấp versionNumber phải atomic. Phase 1 dùng transaction khóa project, cấp số tiếp theo và giữ
unique constraint làm guard cuối; không dùng SELECT MAX + 1 ngoài transaction.

Restore đọc saved version cùng workspace/project rồi ghi snapshot đó vào current draft:

    saved version N
      -> current draft snapshot = saved snapshot
      -> draft revision++
      -> restoredFromVersionId = N

Saved version không bị mutate. restoredFromVersionId nullable, chỉ có ý nghĩa trên current draft,
chỉ trỏ tới saved version cùng project/workspace và không trỏ tới draft.

## E. Concurrency

Autosave v1 dùng full snapshot, không dùng patch/merge:

    { scriptVersionId, baseRevision, editableSnapshot }

Server validate snapshot trước rồi conditional update draft khi revision đúng baseRevision.
Nếu không có row phù hợp, trả SCRIPT_VERSION_CONFLICT và latestRevision nếu đọc được sau
authorization.

Save Version và Restore cũng nhận baseRevision, chạy transaction và conflict nếu draft đã thay đổi.
Không silent overwrite, last-write-wins, auto merge hoặc field-level merge trong US9 v1.

Client khi conflict hiển thị thông báo và chỉ tải state mới sau hành động rõ ràng Tải bản mới nhất.

## F. SourceGeneration policy

Draft luôn pinned tới sourceGenerationId cùng workspace/project. Nếu US8 tạo generation mới sau
khi draft tồn tại:

- không overwrite draft;
- không reinitialize;
- không rebase tự động;
- UI sau này có thể hiển thị Có bản AI mới.

Apply generation mới là enhancement ngoài US9 v1.

## G. Claims stale policy

claims trong editable snapshot là candidate claims snapshot của một script revision:

    script revision = 15
    claimsSourceRevision = 15
    claimsStatus = current

Khi nội dung claim-relevant thay đổi:

    script revision = 16
    claimsSourceRevision = 15
    claimsStatus = stale

Không auto-regenerate claim và không chạy Fact Lock trong US9.

V1 invalidation matrix:

| Thay đổi | Claims |
| --- | --- |
| selectedHookKey | stale |
| Hook text | stale |
| Voiceover text | stale |
| CTA | stale |
| Disclosure | stale |
| Scene onScreenText | stale |
| Caption | stale |
| Hashtags | giữ current |
| Visual direction | giữ current |
| Scene duration | giữ current |

## H. Downstream dependency và audio contract

Phase 0 không mở rộng fact_dependency và không tạo generic dependency table mới.

US7/US8 tiếp tục dùng dependency theo hướng Product Fact -> artifact. Allow-list hiện đã có
dependentType = script, là semantic dành cho ScriptVersion ở phase implementation nếu cần đăng ký
Product Fact dependency; Phase 0 chưa ghi runtime row.

Downstream artifact tương lai phải lưu:

    sourceScriptVersionId
    sourceScriptRevision

Artifact stale khi sourceScriptRevision khác current ScriptVersion.revision. Đây là semantic
revision contract, không phải lý do để US9 dựng Fact Lock/TTS.

US9 không tạo audio/TTS table, provider, player hoặc fake audio artifact. Audio future chỉ dùng
source version/revision contract và đánh dấu bản cũ stale khi script đổi.

## I. Validation

Tạo validateScriptVersionDraft() trong packages/core. Draft validator cho phép intermediate state:

- selectedHookKey = null;
- text tạm rỗng;
- caption/scene text đang gõ dở.

Vẫn reject unknown schema, sai kiểu dữ liệu, duplicate stable keys, scene reference hỏng và
structural corruption.

Tạo validateScriptVersionForFactLock() trong packages/core để US10 reuse. Validator strict kiểm tra
selected hook, voiceover, scene/reference, CTA, disclosure, language, schema invariant và claim state.
Không implement Fact Lock hoặc các trạng thái SUPPORTED/UNSUPPORTED/NEEDS_REVIEW trong US9.

## J. Proposed API

Tên procedure cuối theo convention oRPC hiện tại:

    scriptVersion.initialize({ projectId })
    scriptVersion.getCurrent({ projectId })
    scriptVersion.autosave({ scriptVersionId, baseRevision, editableSnapshot })
    scriptVersion.saveVersion({ scriptVersionId, baseRevision })
    scriptVersion.listHistory({ projectId })
    scriptVersion.getVersion({ projectId, versionId })
    scriptVersion.restore({ scriptVersionId, versionId, baseRevision })

Mọi input phải được validate bằng Zod/core schema. Không có regenerate AI, Fact Lock, TTS hoặc
audio procedure trong US9.

## K. Authorization

Mọi read/mutation phải xác nhận server-side:

    authenticated actor
      -> workspace membership/ownership
      -> project thuộc workspace
      -> ScriptVersion thuộc project/workspace
      -> sourceGeneration thuộc cùng project/workspace
      -> restore target cùng project/workspace và status saved

Cross-workspace/project access trả typed rejection an toàn. Không dựa vào ID random khó đoán.

## L. Required test matrix

Phase implementation bắt buộc cover:

- concurrent initialize chỉ tạo đúng một draft;
- initialize completed pass, partial/failed/indeterminate/invalidated reject;
- cross-workspace initialize/read/save/restore reject;
- autosave đúng revision pass, stale revision conflict và không overwrite;
- autosave race với Save Version cho kết quả nhất quán;
- Save Version tạo immutable saved snapshot;
- update/delete saved version bị reject;
- restore tăng draft revision, giữ history và stale baseRevision bị conflict;
- các field claim-relevant làm claims stale đúng matrix;
- hashtags/visual/duration giữ claims theo matrix;
- reload giữ current draft;
- direct /projects/{projectId}/content load đúng mode và draft.

## M. Phase boundary và migration

Phase 0 không:

- tạo script_version table;
- tạo segment/scene table;
- tạo migration;
- sửa Neon schema/data;
- implement editor/debounce/history UI;
- implement Fact Lock/TTS/audio;
- gọi APIKEY.FUN.

Phase 1 sau khi contract được chấp nhận mới tạo schema/migration và core validator tối thiểu.

## N. Open questions

Không còn open question blocking Phase 1. Tên migration/index và procedure oRPC cuối chỉ là chi
tiết triển khai theo convention repo, không thay đổi contract.

## O. Recommendation

editableSnapshotJson là source of truth; draft mutable bằng CAS; saved version immutable; Save
Version giữ draft hiện tại; Restore copy vào draft; source generation pinned; claims có current/stale;
downstream dùng source ScriptVersion/revision; draft validator tách strict Fact-Lock readiness validator.

AFF-US-009 Phase 0 contract is ready for acceptance.
Phase 1 ScriptVersion Foundation may begin.


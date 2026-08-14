# AFF-US-008 — Nền kiến trúc Structured Script Generation

- Trạng thái: Đã chấp nhận
- Cập nhật: 2026-08-14
- Phạm vi: audit, domain contract, data model, transaction design và foundation implementation

Tài liệu này làm AFF-US-008 implementation-ready và ghi nhận foundation đã được triển khai. Nó không thêm provider SDK, API
production, Script Studio, `ScriptVersion` hoặc Fact Lock.

## A. Current-state audit

### Source và convention sẽ tái sử dụng

- `packages/core` giữ domain rule độc lập framework và dùng Zod ở trust boundary.
- Schema PostgreSQL trong `packages/db/src/schema` dùng tên bảng singular, ID `text` do ứng
  dụng tạo, timestamp có timezone, `text + CHECK` cho state enum và index cho foreign key hoặc
  query path thường dùng.
- Runtime dùng `drizzle-orm/neon-serverless` với `Pool`, hỗ trợ transaction thật. Migration
  tooling dùng `DATABASE_URL_DIRECT`; runtime dùng pooled `DATABASE_URL`.
- Protected operation lấy `WorkspaceActor` ở server. Client không truyền `workspaceId`; query
  luôn scope theo workspace và trả not-found khi record thuộc workspace khác.
- `Project` liên kết đúng một `Product` và một `ContentBrief`. Content Brief hiện hỗ trợ
  `platform=tiktok`, thời lượng 15–180 giây, goal, angle và description.
- Product Facts dùng revision nguyên dương, date-only `YYYY-MM-DD`, status
  `draft | verified | inactive` và type đã chốt trong DEC-012.
- `evaluateFactGenerationUsability()` của US7 là policy chuẩn:
  `allowed | allowed_with_warning | blocked`. Chỉ hai trạng thái đầu được phép vào input AI.
- US7 register/replace dependency khóa `product_fact` bằng `FOR UPDATE`, khóa nhiều Fact theo
  thứ tự ID ổn định và tự đọc revision ở server. Fact mutation/history/revision/invalidation
  chạy trong transaction.
- `fact_dependency.productFactId` cố ý không có FK để giữ identity sau hard delete Fact;
  invalidation event là audit append-only.

### Constraint US7 phải thay đổi

Các file sau hiện chỉ cho phép dependent type:

```text
script | fact_lock | voice | video | render
```

AFF-US-008 phải thêm `script_generation` vào:

- `packages/core/src/product-fact/dependency.ts`;
- CHECK `fact_dependency_type_check`;
- CHECK `fact_invalidation_type_check`;
- migration kế tiếp và snapshot Drizzle được generate.

`script_generation` trỏ tới generation artifact của US8. `script` được giữ riêng cho
`ScriptVersion` của US9.

### Conflict giữa source hiện tại và foundation mới

#### Conflict 1 — Public dependency helper tự mở transaction

**Current source:** `registerFactDependency()` và `replaceFactDependencies()` tự gọi
`db.transaction()` và tự đọc revision hiện tại.

**Conflict:** Transaction A của US8 phải snapshot Fact và ghi dependency bằng chính revision
đã snapshot. Gọi helper public sau khi snapshot sẽ tạo transaction khác và có thể lấy revision
mới hơn.

**Recommended adjustment:** tách transaction-scoped primitive nội bộ nhận transaction và các
Fact đã khóa, hoặc xây repository operation riêng cho ScriptGeneration. Public helper hiện có
vẫn giữ contract “không tin revision client”; US8 không truyền revision từ browser.

**Reason:** snapshot và dependency phải cùng một lock scope và commit boundary.

#### Conflict 2 — Roadmap đang gộp US8 và US9

**Current source:** roadmap Slice Structured Script mô tả mock editor, immutable version và
live adapter trong một chuỗi chung.

**Conflict:** boundary mới chốt US8 là generated artifact read-only; editor và
`ScriptVersion` thuộc US9.

**Recommended adjustment:** tách rõ US8/US9 trong roadmap và product spec.

**Reason:** tránh coi provider output là script đã được người dùng chọn/lưu.

#### Conflict 3 — `inputHash` không đủ để phát hiện reuse idempotency key

**Current proposal:** cùng idempotency key và cùng `inputHash` trả record cũ; khác hash trả
`IDEMPOTENCY_CONFLICT`.

**Conflict:** client không biết server snapshot trong lần gọi đầu. Nếu response bị mất rồi Fact
thay đổi, recompute snapshot sẽ tạo `inputHash` mới và báo conflict dù retry phải trả request
gốc.

**Recommended adjustment:** lưu thêm `requestHash`, hash từ client intent ổn định
(`projectId`, mode, parent generation và repair sections). Khi key đã tồn tại, so
`requestHash` và trả record gốc mà không recompute input. `inputHash` tiếp tục nhận diện chính
xác logical snapshot server đã dùng.

**Reason:** idempotency bảo vệ network retry; `inputHash` phục vụ reproducibility và cache
identity, hai khái niệm không đồng nhất.

### Rủi ro tương thích

- Thêm dependent type yêu cầu drop/recreate hai CHECK constraint hiện tại; dữ liệu cũ vẫn hợp lệ.
- Partial unique index pending có thể fail migration nếu data tương lai đã có nhiều pending;
  migration đầu tiên tạo table mới nên chưa có backfill conflict.
- PostgreSQL không tự index FK; mọi FK mới có query/delete path phải có index tương ứng.
- Không dùng GIN cho `jsonb` ở foundation vì read model lấy toàn artifact theo project/ID, không
  filter bằng JSON containment. Chỉ thêm GIN khi xuất hiện query thật cần nó.
- Provider call không được nằm trong Neon transaction. Terminal transition phải dùng compare
  condition `status='pending'` để tránh finalize hai lần.

## B. DEC-015 proposal

DEC-015 được ghi trong `docs/decisions.md`. Nội dung chuẩn của quyết định khóa:

1. US8 lưu `ScriptGeneration` read-only; terminal artifact bất biến.
2. Một row được phép chuyển đúng một lần từ `pending` sang terminal. Repair không sửa row cũ mà
   tạo row mới với `parentGenerationId`.
3. `ScriptGeneration` khác `ScriptVersion`; dependent type tương ứng là
   `script_generation` và `script`.
4. Snapshot Fact và dependency revision được tạo atomically trong Transaction A.
5. Idempotency nằm ở `(workspaceId, idempotencyKey)`, so `requestHash`; `inputHash` và
   `promptHash` có semantic riêng.
6. Mỗi project tối đa một generation `pending` bằng partial unique index.
7. Provider call nằm ngoài transaction.
8. Read model trả cả latest request và latest usable artifact.
9. Stale pending có thể thành `indeterminate`, không retry mù.
10. Dependency của completed/partial/indeterminate được giữ; failed không có output usable được
    detach. Repair có dependency riêng và không mutate parent.

## C. Domain model proposal

### Version và policy tập trung

```ts
export const SCRIPT_OUTPUT_SCHEMA_VERSION = "1";
export const SCRIPT_PROMPT_VERSION = "script-v1";

export const SCRIPT_DURATION_TOLERANCE_RATIO = 0.15;
export const SCRIPT_MAX_VOICEOVER_SEGMENTS = 20;
export const SCRIPT_MAX_SCENES = 20;
export const SCRIPT_MAX_HASHTAGS = 15;
export const SCRIPT_MAX_CLAIMS = 50;
export const SCRIPT_MAX_NORMALIZED_BYTES = 128 * 1024;
```

Các giới hạn nằm trong `packages/core/src/script-generation/policy.ts`, không hard-code lại
trong prompt, API hoặc UI.

### Enum và state

```ts
export const scriptSections = [
  "hook",
  "voiceover",
  "scenes",
  "cta",
  "caption",
  "hashtags",
  "disclosure",
  "claims",
] as const;

export type ScriptSection = (typeof scriptSections)[number];

export type ScriptGenerationStatus =
  | "pending"
  | "completed"
  | "partial"
  | "failed"
  | "indeterminate";

export type ScriptGenerationMode = "full" | "repair";
```

Không nhận arbitrary string cho `validSections`, `invalidSections` hoặc repair sections.
Section array được normalize theo thứ tự `scriptSections` trước khi hash/persist.

### Structured draft

```ts
export type ScriptHook = {
  text: string;
};

export type VoiceoverSegment = {
  key: string;
  text: string;
};

export type ScriptScene = {
  order: number;
  durationSeconds: number;
  visualDirection: string;
  onScreenText: string | null;
  voiceoverSegmentKeys: string[];
};

export type ClaimOccurrence =
  | { section: "hook" }
  | { section: "voiceover"; segmentKey: string }
  | { section: "scenes"; sceneOrder: number }
  | { section: "cta" | "caption" | "hashtags" | "disclosure" };

export type CandidateClaim = {
  text: string;
  occurrence: ClaimOccurrence;
};

export type ScriptDraft = {
  schemaVersion: "1";
  language: "vi";
  hook: ScriptHook;
  voiceoverSegments: VoiceoverSegment[];
  scenes: ScriptScene[];
  cta: { text: string };
  caption: string;
  hashtags: string[];
  disclosure: string;
  claims: CandidateClaim[];
};
```

Candidate Claim chỉ là claim được phát hiện trong draft. Nó không chứa `supportingFactId`,
confidence, approval hoặc trạng thái Fact Lock.

### Partial output

Partial artifact chỉ lưu section đã parse và validate độc lập:

```ts
export type PartialScriptDraft = Partial<ScriptDraft> & {
  schemaVersion: "1";
  language: "vi";
};
```

Implementation không dùng `Partial<ScriptDraft>` trực tiếp làm trust boundary; cần một schema
partial strict ánh xạ section `voiceover` tới field `voiceoverSegments` và chỉ cho phép các
field tương ứng với `validSections`.

### Input snapshot

```ts
export type ScriptGenerationInputSnapshot = {
  request: {
    mode: "full" | "repair";
    repair: null | {
      parentGenerationId: string;
      sections: ScriptSection[];
      baseOutput: ScriptDraft | PartialScriptDraft;
    };
  };
  project: {
    id: string;
    name: string;
  };
  brief: {
    platform: "tiktok";
    goal: string;
    durationSeconds: number;
    angle: string;
    description: string | null;
  };
  product: {
    id: string;
    name: string;
    category: string | null;
  };
  facts: Array<{
    id: string;
    revision: number;
    type: ProductFactType;
    content: string;
    sourceType: ProductFactSourceType | null;
    sourceLabel: string | null;
    sourceUrl: string | null;
    confirmedAt: string | null;
    expiresAt: string | null;
    generationUsability: "allowed" | "allowed_with_warning";
    assessment: FactAssessment;
  }>;
  generation: {
    promptVersion: string;
    outputSchemaVersion: string;
    provider: string;
    model: string;
  };
};
```

Blocked Facts không được xuất hiện. Snapshot không chứa Product `priceAmount`, notes nội bộ,
secret, cookie, authorization hoặc unrelated user data. Array Facts được sort theo Fact ID trước
canonical serialization; semantic order không phụ thuộc query planner. Repair snapshot chứa đúng
validated parent output đã gửi provider, không chỉ parent ID, để input có thể tái lập.

Canonical serializer sort object keys recursively, reject `undefined`, non-finite number và giá trị
không thuộc JSON; giữ thứ tự cho array có semantic thứ tự như scenes/voiceover; normalize trước
những array mang nghĩa set như Fact IDs, repair sections và section status. Hash SHA-256 dùng UTF-8
compact JSON, không phụ thuộc pretty-print hoặc insertion order của object.

### Generation artifact

```ts
export type ScriptGenerationArtifact = {
  id: string;
  workspaceId: string;
  projectId: string;
  createdByUserId: string;
  idempotencyKey: string;
  requestHash: string;
  parentGenerationId: string | null;
  mode: ScriptGenerationMode;
  provider: string;
  model: string;
  promptVersion: string;
  outputSchemaVersion: string;
  inputSnapshot: ScriptGenerationInputSnapshot;
  inputHash: string;
  promptHash: string;
  status: ScriptGenerationStatus;
  output: ScriptDraft | PartialScriptDraft | null;
  validSections: ScriptSection[];
  invalidSections: ScriptSection[];
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMicros: number | null;
  actualCostMicros: number | null;
  currency: string | null;
  errorCode: string | null;
  finishedAt: Date | string | null;
  createdAt: Date | string;
};
```

### Structural và cross-field refinement

- Mọi object là strict; unknown key bị reject.
- Mọi string được trim, có min/max rõ. Hook/CTA/on-screen text tối đa 500 ký tự;
  voiceover/visual direction tối đa 2.000; caption tối đa 5.000; disclosure tối đa 1.000;
  hashtag tối đa 100; candidate claim tối đa 1.000.
- Voiceover key unique và match pattern ổn định như `^[a-z0-9][a-z0-9_-]{0,63}$`.
- Scene order unique, integer dương và liên tục `1..N`.
- Scene duration là số hữu hạn dương.
- Mọi `voiceoverSegmentKeys` phải tồn tại và không trùng trong cùng scene.
- Claim occurrence phải trỏ tới segment/scene tồn tại.
- Hashtag trim, không rỗng, unique sau normalize không phân biệt hoa/thường và không vượt 15.
- Tổng scene duration nằm trong `brief.durationSeconds ±15%`.
- Normalized UTF-8 JSON không vượt 128 KiB.
- `validSections` và `invalidSections` chỉ chứa enum, unique, theo canonical order và không giao.
- `completed`: valid đủ 8 section, invalid rỗng, output full.
- `partial`: valid và invalid đều không rỗng, hợp bằng đủ 8 section, output chỉ chứa phần valid.
- `failed`: không có usable output, valid rỗng.
- `pending`/`indeterminate` không phải usable artifact.

## D. Database/migration design

### Recommended table name

Proposal dùng `script_generation_request`, nhưng convention repository dùng singular domain noun
và row vừa là request vừa là artifact. Tên khuyến nghị là `script_generation`. Nó tránh tạo
thêm table “artifact” giả và giữ ranh giới rõ với `script_version` của US9.

### Table `script_generation`

| Column | PostgreSQL/Drizzle | Null | Lý do |
|---|---|---:|---|
| `id` | `text` PK | no | UUID do app tạo, theo convention hiện tại |
| `workspace_id` | `text` FK workspace cascade | no | ownership scope |
| `project_id` | `text` FK project restrict | no | artifact audit không bị hard-delete ngầm |
| `created_by_user_id` | `text` FK user restrict | no | audit |
| `idempotency_key` | `text` | no | key do client tạo |
| `request_hash` | `text` | no | normalized client intent identity |
| `parent_generation_id` | `text` self FK | yes | immutable repair lineage |
| `mode` | `text` CHECK | no | `full | repair` |
| `provider` | `text` | no | server-selected provider |
| `model` | `text` | no | server-selected model |
| `prompt_version` | `text` | no | prompt contract |
| `output_schema_version` | `text` | no | output contract |
| `input_snapshot_json` | `jsonb` | no | exact normalized logical input |
| `input_hash` | `text` | no | SHA-256 canonical snapshot |
| `prompt_hash` | `text` | no | SHA-256 rendered provider prompt |
| `status` | `text` CHECK | no | lifecycle state |
| `output_json` | `jsonb` | yes | normalized validated full/partial output |
| `valid_sections` | `text[]` default `{}` | no | small enum set, no JSON query needed |
| `invalid_sections` | `text[]` default `{}` | no | small enum set, no JSON query needed |
| `provider_request_id` | `text` | yes | provider audit identifier |
| `input_tokens` | `integer` | yes | usage, nonnegative |
| `output_tokens` | `integer` | yes | usage, nonnegative |
| `estimated_cost_micros` | `bigint` | yes | exact cost, nonnegative |
| `actual_cost_micros` | `bigint` | yes | exact cost, nonnegative |
| `currency` | `text` | yes | ISO-like three uppercase letters |
| `error_code` | `text` | yes | normalized domain/provider error |
| `finished_at` | `timestamptz` | yes | thời điểm vào terminal state |
| `created_at` | `timestamptz default now()` | no | request creation order |

Không thêm `started_at`: với synchronous request foundation, nó trùng semantic với `created_at`.
Không thêm `updated_at`: terminal artifact là immutable; pending chỉ được finalize một lần.
Không lưu raw provider response hoặc raw secret-bearing prompt.

### Array so với JSONB

`valid_sections` và `invalid_sections` dùng `text[]` vì:

- tập phần tử nhỏ, đồng nhất và có toán tử overlap/subset cho CHECK;
- read/write toàn bộ array, không cần document shape;
- dễ enforce enum subset hơn JSONB;
- không cần GIN index vì không có query filter theo section.

`input_snapshot_json` và `output_json` dùng `jsonb` vì là structured document được load nguyên
khối và validate lại bằng domain schema. Foundation không thêm GIN index cho hai cột này.

### Constraints và indexes

1. PK `script_generation_pkey(id)`.
2. Unique `(workspace_id, idempotency_key)`.
3. Partial unique `(workspace_id, project_id) WHERE status='pending'` để chặn hai provider call đồng thời.
4. Composite read index `(workspace_id, project_id, created_at DESC, id DESC)` cho latest read.
5. Index `parent_generation_id` cho lineage/FK.
6. Index `created_by_user_id` theo audit/FK convention.
7. CHECK status trong `pending | completed | partial | failed | indeterminate`.
8. CHECK mode trong `full | repair`.
9. CHECK `full => parent_generation_id IS NULL` và
   `repair => parent_generation_id IS NOT NULL`.
10. CHECK hash match `^[0-9a-f]{64}$` cho request/input/prompt hash.
11. CHECK token/cost nullable hoặc không âm; khi có cost thì currency bắt buộc và match
    `^[A-Z]{3}$`.
12. CHECK section arrays chỉ là subset của 8 section chuẩn, không duplicate, không overlap.
13. CHECK state shape tối thiểu: completed có output và invalid rỗng; partial có output và hai
    array không rỗng; pending có `finished_at IS NULL`; terminal có `finished_at IS NOT NULL`.

Để ngăn repair cross-project, nên dùng composite self-reference:

```text
UNIQUE(workspace_id, project_id, id)
FOREIGN KEY(workspace_id, project_id, parent_generation_id)
  REFERENCES script_generation(workspace_id, project_id, id)
  ON DELETE RESTRICT
```

`parent_generation_id` null làm FK được bỏ qua cho mode full. Authorization vẫn phải được thực
thi ở service; FK chỉ là defense-in-depth.

### Dependency migration

Migration kế tiếp phải drop/recreate:

```text
fact_dependency_type_check
fact_invalidation_type_check
```

với `script_generation` cộng vào allow-list. Không sửa migration `0005` đã áp dụng. Migration
và meta snapshot phải được Drizzle generate, review SQL, rồi chỉ apply khi chủ dự án cho phép.

### Rollback/risk

- Rollback chỉ được bỏ `script_generation` khỏi CHECK sau khi chắc chắn không có dependency type
  đó; nếu đã có data, rollback phải bị chặn hoặc migrate data có chủ đích.
- Drop table rollback sẽ cascade/vi phạm dependency polymorphic vì `fact_dependency` không có FK
  tới artifact. Phải detach/archive dependency generation trước khi drop, không xóa mù.
- `ON DELETE RESTRICT` trên Project và parent giữ audit nhưng có thể yêu cầu future Project delete
  action chuyển thành archive; hiện Project đã ưu tiên archive nên phù hợp.
- Không chạy migration trên Neon trong vòng foundation này.

## E. Transaction design

### Idempotent replay trước Transaction A

Server derive `WorkspaceActor`, normalize client intent và tính `requestHash`.

1. Tìm `(workspaceId, idempotencyKey)`.
2. Nếu có và `requestHash` giống: trả record hiện có, không gọi provider.
3. Nếu có và hash khác: `IDEMPOTENCY_CONFLICT`.
4. Nếu chưa có: vào Transaction A. Unique constraint vẫn là arbiter cuối cho race.

### Transaction A — prepare generation

Lock order cố định để tránh deadlock:

1. Lock/read Project theo `(workspaceId, projectId)` và reject archived/not found.
2. Read ContentBrief và Product qua Project trong cùng workspace.
3. Lock/read toàn bộ Product Facts của Product bằng `FOR UPDATE ORDER BY product_fact.id`.
4. Tính business today một lần; evaluate generation usability cho từng row đã khóa.
5. Loại blocked Fact; nếu không có usable Fact, rollback với `NO_USABLE_PRODUCT_FACTS`.
6. Build exact input snapshot từ các row đang khóa, sort Fact theo ID.
7. Canonical serialize; tính `inputHash`; render prompt ở CPU; tính `promptHash`.
8. Insert `script_generation(status='pending')`.
9. Insert `fact_dependency` cho từng usable Fact bằng **ID và revision từ chính row đã khóa**,
   `dependentType='script_generation'`, `dependentId=generation.id`.
10. Commit.

Không gọi public `registerFactDependency()` vì helper đó mở transaction riêng. Repository nên
cung cấp primitive transaction-scoped không nhận revision từ browser. Revision là data đọc từ
locked row; dependency insert dùng object đó trực tiếp. Vì Product Fact update/delete cũng cần
`FOR UPDATE`, chúng không thể đổi revision cho tới sau commit. Do đó:

```text
inputSnapshot.fact.revision === factDependency.factRevision
```

luôn đúng tại commit.

Partial unique pending là arbiter cho hai tab. Nếu insert conflict, load pending hiện tại và trả
`GENERATION_ALREADY_IN_PROGRESS`; không gọi provider.

### Provider call

Sau COMMIT, provider nhận instruction messages và untrusted JSON data đã render. Không giữ DB
transaction, connection hoặc Fact lock trong lúc chờ.

### Transaction B — finalize một lần

1. Parse provider result như `unknown`.
2. Validate từng section; normalize output; chạy cross-field refinement khi đủ dữ liệu.
3. Derive terminal status.
4. Atomic update chỉ khi `id=? AND workspace_id=? AND status='pending'`.
5. Persist normalized output, section arrays, usage, cost, providerRequestId, errorCode và
   `finishedAt`.
6. Nếu `failed` và không có usable output, detach active dependency trong cùng transaction.
7. Commit.

Nếu conditional update không trả row, finalize đã xảy ra hoặc request không thuộc workspace;
không overwrite terminal artifact.

### Stale pending

- Foundation định nghĩa transition `pending -> indeterminate` bằng conditional update.
- Không automatic resubmit nếu provider idempotency chưa được xác nhận.
- `indeterminate` giữ dependency vì provider có thể đã sinh content từ snapshot đó.
- Khi người dùng chủ động tạo generation mới, partial unique đã được giải phóng sau transition.
- Cơ chế phát hiện/reconcile stale pending được triển khai cùng live provider, không trong vòng
  foundation.

### Repair

- Input dùng `baseGenerationId`, không nhận `baseDraft` từ client.
- Transaction A lock/read parent trong cùng workspace/project; parent phải completed/partial và
  dependency state còn current. Parent invalidated trả `BASE_GENERATION_INVALIDATED` và yêu cầu
  full generation, vì US8 chưa có mapping Fact-to-section đủ an toàn để giữ section cũ.
- Tạo snapshot mới từ current Project/Brief/Product/usable Facts và ghi lineage đến parent.
- Repair sections là enum unique, không rỗng và phải nằm trong `parent.invalidSections` hoặc
  policy repair được chốt sau; mặc định foundation giới hạn ở invalid sections.
- Provider output được merge server-side với valid output của parent, validate lại và lưu thành
  generation mới. Parent và dependency parent không mutate.

## F. Read-model semantics

Read model scoped theo `(workspaceId, projectId)` và trả:

```ts
type ScriptGenerationReadModel = {
  latestRequest: ScriptGenerationArtifactView | null;
  latestUsableArtifact: ScriptGenerationArtifactView | null;
};

type ScriptGenerationArtifactView = ScriptGenerationArtifact & {
  dependencyState: "current" | "invalidated";
  invalidatedFactCount: number;
};
```

### Query ordering

`latestRequest`:

```text
ORDER BY created_at DESC, id DESC
LIMIT 1
```

Không order theo `finished_at` hoặc provider completion time. ID chỉ là deterministic tie-break;
semantic chính là request creation timestamp. Partial unique pending làm request creation được
serialize theo project ở thời điểm có provider call.

`latestUsableArtifact` dùng cùng order và filter:

```text
status IN ('completed', 'partial')
AND output_json IS NOT NULL
```

“Usable” ở đây nghĩa là có normalized output để hiển thị/không làm mất draft, không có nghĩa
Fact vẫn current hoặc đã qua Fact Lock. Dependency state được derive bằng active/invalidated
`fact_dependency` của chính generation. Artifact invalidated vẫn được trả để UI cảnh báo, nhưng
không được coi là factual-current hoặc tự advance workflow.

### State behavior

| latestRequest | latestUsableArtifact | Read behavior |
|---|---|---|
| none | none | empty state |
| pending | A usable hoặc null | giữ A; báo request đang chạy |
| completed | chính nó | render full artifact |
| partial | chính nó | render valid sections và repair action |
| failed | A usable hoặc null | giữ A; hiển thị lỗi latest attempt |
| indeterminate | A usable hoặc null | giữ A; cảnh báo trạng thái không xác định, không auto retry |

Nếu Fact thay đổi sau Transaction A nhưng trước provider response, dependency có thể invalidated
trước khi generation finalize completed/partial. Read model phải trả artifact cùng
`dependencyState="invalidated"`. Không reset hoặc che output.

Read query không mutate stale pending. Reconciliation là business action riêng có conditional
transition và provider-specific policy.

## G. File change map cho implementation

### CREATE

| File | Vai trò |
|---|---|
| `packages/core/src/script-generation/types.ts` | enum và domain types |
| `packages/core/src/script-generation/schema.ts` | strict Zod schemas + refinements |
| `packages/core/src/script-generation/policy.ts` | version, limits, duration tolerance |
| `packages/core/src/script-generation/canonical-json.ts` | deterministic serialization thuần, không phụ thuộc Node |
| `packages/core/src/script-generation/errors.ts` | typed domain errors |
| `packages/db/src/schema/script-generation.ts` | Drizzle table/index/check definitions |
| `packages/api/src/services/script-generation-repository.ts` | Transaction A/B và read model |
| `packages/api/src/services/script-generation-service.ts` | orchestration domain/application flow |
| `packages/api/src/services/script-generation-hashing.ts` | SHA-256 server-side từ canonical JSON/prompt |
| `packages/api/src/providers/text/text-provider.ts` | provider-neutral interface, ở phase implementation |
| `packages/api/src/providers/text/deterministic-text-provider.ts` | deterministic fixtures/tests |
| `packages/api/src/services/script-prompt.ts` | versioned prompt builder/safety boundary |
| `scripts/test-script-generation-foundation.ts` | DB integration/concurrency tests |
| `packages/db/src/migrations/0006_tan_khan.sql`, `0007_slimy_morgan_stark.sql` | generated migration + follow-up hardening |
| `packages/db/src/migrations/meta/0006_snapshot.json`, `0007_snapshot.json` | generated migration snapshots |

UI/live-provider files chưa được tạo trong foundation implementation đầu tiên. Khi bước UI bắt
đầu mới tạo `apps/web/src/features/script-generation/*` và thay route `/content`.

### MODIFY

| File | Thay đổi |
|---|---|
| `packages/core/src/index.ts` | export script-generation domain |
| `packages/core/src/product-fact/dependency.ts` | thêm `script_generation` |
| `packages/db/src/schema/index.ts` | export table mới |
| `packages/db/src/schema/fact-dependency.ts` | update dependent type CHECK |
| `packages/db/src/schema/fact-invalidation-event.ts` | update dependent type CHECK |
| `packages/api/src/services/fact-dependency-repository.ts` | transaction-scoped insert/detach primitive |
| `packages/api/src/routers/index.ts` | chưa đổi; đăng ký router ở phase API production |
| `packages/env/src/server.ts` | chỉ thêm provider config khi live adapter được chọn |
| `package.json` | integration script foundation khi test được thêm |
| `packages/db/src/migrations/meta/_journal.json` | Drizzle generate entry |
| `docs/architecture.md` | data/transaction/provider boundary |
| `docs/roadmap.md` | tách US8 artifact và US9 ScriptVersion |
| `docs/product-spec.md` | thêm ScriptGeneration concept |
| `docs/ai-progress.md`, `docs/changelog.md` | evidence/change log |

### UNCHANGED trong vòng implementation foundation

- `apps/web/src/app/(protected)/projects/[projectId]/content/page.tsx` — vẫn placeholder cho tới
  UI phase.
- Toàn bộ Product Facts UI.
- `packages/api/src/services/product-fact-repository.ts` — mutation locking hiện tại được reuse;
  không đổi freshness/business rule.
- Project workflow/current step — không advance.
- ScriptVersion/Fact Lock/TTS/Media/Video/Analytics modules — chưa tạo.
- `packages/env/src/web.ts` — không có AI secret/config client-side.

## H. Foundation test plan

### Domain/schema

1. Full draft hợp lệ; unknown field bị reject.
2. Voiceover key duplicate bị reject.
3. Scene order duplicate hoặc không liên tục bị reject.
4. Scene tham chiếu segment không tồn tại bị reject.
5. Claim occurrence tham chiếu segment/scene không tồn tại bị reject.
6. Hashtag trim/unique/max count.
7. Tổng duration ngoài ±15% bị reject.
8. Normalized output vượt 128 KiB bị reject.
9. `validSections ∩ invalidSections != ∅` bị reject.
10. completed/partial/failed state-shape invariant.
11. Canonical JSON cho cùng logical object luôn cho cùng hash; Fact array canonical order rõ.

### Database/integration

12. Snapshot Fact revision bằng dependency revision dưới race với Fact update.
13. Fact update chờ Transaction A rồi invalidates đúng revision đã snapshot.
14. Hai pending khác idempotency key trên cùng Project: đúng một insert, request còn lại nhận
    `GENERATION_ALREADY_IN_PROGRESS`.
15. Cùng key + cùng `requestHash`: trả row cũ, không tạo dependency/provider attempt mới.
16. Cùng key + khác `requestHash`: `IDEMPOTENCY_CONFLICT`.
17. Cross-workspace project/generation/parent đều not-found.
18. Repair tạo ID mới, parent đúng project/workspace và parent không đổi.
19. Terminal conditional finalize chỉ thành công một lần.
20. completed/partial giữ dependency.
21. failed không output detach dependency nhưng không xóa invalidation audit cũ.
22. indeterminate giữ dependency và giải phóng pending unique slot.
23. Repair tạo dependency riêng; không detach/mutate dependency parent.
24. Fact đổi trong lúc provider chạy: generation vẫn finalize nhưng read model đánh dấu dependency
    invalidated; repair từ artifact đó bị chặn.

### Read model

25. Chưa có generation: cả hai null.
26. A completed, B pending: latest=B, usable=A.
27. A partial, B failed: latest=B, usable=A.
28. A completed, B indeterminate: latest=B, usable=A.
29. Request cũ hoàn thành muộn không vượt request mới khi order theo `createdAt`.
30. Completed/partial artifact có invalidated dependency vẫn được trả với warning state.
31. Artifact latest thuộc workspace khác không bị đọc.

Migration test đã review SQL cho partial unique index, self-FK/index, array CHECK và hai
dependent-type CHECK; SQL đã được apply thử trên database Postgres local cô lập. Không apply Neon
shared branch trong foundation này.

## Implementation addendum — 2026-08-14

Foundation implementation is now present. The committed scope includes:

- core `ScriptDraft` and strict partial-output validation with cross-field checks;
- exact input snapshot, deterministic canonical JSON and server-side SHA-256 hashes;
- `script_generation` schema plus migrations `0006_tan_khan.sql` and `0007_slimy_morgan_stark.sql`;
- `script_generation` Fact dependency registration/detach primitives inside the caller transaction;
- prepare/finalize orchestration, idempotency by `(workspace_id, idempotency_key)` plus `request_hash`, one pending generation per `(workspace_id, project_id)`, and latest read model;
- deterministic provider scenarios for valid, partial, malformed, timeout and provider-error output;
- focused domain tests and a DB integration script.

The pending uniqueness rule is `(workspace_id, project_id) WHERE status = 'pending'`. The project FK is `ON DELETE RESTRICT`, and the composite self-FK uses the scoped unique constraint `(workspace_id, project_id, id)`. Migration SQL was exercised on an isolated local Postgres database. It was not applied to the shared Neon branch.

No production router, live provider SDK, API key, UI, ScriptVersion, Fact Lock, TTS, media or workflow-advance code is included in this phase.

## I. Open questions

Không còn blocker cho domain/schema foundation.

Trước phase live provider phải chốt đúng một vấn đề: provider/model nào được chọn và provider đó
có hỗ trợ idempotency/retrieve request an toàn hay không. Kết quả này quyết định cách reconcile
`indeterminate`, API key env và cost currency/pricing source; nó không làm thay đổi artifact,
dependency, transaction hoặc read-model contract đã chốt ở đây.

## Prompt safety boundary

Provider prompt về sau phải tách message/segment rõ:

```text
SYSTEM
- role, safety, factual constraints

DEVELOPER
- output schema, formatting, candidate-claim locator rules

USER DATA (serialized JSON)
- Project
- Content Brief
- Product
- allowed/allowed_with_warning Product Facts
```

System/developer instruction phải nói rõ JSON data là untrusted content, không phải instruction.
Không interpolate Fact/Brief trực tiếp vào instruction sentence. Provider output luôn parse như
`unknown`, strict validate và chỉ lưu normalized valid sections; raw response không trở thành
domain object.

# AFF-US-019 — Organic Scripted Content

## Phase 19C.3B — Product-subset Fact Lock v2

- Trạng thái: **19C.3B PRODUCT-SUBSET FACT LOCK V2 IMPLEMENTED — DB ACCEPTANCE BLOCKED**
- Cập nhật: 2026-09-04
- Phạm vi: Organic Scripted Product-subset Fact Lock v2 execution
- Organic dùng source mode `ORGANIC_NO_PRODUCT`, Claim Refresh input v1 và
  prompt/output v2; Affiliate giữ nguyên Claim Refresh v1. Không có schema/migration mới.

AFF-US-001–012 là historical/golden baseline. AFF-US-013–018, 19B và 19C.1 đã
accepted. Quick Image/Media First, Organic Fact Lock runtime, Voice TOCTOU và
Project creation UI không thuộc 19C.2B.

## 19C.3B implementation boundary

Organic Scripted Standard v1 now derives the `ORGANIC_PRODUCT_V2` strategy from
the current confirmed `script-draft.v3` ClaimManifest builder v2. The persisted
FactLockRun input mode remains `MANIFEST_V1`; only the semantic input version is
`fact-lock.manifest.v2`. The full ordered GENERAL + PRODUCT Manifest remains
provenance, while the provider and FactLockClaim rows contain only the confirmed
PRODUCT subset in Manifest order. Product Facts use the existing exact snapshot
and fingerprint helper, and v2 request identity includes the Manifest and Facts
fingerprints.

Affiliate remains on the frozen builder-v1 / `fact-lock.manifest.v1` path,
including zero-claim behavior. Organic claimless/general-only states remain
`not_required` with zero provider calls; Voice paid authorization remains
deferred to 19D. Version-aware read, gate, restart, idempotency, mismatch,
uncertainty, currentness, and manual-review paths recognize the v2 snapshot
without adding a schema, migration, `MANIFEST_V2` mode, or output-version bump.

Unit, web, type, and Biome checks pass. Disposable PostgreSQL acceptance is
blocked in this environment because no approved `AFFICHANNEL_M1_TEST_DATABASE_URL`
or local PostgreSQL/Docker runtime is available; no remote, development, or
production database was contacted.

## 19C.3A acceptance

The public `factLock.prepareManifest` contract remains
`projectId`/`scriptVersionId`/`expectedScriptVersionRevision`; the server derives
the exact Organic Scripted Standard v1 identity and routes current confirmed
`script-draft.v3` inventories to `claim-manifest-builder.v2`. The envelope remains
`claim-manifest.v1`; Affiliate continues to use the frozen builder v1 byte
semantics and Fact Lock remains Affiliate-only on `fact-lock.manifest.v1` with no
`MANIFEST_V2` input mode.

Organic v2 persists the complete ordered GENERAL + PRODUCT inventory. It requires
current claims, an exact claims-source revision match, CONFIRMED subject metadata,
and USER/STRUCTURED_SOURCE authority; unresolved, stale, legacy, malformed, or
subject-less claims fail closed. A claimless/general-only inventory returns a
deterministic `not_required` result and creates no row. A PRODUCT claim with no
accessible Project Product returns `CLAIM_MANIFEST_PRODUCT_REQUIRED` and never
persists a null-product executable manifest.

Claim keys and source-text hashes retain the v1 textual/structural identity, while
the v2 authority fingerprint includes subject metadata and Product identity and
excludes `proposedSubject`, timestamps, IDs, and provider data. Subject-only
changes therefore create a new historical row without rewriting the prior row;
existing v1 history remains readable through the version-aware parser. Repository
create/reuse, malformed-v2 fail-closed reads, Organic eligibility, full inventory,
Product-change history, frozen v2 vectors, refresh→confirm→manifest composition,
Affiliate, Fact Lock, web, type, and formatting regressions pass on a disposable
loopback PostgreSQL database with live AI/TTS calls disabled.

## 19C.2B acceptance

`scriptVersion.confirmClaimSubjects` is a protected, server-authorized batch
mutation for the exact Organic + Scripted + `SCRIPTED_STANDARD` v1 identity and
the current mutable `script-draft.v3` ScriptVersion only. Its strict input is
`scriptVersionId`, `expectedScriptVersionRevision`, and zero-based
`{ claimIndex, subject: GENERAL | PRODUCT }` decisions; caller-supplied source,
binding, Product ID, claim status, applicability, or project identity is not
accepted. The server requires every current `NEEDS_CONFIRMATION` claim to be
covered, permits explicit correction of already-confirmed claims, and rejects
duplicates, partial batches, and out-of-range indices.

The repository locks the workspace-scoped Project and current draft in one
transaction and applies one revision CAS (R→R+1) for the complete batch. It
reuses `confirmClaimSubject`, writes `subjectStatus = CONFIRMED` and
`subjectSource = USER`, preserves `proposedSubject` as provider provenance, and
constructs the only allowed Product subject binding (`PROJECT_PRODUCT`) on the
server. Product claims remain valid when `Project.productId` is null; the
existing applicability resolver therefore derives Product `REQUIRED` and Fact
Lock `BLOCKED` without mutating Project, Manifest, or Fact Lock state.

Empty or already-confirmed inventories return sanitized `not_required` without a
revision. Stale/mismatched claim source revisions, Affiliate identities,
historical ScriptVersions, malformed persisted Organic claims, cross-workspace
IDs, and CAS races fail closed with mapped public errors. Confirmation never
calls a provider, refreshes claims, changes text/occurrences, creates a
confirmation table, or changes schema/migrations. A subsequent Claim Refresh
read sees current confirmed claims and returns `not_required` with zero provider
calls. Clean-room matrix, concurrency, applicability, refresh, Affiliate, web,
type, and formatting regressions pass on disposable loopback PostgreSQL.

## 19C.2A acceptance

Claim Refresh keeps input v1 and the Affiliate prompt/output v1 contract. Exact
Organic Scripted `script-draft.v3` uses prompt/output v2, with the same source
projection and no Product/Product Facts/Manifest/Fact Lock input. Both GENERAL and
PRODUCT provider proposals are accepted as unresolved claims carrying
`NEEDS_CONFIRMATION` and `subjectSource = null`; no provider result is authority.
Current unresolved Organic claims are `NOT_REQUIRED`, stale claims refresh with
R→R+1 CAS, and zero claims complete without Product or Fact Lock. At the 19C.2A
boundary, user confirmation was intentionally deferred to 19C.2B.

## 19C.1 acceptance

Resolver now consumes one canonical claim summary derived from the current
ScriptVersion. Organic Scripted claimless/general-confirmed content returns
`PRODUCT = NOT_REQUIRED` and `FACT_LOCK = NOT_REQUIRED`; confirmed Product claims
escalate Product/Fact Lock, while stale, unresolved, unknown, and malformed claim
state fails closed. Current ScriptVersion wins over historical versions, manifests,
and FactLock runs. Affiliate Scripted remains on its accepted compatibility path.

The adaptive workflow and both single-read/batch entry paths receive the same
summary. Product/Fact Lock are hidden as not-required steps for claimless Organic;
Voice execution and subject-aware Fact Lock execution remain outside this phase.
Shadow parity covers Organic vectors. Clean-room DB checks use loopback only and
live AI/TTS providers remain disabled.

## 1. Verdict

Phase 19A.2/19A.3 đã khóa và accepted claim-subject foundation. Phase 19B đã
activate đúng identity Organic + Scripted + `SCRIPTED_STANDARD` v1 với
`productId = null`; server tự derive source mode và không nhận sourceMode từ client.

Organic preflight không query Product/Product Facts; provider PRODUCT proposal
trong ScriptGeneration vẫn fail closed. Claim applicability remains active in
19C.1; subject-aware Fact Lock execution and Voice remain inactive until later phases.

Fresh clean-room acceptance đã PASS trên disposable PostgreSQL loopback với
process-only authorities và live AI/TTS tắt. Validation attempt trước đó invalid
do remote `.env` contact; clean-room run này đã supersede safety certification đó.

Không được giải quyết blocker bằng keyword matching, suy luận từ tên Product, AI
output hoặc bằng cách coi mọi factual claim là Product claim. Không được tạo một
claim taxonomy độc lập song song với ClaimManifest/ScriptVersion mà không có quyết
định canonical trước.

## 2. Existing architecture audit

### Project identity

M5 đã enforce bốn Channel-First identity columns của Project là NOT NULL và giữ
`product_id` nullable. Target identity cho story này là:

```text
contentType       = ORGANIC
creationPath      = SCRIPTED
contentFormat     = SCRIPTED_STANDARD v1
productId         = null
```

Đây là identity đã được 19B kích hoạt cho ScriptGeneration no-product; 19C.1
tiếp tục kích hoạt policy/read-model applicability trên đúng boundary này.

### ScriptGeneration

Current persisted operation mode vẫn chỉ là `full | repair` (`packages/core/src/script-generation/types.ts`).
`script_generation.input_snapshot_json` là JSONB và có thể được mở rộng additive
trong phase runtime tương lai; không cần tạo migration chỉ để tách source mode nếu
19B giữ source mode trong versioned snapshot contract.

Tuy nhiên current implementation chưa hỗ trợ Organic no-Product:

- `ScriptGenerationInputSnapshot.product` hiện là object bắt buộc;
- `prepareInTransaction()` inner-join Project với Product;
- snapshot luôn đọc Product Facts;
- generation fail khi không có usable Product Facts;
- request input chưa có `ORGANIC_NO_PRODUCT`.

Vì vậy `PRODUCT_BACKED` và `ORGANIC_NO_PRODUCT` hiện mới là target dimension trong
canonical docs, chưa phải active API/runtime capability.

### Current claim model — audited gap (resolved by DEC-035)

Audit hiện tại xác nhận:

- `ScriptDraft.claims` chỉ có `{ text, occurrence }`;
- `ScriptVersion` candidate claims cũng chỉ mang text/occurrence metadata;
- Script Claim Refresh provider output chỉ có `{ text, occurrence }`;
- `ClaimManifestClaim` có `claimKey`, `claimText`, `locator`, `sourceTextHash`,
  nhưng không có Product/general claim kind;
- `FactLockClassification` gồm `SUPPORTED`, `NEEDS_REVIEW`, `UNSUPPORTED`,
  `PROHIBITED`; đây là kết quả đánh giá verification, không phải claim kind;
- `ProductFactType = claim` mô tả loại Product Fact, không phân loại một claim trong
  Script thành Product claim;
- Applicability input hiện không nhận current claim inventory và resolver hiện chưa
  có policy phân biệt Organic claimless với Organic có Product claim.

Claim Refresh prompt còn mô tả output là “factual or product claims”, nhưng output
contract không mang discriminator để phân biệt hai loại này. Đây là gap thực tế,
không phải chỉ là thiếu wording trong docs.

### Fact Lock và Voice

Fact Lock hiện xác minh claims với Product Facts và đã có Manifest-first public
contract cho Affiliate. Voice Preview/Voice Segment hiện giữ FactLockGate ở server.
Organic activation cần thay đổi policy theo Applicability, nhưng chỉ được bỏ gate
khi server đã re-read identity, current ScriptVersion, current claim state và
Applicability ngay trước paid provider call.

Các thay đổi trên thuộc 19C/19D, chưa được thực hiện trong 19A.

## 3. Intended Organic source-mode contract

Khi 19B được authorize sau 19A.3:

- input source mode gồm `PRODUCT_BACKED | ORGANIC_NO_PRODUCT`;
- persisted operation mode vẫn là `full | repair`;
- source mode do server derive từ Project identity/policy, không phải caller override;
- Organic no-Product không lookup Product/Product Facts;
- Product, Product Facts, ClaimManifest và Fact Lock không bắt buộc cho baseline
  claimless;
- cùng `ScriptGeneration → ScriptVersion` artifact/versioning/repair/idempotency
  foundation được reuse;
- source mode phải nằm trong versioned input snapshot để audit/hash/replay không nhập
  nhằng hai semantics.

## 4. Product claim source-of-truth requirement

Trước 19B/19C phải khóa một contract có thể trả lời deterministic:

```text
current ScriptVersion claim → PRODUCT_CLAIM hoặc GENERAL_NON_PRODUCT_CLAIM
```

Contract đó phải:

1. dùng current ScriptVersion/claim state làm authority;
2. không dùng stale ClaimManifest, old ScriptVersion hoặc UI-local state để quyết
   định applicability hiện tại;
3. không coi `SUPPORTED`/`UNSUPPORTED` là Product claim kind;
4. không suy ra chỉ bằng keyword hoặc tên Product;
5. xác định rõ claim nào được đưa vào Product-scoped Manifest/Fact Lock;
6. định nghĩa hành vi khi claim refresh chưa chạy, output malformed hoặc trạng thái
   không xác định;
7. cho phép de-escalation sau khi current claims đã loại bỏ toàn bộ Product claims,
   trong khi historical Manifest/FactLockRun vẫn immutable/readable.

Contract đã được khóa tại Phase 19A.2; các yêu cầu `US019-T04`, `US019-T05`,
`US019-T07`, `US019-T09` và TOCTOU escalation chỉ được implement sau 19A.3 theo
đúng contract này.

## 5. Applicability matrix (19C.1 read policy)

| Case | Product | Script | Fact Lock | Voice paid operation |
|---|---|---|---|---|
| Organic + Scripted, product null, no Product claim | NOT_REQUIRED | applicable; READY/COMPLETE theo lifecycle | NOT_REQUIRED | eligible sau server recheck |
| Organic + Scripted, product null, Product claim | REQUIRED/BLOCKED | applicable | REQUIRED/BLOCKED | blocked; provider calls = 0 |
| Organic + Scripted, Product selected, Product claims, Facts usable, Fact Lock chưa PASS | COMPLETE | applicable | REQUIRED/READY theo gate | blocked |
| Organic + Scripted, Product selected, Product claims, Fact Lock PASS | COMPLETE | applicable | COMPLETE | eligible |
| Organic + Scripted, Product selected, không Product claim | policy-dependent/optional | applicable | NOT_REQUIRED nếu resolver trả đúng policy | eligible sau server recheck |
| Affiliate + Scripted | current accepted behavior | current accepted behavior | current accepted behavior | current accepted behavior |

Matrix này là 19C.1 policy/read-model evidence. Paid Voice and subject-aware Fact
Lock execution remain phase-gated.

## 6. Escalation, de-escalation và TOCTOU target

- Khi current claims chuyển từ claimless sang có Product claim, resolver phải đổi
  Product/Fact Lock policy mà không tạo Project mới.
- `productId = null` không được phép chạy Product-backed Fact Lock hoặc paid Voice
  bypass.
- Khi current claims loại bỏ toàn bộ Product claims, applicability có thể quay lại
  `PRODUCT = NOT_REQUIRED` và `FACT_LOCK = NOT_REQUIRED` nếu không còn requirement
  khác. Historical artifacts chỉ là history.
- Trước Voice Preview, Segment generation và regeneration, server phải đọc lại
  Project identity, current ScriptVersion, current claim state và Applicability.
  Client state không có quyền bỏ qua gate.
- Product claim escalation/de-escalation không tự động gọi AI, Claim Refresh, Fact
  Lock hoặc TTS; các paid actions vẫn là explicit user actions.

## 7. Planned implementation phases after unblock

- **19B — Organic ScriptGeneration:** source mode, no-Product preflight, snapshot/
  prompt, repair và fail-closed generated-output protection.
- **19C.1 — Claim Applicability:** current ScriptVersion summary, Organic Resolver
  policy, adaptive/read-model propagation, fail-closed state and shadow parity.
- **19C.2 — Claim Resolution/Refresh:** confirmation and Organic refresh runtime
  (completed).
- **19C.3 — Manifest/Fact Lock:** subject-aware Manifest/Fact Lock execution.
- **19D — Voice Applicability:** Config policy, Preview/Segment server recheck,
  TOCTOU protection và zero-provider-call tests khi gate fail.
- **19E — UI/E2E/manual:** Organic Project creation, Script Studio, escalation/
  de-escalation và full Affiliate regression.

19B trở đi không được bắt đầu trước khi 19A.3 hoàn tất các test vectors và
compatibility adapters.

## 8. Non-regression and scope boundary

Affiliate Scripted flow phải giữ nguyên:

```text
Product → Product Facts → Script → Claim Refresh → ClaimManifest
→ Manifest-first Fact Lock → FactLockGate → Voice
```

Phase 19A không thay đổi runtime, schema, migration, Project, ScriptGeneration,
ScriptVersion, ClaimManifest, FactLockRun, Voice, Applicability, Adaptive Workflow,
Claim Refresh hoặc provider behavior. Không activate Organic, Quick Image, Media
First, AFF-US-020 hoặc later stories.

## Phase 19A.1 — Product claim classification architecture plan

Phần này là architectural recommendation để đưa vào 19A.2 contract lock. Nó chưa
thay đổi contract/runtime hiện tại và không phải là authorization cho 19B.

### A. Option comparison

| Option | Determinism | Product binding | Backward compatibility | UX/complexity | Provider dependency | Decision |
|---|---:|---:|---:|---:|---:|---|
| A. Structured claim type | High | Medium | Medium | Medium | Low | Not selected: type alone does not define which Product is bound |
| B. Subject/target | Very high | Very high | High | Medium | Low | Necessary primitive, but needs an authority for ambiguous classification |
| C. Structured source | High for tagged source | High | Low/medium | High | Low | Useful input, but free-text edits and legacy content remain unresolved |
| D. Explicit user confirmation | Very high | High | High | Higher friction | Low | Safe authority, but insufficient as the persisted claim shape by itself |
| E. Explicit subject + server/user confirmation | Very high | Very high | High | Medium | Low | **Selected canonical model** |

The selected model is one hybrid contract: every current claim has an explicit
server-owned subject, while provider output and heuristic/structured extraction
are only proposals until accepted by an explicit server-side confirmation path.
The model does not use keywords, Product names, or an LLM response as the final
policy authority.

### B. Chosen canonical claim model

The canonical classification belongs to the current ScriptVersion claim
inventory. The proposed shape for 19A.2 is:

```ts
type ClaimSubject =
  | { kind: "GENERAL" }
  | { kind: "PRODUCT"; binding: "PROJECT_PRODUCT" };

type CurrentScriptClaim = {
  text: string;
  occurrence: ClaimOccurrence;
  subject: ClaimSubject;
  subjectStatus: "CONFIRMED" | "NEEDS_CONFIRMATION";
  subjectSource: "USER" | "STRUCTURED_SOURCE" | "LEGACY_COMPATIBILITY" | null;
};
```

`GENERAL` maps to `GENERAL_NON_PRODUCT_CLAIM`; `PRODUCT` maps to
`PRODUCT_CLAIM`. `subjectStatus = NEEDS_CONFIRMATION` is not a third claim
kind: it means the current classification is unknown for policy purposes. A
proposal may be retained separately or in this provisional shape, but
`subjectSource` must be null or otherwise non-authoritative. A claim inventory is
safe to use for applicability only when the current ScriptVersion is current and
every claim subject is confirmed.

This is intentionally a project-level Product binding. A Product claim does not
invent or carry a caller-supplied Product ID inside the claim. Its binding is
resolved against the current Project Product at the policy boundary.

### C. Product binding and preselection semantics

Product selection is not required before a user can express Product intent. The
following states are distinct:

| State | Classification | Binding state | Required behavior |
|---|---|---|---|
| Organic, no Product, no current claims | Claimless | None | Product/Fact Lock may be NOT_REQUIRED when all other gates pass |
| Organic, no Product, confirmed Product subject | Product-bearing | `PRODUCT_UNBOUND` | Product is REQUIRED/BLOCKED; no fake Product ID; Fact Lock and paid Voice are blocked |
| Product selected, confirmed Product subject | Product-bearing | `PROJECT_PRODUCT` | Resolve against the current Project Product and require applicable Product Facts/Fact Lock |
| Product changed or removed after classification | Product-bearing | Stale | Do not silently rebind; require re-evaluation/confirmation before a paid gate |

The current Project Product is therefore the only Product identity used for
verification. A later Product change invalidates the current binding context but
does not rewrite historical ScriptVersions, manifests, or FactLockRuns.

### D. General, claimless, and unknown content

- **Claimless** means the current claim array is empty.
- **General-only** means one or more claims exist and all are confirmed
  `GENERAL`; this is not the same as claimless, but it does not require Product
  Facts solely because it contains factual editorial content.
- **Product-bearing** means at least one confirmed `PRODUCT` claim exists.
- **Unknown** means the current claim state, subject, refresh result, or source
  revision is stale, malformed, or incomplete.

Unknown/stale classification is fail-closed: the resolver must not treat it as
general-only. Product/Fact Lock policy is `BLOCKED` with a typed
classification-currentness reason until the user performs the required refresh
or confirmation. No paid TTS/provider call may be authorized from an unknown
state.

### E. Applicability Resolver input

The Resolver should receive a server-derived, non-text claim summary from the
current ScriptVersion, for example:

```ts
script: {
  // existing lifecycle fields...
  claimsStatus: "CURRENT" | "STALE" | "UNKNOWN";
  productClaimState: "NONE" | "PRESENT" | "UNKNOWN";
  productClaimCount: number | null;
  generalClaimCount: number | null;
}
```

Raw claim text, UI state, stale manifests, and old ScriptVersions are not Resolver
authority. `productClaimState = NONE` is valid only when the current inventory
and all subject classifications are current and confirmed. The Resolver remains
the owner of applicability; claim classification does not own Product
applicability.

### F. Target applicability matrix after classification

| Case | Product | Script | Fact Lock | Paid Voice |
|---|---|---|---|---|
| A. Organic + claimless | NOT_REQUIRED | applicable | NOT_REQUIRED | Eligible after immediate server recheck |
| B. Organic + general-only | NOT_REQUIRED | applicable | NOT_REQUIRED | Eligible after immediate server recheck |
| C. Organic + Product claim, Product absent | REQUIRED/BLOCKED | applicable | REQUIRED/BLOCKED | Blocked; provider calls = 0 |
| D. Organic + Product claim, Product present, Facts missing | COMPLETE | applicable | REQUIRED/BLOCKED | Blocked |
| E. Organic + Product claim, Product present, Fact Lock passed | COMPLETE | applicable | COMPLETE | Eligible after immediate server recheck |
| F. Organic + Product selected, no Product claim | Optional/policy-dependent | applicable | NOT_REQUIRED if no other requirement | Eligible after immediate server recheck |
| G. Organic + stale/unknown claim classification | UNKNOWN/BLOCKED | applicable but not paid-ready | UNKNOWN/BLOCKED | Blocked; provider calls = 0 |
| H. Affiliate + current accepted flow | Existing accepted behavior | Existing accepted behavior | Existing accepted behavior | Existing accepted behavior |
| I. Historical Affiliate snapshot without subject | Existing legacy Product candidate behavior | Existing accepted behavior | Existing accepted behavior | Existing accepted behavior |

The old Affiliate row remains the non-regression baseline. The existing M2
reason `CONTENT_FORMAT_CREATION_PATH_MISMATCH` is not renamed; any M3/M4 claim
policy reason is a separate contract concern.

### G. Claim Refresh and ScriptGeneration authority

Claim Refresh may propose `subject` metadata, but provider output is untrusted
and cannot finalize applicability. The proposed flow is:

1. Refresh extracts claims from the exact current ScriptVersion content.
2. The server validates the output shape and source revision/content hash.
3. Unambiguous structured-source metadata may be carried forward as a proposal;
   ambiguous or provider-supplied classification remains
   `NEEDS_CONFIRMATION`.
4. An explicit user/server confirmation creates the current confirmed subject
   assignment.
5. Any edit that changes claim-bearing content marks the classification/current
   inventory stale until refreshed or explicitly re-confirmed.

For `ORGANIC_NO_PRODUCT`, generation must not create a confirmed Product claim
or silently convert provider text into a Product claim. A generated output with
an explicit Product proposal is rejected or held as non-paid-ready; a generated
claim without a confirmed subject is `NEEDS_CONFIRMATION`. This preserves the
safe claimless/general-only path without pretending that a model is a semantic
authority. The generation prompt is a constraint, not the enforcement boundary.

### H. Manual escalation and de-escalation

The editor must expose the classification state rather than infer it from text:

- user marks/accepts a claim as Product-bound or General;
- Product-bound confirmation with no Project Product shows a blocked
  `PRODUCT_UNBOUND` state and offers Product selection;
- changing/removing a Product or editing claim-bearing text marks affected
  classification stale;
- removing all Product claims can de-escalate the current content to
  `GENERAL`/`NONE` only after the current inventory is revalidated;
- historical manifests and FactLockRuns remain immutable history and do not
  keep the current content escalated by themselves.

No escalation or de-escalation automatically invokes AI, Fact Lock, or TTS.
Those remain explicit user actions with their own provider/cost gates.

### I. ClaimManifest architecture

ClaimManifest should remain the complete output-bearing claim inventory, not a
Product-only replacement. Each manifest claim carries the normalized subject
metadata, while Manifest-first Fact Lock selects only the confirmed `PRODUCT`
subset for Product verification. `GENERAL` claims remain in the manifest for
provenance, fingerprinting, and audit; they are not sent to Product Fact Lock
solely because they are factual.

For an Organic general-only result, a ClaimManifest is conditional on the
existing applicability policy. If a manifest is created for another reason,
its `isEmpty`/`claimCount` still describe the complete claim array, not the
Product subset. This preserves the existing full-inventory contract and avoids
making general claims disappear from source evidence.

The current database stores the manifest claim payload in `claims_json` JSONB,
and ScriptVersion claims in `editable_snapshot_json` JSONB. The plan therefore
expects additive versioned payloads, not a new relational claim table or a schema
migration merely to add subject metadata. The existing relational manifest
identity/foreign-key semantics remain unchanged.

### J. Versioning and historical Affiliate compatibility

| Contract/constant hiện tại | Next target | Lý do |
|---|---|---|
| `script-input.v2` | `script-input.v3` ở 19B | Thêm server-selected source mode/policy |
| `script-draft.v2` | `script-draft.v3` | Thêm subject/status/source vào claim; ScriptVersion dùng constant này |
| `script-prompt.v2` | `script-prompt.v3` | Organic no-Product prompt policy |
| `script-claim-refresh.v1` | Giữ v1 | Source projection/hash không đổi |
| `script-claim-refresh-prompt.v1` | `script-claim-refresh-prompt.v2` | Provider proposal semantics |
| `script-claim-refresh-output.v1` | `script-claim-refresh-output.v2` | Thêm `proposedSubject` không authoritative |
| `claim-manifest.v1` | Giữ v1 envelope | DB CHECK hiện chỉ cho phép v1; subject additive trong JSONB |
| `claim-manifest-builder.v1` | `claim-manifest-builder.v2` | Fingerprint projection thêm subject metadata |
| `fact-lock.manifest.v1` | `fact-lock.manifest.v2` cho subject-aware path | Input semantics chỉ verify Product subset |
| `fact-lock-manifest-prompt.v1` | `fact-lock-manifest-prompt.v2` | Provider chỉ nhận confirmed Product subset |
| `fact-lock-output.v1` | Giữ v1 | Verification result shape không đổi |
| `fact-lock-prompt.v3` | Giữ v3 | Legacy Affiliate path không đổi |
| `fact-lock-zero-claim.v1` | Giữ v1 | Organic không tự chạy zero-claim Fact Lock |

`sourceTextHash` remains a hash of the source text projection. Subject metadata
is included in the normalized claim/fingerprint projection where required, so a
classification change cannot reuse a semantically different current manifest
under the old fingerprint. Existing v1 JSON payloads and Affiliate history are
read through a legacy adapter and are not rewritten or backfilled by 19A.2.

For historical Affiliate ScriptVersions with no subject field, the compatibility
adapter treats their claims as legacy Product-verification candidates for the
existing Affiliate path. It does not claim that those old payloads prove an
Organic/general classification, and it does not alter completed Affiliate
history.

### K. Voice TOCTOU and provider boundary

Immediately before Preview, Segment generation, or regeneration, the server must
re-read Project identity, current ScriptVersion/revision, current classification
state, and Resolver output in one authorization boundary. It must reject stale,
unknown, unbound, or newly escalated Product states before opening a paid
provider operation. The client, an earlier Resolver response, a stale manifest,
and a prompt instruction cannot authorize a provider call.

### L. UX and cost boundary

The UI should present `NOT_REQUIRED`, `REQUIRED`, `BLOCKED`, `READY`, `COMPLETE`,
`STALE`, and `NEEDS_CONFIRMATION` as distinct states, with a reason and next
action. It must not show a skipped Product/Fact Lock step as successfully
completed. Claim Refresh, confirmation, Fact Lock, and AI/TTS generation remain
explicit actions; no background provider call is introduced by classification.

### M. Historical implementation sequence and decision gates

After 19A.2 accepts the exact names and payload contract:

- **19A.2 — Contract lock:** finalize the discriminated subject shape, status /
  source vocabulary, legacy adapter, reason codes, and version numbers.
- **19A.3 — Test vectors:** lock claimless, general-only, Product-bound,
  unbound, stale, malformed, Product-change, and escalation/de-escalation vectors.
- **19B — Organic ScriptGeneration:** add source mode and no-Product preflight;
  no Organic runtime activation before the claim policy is enforced.
- **19C.1 — Claim applicability:** expose the current inventory to Resolver and
  implement Organic conditional read-model policy (completed).
- **19C.2/19C.3 — Claim resolution and Manifest/Fact Lock:** later runtime phases.
- **19D — Voice:** add the immediate server-side TOCTOU recheck and zero-call
  blocked-path tests.
- **19E — UI/E2E:** activate Organic creation/editor flow and perform parity /
  regression checks.

The five questions that must pass before 19B are:

1. Can current and legacy ScriptVersion JSON be read without rewriting history?
2. Is `PRODUCT` binding always resolved from the current Project Product, with
   no caller-supplied or invented Product ID?
3. Does unknown/stale classification fail closed in Resolver and Voice?
4. Does ClaimManifest preserve the complete inventory while Fact Lock filters
   only Product claims?
5. Can Affiliate history continue through its existing path without backfill?

All five have a viable answer in this recommendation. Phase 19A.2/19A.3 and 19B
are accepted; 19C.1 now owns the current claim applicability read policy.

### N. 19A.2 locked decision (historical contract)

The runtime now reads the accepted subject metadata from current Organic v3
ScriptVersions while retaining the compatibility adapter for Affiliate v2. The
following decision remains locked:

- `ClaimSubject` uses only `GENERAL` and `PRODUCT/PROJECT_PRODUCT`;
- confirmation is required for free-text/provider proposals, with no AI bypass;
- stale/unknown/unconfirmed states fail closed;
- versioning, reason codes and the legacy Affiliate adapter follow DEC-035.

## 9. Current acceptance boundary

```text
AFF-US-019 Phase 19C.3B: PRODUCT-SUBSET FACT LOCK V2 IMPLEMENTED / DB ACCEPTANCE BLOCKED
19C.3A status: COMPLETE (Organic ClaimManifest builder v2 + persistence)
19C.3B status: IMPLEMENTED; disposable PostgreSQL matrix pending
19D status: NOT STARTED
19E status: NOT STARTED
Runtime changed: Organic Claim Refresh v2, protected confirmation, Organic ClaimManifest v2, and Product-subset Fact Lock v2
Schema changed: NO
Migration created: NO
Provider calls: 0
Production DB touched: NO
Development manual DB touched: NO
```

Required next action is to run the disposable PostgreSQL 19C.3B acceptance matrix.
Voice TOCTOU remains phase-gated for 19D, and no UI was added in 19C.3B.

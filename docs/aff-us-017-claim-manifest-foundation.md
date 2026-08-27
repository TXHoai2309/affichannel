# AFF-US-017 — ClaimManifest Foundation

- Trạng thái: PHASE 17A–17E PASS; DONE
- Phiên bản: 1.1
- Ngày: 2026-08-25
- Quyết định: DEC-031, DEC-017-A–D; làm rõ V08-DEC-011 và V08-DEC-013
- Dependency: Domain Evolution M5 DONE → AFF-US-017 → AFF-US-018

## 1. Mục tiêu và ranh giới

ClaimManifest là immutable canonical claim-input artifact: inventory những claim
cần được kiểm tra từ một source revision đã pin. Nó không phải Fact Lock result,
không thay ScriptVersion, không chứa Product Facts snapshot và không phải workflow
hay applicability state.

```text
Content source revision
→ deterministic source adapter / manifest builder
→ ClaimManifest: claims to be checked
→ AFF-US-018 FactLockRun: evaluation of those claims
→ existing Fact Lock gate
→ Voice
```

AFF-US-017 sở hữu domain, additive persistence, deterministic builder cho current
ScriptVersion, create/reuse/read service và tests. AFF-US-017 không đổi
FactLockRun, Fact Lock execution, Voice, Resolver, Adaptive Workflow hoặc current
Affiliate behavior. AFF-US-018 mới sở hữu Manifest-first FactLockRun linkage và
execution cutover.

## 2. Repository findings và canonical precedence

`V08-DEC-013` là ClaimManifest decision cần áp dụng. Historical `DEC-013` ngày
2026-08-12 nói về Product Fact verification intent và Drawer anatomy; nó không
liên quan ClaimManifest và không được sửa/đánh lại số.

Thứ tự authority khi wording khác nhau:

1. DEC-031 và contract này cho AFF-US-017 foundation.
2. V08-DEC-011/V08-DEC-013, DEC-025 và Product Specification v0.8.
3. `claim-manifest-fact-lock-contract.md` cho target end-state US17+US18.
4. AFF-US-008–012 là historical implementation evidence của current golden flow.

### V08-DEC-013 status

| Requirement | Current status | Owner |
|---|---|---|
| New FactLockRun stores ClaimManifest ID/fingerprint | Not implemented | AFF-US-018 |
| Script fields become nullable provenance for new mode | Not implemented | AFF-US-018 |
| Legacy Script-linked rows remain readable | Already implemented as current-only mode; dual-mode not implemented | AFF-US-018 |
| New pending/idempotency uses Manifest fingerprint | Not implemented | AFF-US-018 |
| ClaimManifest immutable server-built source | Phase 17A–17E DONE; dormant | AFF-US-017 |

No V08-DEC-013 requirement is superseded. AFF-US-017 prepares its dependency but
must not partially expose Manifest-first Fact Lock behavior.

## 3. Current repository architecture

Current Fact Lock is ScriptVersion-first:

- `ScriptGeneration.outputJson` contains a validated `ScriptDraft` with ordered
  candidate `claims[]` of `{text, occurrence}`.
- `ScriptVersion` owns one mutable current draft per Project; every edit uses
  revision CAS. Saved versions are immutable history rows.
- Current Fact Lock locks the current draft, pins `scriptVersionId + revision`,
  snapshots Script content/Product Facts/policy and uses provider extraction.
- `fact_lock_run.script_version_id` and `source_script_revision` are NOT NULL;
  pending uniqueness is ScriptVersion/revision-based.
- `fact_lock_claim` stores evaluated claims/results, not canonical input claims.
- Product Fact dependencies attach to FactLockRun through `fact_dependency`.
- Voice calls `FactLockGate.assertPassed()` and does not depend directly on claims.
- Resolver derives whether FACT_LOCK applies; persisted workflow cursor is not
  authority.

```text
Current
ScriptGeneration
→ current ScriptVersion draft + revision
→ FactLockRun snapshot/provider/evaluation
→ FactLockGate
→ Voice
```

## 4. Canonical ClaimManifest domain

### 4.1 Artifact identity and lifecycle

ClaimManifest is append-only and immutable. It has no `updatedAt`, mutable status,
pending/completed/failed lifecycle or in-place supersession pointer. A source or
builder semantic change creates/reuses another Manifest. Historical Manifests stay
readable.

Current applicability is derived, not stored:

```text
manifest source identity/fingerprint == current applicable source identity/fingerprint
→ current

otherwise
→ historical/non-current, still valid as an immutable artifact
```

Synchronous deterministic build failures return a typed error and do not persist
an empty/failed Manifest. `isEmpty=true` is derived only from a successfully
validated zero-length claim inventory.

### 4.2 Source union

```ts
type ClaimManifestSource =
  | {
      sourceType: "SCRIPT_VERSION";
      scriptVersionId: string;
      scriptVersionRevision: number;
      claimsSourceRevision: number;
      sourceContentHash: string;
    }
  | {
      sourceType: "NO_SCRIPT";
      sourceSchemaVersion: string;
      sourceRevision: string;
      elements: NoScriptSourceElement[];
      sourceContentHash: string;
    };

type NoScriptSourceElement = {
  kind:
    | "OVERLAY"
    | "CAPTION"
    | "CTA"
    | "VOICE_TEXT"
    | "DECLARED_CLAIM"
    | "COMPOSITION_ELEMENT";
  key: string;
  revision: string;
  contentHash: string;
};
```

The `NO_SCRIPT` branch is a domain/schema representability contract only in US17.
Its versioned element descriptor can represent future overlay, caption, CTA,
voice text, declared claim and composition element identities/hashes without fake
ScriptVersion rows. No no-script adapter, route or production activation belongs
to US17.

`source_snapshot_json` stores this strict versioned union. For SCRIPT_VERSION,
dedicated nullable columns and a real FK preserve practical DB integrity. For
NO_SCRIPT, source elements are immutable snapshots because the repository does
not yet have one common content-artifact table; service authorization must verify
each real source before a future adapter may persist it.

### 4.3 Script-backed source

The current Scripted adapter accepts an explicit:

```text
projectId
scriptVersionId
expectedRevision
```

It must load the actor-authorized current `status=draft` ScriptVersion for the same
workspace/Project and compare exact revision. It never runs a moving “latest”
query after the source is selected.

- Generated, never-edited script: initialized draft revision 1 is the source.
- Edited script: current draft and its exact new revision are the source.
- Saved ScriptVersion history remains readable/immutable but is not silently
  selected as current Fact Lock input.
- Repair generation does not replace the existing draft automatically; a Manifest
  pins whichever current ScriptVersion revision the caller explicitly supplied.
- `claimsStatus` must be `current`. A stale structured claim inventory returns
  `CLAIM_MANIFEST_SOURCE_NOT_USABLE`; US17 does not invoke AI to refresh it.

The builder deterministically projects validated `editableSnapshot.claims` and
their existing `ClaimOccurrence`. It does not regenerate, paraphrase or classify
claims and makes zero provider calls.

## 5. Claim shape, identity and order

The MVP Manifest claim is deliberately minimal:

```ts
type ClaimManifestClaim = {
  claimKey: string;
  claimText: string;
  locator: ClaimManifestLocator;
  sourceTextHash: string;
};

type ClaimManifestLocator =
  | {
      sourceType: "SCRIPT_VERSION";
      occurrence: ClaimOccurrence;
    }
  | {
      sourceType: "NO_SCRIPT";
      elementKind: NoScriptSourceElement["kind"];
      elementKey: string;
    };
```

For the SCRIPT_VERSION adapter, locator reuses the existing strict occurrence
union:

```text
hook(hookKey)
voiceover(segmentKey)
scene(sceneOrder)
cta
caption
```

The source element must exist, selected-hook rules must hold, and normalized
source text must contain the claim text. Missing hook/segment/scene or invalid
locator fails the whole build. US17 does not invent a claim category taxonomy;
current repository semantics need locator + text only. Product association is
manifest-level for the one-Product MVP.

### DEC-017-C — Same-locator ordinal

`claimKey` is identity within one Manifest, not a cross-Manifest business ID. It
is deterministic and DB-ID-independent. `sameLocatorOrdinal` is a zero-based
counter scoped to the canonical locator. The builder validates the complete
snapshot and claim array first, canonicalizes each structured locator with the
existing canonical JSON serializer, then walks claims in their original validated
array order. The first claim for one locator gets ordinal `0`, the second gets
`1`, and so on. It never sorts by text or hash and never uses one global ordinal.

Two claims are in the same locator group only when their complete structured
canonical locator representations are byte-identical. SCRIPT_VERSION locators
keep the existing `ClaimOccurrence` fields (`hookKey`, `segmentKey`, `sceneOrder`,
or the strict CTA/caption shape); no competing string locator format is created.

The exact key projection is:

```text
claimKey = "claim_" + SHA-256(canonical JSON of
  {
    sourceType,
    locator,
    sameLocatorOrdinal,
    claimText: canonicalClaimSourceText(validated claim text)
  })
```

Duplicate keys are invalid. Array order is semantic and preserved from the
validated source. Future multi-element adapters must define deterministic source
element order, then claim order; database row order is never used.

## 6. Canonicalization, hashes and fingerprint

Use the existing canonical JSON convention: recursively sorted object keys and
preserved array order. SHA-256 output is lowercase 64-character hexadecimal.

### DEC-017-B — Canonical text and source text hash

`canonicalClaimSourceText(text)` performs exactly, in order:

1. Unicode NFKC normalization;
2. CRLF and CR conversion to LF;
3. leading/trailing whitespace trim on the whole string.

It preserves case, punctuation and every internal whitespace character. It does
not trim each line, collapse repeated spaces, apply locale-sensitive casing,
rewrite meaning or paraphrase text.

`claimText` stores the exact text returned by the validated ScriptVersion claim
schema; it is not replaced with the hashing representation. For one claim,
`sourceText` is the exact validated output-bearing text selected by its locator:

- selected `hookVariants[].text` for `hook(hookKey)`;
- `voiceoverSegments[].text` for `voiceover(segmentKey)`;
- `scenes[].onScreenText` for `scene(sceneOrder)`;
- `cta.text` for CTA;
- `caption` for caption.

A missing/null source text for a referenced claim is an invalid locator/source,
not an empty string. The exact derivative is:

```text
sourceTextHash = SHA-256(canonicalClaimSourceText(sourceText))
```

### DEC-017-A — SCRIPT_VERSION source content hash

For a validated current ScriptVersion snapshot, resolve the selected hook first
and construct this exact projection using existing ScriptDraft v2 field names:

```ts
type ClaimManifestSourceContentProjection = {
  selectedHookKey: string;
  hookVariants: Array<{ key: string; text: string }>; // exactly the selected hook
  voiceoverSegments: Array<{ key: string; text: string }>;
  scenes: Array<{ order: number; onScreenText: string | null }>;
  cta: { text: string };
  caption: string;
  claims: Array<{ text: string; occurrence: ClaimOccurrence }>;
};
```

`hookVariants` contains exactly one entry, the variant referenced by
`selectedHookKey`; unselected variants cannot be valid claim surfaces. Array order
for voiceover segments, scenes and claims is preserved from the validated
snapshot. Scene duration, visual direction and voiceover linkage are excluded
because the current scene claim locator resolves only `onScreenText`.

```text
sourceContentHash = SHA-256(canonical JSON of
  ClaimManifestSourceContentProjection)
```

The projection excludes ScriptVersion/ScriptGeneration/workspace/Project/Product
IDs, revision, timestamps, creator, `claimsStatus`, `claimsSourceRevision`, DB and
provider metadata. It also excludes language, hashtags, disclosure and every
other field that the current deterministic structured-claim builder neither
projects nor resolves as a claim source surface. Source identity/revision remains
separate provenance in the Manifest source descriptor.

### DEC-017-D — Builder version

The initial server-owned constant is exactly:

```text
builderVersion = claim-manifest-builder.v1
```

Clients cannot send or override it. The version MUST bump whenever the same
canonical source input could produce different ordered claims, claim keys,
locator representation, source text/content hashes, Manifest fingerprint or
empty/non-empty result. This includes changes to extraction/projection, ordering,
locator or text canonicalization, same-locator ordinal assignment, claim-key,
source-content-hash or fingerprint projections.

Logging, telemetry, error copy, query optimization, tests and internal refactors
that preserve byte-equivalent projections do not require a bump. Historical
Manifests retain the builder version used at creation and are never recomputed or
migrated solely because another builder version exists.

### Exact Manifest fingerprint projection

Locator containment validation may reuse current Fact Lock comparison semantics
(NFKC, locale-aware lowercase, whitespace collapse) without changing stored text.

The exact fingerprint projection is the following canonical JSON object. For
SCRIPT_VERSION, `source` is the first branch shown; NO_SCRIPT uses the second.
`domain` is also the Manifest schema-version domain separator, so schema version
participates once without a duplicate field.

```ts
{
  domain: "claim-manifest.v1",
  builderVersion,
  workspaceId,
  projectId,
  source:
    | {
        sourceType: "SCRIPT_VERSION",
        scriptVersionId,
        scriptVersionRevision,
        claimsSourceRevision,
        sourceContentHash,
      }
    | {
        sourceType: "NO_SCRIPT",
        sourceSchemaVersion,
        sourceRevision,
        elements,
        sourceContentHash,
      },
  productId: productId ?? null,
  claims: orderedClaims.map((claim) => ({
    claimKey: claim.claimKey,
    claimText: canonicalClaimSourceText(claim.claimText),
    locator: claim.locator,
    sourceTextHash: claim.sourceTextHash,
  })),
}
```

```text
fingerprint = SHA-256(canonical JSON of the projection above)
```

Exclude database ID, `createdAt`, creator ID, UI labels, localized presentation
copy, logs/metrics, random values, provider output and moving `latest` resolution.
Product Facts IDs/revisions/snapshots are excluded because they are evaluation
dependencies owned by FactLockRun in AFF-US-018.

The deterministic dependency chain is therefore:

```text
validated source projection → sourceContentHash
validated claim + canonical locator + zero-based locator ordinal
  → sourceTextHash + claimKey
ordered canonical claims + exact source descriptor + scope/Product
  + schema domain + builderVersion
  → Manifest fingerprint
```

Same semantic source and builder version always preserve claim order, claim keys,
source hashes and Manifest fingerprint. A semantic builder change requires a
builder-version bump. No deterministic identity input may depend on timestamps,
random UUIDs, database row order, provider output or a moving latest source.

## 7. Product boundary

`product_id` is nullable at the Manifest schema level. This preserves canonical
Product conditionality and future source representation; it does not activate a
productless flow.

- Current Affiliate SCRIPT_VERSION builder requires the Project's accessible
  Product and pins that Product ID.
- Future Organic Product claims require an accessible Product and a Product-scoped
  Manifest.
- Organic without Product/Product claims does not require a Manifest.
- AFF-US-017 creates no active no-product Manifest path. Non-Product factual
  knowledge remains outside Product Fact Lock until a separate manual-evidence
  contract exists.
- Product Facts are never copied into ClaimManifest. AFF-US-018 snapshots/registers
  Product Fact dependencies when evaluating a Manifest.

## 8. Proposed additive database contract

Choose one immutable `claim_manifest` row with versioned JSONB source/claim
payloads. Normalized child claim rows are rejected for US17: claims have no
independent lifecycle/query requirement, are bounded, fingerprinted as one unit
and consumed together. Fact Lock evaluation results continue to use their own
normalized tables.

| Column | Contract |
|---|---|
| `id` | TEXT PK, application-generated opaque ID |
| `workspace_id` | NOT NULL FK workspace, ON DELETE CASCADE |
| `project_id` | NOT NULL FK Project, ON DELETE RESTRICT |
| `source_type` | NOT NULL check `SCRIPT_VERSION | NO_SCRIPT` |
| `source_script_version_id` | Nullable FK ScriptVersion, ON DELETE RESTRICT |
| `source_script_revision` | Nullable positive integer |
| `source_snapshot_json` | NOT NULL strict versioned source union |
| `source_content_hash` | NOT NULL SHA-256 hex |
| `product_id` | Nullable FK Product, ON DELETE RESTRICT |
| `schema_version` | NOT NULL, initial `claim-manifest.v1` |
| `builder_version` | NOT NULL deterministic builder contract version |
| `claims_json` | NOT NULL ordered strict claims array, max 64 |
| `claim_count` | NOT NULL integer 0..64, equals JSON array length |
| `is_empty` | NOT NULL, derived equivalence `claim_count = 0` |
| `fingerprint` | NOT NULL SHA-256 hex |
| `created_by_user_id` | NOT NULL FK user, ON DELETE RESTRICT |
| `created_at` | NOT NULL UTC timestamp |

Checks enforce the SCRIPT_VERSION source pair is complete only for that source
type and null for NO_SCRIPT. There is no `updated_at`, lifecycle status,
normalization status or verdict field.

Constraints/indexes:

- unique `(workspace_id, project_id, fingerprint)` for exact semantic reuse;
- index `(workspace_id, project_id, created_at, id)` for Project history;
- index `(workspace_id, source_script_version_id, source_script_revision)`;
- index `product_id` for FK/maintenance;
- no globally unique fingerprint and no automatic generic Project-list join.

Creation runs in one short transaction: authorize/lock or CAS-check Project,
load exact source revision, validate/build/hash, insert with conflict-ignore, then
read the same scoped fingerprint. Same semantic input returns the exact existing
Manifest. A unique conflict with non-equivalent payload is
`CLAIM_MANIFEST_CONFLICT`. Hash is not an authorization boundary.

## 9. Authorization, errors and observability

Every create/read must scope actor → workspace → Project. Script source and
Product must belong to that Project/workspace. Cross-workspace and cross-Project
injection return a non-enumerating not-found/scope error. A future NO_SCRIPT
adapter must authorize every referenced source element before persistence.

Canonical service errors:

```text
CLAIM_MANIFEST_PROJECT_NOT_FOUND
CLAIM_MANIFEST_SOURCE_NOT_FOUND
CLAIM_MANIFEST_SOURCE_NOT_USABLE
CLAIM_MANIFEST_SOURCE_SCOPE_MISMATCH
CLAIM_MANIFEST_SOURCE_REVISION_CONFLICT
INVALID_CLAIM_MANIFEST
CLAIM_MANIFEST_PRODUCT_REQUIRED
CLAIM_MANIFEST_CONFLICT
```

Use the repository's typed domain-error envelope; do not expose raw SQL or record
existence across workspace boundaries. Safe telemetry may record created/reused,
source type, claim count and latency. Never log raw claim text, source payload,
Product business data or credentials.

## 10. Dependency and staleness semantics

ClaimManifest depends on its pinned content source, represented by source identity,
revision and hashes. It does not register `fact_dependency` rows because Product
Facts are not Manifest inputs.

Old Manifests are not mutated to `STALE`. A read service may derive
`isCurrentForSource=false` after source revision/content/product association
changes. In AFF-US-018, a FactLockRun depends on immutable Manifest fingerprint
plus Product Fact revisions; a different current Manifest fingerprint means an
old run cannot be reused as current. The run remains historical.

Voice continues to depend on Fact Lock gate truth, never directly on Manifest.
Resolver continues to decide whether FACT_LOCK is applicable. ContentFormat may
help a source adapter understand locator structure, but owns no applicability.

## 11. Service/API/UI scope

US17 exposes internal application services, not a public user capability:

```text
buildClaimManifestFromScriptVersion(actor, explicit source revision)
createOrReuseClaimManifest(actor, built manifest)
getClaimManifest(actor, manifestId)
listClaimManifestsForProject(actor, bounded cursor) [internal/audit only]
```

There is no “latest” method used as Fact Lock authority; AFF-US-018 must pass an
explicit Manifest ID/fingerprint. No public router, tab, page, empty-state UI,
Dashboard/List/Adaptive join or provider is required in US17.

Minimal internal DTO includes ID, scope, source descriptor, Product ID, schema/
builder versions, ordered claims, count/empty, fingerprint and createdAt. Public
presentation DTO is deferred until a real UI consumer exists.

## 12. Compatibility and rollout

- US17 database change is expand-only: add one table and indexes/checks/FKs.
- Do not alter `fact_lock_run`, ScriptGeneration, ScriptVersion, Project or Voice.
- No existing Script or FactLockRun backfill. Manifest is created on explicit
  demand for an exact current source revision.
- Existing Fact Lock and golden Affiliate flow remain ScriptVersion-first until
  AFF-US-018 atomically adds dual-mode linkage/reader and cuts over new writes.
- Deploying the dormant table/service before US18 has no user-visible behavior,
  provider call, production data rewrite or future-mode activation.
- Rollback is application rollback plus leaving the unused additive table in
  place; dropping it requires a separate reviewed migration.

```text
After US17
ScriptVersion revision
→ ClaimManifest (dormant internal foundation)

ScriptVersion
→ existing FactLockRun execution unchanged
→ Voice unchanged

After US18
ScriptVersion revision / authorized no-script source
→ ClaimManifest
→ Manifest-first FactLockRun + Product Fact dependencies
→ existing Fact Lock gate contract
→ Voice
```

## 13. AFF-US-017 / AFF-US-018 split

| Area | AFF-US-017 | AFF-US-018 |
|---|---|---|
| Manifest domain/schema/fingerprint | Owns | Consumes |
| ScriptVersion deterministic builder | Owns | Invokes/reuses |
| NO_SCRIPT representability | Owns domain/schema fixture only | Adds real adapter only with activated source story |
| Manifest persistence/read/auth/idempotency | Owns | Consumes |
| FactLockRun columns/constraints | No change | Owns additive dual-mode migration |
| Fact Lock input/provider/prompt | No change | Manifest-first cutover |
| Legacy FactLockRun reader | No change | Adds explicit dual-mode reader |
| Product Fact dependencies | Excluded | Pins to FactLockRun |
| Voice/Resolver/Adaptive | No change | Preserve existing authority/gates |

US18 handoff gate requires a persisted Manifest ID/fingerprint, explicit source
descriptor, ordered validated claims, deterministic ScriptVersion builder,
authorized read service and race-safe exact reuse. US18 must make new FactLockRun
Manifest linkage required while leaving legacy Script-linked rows readable; it
must not fake or heuristically backfill historical Manifests.

## 14. Repository audit matrix

| Area | Current files/functions | Current authority | US17 target | US18 target | Migration impact | Compatibility risk |
|---|---|---|---|---|---|---|
| ScriptDraft claims | core script-generation types/schema | Ordered `{text, occurrence}` candidate claims | Deterministic source projection | Consume Manifest claims | None in US17 domain phase | Invalid locator/currentness must fail closed |
| ScriptGeneration | generation service/repository | Immutable provider artifact; `full/repair` | No behavior change | No direct Fact Lock authority | None | Do not confuse generation with selected content |
| ScriptVersion | types/schema/service/repository | Current mutable draft + revision CAS; saved history immutable | Explicit draft ID/revision source adapter | Optional provenance only on new runs | No table change | Moving-latest or stale claim inventory |
| Fact Lock service | `fact-lock-service.ts` | Builds Script/Product Fact snapshot; provider extracts/evaluates | Unchanged | Consume explicit Manifest | None in US17 | Partial cutover would break golden flow |
| FactLockRun schema | DB fact-lock schema | Script ID/revision NOT NULL | Unchanged | Add nullable Manifest fields then enforce new-write mode | AFF-US-018 only | Historical rows must remain readable |
| Fact Lock fingerprint | request/input/prompt SHA-256 | Script revision + Product Facts/policy | Separate Manifest fingerprint | Include Manifest fingerprint in run intent | AFF-US-018 only | Do not replace evidence dependencies with Manifest |
| Dependency graph | fact dependency schema/repository | Product Facts → run/artifact | No Product Fact edge | FactLockRun → Manifest + Product Facts semantics | Usually no US17 change | Attaching facts to Manifest mixes boundaries |
| Project/Product | Project schema/service | One nullable Product; Affiliate policy requires it | Manifest Product nullable; Scripted Affiliate pins it | Enforce applicable policy | New table FKs only | DB nullable ≠ policy optional |
| Applicability Resolver | core resolver | FACT_LOCK applicability truth | Unchanged | Unchanged policy, new read input only | None | Manifest existence must not determine policy |
| ContentFormat | registry/resolver | Identity/path compatibility only | Locator adapter aid only | No applicability ownership | None | Avoid format-driven Fact Lock policy |
| Voice | preview/segment services, FactLockGate | Reasserts Fact Lock PASS | Unchanged | Continues through gate | None | Direct Voice→Manifest dependency forbidden |

## 15. Implementation phases

| Phase | Goal | Areas | Migration | Required tests | Production effect / rollback risk |
|---|---|---|---|---|---|
| 17A | Pure domain contract | `packages/core` ClaimManifest types/schema/builder/fingerprint/errors | None | Shape, locator, ordering, normalization, fingerprint, no-script/productless fixtures | None; pure code |
| 17B | Additive persistence | DB schema/export and next generated migration | New table only; no FactLockRun change | Clean migration, constraints/FKs/indexes, immutability | Dormant additive table; low rollback risk |
| 17C | Race-safe repository | API repository create/reuse/read/history | None | concurrency/idempotency, payload conflict, authorization | Writes only when internal service invoked |
| 17D | ScriptVersion adapter/service | Explicit revision build orchestration | None | current/stale revision, claimsStatus, cross-scope, repair/edit/save cases | No current flow wiring |
| 17E | Regression and handoff | package/test wiring + canonical evidence | None | full contract matrix and golden regressions | US18 unblocked; no cutover |

Do not combine 17B with FactLockRun migration. Do not expose a public router or
wire current Fact Lock before 17E acceptance.

## 16. Stable acceptance criteria

- `AC-017-01` — ClaimManifest is an immutable claim-input artifact and contains no verdict/workflow state.
- `AC-017-02` — additive table matches the locked PK/FK/check/index/immutability contract.
- `AC-017-03` — strict ordered claim payload contains deterministic unique keys, text, locator and source text hash.
- `AC-017-04` — fingerprint uses canonical JSON/SHA-256 and excludes incidental IDs/timestamps/UI copy.
- `AC-017-05` — same scoped semantic input concurrently reuses exactly one Manifest; different intent never aliases.
- `AC-017-06` — Script builder pins explicit current draft ID/revision and never queries moving latest as authority.
- `AC-017-07` — generated, edited, repaired-source and saved-history scenarios preserve the explicit source decision.
- `AC-017-08` — stale/invalid Script claims or missing locator fail closed with typed errors and no persisted empty Manifest.
- `AC-017-09` — builder is deterministic/offline and makes zero AI/TTS/provider calls.
- `AC-017-10` — NO_SCRIPT source and null Script refs are representable in pure domain/schema fixtures without activation.
- `AC-017-11` — Product is manifest-level nullable; current Affiliate Script builder requires/pins accessible Product.
- `AC-017-12` — Product Facts snapshots/dependencies are absent from Manifest and remain AFF-US-018 FactLockRun inputs.
- `AC-017-13` — workspace/Project/source/Product authorization prevents cross-scope injection without existence leaks.
- `AC-017-14` — historical/non-current Manifest remains immutable/readable; currentness is derived from source identity.
- `AC-017-15` — no existing Script or FactLockRun backfill/rewrite occurs.
- `AC-017-16` — current Fact Lock service/schema/provider/gate and legacy Script-linked runs are unchanged.
- `AC-017-17` — Voice depends only on Fact Lock gate; Resolver and ContentFormat authority remain unchanged.
- `AC-017-18` — no public UI/router or automatic Dashboard/List/Adaptive join is added.
- `AC-017-19` — internal DTO/service exposes explicit Manifest ID/fingerprint/source/claims needed by AFF-US-018.
- `AC-017-20` — clean migration, concurrency, authorization, negative and no-script/productless fixtures PASS.
- `AC-017-21` — Fact Lock, M4 shadow, Adaptive A–J, nine golden suites, Web tests, types, Biome and diff check PASS.
- `AC-017-22` — Organic/Quick Image/Media First/no-script Fact Lock/AFF-US-018 remain inactive and no production backfill/provider call occurs.

Deterministic identity clarification criteria:

- `AC-017-C01` — SCRIPT_VERSION `sourceContentHash` uses only the exact validated
  selected-hook/voiceover/scene-text/CTA/caption/claims projection in section 6.
- `AC-017-C02` — `canonicalClaimSourceText` applies NFKC, CRLF/CR-to-LF and
  whole-string trim in that order while preserving internal whitespace and case.
- `AC-017-C03` — `sourceTextHash`, `sourceContentHash`, `claimKey` digest and
  Manifest fingerprint use SHA-256 lowercase 64-character hexadecimal output.
- `AC-017-C04` — same-locator grouping uses byte-identical canonical JSON of the
  complete structured locator; no alternate string locator identity exists.
- `AC-017-C05` — ordinal is zero-based, locator-scoped and assigned from original
  validated claim-array order before claim-key/fingerprint creation.
- `AC-017-C06` — initial server-owned builder version is exactly
  `claim-manifest-builder.v1` and cannot be overridden by a client.
- `AC-017-C07` — every deterministic semantic change listed in DEC-017-D requires
  a builder-version bump.
- `AC-017-C08` — byte-equivalent refactors, logging, telemetry, error copy, query
  optimization and test-only changes do not require a bump.
- `AC-017-C09` — historical Manifests retain their creation builder version and
  are not recomputed solely because a later builder exists.
- `AC-017-C10` — timestamps, random IDs, DB row order, provider output and moving
  latest-source lookup never participate in deterministic identity.

## 17. Required implementation test contract

Tests must cover pure builder/fingerprint/order; duplicate key and invalid locator;
missing/current/stale source revision; workspace/Project/Product mismatch;
deterministic exact reuse under concurrency; clean additive migration; immutable
row behavior; deprecated ContentFormat read compatibility; SCRIPT_VERSION and
NO_SCRIPT schema fixtures; Organic no-Product/no-claim requiring no Manifest;
Product claim without Product rejection; existing Fact Lock/ScriptVersion/
ScriptGeneration/Voice regressions; M4 shadow; Adaptive A–J; all nine golden
suites; full Web; type-check; Biome on touched source and `git diff --check`.

No test may call a live/paid provider. No production connection, data backfill or
FactLockRun migration belongs to AFF-US-017.

## 18. Final contract status

```text
AFF-US-017
CLAIMMANIFEST FOUNDATION
PHASE 17A–17E PASS
DONE

AFF-US-018
MANIFEST-FIRST FACT LOCK — PHASE 18A–18F PASS / DONE

AFF-US-019
NOT STARTED
```

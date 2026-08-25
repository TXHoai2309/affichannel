# Domain Evolution M5 — Enforcement & Authority Cutover Contract

- Trạng thái: Canonical ở cấp tài liệu; runtime/schema chưa implement
- Ngày: 2026-08-25
- Quyết định: DEC-030
- Dependency: M1 → M2/M3 → M4 → AFF-US-015 → M5 → AFF-US-017

## 1. Mục tiêu và ranh giới

M5 đóng phase Domain Evolution bằng cách biến Channel-First identity hoàn chỉnh
thành invariant bắt buộc của mọi persisted Project. M5 không mở thêm user flow.
Production writable identity vẫn chỉ là:

```text
AFFILIATE + SCRIPTED + SCRIPTED_STANDARD v1 + accessible Product
```

M5 không activate Organic, Quick Image hoặc Media First; không implement
ClaimManifest/Manifest-first Fact Lock, Render, Voice R2, OPTIONAL persistence;
không đồng bộ hay xóa legacy persisted workflow và không remove M4 shadow.

## 2. Repository authority audit

| Area | Current file/function | Current behavior | M5 desired behavior | Decision | Migration/rollback risk |
|---|---|---|---|---|---|
| Project DB schema | `packages/db/src/schema/project.ts`; migration `0017_lame_zemo.sql` | Four identity columns nullable; type/path and whole-pair/positive-version checks; Product nullable | Four identity columns NOT NULL; preserve checks, nullable Product/FK/index and no DB default | Change | Constraint fails if preflight misses any null; old null-writing binary is unsafe |
| Project create | `project-service.ts#createProject`; `project-repository.ts#createProjectBundle` | Legacy request omission and explicit baseline request both persist canonical identity | Keep request compatibility and canonical persistence; no null identity write | Keep/harden evidence | Rejecting legacy shape would break clients without improving persisted invariant |
| Project update | `project-service.ts#updateProject`; `updateProjectBundle` | Classifies request and persisted identity; set/preserve strategy with identity CAS | Preserve exact existing canonical identity when identity is omitted, including known deprecated refs; reject newly assigned deprecated refs; never auto-upgrade | Keep | Removing expected-state CAS permits concurrent identity overwrite |
| Project read projection | `project-repository.ts#projectIdentityReadModel` | Deterministic all-null + Product projects to baseline with `isLegacyProjection=true` | Retain defensively through rollback/stability window; unreachable on M5 DB | Keep until M6 | Early removal weakens rollback/recovery reads |
| Project list/details | `listProjectItems`, `findProjectDetails` | Affiliate-oriented Product inner join; identity read model shared | No activation/generalization in M5 | Keep | Changing joins would accidentally open productless behavior |
| Persisted classifier | `legacy-affiliate-compatibility.ts#classifyLegacyProject` | Exact precedence for candidate/canonical/exceptions | Keep for preflight, defensive reads and recovery evidence | Keep | Deletion loses deterministic diagnosis |
| ContentFormat resolver | `content-format/registry.ts`; `resolver.ts` | Server registry; `(key,version)` identity; `resolved | deprecated | unsupported` read union; assignment/path validation | Active known refs may be assigned; known deprecated refs remain readable but cannot be newly assigned; unknown/invalid refs are unsupported | Keep | DB cannot encode registry lifecycle or path compatibility without an unwanted registry table |
| M3 write policy | `project-write-contract.ts#classifyProjectWriteIdentity` | Baseline canonical writable; future identities return `CHANNEL_FIRST_IDENTITY_NOT_ACTIVE` | Retain same writable set; legacy request maps to baseline canonical identity | Keep; rename phase-local symbols only if implementation requires | Broadening policy activates future flows unintentionally |
| M2 tooling | `backfill-legacy-affiliate-projects.ts`; `legacy-affiliate-inventory.ts` | Fail-closed authority, keyset scan, deterministic CAS, reports/checkpoints | Retain as maintenance/recovery and preflight evidence; no heuristic M5 repair | Keep | Removing accepted tooling weakens recovery; rerunning apply without blockers should update zero |
| Adaptive Workflow | `project-workflow-read-service.ts`; core adaptive mapper; Web mapper | Resolver-derived presentation/navigation authority, read-only | Preserve exactly | Keep | Reverting to persisted cursor regresses AFF-US-015 |
| `currentStepKey` / `project_step_status` | Project schema/service; Voice reconciliation | Legacy persistence and explicit write projection | No schema, sync, cleanup or authority change in M5 | Out of M5 | Automatic sync would create a second applicability authority |
| M4 shadow | `applicability-shadow-service.ts` | Diagnostic observer; zero authority/mutation | Retain full shadow; sampling/removal requires separate decision | Keep | Removal erases post-cutover confidence evidence |

## 3. M5 scope classification

| Candidate | Classification | Locked meaning |
|---|---|---|
| A. Channel-First identity DB enforcement | IN M5 | Four identity columns become NOT NULL after zero-blocker preflight |
| B. Disable legacy all-null Project persistence | IN M5 | Persisted null identity prohibited; legacy request shape may remain |
| C. Remove legacy read projection | LATER — M6 | Retain defensive adapter for rollback/recovery |
| D. Enforce canonical identity on update | IN M5 | Preserve/set only canonical identity with expected-state CAS |
| E. Change M3 write policy | IN M5, policy lock only | Keep legacy request canonicalization; do not activate new identity |
| F. Activate more ContentType/CreationPath combinations | LATER STORIES | Organic/Quick Image/Media First remain controlled reject |
| G. Workflow authority cutover finalization | OUT OF M5 | Presentation/navigation completed by AFF-US-015; M5 only preserves it |
| H. Synchronize persisted current step | OUT OF M5 | Separate explicit decision/command if ever required |

## 4. Database enforcement contract

M5 migration must make these columns individually NOT NULL:

```text
project.content_type
project.creation_path
project.content_format_key
project.content_format_version
```

Keep `project_content_type_check`, `project_creation_path_check` and
`project_content_format_pair_check`. The pair check continues to require positive
version; NOT NULL makes the all-null branch unreachable. Do not add a DB default,
enum or registry table. Registry existence, availability and path compatibility
remain server/domain invariants.

`product_id` remains nullable. Preserve its FK, `ON DELETE RESTRICT` and
`project_product_id_idx`. Current Affiliate writes still require an accessible
Product in the application service. This permits future canonical Organic rows
with `product_id = NULL` without making those writes active in M5.

## 5. Persisted, request and read matrices

### Persisted state after M5

| State | Allowed? | Enforcement |
|---|---|---|
| All four identity fields null | NO | DB NOT NULL + preflight |
| Partial identity | NO | DB NOT NULL/pair check + domain validation |
| Affiliate/Scripted/Standard v1 + Product | YES | Current canonical baseline |
| Affiliate identity + missing Product | NO at domain/write level | DB remains structurally nullable; defensive policy required |
| Organic canonical identity + no Product | Schema-compatible, production write NO | Later activation story |
| Known active ContentFormat assignment | YES when current write policy and CreationPath allow | Registry/domain validation |
| Known deprecated ContentFormat already pinned | YES as persisted/readable state; NO as a new assignment | Report separately; no auto-upgrade |
| Unknown/unsupported ContentFormat assignment | NO for write | Registry/domain reject; defensive unsupported read remains |
| Format/path mismatch | NO for write | Domain reject; preflight blocker |

### Request behavior after M5

| Request | Result |
|---|---|
| Legacy shape with no identity fields on create | Accepted and canonicalized to current Affiliate baseline |
| Identity omitted on update of a canonical Project | Accepted; preserve exact persisted identity under CAS |
| Explicit Affiliate baseline identity | Accepted explicitly |
| Explicit known deprecated ContentFormat | Controlled reject `DEPRECATED_CONTENT_FORMAT`; not a future-identity error |
| Explicit unknown/unsupported ContentFormat | Controlled typed reject |
| Organic canonical identity | Controlled reject `CHANNEL_FIRST_IDENTITY_NOT_ACTIVE` |
| Quick Image or Media First | Controlled reject `CHANNEL_FIRST_IDENTITY_NOT_ACTIVE` |
| Partial identity/ref | Controlled typed reject |
| Invalid version or format/path mismatch | Controlled typed reject |

Legacy request compatibility is not permission to persist legacy null state.

### Read behavior

| Persisted row | Result |
|---|---|
| Canonical complete with known active format | Exact identity, `resolution=resolved`, `isLegacyProjection=false` |
| Canonical complete with known deprecated format | Readable with exact pinned ref, `resolution=deprecated`; no auto-upgrade |
| All-null + Product encountered on pre-M5/rollback snapshot | Defensive baseline projection, `isLegacyProjection=true` |
| All-null without Product | Fail closed as `LEGACY_PROJECT_WITHOUT_PRODUCT` |
| Partial ContentFormat ref | `resolution=unsupported`, `PARTIAL_CONTENT_FORMAT_REF` |
| Invalid ContentFormat version | `resolution=unsupported`, `INVALID_CONTENT_FORMAT_VERSION` |
| Unknown complete ContentFormat ref | Preserve raw ref, `resolution=unsupported`; no fallback latest |

## 6. Invalid-state policy

After M5, DB constraints make null/partial identity, invalid ContentType,
invalid CreationPath and non-positive/null format version impossible through the
schema. Domain validation must still defend all of them, plus unknown/unsupported
format, format/path mismatch and Affiliate missing Product. Assignment validation
must reject a known deprecated ref, but persisted-read classification must not call
that Project invalid merely because its pinned ref is deprecated. Direct constraint
errors must not leak to UI.

The ContentFormat resolution union remains exactly:

```text
resolved | deprecated | unsupported
```

Never introduce `unresolved`. Registry/domain code—not DB constraints—owns active,
deprecated and unsupported lifecycle resolution.

API keeps `INVALID_PROJECT_WRITE_IDENTITY` as the public typed envelope. Existing
reasons remain stable, including `CHANNEL_FIRST_IDENTITY_NOT_ACTIVE` and
`PROJECT_IDENTITY_CHANGED_DURING_UPDATE`. M5 does not rename the accepted M2
`CONTENT_FORMAT_CREATION_PATH_MISMATCH` classifier reason or M3 assignment reason
`CONTENT_FORMAT_PATH_MISMATCH`. `DEPRECATED_CONTENT_FORMAT` remains the specific
new-assignment rejection and must not be replaced by
`CHANNEL_FIRST_IDENTITY_NOT_ACTIVE`.

### Preserved update and CAS rule

An unrelated update that omits identity preserves the exact persisted canonical
identity under the existing expected-state CAS, including a known deprecated
ContentFormat. Read/archive and other identity-preserving operations remain
allowed. Any request that explicitly assigns or changes to a deprecated ref is a
new assignment and is rejected. M5 never rewrites the ref to a newer version and
never silently upgrades a Project. CAS remains required for both preserve and set
strategies.

## 7. Production preflight and rollout

Accepted owner-provided reconciliation evidence is historical only:

```text
15 legacy Projects canonicalized
remaining legacy candidates = 0
blocking exceptions = 0
```

Do not touch production during contract/audit. Immediately before migration, a
fresh read-only, fail-closed preflight must report total Projects and exact counts.
Blocking categories are all-null identity, partial identity, invalid ContentType,
invalid CreationPath, invalid ContentFormat version, unknown/unsupported
ContentFormat, format/path mismatch, Affiliate missing Product and unclassified
state. Known deprecated-but-readable refs are reported separately and are not an
automatic blocker unless a separately approved migration decision says otherwise.
M5 performs no heuristic repair or format upgrade.

Safe rollout order:

1. validate clean M1→M5 migration and rollback rehearsal on disposable/snapshot DB;
2. deploy/verify an application binary that canonicalizes legacy request shapes,
   rejects invalid/future/new-deprecated assignments, permits exact deprecated
   identity preservation on unrelated updates and preserves CAS;
3. run production zero-blocker preflight under controlled write conditions;
4. apply one explicit reviewed migration adding four NOT NULL constraints;
5. run postflight counts, canonical reads/writes, legacy-request canonicalization,
   invalid/future rejection, CAS and golden regression;
6. retain M4 shadow and monitor sanitized errors/mismatches.

Application startup must never alter schema. The current M3B binary is conceptually
compatible with an M5 DB because it already persists canonical identity for both
legacy and explicit baseline requests; this must be proven in implementation tests.
The future M5 binary remains compatible with pre-M5 DB because it still writes
canonical identity and retains defensive readers.

Rollback may return only to a proven M3B-or-newer binary. Keep legacy request
canonicalization and read projection during the rollback window. Do not roll back
by writing null identity, changing Organic to Affiliate, attaching fake Product or
silently dropping constraints. Dropping NOT NULL requires a separately reviewed
rollback migration only when operationally necessary.

## 8. Authority and lifecycle locks

- Applicability Resolver remains applicability truth.
- Adaptive Workflow remains presentation/navigation truth.
- Backend authorization, Script preflight, Fact Lock mutation/gate, Voice Fact
  Lock reassertion, provider guards, CAS, transaction and idempotency remain
  execution authority. `Resolver says READY` is never a global mutation permit.
- `currentStepKey` and `project_step_status` remain legacy persisted compatibility;
  M5 does not synchronize, remove or extend them.
- M4 shadow remains fully active. Sampling/removal requires a separate ADR after
  post-cutover evidence.
- M2 scanner/classifier/CAS/report tooling remains maintenance/recovery tooling.
- Successful implementation acceptance closes AFF-US-013 and AFF-US-016, but does
  not require physical deletion of every compatibility helper.
- AFF-US-017 cannot start until M5 migration/postflight/golden acceptance is DONE.

## 9. Stable acceptance criteria

- `AC-M5-01` — production preflight reports zero legacy all-null identities.
- `AC-M5-02` — production preflight reports zero partial identities.
- `AC-M5-03` — all four persisted identity columns are NOT NULL without DB default.
- `AC-M5-04` — Product remains DB-nullable; current Affiliate Product invariant is server-enforced.
- `AC-M5-05` — whole-pair and positive ContentFormat version invariants remain; no enum/registry table.
- `AC-M5-06` — no application or direct-schema path can create persisted legacy null identity.
- `AC-M5-07` — legacy request omission policy is explicit and canonicalizes before persistence.
- `AC-M5-08` — defensive legacy read projection is retained through the M5 rollback window.
- `AC-M5-09` — partial/invalid/unsupported/conflicting identity fails closed with typed errors; known deprecated persisted refs remain readable while new assignment is rejected.
- `AC-M5-10` — Organic, Quick Image and Media First remain inactive production writes.
- `AC-M5-11` — Resolver/Adaptive authority remains independent of persisted current step.
- `AC-M5-12` — authorization and domain execution guards, CAS and idempotency remain authoritative.
- `AC-M5-13` — M4 shadow remains active; zero exception/unmapped/mismatch regression passes.
- `AC-M5-14` — fresh production preflight covers every required count, reports deprecated refs separately and stops on any actual blocker.
- `AC-M5-15` — rollout follows application-compatible → preflight → explicit migration → postflight; no startup migration.
- `AC-M5-16` — rollback to a proven M3B-or-newer binary works without null writes/data rewriting.
- `AC-M5-17` — postflight reports zero null/partial/invalid/unsupported blockers, reports deprecated refs separately and proves canonical write/read behavior.
- `AC-M5-18` — successful M5 gate is the completion boundary for AFF-US-013.
- `AC-M5-19` — successful M5 gate is the completion boundary for AFF-US-016 while approved adapters may remain.
- `AC-M5-20` — no ClaimManifest/FactLock manifest schema or runtime starts before M5 is accepted.

## 10. Required implementation gates

Later implementation must cover: clean DB migration; M1→M5 sequence; production-
shaped zero-blocker preflight; legacy and explicit canonical writes; partial/
invalid/future/deprecated-assignment rejection; synthetic known-deprecated readable
and identity-preserving update fixtures; legacy-request canonical persistence;
CAS concurrency;
M3B regression; M2 scan with zero candidates/exceptions; Adaptive A–J and M4
shadow; AFF-US-015 presentation; Productless Organic schema fixture proving
`product_id=NULL` remains representable; postflight and rollback rehearsal. Use
only explicit disposable/test DB authority until separately approved production
preflight/apply. No live paid provider is required.

M5A implementation evidence (2026-08-25): migration `0018_natural_speed`, bounded
read-only preflight, dirty STOP/atomic failure, postflight introspection,
productless schema fixture and pre/post-M5 binary regressions PASS on the isolated
loopback PostgreSQL database `affichannel_m5a_validation`. Production/Neon
preflight is NOT RUN and the migration is NOT APPLIED outside disposable testing.
Repository migrations are forward-only; constraint rollback requires a separately
reviewed forward migration. A pre-M3B null-writing binary is not a permitted
rollback target.

## 11. Story completion boundary

M5A makes enforcement technically ready for production preflight; it does not
accept full M5 or authorize production migration.
Only after `AC-M5-01–20` pass may docs mark:

```text
Domain Evolution M5 DONE
AFF-US-013 DONE
AFF-US-016 DONE
AFF-US-017 READY TO START
```

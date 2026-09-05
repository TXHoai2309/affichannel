# AFF-US-020 — Shared Media Library

- Status: **20C PROTECTED MEDIA APIs = PASS; UI remains deferred**
- Updated: 2026-09-05 (Asia/Saigon)
- Branch: `TXH`
- Starting HEAD: `a8c366a828496393038441a6e5d556d0ad6923bb`
- Scope: architecture contract, persistence/storage foundation, and protected API layer
- Explicitly not implemented: public media APIs, upload UI, picker, project import/cutover, Quick Image, Media First, Video Studio/render, live R2

## Phase 20C acceptance — PASS

Phase 20C adds the protected server API layer on top of the accepted 20B
foundation. `appRouter.media` now exposes workspace-scoped `list`, `get`,
`prepareUpload`, `finalizeUpload`, `updateMetadata`, `archive`, `getDownload`,
`linkToProject`, and `unlinkFromProject` procedures. Every procedure derives its
`WorkspaceActor` from the authenticated session; callers cannot submit a
workspace, storage provider/key, upload session, status, checksum, or detected
metadata as authority.

- Prepare accepts intent only, validates type/MIME/size/name/tags/rights, creates
  a server key/session, and returns a short-lived private grant. Prepare
  idempotency is workspace-scoped, replay-safe, and race-safe.
- Local grants are encrypted, authenticated, stateless tokens with purpose,
  workspace, asset, session, key, content type, and expiry binding. The local
  upload route consumes bounded bytes once and never makes an asset READY.
  Download grants stream only READY/ARCHIVED assets after a fresh DB ownership
  check. R2 remains private and uses the injected presigned adapter; no live R2
  call is made by tests.
- Finalize claims `pending_upload → validating` with CAS, confirms HEAD and
  exact bytes, runs authoritative bounded JPEG/PNG/WebP/MP4/MP3 validation and
  SHA-256, then commits READY or a typed FAILED result with best-effort cleanup.
  Replays and concurrent finalizers are deterministic; expired sessions cannot
  refresh or resurrect an asset.
- Library reads use escaped display-name/tag search, media/status/archive
  filters, and opaque `(updatedAt,id)` cursors. Metadata updates are strict;
  archive is idempotent and retains bytes/links. There is no public hard-delete,
  purge, arbitrary URL import, or public object URL.
- Project links are same-workspace and READY-only. Affiliate links require
  `owned` or `licensed` rights; Organic links have no additional rights gate.

Implementation verification for this slice: full workspace type-check, Next
production build, Biome check, and the complete web Vitest suite (58 files / 544
tests) pass. The mandatory disposable PostgreSQL acceptance matrix is guarded by
`AFFICHANNEL_MEDIA_TEST_DATABASE_URL` plus its explicit disposable confirmation
and is implemented in `scripts/test-media-protected-api.ts`. On 2026-09-05 it
passed 27/27 cases against a fresh PostgreSQL 16 container bound only to
`127.0.0.1:55432`, with migrations through `0022`, a temporary local media root,
and an injected/mocked R2 seam. No remote, development, or production database
was touched; live R2/provider/AI/TTS/external URL calls were zero; and the
disposable container was removed after verification. Phase 20D remains not
started and UI activation is still deferred.

No UI, picker, render, AI, Voice, Product, or URL-import flow is activated by
20C.

This document is the canonical contract for AFF-US-020. It records the repository
evidence and the decisions for the persistence/storage and protected API slices.
It does not authorize public endpoints or UI activation; Phase 20C adds only the
authenticated API and private grant routes described above.

## Phase 20B acceptance — persistence and storage foundation

Phase 20B is accepted on branch `TXH` from starting HEAD
`6f27fd838f5c2795047664998d558cbbab3b2373`.

- Migration `0022_furry_sharon_carter.sql` is additive and creates only
  `media_asset` and `media_asset_link`; legacy `media_metadata`, Product, Project,
  ScriptGeneration, VoiceSegment, and VoiceAudioStorage schemas are untouched.
- `MediaAsset` is workspace-owned with explicit `MediaAssetLink` Project N:N reuse;
  repository reads and writes require `WorkspaceActor`, validate same-workspace
  links transactionally, and permit one READY asset to link to Organic and
  Affiliate projects.
- Lifecycle CAS operations enforce `pending_upload → validating → ready|failed`
  and `ready|failed → archived`. Binary metadata is immutable after READY;
  display name, tags, rights, and archive state are the only mutable metadata.
- `MediaAssetStorage` is private and server-owned. Local storage is deterministic
  under the configured root; R2 is an injected S3-compatible adapter with private
  presigned-grant support. No live R2 call or public URL was made.
- Server validation enforces safe object keys, exact-byte lowercase SHA-256,
  allow-listed MIME/magic (JPEG/PNG/WebP, MP4, MP3), decoded image dimensions,
  MP3 duration via `music-metadata`, and bounded per-type size limits. SVG/WAV
  and arbitrary URL imports remain rejected/deferred; MP4 dimensions/duration are
  intentionally nullable until a future bounded probe dependency is approved.
- Focused domain/storage tests and the migration/repository acceptance script pass
  against a newly created loopback disposable PostgreSQL database only. The
  acceptance script verifies 20A→20B additivity and no binary database column.

Phase 20C implements the protected prepare/upload/finalize/download/library APIs
and their authorization/expiry boundaries; no public media endpoint is active.

## 1. Decision summary

AFF-US-020 will add a new workspace-owned `MediaAsset` aggregate. A media asset is
the identity of one immutable set of stored bytes plus server-authoritative
metadata. A project relationship is represented separately by
`MediaAssetLink`; an asset has no permanent `projectId` and no `creationPath`.

The existing `media_metadata` table remains historical/project-scoped input for
ScriptGeneration. It is not renamed, backfilled, or silently repurposed in 20A.
The existing `VoiceSegmentArtifact` and `VoiceAudioStorage` remain a separate
voice domain. Existing Organic and Affiliate flows remain unchanged.

The v1 upload flow is prepare → signed/opaque upload grant → finalize. The server
creates the asset and object key, validates the stored object, and only then makes
the asset `ready`. Binary data is never stored in PostgreSQL. R2 remains private
in production; local filesystem storage is deterministic in development/test.

## 2. Repository audit

### 2.1 `media_metadata` current state

Evidence: `packages/db/src/schema/media-metadata.ts`, migration
`packages/db/src/migrations/0010_stormy_groot.sql`, and the current ScriptGeneration
service/tests.

| Finding | Evidence and consequence |
|---|---|
| Workspace and project scoped | `workspace_id NOT NULL` and `project_id NOT NULL`; project FK is `ON DELETE CASCADE`. |
| Metadata-only | No provider, object key, MIME, byte size, checksum, decoded dimensions, or authoritative duration. |
| Legacy vocabulary | `media_type` is lower-case `image/video/audio`; status is `ready/needs_review/archived`; rights are `owned/licensed/unknown/restricted`. |
| Project-specific fields | Required free-form `aspect_ratio` and `scene_suitability`; `reference_url` is a URL-shaped reference, not an import contract. |
| Current consumer | `script-generation-service.ts` selects rows by `(workspaceId, projectId)`, orders by `id`, validates the snapshot, and includes only `ready` rows with `owned` or `licensed` rights. |
| UI/API state | `/media` is a `FeaturePlaceholder`; `routes.ts` marks it `skeleton`; there is no media router or storage endpoint. |
| Index history | Table and indexes were created in migration 0010 and have not been evolved into a stored-asset model. The `(workspace_id, project_id, id)` unique index is redundant with the primary key for identity. |

**Assessment: B/C.** `media_metadata` is legacy/project-specific semantic
metadata and a ScriptGeneration input/association shape. It is not a complete
private reusable asset and is not suitable as the v1 Shared Media Library
identity. Keeping it read-compatible avoids changing historical snapshots and
fixtures. A future explicit bridge may project a `MediaAsset` into the existing
snapshot shape, but 20A does not implement that bridge.

### 2.2 Voice storage current state

Evidence: `packages/db/src/schema/voice-segment-artifact.ts`, migration 0016,
`packages/api/src/storage/voice-audio-storage.ts`,
`voice-audio-storage-factory.ts`, the protected audio route, and VoiceSegment
tests.

`VoiceSegmentArtifact` is project-scoped and immutable per generation attempt. It
uses statuses `pending/completed/failed/indeterminate`; storage metadata is
nullable until a completed artifact satisfies a database shape check. The
`VoiceAudioStorage` interface currently offers `put`, `get`, `open`, and `delete`,
accepts only non-empty `audio/mpeg`, verifies SHA-256, guards local path traversal,
uses an atomic local temp-file rename, and routes R2 through an injected
S3-compatible client. `music-metadata` is already installed for server-side MP3
duration parsing.

This is strong evidence for a lower-level private-object adapter, but not for
making images/video pretend to be VoiceSegments. Voice semantics (provider
artifact, segment fingerprint, MP3-only validation, and uncertainty) stay in the
voice domain. AFF-US-020 introduces a media-specific interface and may share a
small private-object primitive later if that extraction preserves both contracts.

### 2.3 Existing list/search and ownership patterns

Product Library (`product-repository.ts`, `product-service.ts`, and the Product
UI) uses server-side `WorkspaceActor` authorization, opaque cursor pagination with
`(updatedAt,id)` descending order, escaped `ILIKE` search, and explicit archive
scope. This is the closest current pattern for Media Library browsing. Project
listing is currently non-paginated; it is not a model for a potentially large
binary library.

The database factory uses Neon for application requests and a guarded Node
Postgres path for disposable tests. No 20A action touches either database.

## 3. Domain identity and ownership

### 3.1 Canonical identity

`MediaAsset.id` identifies one immutable stored byte sequence and its validated
metadata. Replacing a file creates a new asset; bytes, checksum, byte size,
detected MIME, dimensions, and duration are never mutated under an existing ID.
`displayName`, tags, rights metadata, and archive state are mutable fields.

The graph is:

```text
Workspace 1 ─── N MediaAsset
Project   N ─── N MediaAsset   (MediaAssetLink)
```

Neither `creationPath` nor Content Type is part of asset identity. Organic,
Affiliate, Quick Image, Scripted, and Media First can all reference the same
asset.

### 3.1.1 Link-model options

| Option | Assessment |
|---|---|
| Optional `projectId` on the asset | Rejected: preserves the current one-project bias, makes reuse awkward, and turns unlink/relink into identity mutation. |
| Separate `MediaAssetLink` relation | **Selected:** clear N:N reuse, project-scoped usage context, reference protection, and compatibility with future US021/22/23 consumers. |
| Reuse an existing Product/Voice relation | Rejected: Product links and VoiceSegment artifacts have different ownership, lifecycle, and authorization semantics. |

The separate relation is required by the user story even though the first UI may
ship Library CRUD before the picker. Link APIs and the schema contract are locked
now so later slices do not invent a second association model.

### 3.2 Workspace authorization

Every list, get, metadata update, upload preparation/finalization, download,
archive, link, unlink, and future purge operation resolves a server-side
`WorkspaceActor`. The asset and project must both be loaded in that actor's
workspace. A client-supplied `workspaceId` is not an authority and is not needed
in public input. The workspace check remains mandatory even when a project ID is
also supplied.

The proposed link table carries `workspaceId` for tenant indexes and composite
foreign-key enforcement. Supporting unique keys on `(workspace_id,id)` for
`media_asset` and `project` make the workspace/project and workspace/asset pairs
database-checkable; service authorization is still required.

## 4. Vocabulary, origin, and rights

### 4.1 Media type

The persisted and API vocabulary is exactly the lower-case string union:

```ts
type MediaType = "image" | "video" | "audio";
```

The same values are used in PostgreSQL checks, API validation, snapshots, and UI
filters. Labels may be displayed as IMAGE/VIDEO/AUDIO, but no silent upper/lower
case mapping is introduced. No AI-specific media type exists.

### 4.2 Origin

`origin` is a small audit field, not a provider workflow. The schema reserves
`user_upload`, `ai_generated`, `voice_generated`, and `imported` for future
compatibility, but AFF-US-020 v1 accepts and creates only `user_upload`. US028
owns AI Visual and no AI provider call is part of this foundation. Existing Voice
artifacts are not automatically converted to `voice_generated` assets.

### 4.3 Rights and tags

`usageRights` remains `owned | licensed | unknown | restricted`. US020 stores and
displays this metadata; it does not claim to provide a legal-rights review
workflow. `unknown` and `restricted` are visible but are not eligible for
Affiliate commercial use or paid TTS/render gates unless a later explicit policy
allows it. This preserves the existing ScriptGeneration usability rule.

`tags` is the canonical reusable label list, normalized for trimming and
case-insensitive duplicate checks, with the existing practical bound of at most
50 entries and 80 characters per entry. `sceneSuitability` remains a legacy
`media_metadata` field; it is not an asset-level truth because suitability is
contextual. A future scene/resource relation owns scene-specific semantics.

`referenceUrl` remains historical metadata only. Shared Media upload v1 does not
fetch arbitrary URLs or import remote content.

## 5. Proposed schema target (NOT IMPLEMENTED)

The following was the design target for the 20B migration and is now implemented
by the additive Drizzle schema/migration described in the Phase 20B acceptance
section above.

### 5.1 `media_asset`

| Column | Nullability / default | Contract |
|---|---|---|
| `id` | `text NOT NULL PK` | Server-generated opaque ID; not client authority. |
| `workspace_id` | `text NOT NULL FK workspace(id) ON DELETE CASCADE` | Owning workspace. |
| `created_by_user_id` | `text NOT NULL FK user(id) ON DELETE RESTRICT` | Audit only; not the ownership boundary. |
| `origin` | `text NOT NULL DEFAULT 'user_upload'` | Reserved values listed in §4.2; v1 API permits only `user_upload`. |
| `media_type` | `text NOT NULL` | `image`, `video`, or `audio`. |
| `status` | `text NOT NULL DEFAULT 'pending_upload'` | Lifecycle in §6. |
| `storage_provider` | `text NOT NULL` | `local` or `r2`; selected server-side at prepare. |
| `storage_key` | `text NOT NULL` | Server-generated key; never the original filename or client path. |
| `upload_session_id` | `text NOT NULL` | Opaque session, unique per workspace; finalization authority. |
| `prepare_idempotency_key` | `text NOT NULL` | Unique per workspace and request identity. |
| `upload_expires_at` | `timestamptz NOT NULL` | Pending-upload cleanup/expiry boundary. |
| `original_filename` | `text NOT NULL` | Sanitized/truncated display metadata; never used in a path. |
| `display_name` | `text NOT NULL` | Mutable user-facing name, initialized server-side. |
| `declared_mime_type` | `text NULL` | Untrusted client declaration retained only for diagnostics. |
| `mime_type` | `text NULL` until validated | Server-authoritative detected/allow-listed MIME. |
| `byte_size` | `bigint NULL` until validated | Object HEAD/stream byte count, positive when present. |
| `checksum_sha256` | `text NULL` until validated | Lower-case SHA-256 of exact stored bytes. |
| `width` / `height` | `integer NULL` | Required for validated images; optional for video when probing is deferred. |
| `duration_ms` | `bigint NULL` | Required for validated audio; video may remain null under the v1 boundary. |
| `usage_rights` | `text NOT NULL DEFAULT 'unknown'` | Rights vocabulary in §4.3. |
| `tags` | `text[] NOT NULL DEFAULT []` | Normalized reusable tags. |
| `failure_code` | `text NULL` | Typed, non-secret validation/storage failure; set for `failed`. |
| `finalized_at` | `timestamptz NULL` | Set once on successful finalization. |
| `archived_at` | `timestamptz NULL` | Set for `archived`; archive is reversible only through a later explicit restore contract. |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Audit timestamps. |

Checks must enforce trimmed non-empty names, the media type/status/provider/origin
vocabularies, positive byte size/dimensions/duration when present, and a
lower-case 64-hex checksum. A READY row must have a provider, key, allow-listed
detected MIME, positive byte size, checksum, and the metadata required for its
type (image dimensions; audio duration). A video may be READY after validated
MP4/container bytes with dimensions/duration null only when the deferred-probe
flag is represented by a typed implementation result; callers requiring those
fields must fail closed. `archived_at` and `status='archived'` must agree.

Indexes/constraints:

- unique `(workspace_id, prepare_idempotency_key)`;
- unique `(workspace_id, upload_session_id)`;
- unique `(workspace_id, id)` support key;
- list index `(workspace_id, status, updated_at DESC, id DESC)`;
- filter index `(workspace_id, media_type, status, updated_at DESC, id DESC)`;
- optional GIN index on `tags` if measured search needs it (no analytics index);
- FK to workspace and creator as above.

### 5.2 `media_asset_link`

| Column | Nullability / default | Contract |
|---|---|---|
| `id` | `text NOT NULL PK` | Server-generated link ID. |
| `workspace_id` | `text NOT NULL` | Composite FK tenant key. |
| `project_id` | `text NOT NULL` | Composite FK to the same workspace's project. |
| `media_asset_id` | `text NOT NULL` | Composite FK to the same workspace's asset. |
| `usage_type` | `text NOT NULL DEFAULT 'project_resource'` | Controlled v1 context; no scene composition semantics. |
| `created_by_user_id` | `text NOT NULL FK user(id) ON DELETE RESTRICT` | Audit. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Link audit timestamp. |

Use composite FKs `(workspace_id, project_id)` and `(workspace_id,
media_asset_id)` with `ON DELETE RESTRICT` for the asset side and a safe project
policy (project archive does not unlink; project hard-delete may cascade its
links). Add unique `(workspace_id, project_id, media_asset_id, usage_type)` and
indexes `(workspace_id, project_id, created_at DESC, id DESC)` and
`(workspace_id, media_asset_id, created_at DESC, id DESC)`. Unlink removes the
active link; v1 is not an audit-ledger implementation. Immutable Script/Fact Lock
snapshots remain the historical record of what a prior workflow saw.

The migration must add supporting unique `(workspace_id,id)` keys to `project`
and the new `media_asset` table before creating these composite FKs. No such
migration is created in 20A.

### 5.3 Migration strategy comparison

| Strategy | History safety | Reuse/query clarity | Complexity and downstream effect |
|---|---|---|---|
| 1. Evolve `media_metadata` (`projectId` nullable + storage/lifecycle fields) | Poor: changes a table already embedded in ScriptGeneration snapshots and fixtures. | Mixed: one overloaded table conflates semantic input and stored bytes. | High backfill/status/nullability risk; makes US021/22/23 queries and legacy compatibility harder. |
| 2. Add `media_asset` + `media_asset_link`, keep `media_metadata` | **Best:** additive migration and no historical rewrite. | **Clear:** asset identity and project usage are separate, explicit queries. | Moderate: two new tables and a future explicit bridge; lowest regression risk for US021/22/23. **Selected.** |
| 3. Rename/redefine `media_metadata` | Worst: destructive identity/history change and forced consumer migration. | Potentially clear only after a large rewrite. | Highest migration/rollback and fixture risk; not justified. |

No automatic backfill is planned. If legacy metadata must become a reusable asset,
that is a separately reviewed import/bridge with explicit bytes and rights proof.

## 6. Lifecycle and atomicity

New asset status values are lower-case and distinct from legacy
`media_metadata.status`:

1. `pending_upload` — DB row and server key/session exist; bytes are not trusted.
2. `validating` — finalize has claimed the session and is checking the object.
3. `ready` — object and required metadata were confirmed; eligible for normal
   library reuse subject to rights and type gates.
4. `failed` — validation, expiry, storage, or persistence outcome failed; typed
   failure is retained and the object is cleaned up best-effort.
5. `archived` — no new links/picker selection; metadata and bytes are retained
   for existing references and history.

`failed` is required. It prevents a missing object or uncertain finalize from
being represented as a misleading empty or READY row. There is no
`needs_review` alias in the new lifecycle. Rights `unknown` is a policy value,
not a processing state.

The DB row never becomes READY before object confirmation. A finalize transaction
must conditionally claim the pending session, validate outside long-held locks,
then conditionally write the terminal state. A stale pending session is
recoverable/cleanable; it is not silently retried into a second asset.

Failure semantics:

| Failure | Required behavior |
|---|---|
| Prepare succeeds, browser upload fails | Keep `pending_upload` until expiry; cleanup is retryable. Client retry uses a new session unless the same prepare idempotency key is safely replayed. |
| Upload succeeds, finalize fails validation | Mark `failed`, persist typed code, and best-effort delete the object. Never expose it as READY. |
| DB finalize fails after object confirmation | Return typed persistence-uncertain result; retain enough session/key state for reconciliation or best-effort cleanup. Do not create a second READY row. |
| Storage delete fails | Retain metadata/status and return `MEDIA_STORAGE_DELETE_FAILED`; never claim deletion succeeded. |

## 7. Storage architecture

### 7.1 Decision among reuse options

- **A — reuse `VoiceAudioStorage` directly:** rejected. Its `audio/mpeg` input,
  VoiceSegment errors, and provider semantics would make image/video behavior
  misleading and couple unrelated lifecycles.
- **B — extract a generalized private-object primitive:** viable later for
  shared path safety, object grants, HEAD, stream, and delete behavior, provided
  VoiceAudioStorage keeps its typed facade. This is a refactoring option, not a
  20A code change.
- **C — dedicated `MediaAssetStorage` over a lower-level adapter:** selected for
  the first implementation. It makes media validation, grant expiry, and
  server-owned keys explicit while allowing a future B extraction.

### 7.2 Conceptual interface (not implemented)

```ts
interface MediaAssetStorage {
  readonly provider: "local" | "r2";
  createUploadGrant(input: {
    storageKey: string;
    contentType: string;
    byteSize: number;
    expiresAt: Date;
  }): Promise<{ urlOrToken: string; expiresAt: Date }>;
  head(storageKey: string): Promise<{
    byteSize: number;
    contentType: string | null;
    etag?: string | null;
  } | null>;
  open(storageKey: string): Promise<ReadableStream<Uint8Array>>;
  createDownloadGrant(input: {
    storageKey: string;
    contentType: string;
    expiresAt: Date;
  }): Promise<{ urlOrToken: string; expiresAt: Date }>;
  delete(storageKey: string): Promise<void>;
  cleanup(storageKey: string): Promise<void>;
}
```

The interface is server-owned. R2 can implement grants as short-lived signed
PUT/GET URLs. Local development/test uses an opaque, expiring server token and
the local adapter; it must not turn the filesystem root into a public URL. A
server-side multipart `put` may be a test/fallback primitive, but it is not the
canonical browser flow for v1.

### 7.3 Keys and configuration

The key is generated only after the server creates the asset ID, conceptually:
`media/v1/{workspaceId}/{assetId}/{opaque-file-name}`. The extension, if any,
comes from the validated allowlist; the original filename is never a path
authority. Path traversal and backslashes are rejected at both service and local
adapter boundaries.

Production uses private Cloudflare R2. Credentials remain server-only and no
permanent public URL is stored. The media slice should use dedicated configuration
names (`MEDIA_STORAGE_PROVIDER`, `MEDIA_LOCAL_ROOT`, `MEDIA_R2_ENDPOINT`,
`MEDIA_R2_BUCKET`, `MEDIA_R2_ACCESS_KEY_ID`, `MEDIA_R2_SECRET_ACCESS_KEY`) rather
than silently reusing the Voice `VOICE_AUDIO_*` contract. The actual environment
variables are added only when 20B starts.

The local default is a deterministic root such as `.data/media-library`,
resolved by the app's configured adapter; E2E can override it to a separate
`.data/media-library-e2e`. The existing `apps/web/.data/` ignore rule covers
these roots. Voice audio remains under its own `.data/voice-audio*` root.

## 8. Upload, download, and public API contract

### 8.1 Canonical upload flow

| Flow | Assessment |
|---|---|
| A. Browser multipart → authenticated API → storage | Simple for small files, but buffers/streams large video through a short-lived Next.js request and makes retry/timeout behavior less predictable. Not the canonical v1 flow. |
| B. Prepare row + signed/opaque upload + finalize | **Selected:** fits private R2, keeps object bytes out of the app request, and makes validation/READY transition explicit. Local uses the same semantic grant with an opaque server token. |

Option B is selected: authenticated prepare → signed/opaque upload → authenticated
finalize. Direct upload avoids buffering large video in a short-lived Next.js
request while keeping authorization and validation on the server.

1. `media.prepareUpload` validates the requested type, declared MIME, filename,
   and configured byte limit; creates `pending_upload`, session, expiry, provider,
   and server key; returns the grant and asset/session IDs.
2. The browser uploads through the grant. It cannot choose a key, workspace, or
   provider and cannot mark the row ready.
3. `media.finalizeUpload` authenticates the actor, locks the session by workspace,
   checks expiry/idempotency, obtains object HEAD/stat, validates bytes and
   decoded metadata, computes/checks SHA-256, and conditionally sets READY or
   FAILED.
4. A failed/abandoned session is cleaned best-effort and retained as typed
   state until a later reconciliation/purge slice. Retry is explicit and never
   mutates bytes under a READY ID.

### 8.2 Smallest complete v1 API

The conceptual protected router is:

- `media.list` — cursor list/filter/search;
- `media.get` — metadata and link summary;
- `media.prepareUpload`;
- `media.finalizeUpload`;
- `media.updateMetadata` — display name, tags, rights only;
- `media.archive` — idempotent archive;
- `media.getDownload` — short-lived protected grant;
- `media.linkToProject` / `media.unlinkFromProject` — explicit reuse relation.

There is no public `media.upload` mutation in the signed-upload flow and no
public hard-delete mutation in the first release. A future purge operation must
be reference-protected and idempotent. Every router calls the workspace actor
resolver and maps typed domain errors without leaking storage/provider details.

### 8.3 Download/view

`media.getDownload` is the canonical read path. It authorizes the asset in the
actor workspace, requires a validated object, and returns a short-lived grant.
R2 uses a signed GET; local uses an expiring protected token/stream. There is no
permanent public R2 URL and no client access to credentials. Archived assets may
remain downloadable to authorized existing references, but are excluded from
new-link selection.

A protected streaming endpoint remains an adapter implementation detail for local
development or range requests. The public contract is the short-lived
server-authorized grant rather than a permanent URL, so callers do not need to
know whether the object lives on disk or in R2.

## 9. Validation and MIME policy

Validation is server-authoritative and layered: sanitized filename extension and
declared Content-Type are hints; stored object Content-Type and HEAD size are
cross-checks; magic bytes/container parsing and decoded metadata decide the
canonical MIME/metadata. Mismatches fail closed. Browser-supplied dimensions,
duration, and byte size are never final authority.

Initial allowlist is intentionally narrow:

| Type | MIME | v1 validation boundary |
|---|---|---|
| image | `image/jpeg`, `image/png`, `image/webp` | Magic/decoder check plus authoritative positive width and height. SVG is rejected. |
| video | `video/mp4` | Non-empty bytes, MP4/container (`ftyp`) check, size/MIME/checksum. No FFmpeg requirement; width/height/duration/codec are nullable until a bounded probe exists, and consumers requiring them fail closed. |
| audio | `audio/mpeg` | Magic/decoder check and `music-metadata` duration; positive duration is required for READY. WAV is deferred until a parser/storage test proves support. |

The current dependency audit found `music-metadata` but no image metadata parser,
`file-type`, or FFmpeg/ffprobe. 20B adds bounded JPEG/PNG/WebP
metadata validator; it must not invent dimensions. Full video codec probing is
deferred to a future worker/parser slice and is not a prerequisite for basic
private MP4 library storage. No render worker is pulled into upload validation.

Server-owned per-type limits are configuration, not product constants. Defaults
are introduced and tested in 20B from the existing env conventions; they must
bound request/object size and reject oversized uploads before grant and again at
finalize. The current repository defines `VOICE_SEGMENT_MAX_AUDIO_BYTES` (10 MiB
default) for VoiceSegment only and has no Media Library limit; that value is not
copied into the new media contract.

## 10. Checksum, metadata authority, and versioning

`checksum_sha256` is lower-case hexadecimal SHA-256 over the exact bytes stored in
the object. It provides integrity, audit, and a dedupe hint only. Same-checksum
uploads are allowed to create distinct assets; v1 neither silently reuses nor
rejects duplicates, and checksum is not the asset identity.

Authoritative immutable fields are stored bytes/object key, detected MIME,
byte size, checksum, decoded dimensions, and decoded duration. Mutable fields are
display name, tags, usage rights, and archive state. Declared MIME and original
filename are untrusted diagnostics/display metadata. `aspectRatio` is derived
from validated dimensions where meaningful; it is not an arbitrary user-entered
truth in the new model.

## 11. Linking, archive, and deletion

`MediaAssetLink` is the only v1 project reuse relation. Linking requires a READY
asset, a live project in the same workspace, and a controlled `usageType` of
`project_resource`. It does not encode Organic/Affiliate or scene composition.
One asset may link to any number of Projects; one Project may link to any number
of assets.

Archive is the safe user-facing removal operation. It is idempotent, prevents
new links/picker selection, preserves metadata/bytes and does not silently break
existing project references. Unlink removes the active link; ScriptGeneration
and Fact Lock snapshots remain immutable historical records.

Hard delete/purge is not a public v1 operation. If a later maintenance operation
is approved, it must require no active links, delete storage first, retain a
typed row on storage failure, and delete the DB row only after confirmed storage
deletion. It must be idempotent and must never silently break a project or
historical snapshot.

## 12. ScriptGeneration, Product, Voice, and US021 compatibility

- **ScriptGeneration:** current service continues to read `media_metadata` by
  project and snapshot the legacy fields. A future integration can query linked
  READY MediaAssets and explicitly map them into the snapshot contract; it must
  not change historical snapshot versions or bypass the existing rights rule.
- **Product media:** Product `thumbnailUrl`/source fields remain Product Library
  data. They are not automatically imported into Media Library. Explicit import
  or link is a future seam with its own URL/SSRF policy.
- **Voice audio:** existing generated `VoiceSegmentArtifact` rows and
  `VoiceAudioStorage` remain the Voice domain. No automatic migration or
  duplication occurs. A future explicit “Add to Media Library” can create a new
  asset/link after the Voice contract is satisfied.
- **AI media:** US028 owns provider invocation; this story stores no AI output by
  itself and makes zero provider calls.
- **US021 handoff:** a deterministic image-to-video job selects only a READY
  image, reads server-authoritative MIME/checksum/dimensions, and obtains exact
  private bytes through the storage interface. The render request pins asset ID,
  checksum, and storage object identity in its own immutable input snapshot. A
  later metadata update or replacement cannot change those bytes.

## 13. Security and observability constraints

The v1 threat boundary explicitly covers path traversal, MIME spoofing, oversized
uploads, malicious filenames, cross-workspace IDs, cross-project links, public
object URLs, unsafe SVG, and future SSRF from remote URL import. URL import is
not supported. Provider credentials and upload/download grants are server-only;
grant TTLs are short and non-permanent.

Typed domain errors are required for authorization, invalid type/size, expired or
replayed session, validation mismatch, storage failure, and persistence
uncertainty. US030 owns general operational monitoring, retries, and cost
tracking; 20A does not invent a job-monitoring system or paid-provider ledger.

## 14. 20D UI target (not implemented now)

`/media` may remain the current placeholder. The later 20D target is a practical
grid/list with upload CTA, image/video/audio filters, display-name/tag search,
asset detail, archive action, and a reuse picker. It must distinguish pending,
failed, ready, and archived states and must not expose storage keys or credentials.
No visual redesign or activation occurs in 20A.

## 15. Implementation phases after 20A

| Phase | Scope | Exit proof |
|---|---|---|
| 20B | `MediaAsset`/`MediaAssetLink` persistence, checks/indexes, core vocabulary, media storage adapter, local/R2 config, bounded validators. | Migration reviewed; adapter/validator contract tests; no public UI cutover. |
| 20C | Prepare/finalize/download/list/get/update/archive APIs, idempotency, typed failure/cleanup semantics, cursor/search. | Protected API integration matrix against disposable DB + local adapter; R2 client injected/mocked. |
| 20D | Activate `/media` library UI: grid/list, filters/search, upload state, details/archive. | Browser/manual UX and persistence checks; keys/credentials absent from client. |
| 20E | Project linking/reuse picker, Organic/Affiliate handoff, US021-ready image selection, E2E/manual acceptance. | Workspace isolation, two-project reuse, archive/reference protection, F5 and local/R2 adapter proof. |

Quick Image/Video Studio/render worker and US028 AI Visual remain outside 20A.

## 16. Future acceptance matrix

These are required tests for the implementation slices, not 20A runtime claims.

| Area | Required assertion |
|---|---|
| Upload | JPEG/PNG/WebP image, MP4 video, and MP3 audio can prepare/upload/finalize; no binary is inserted into DB. |
| Validation | Invalid MIME/magic bytes, extension mismatch, oversized object, invalid dimensions/duration, and SVG fail closed. |
| Integrity | SHA-256 is lower-case exact-byte checksum; duplicate checksum does not silently alias another asset. |
| Isolation | Cross-workspace get/download/link/archive and cross-workspace project linking are rejected, including guessed IDs. |
| Library | Cursor pagination, latest ordering, mediaType/status filters, escaped displayName/tag search, and archive visibility work. |
| Download | Only authorized workspace actors receive a short-lived grant; no permanent public URL or credential leaks. |
| Lifecycle | Pending expiry, failed validation, duplicate finalize retry, persistence-uncertain cleanup, archive, and typed storage-delete failure are recoverable. |
| References | Same READY asset links to two Projects; unlink/archive does not silently break existing references; future hard-delete is blocked by active links. |
| Reuse | Organic and Affiliate projects can reference the same asset without creationPath in asset identity. |
| Persistence | F5/reload returns server state; local storage root is deterministic and gitignored. |
| R2 | Adapter contract is proven with an injected/mocked private R2 client; no live R2 call is required for unit/integration tests. |
| US021 seam | READY image exposes authoritative MIME/checksum/dimensions and immutable object pinning to a future render request. |

## 17. Historical compatibility and 20A boundary

- `media_metadata` and its migration history remain untouched; no rename,
  nullable `projectId` change, backfill, or status conversion occurs.
- ScriptGeneration snapshots, Organic claimless behavior, Affiliate golden
  vectors, Product fixtures, and VoiceSegment storage continue unchanged.
- `/media` remains a placeholder and `routes.ts` remains a skeleton route.
- No new table, Drizzle schema, migration, upload/download endpoint, local object,
  R2 request, provider call, or runtime storage configuration is created in 20A.

The accepted architecture decision is recorded as **DEC-036** in
`docs/decisions.md`.

# AFF-US-028 — AI Visual Generation

- Trạng thái: IMPLEMENTATION COMPLETE / DETERMINISTIC ACCEPTANCE PASS / LIVE PAID EXECUTION NOT AUTHORIZED
- Cập nhật: 2026-09-22

## Phạm vi và authority

US28 triển khai image-to-video như một operation được quản trị bởi các primitive
US29/US30 hiện hữu. Server resolve provider, model, capability, pricing, hash,
reservation và release gate; browser chỉ gửi source MediaAsset identity cùng
semantic intent bounded. Không có raw provider call, arbitrary model/provider,
API key, URL/path import, queue/broker, worker hoặc parallel render pipeline.

Provider deterministic là test adapter duy nhất được thực thi. Paid provider
registry vẫn fail-closed ở release gate; không có provider trả phí nào được gọi.

## Lifecycle contract

1. `aiVisual.estimate` đọc READY image `MediaAsset` đã link đúng workspace/project,
   materialize source proof, canonical request hash `paid-request.image-to-video.v1`
   và trả estimate có expiry, pricing version và governance version.
2. `aiVisual.confirm` yêu cầu explicit `confirmed=true`; server re-read source,
   re-resolve governance/pricing và từ chối estimate stale trước khi gọi
   `prepareAiOperation` để reserve budget/idempotency/audit.
3. Deterministic adapter chỉ chạy trong test mode. Output bị giới hạn `video/mp4`,
   byte cap, exact requested duration và SHA-256 proof trước khi storage.
4. Output hợp lệ được lưu bằng `MediaAssetStorage`, tạo `MediaAsset` origin
   `ai_generated`, link `project_resource`, và ghi provenance trong
   `ai_visual_generation`/`ai_visual_artifact`. Finalize dùng reservation/lifecycle
   US29/US30, không tạo accounting hoặc media silo mới.
5. Timeout sau khả năng gửi, storage/DB uncertainty và orphan artifact giữ
   `INDETERMINATE`; reconcile/attach orphan là recovery duy nhất, không blind retry.

## Acceptance evidence

| Area | Result |
|---|---|
| Schema/migration | `0032_slippery_the_fallen.sql` + `0033_great_terrax.sql`, additive, 2 tables |
| Server identity | provider/model/capability/pricing resolved from registry/settings |
| Estimate/confirmation | stale governance/source/request rejected; confirmation explicit |
| Canonical identity | source proof + prompt/motion/duration/aspect/output MIME hashed |
| Output | MP4 magic/MIME, configured byte cap, duration contract, SHA-256 |
| Shared media | generated clip is READY `MediaAsset` + project resource link |
| Idempotency | same hash replays one operation/output; semantic changes require new hash |
| Recovery | orphan artifact finalizes one MediaAsset exactly once |
| Security | protected router; workspace/project/source ownership; no secrets in DTOs |
| Regression | US29/US30 disposable PostgreSQL regression PASS |
| Real paid provider | `REAL_PAID_PROVIDER_CALLS=0` |
| FFmpeg/MP4 encoding | `REAL_FFMPEG_EXECUTIONS=0`; deterministic fixture only |
| Cloud test database | trusted loopback disposable PostgreSQL; `NEON_USED=NO` |

## Required status fields

```text
AI_VISUAL_LIFECYCLE=IMMUTABLE
IMAGE_TO_VIDEO_ADAPTER=SERVER_SIDE
PROVIDER_RESOLUTION=SERVER_OWNED
MODEL_RESOLUTION=SERVER_OWNED
ESTIMATE_BEFORE_GENERATE=PASS
EXPLICIT_CONFIRMATION=PASS
BUDGET_RESERVATION=PASS
PAID_RELEASE_GATE=PASS
CANONICAL_REQUEST_HASH=PASS
DUPLICATE_GENERATION_PROTECTION=PASS
FAILED=PASS
INDETERMINATE=PASS
NO_BLIND_RETRY=PASS
OUTPUT_MIME_VALIDATION=PASS
OUTPUT_BYTE_LIMIT=PASS
OUTPUT_DURATION_VALIDATION=PASS
OUTPUT_INTEGRITY=PASS
GENERATED_MEDIAASSET=PASS
SHARED_COMPOSITION_PIPELINE=PASS
PARALLEL_RENDER_PIPELINE=NO
ORPHAN_RECOVERY=PASS
DB_FAILURE_RECOVERY=PASS
STORAGE_FAILURE_RECOVERY=PASS
RECONCILIATION_IDEMPOTENT=PASS
AI_VISUAL_API=PROTECTED
AI_VISUAL_UI=PASS
DETERMINISTIC_PROVIDER_TESTS=PASS
REAL_PAID_PROVIDER_CALLS=0
REAL_FFMPEG_EXECUTIONS=0
MIGRATION=ADDITIVE
TRUSTED_DB=PASS
LIVE_PAID_PROOF_REQUIRED_FOR_STORY_CLOSE=NO
AFF-US-028=IMPLEMENTATION_COMPLETE_AWAITING_LIVE_PAID_APPROVAL
```

Paid production release remains a separate owner decision under DEC-041. The
deterministic acceptance proves the governed lifecycle without authorizing any
real paid execution.

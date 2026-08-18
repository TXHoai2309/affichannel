# AFF-US-010 Phase 3 — Fact Lock Gate và downstream runtime

Ngày: 2026-08-18  
Phạm vi: Gate server-side và trạng thái khóa cho Voice, Video và Preview/Render.

## Kết quả

- Thêm pure evaluator `evaluateFactLockGate()` trong `@affichannel/core` với mười
  reason code đã chốt ở Phase 0.
- Thêm `FactLockGate.evaluate(actor, projectId)` và
  `FactLockGate.assertPassed(actor, projectId)` ở application service. Service tự
  resolve project, current draft, Fact Lock runs, dependency state, Product Fact
  revision/status và workspace ownership; client không được cung cấp các giá trị
  quyết định gate.
- Thêm protected `factLock.getGate` để các client/route khác đọc cùng một quyết định.
- Gate chỉ mở khi current ScriptVersion strict-valid, claims current, có run
  `passed` đúng script revision, dependency active/current và Product Facts còn
  `verified` đúng revision.
- Giữ stale script precedence trước stale facts. Retry `failed` hoặc
  `indeterminate` không che mất một PASS cũ còn applicable.
- Route trực tiếp `/voice`, `/video` và `/preview` render locked state từ server;
  không có TTS/render mutation thực tế ở Phase 3 nên không tạo dependency giả.
  `assertPassed()` là enforcement point bắt buộc cho mutation downstream khi các
  mutation đó được triển khai.
- Không thêm migration/schema, không gọi provider AI trả phí và không lưu unlock
  boolean cạnh `project_step_status`.

## Reason mapping

| Reason | Điều kiện chính |
| --- | --- |
| `NO_SCRIPT_VERSION` | Project không có current draft |
| `SCRIPT_NOT_READY` | Draft không qua structural/strict readiness |
| `FACT_LOCK_NOT_RUN` | Chưa có run cho current draft |
| `FACT_LOCK_PENDING` | Run hiện tại còn pending |
| `FACT_LOCK_REVIEW_REQUIRED` | Kết quả hiện tại còn claim unresolved |
| `FACT_LOCK_STALE_SCRIPT` | Script/revision hoặc claims đã thay đổi |
| `FACT_LOCK_STALE_FACTS` | Dependency bị invalidated/detached hoặc Fact revision/status đổi |
| `FACT_LOCK_FAILED` | Retry hiện tại failed và chưa có PASS applicable |
| `FACT_LOCK_INDETERMINATE` | Provider outcome không xác định và chưa có PASS applicable |
| `FACT_LOCK_PASSED` | Mọi điều kiện downstream đều đạt |

## Verification

- Core gate unit test bao phủ no-script, no-run, strict readiness, pending,
  review-required, failed, indeterminate, stale script, stale facts, passed và
  old PASS sau retry failed/indeterminate.
- Fact Lock integration fixture chứng minh `evaluate/assertPassed`, workspace
  isolation, passed retry semantics và Product Fact revision → `STALE_FACTS`.
- Authenticated Playwright proof truy cập trực tiếp Voice/Video/Preview, refresh,
  mở khóa với PASS và khóa lại sau script edit. Browser plugin không khả dụng trong
  môi trường này nên dùng Playwright CLI theo fallback của testing skill.

## Không nằm trong Phase 3

- TTS provider, audio artifact, render job, video worker, Fact Lock migration,
  Fact Lock redesign, Fact Lock dependency cho voice/render chưa có artifact,
  live paid AI smoke và các User Story sau.

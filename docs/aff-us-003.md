# AFF-US-003 — Dashboard Overview

- Trạng thái: Đã triển khai và polish; còn QA authenticated bằng fixed E2E account.
- Cập nhật: 2026-08-11
- Mục tiêu: biến Dashboard debug thành read-only operational Dashboard từ Project data thật.

## Quyết định triển khai

- Dashboard dùng một protected oRPC procedure `dashboard.getOverview()`; client không gửi
  `workspaceId`.
- Query lấy workspace từ session, qua `requireWorkspaceActor()`, rồi chỉ đọc dữ liệu trong
  workspace hiện tại.
- Không tạo bảng `dashboard_summary`, `recent_projects`, `dashboard_activity` hoặc
  `dashboard_warning`.
- Recent projects giới hạn 5 bản ghi, sắp xếp `project.updatedAt DESC`; step status được tải
  trong một query `IN` để tránh N+1.
- Progress được tính trong core từ số step có status `completed`; project ở step `completed`
  luôn hiển thị 100%.
- Video hoàn thành, job đang xử lý, cost tháng và warnings hiện trả về dữ liệu trung thực
  `0`/`[]` cho tới khi các slice tương ứng có persistence.

## Thay đổi kỹ thuật

- Thêm `packages/core/src/dashboard/dashboard-types.ts` và `dashboard-service.ts` cho contract,
  progress, status và activity mapping.
- Thêm `packages/api/src/services/dashboard-repository.ts` cho aggregate query từ Neon.
- Thêm protected route `dashboard.getOverview` và dùng chung workspace authorization.
- Thay Dashboard debug bằng summary cards, recent projects, activity, warnings và cost state.
- Có loading skeleton, empty state, generic error/retry và route-level error boundary.
- Recent project link dùng `targetUrl` derive từ `getProjectStepRoute(projectId, currentStepKey)`.
- Warning dùng `targetUrl` để mở màn hình xử lý và hiển thị khác nhau theo `severity`.
- Action tạo project dùng `CardAction`; copy Dashboard hướng người dùng hơn và relative time
  dùng chung cho project/activity.
- Loading skeleton phản ánh đúng thứ tự summary → recent projects → activity/warnings; lỗi
  Dashboard inline không bật thêm global toast.
- Query error toàn app không còn hiển thị raw server error message ra toast.

## Kiểm tra

- `pnpm check-types`: đạt.
- `pnpm --filter web test`: 16/16 đạt.
- `pnpm test:integration:dashboard`: đạt workspace isolation, ordering, current step và limit 5.
- `pnpm test:integration:project-auth`: giữ nguyên kiểm tra authorization Project.
- `pnpm --filter web build`: đạt.
- Biome scoped cho Dashboard/API/test: đạt.
- Playwright: 3 pass, 5 skipped vì chưa có `E2E_AUTH_EMAIL` và `E2E_AUTH_PASSWORD`.
- Playwright/system Chrome smoke `/dashboard`: redirect đúng về `/login`, nội dung có ý nghĩa,
  không có console error; chưa thể chụp Dashboard authenticated khi thiếu fixed account.

## Blocker QA

- Cần cấu hình fixed E2E credentials để xác nhận authenticated Dashboard, click project tới
  current step và hoàn tất gate không skip.
- `DATABASE_URL` và `DATABASE_URL_DIRECT` phải là cặp pooled/direct của cùng Neon project/branch.

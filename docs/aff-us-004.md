# AFF-US-004 — Tạo Project và Content Brief

- Trạng thái: Đã triển khai, cần QA browser với fixed-account credentials.
- Cập nhật: 2026-08-11
- Branch: `feat/us004-project-content-brief`

## Quyết định đã chốt

- MVP dùng một internal workspace chung. Bảng `workspace_member` là lớp authorization;
  `createdByUserId` chỉ dùng để audit.
- Tên project không unique. Người dùng có thể tạo các project trùng tên.
- `project.currentStepKey` là workflow source of truth. `project_step_status` chỉ lưu
  `not_started`, `completed`, `needs_review` hoặc `blocked`; không persist `current`.
- Mỗi project có đúng một Content Brief và bảy dòng step status.
- AFF-US-005 chưa được triển khai đầy đủ. US004 chỉ thêm Product prerequisite tối thiểu
  trong form để chọn hoặc tạo product, không mở rộng thành Product management UI.

## Thay đổi kỹ thuật

- Schema/migration: `workspace`, `workspace_member`, `product`, `project`, `content_brief`,
  `project_step_status`; xem `packages/db/src/migrations/0001_orange_nocturne.sql` và
  `0002_polite_invaders.sql`.
- Create Project ghi project, brief và bảy status trong một database transaction.
- oRPC bảo vệ list/get/create/update/archive project và list/create product bằng workspace
  membership ở server.
- `/projects/new` có validation client/server, loading/error state, tạo product nhanh và
  redirect tới `/projects/{id}/product`.
- `/projects/{id}` là Project Overview, hiển thị project, Product liên kết, platform,
  current workflow step và Content Brief đã lưu. Từ từng step, “Tổng quan project” điều
  hướng về route này; refresh và browser Back giữ đúng lịch sử điều hướng.

## Kiểm tra đã thực hiện

- `pnpm db:generate`, review SQL và `pnpm db:migrate` trên database của app: đạt.
- `pnpm auth:bootstrap` đảm bảo membership workspace của fixed account: đạt.
- Database smoke test tạo/đọc project, Content Brief và bảy status, rồi xóa chính record test:
  đạt.
- `pnpm check-types`: đạt.
- Unit test bổ sung missing required fields và duplicate project name; integration script kiểm tra
  read/list/update/archive chéo workspace: đạt trên database runtime hiện tại.

## Lưu ý môi trường

Runtime dùng `DATABASE_URL` pooled. Drizzle migration đã được cấu hình ưu tiên
`DATABASE_URL_DIRECT`; hai biến local hiện vẫn trỏ tới hai Neon project khác nhau nên chưa
được coi là cấu hình an toàn. Trước khi migrate/deploy, thay cả hai bằng cặp pooled/direct
của cùng một Neon project/branch rồi chạy `pnpm db:migrate` trên target đó.

`getWorkspaceActor()` chỉ resolve membership ở `INTERNAL_WORKSPACE_ID`; không chọn ngẫu nhiên
membership cũ nhất khi một user có nhiều membership. Đây là invariant ownership của MVP 0.

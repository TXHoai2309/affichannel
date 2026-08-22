# AffiChannel

AffiChannel Personal là workspace nội bộ channel-first để lập kế hoạch, sản xuất,
render và đánh giá video ngắn Organic/Affiliate. Product chỉ là dependency khi
policy yêu cầu; Product claim vẫn phải truy vết qua Product Facts và Fact Lock.
Project được khởi tạo bằng Better T Stack với Next.js, oRPC, Better Auth, Drizzle
và Neon PostgreSQL.

## Tài liệu project

Đọc [docs/README.md](./docs/README.md) trước khi triển khai feature. Phạm vi sản
phẩm, kiến trúc, hệ thống thiết kế, thứ tự triển khai, quyết định, nhật ký thay
đổi và tiến trình AI agent nằm trong `docs/`. Quy tắc chung của agent nằm tại
[`AGENTS.md`](./AGENTS.md).

## Công nghệ chính

- TypeScript
- Next.js App Router
- Tailwind CSS
- Shared UI package với shadcn-style primitives
- oRPC và TanStack Query
- Drizzle ORM
- Neon PostgreSQL
- Better Auth
- Turborepo
- Biome

## Bắt đầu

Cài dependencies nếu chưa có:

```powershell
pnpm install
```

## Thiết lập database

Project dùng PostgreSQL với Drizzle ORM. Biến kết nối nằm trong
`apps/web/.env` và không được commit.

Áp dụng schema hiện tại vào development database:

```powershell
pnpm run db:push
```

Không chạy lệnh này với production database khi chưa được chủ dự án cho phép.

## Chạy development

```powershell
pnpm run dev
```

Mở [http://localhost:3002](http://localhost:3002).

API reference trong development:

[http://localhost:3002/api/rpc/api-reference](http://localhost:3002/api/rpc/api-reference)

API reference phải được tắt hoặc bảo vệ trước production.

## Tùy chỉnh UI

- Design rule: `docs/design-system.md`.
- Global token và style: `packages/ui/src/styles/globals.css`.
- Shared primitive: `packages/ui/src/components/*`.
- App-specific component: đặt trong `apps/web` gần feature sử dụng.

Import shared component:

```tsx
import { Button } from "@affichannel/ui/components/button";
```

Thêm shared shadcn primitive từ project root:

```powershell
pnpm dlx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

## Cấu trúc project

```text
affichannel/
├─ apps/
│  └─ web/          Ứng dụng full-stack Next.js
├─ packages/
│  ├─ api/          oRPC procedures và context
│  ├─ auth/         Cấu hình Better Auth
│  ├─ config/       Cấu hình TypeScript dùng chung
│  ├─ db/           Drizzle schema và database access
│  ├─ env/          Validation biến môi trường
│  └─ ui/           Shared UI components và styles
├─ docs/            Tài liệu chuẩn
└─ AGENTS.md        Quy tắc AI agent
```

`apps/worker`, `packages/storage` và `packages/video` sẽ chỉ được thêm khi vertical
slice tương ứng bắt đầu. `packages/core` đã là nơi giữ domain policy dùng chung.

## Các lệnh có sẵn

- `pnpm run dev`: chạy toàn bộ ứng dụng ở development mode.
- `pnpm run dev:web`: chỉ chạy web app.
- `pnpm run build`: build toàn monorepo.
- `pnpm run check-types`: kiểm tra TypeScript.
- `pnpm run check`: chạy Biome và ghi các fix phù hợp.
- `pnpm run db:push`: đẩy schema trực tiếp vào development database.
- `pnpm run db:generate`: tạo migration.
- `pnpm run db:migrate`: chạy migration.
- `pnpm run db:studio`: mở Drizzle Studio.
- `pnpm run deploy:setup`: liên kết Vercel project.
- `pnpm run dev:vercel`: chạy local Vercel environment.
- `pnpm run env:preview`: đồng bộ env cho preview.
- `pnpm run env:production`: đồng bộ env cho production.
- `pnpm run deploy`: tạo preview deployment.
- `pnpm run deploy:prod`: deploy production.
- `pnpm run deploy:check`: kiểm tra deploy mà không upload.

Agent không tự chạy deploy, đồng bộ production env hoặc thay đổi production
database nếu chưa được yêu cầu rõ ràng.

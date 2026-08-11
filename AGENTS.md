# Quy tắc AI agent của AffiChannel

Các quy tắc này áp dụng cho mọi AI agent và task tự động trong repository. Một
file `AGENTS.md` ở thư mục con có thể bổ sung quy tắc riêng của framework. Khi
làm việc trong `apps/web`, phải đọc và tuân theo cả `apps/web/AGENTS.md`.

## 1. Tài liệu bắt buộc đọc trước khi triển khai

Trước khi thay đổi feature code, đọc phần liên quan trong:

1. `docs/README.md`;
2. `docs/product-spec.md`;
3. `docs/architecture.md`;
4. `docs/design-system.md` nếu làm UI;
5. `docs/roadmap.md`;
6. `docs/decisions.md`;
7. trạng thái và bản ghi mới nhất trong `docs/ai-progress.md`.

Không triển khai hành vi mâu thuẫn với quyết định đã chấp nhận hoặc product spec.
Nếu yêu cầu mới tạo mâu thuẫn, phải giải thích và cập nhật tài liệu cùng decision
log trong chính task đó.

## 2. Làm việc theo vertical slice

- Chỉ giữ một User Story đang thực hiện.
- Chỉ bắt đầu khi kết quả, Acceptance Criteria, dependency và phần loại trừ đã rõ.
- Chỉ làm database, domain logic, API, UI, trạng thái và test tối thiểu để đạt kết
  quả đó.
- Không làm toàn bộ màn hình trước hoặc toàn bộ backend trước.
- Không thực hiện task spreadsheet một cách máy móc theo thứ tự dòng.
- Không bắt đầu slice sau khi slice hiện tại chưa đạt Acceptance Criteria, trừ
  khi chủ dự án đổi ưu tiên rõ ràng.

## 3. Kiểm soát phạm vi

- MVP 0 không bao gồm Video AI, analytics nâng cao, auto-post, payments,
  organizations và full nonlinear editor.
- Không thêm abstraction hoặc provider SDK khi chưa đến slice tương ứng.
- Ưu tiên implementation nhỏ nhất, có thể hoàn tác và đáp ứng đúng tài liệu.
- Thay đổi phạm vi quan trọng cần decision được chấp nhận và cập nhật roadmap.

## 4. Ranh giới kiến trúc

- `apps/web`: Next.js route, page, UI composition và transport adapter.
- `packages/api`: oRPC procedure và request context, không chứa domain rule dùng
  chung.
- `packages/auth`: cấu hình Better Auth.
- `packages/db`: Drizzle schema, migration và database access.
- `packages/core`: domain rule độc lập framework và application service khi thêm.
- `packages/ui`: shared primitive và design token.
- `apps/worker`: job dài, Remotion và FFmpeg khi thêm.

Không được:

- truy cập database trực tiếp từ Client Component;
- đưa secret hoặc provider SDK vào client bundle;
- gọi HTTP API của chính app từ Server Component nếu có thể gọi trực tiếp
  application service;
- đặt business rule dùng chung trong route handler hoặc React component;
- chạy Remotion hoặc FFmpeg trong Vercel request handler;
- lưu media binary trong PostgreSQL.

## 5. API và validation

- Dùng oRPC cho typed query/mutation từ browser, polling và worker contract.
- Validate mọi input bên ngoài tại server boundary bằng Zod hoặc schema chuẩn.
- Với form client có domain schema dùng chung, gọi chính schema đó bằng `safeParse()` và
  map issues; không copy lại required/min/max ở UI. Normalize dữ liệu rỗng (ví dụ mô tả
  toàn dấu cách) trước khi gửi mutation.
- Không expose mutation generic cho state machine/workflow. `currentStepKey` là source of
  truth: transition phải là business action có transaction cập nhật step status và current
  step nhất quán; nếu chưa có action thì giữ workflow read-only.
- Trả typed error an toàn cho người dùng; không lộ stack trace, SQL, provider
  response hoặc secret.
- Tắt hoặc bảo vệ OpenAPI reference trong production.
- Provider và AI output là input không đáng tin cậy, bắt buộc schema validation.

## 6. Authentication và authorization

- Authentication không đủ để xác định quyền truy cập.
- Mọi protected read/mutation phải kiểm tra ownership hoặc group access ở server.
- Với MVP 0, `getWorkspaceActor()` phải resolve rõ `INTERNAL_WORKSPACE_ID`; không chọn
  membership đầu tiên theo thời gian nếu user có nhiều membership.
- Không tin `userId`, `projectId`, `productId`, media key hoặc job ID chỉ vì client
  gửi lên.
- Mỗi protected aggregate phải có test từ chối truy cập chéo người dùng.
- Không tùy tiện sửa Better Auth generated schema; phải review migration và khả
  năng tương thích.

## 7. Quy tắc database

- Thêm schema theo từng vertical slice thực sự dùng nó.
- Dùng migration được generate và review cho thay đổi bền vững.
- Không chạy destructive migration, production `db:push` hoặc sửa dữ liệu
  production nếu chưa được chủ dự án cho phép rõ ràng.
- Thêm index cho foreign key và database constraint cho invariant quan trọng.
- Dùng timestamp UTC và currency field rõ ràng.
- Ưu tiên archive/chuyển trạng thái khi có bản ghi phụ thuộc.
- Thao tác nhiều bản ghi cần thành công cùng nhau phải dùng transaction thật.
- Local `DATABASE_URL` và `DATABASE_URL_DIRECT` phải trỏ cùng một Neon project/branch.
  Trước khi migrate, kiểm tra host/database đã được nạp; không để inherited shell env âm thầm
  ghi đè `.env` của app.
- Runtime luôn dùng pooled `DATABASE_URL`; Drizzle migration/schema tooling ưu tiên
  `DATABASE_URL_DIRECT`.
- Khi database đã có schema nhưng thiếu migration ledger, dừng để đối chiếu schema và ledger;
  không chạy `db:push` hoặc tạo lại bảng để “sửa nhanh”.

## 8. Bảo mật và riêng tư

- Không commit hoặc hiển thị giá trị `.env`, credential, cookie, signed URL hoặc
  provider key.
- Đọc biến môi trường qua `packages/env`, trừ file cấu hình công cụ bắt buộc.
- Loại authorization header và provider payload nhạy cảm khỏi log.
- Coi upload, remote URL, filename và media metadata là không đáng tin cậy.
- Validate protocol, destination, MIME, size, dimensions, duration và file path
  khi phù hợp.
- Dựng tham số FFmpeg từ giá trị đã validate; không nối raw input vào shell.
- Không gửi dữ liệu riêng hoặc secret của provider khác qua AI relay.

## 9. TypeScript và chất lượng code

- Giữ strict TypeScript.
- Tránh `any`; dùng `unknown` và narrowing tại trust boundary.
- Dùng tên domain cụ thể thay vì tên chung như `data`, `item` hoặc `manager`.
- Function tập trung, side effect dễ nhận biết.
- Tái sử dụng workspace package và UI primitive hiện có.
- Không thêm thư viện state, form, validation hoặc component khác nếu chưa có lý
  do được ghi nhận.
- Khi làm Next.js, tuân theo `apps/web/AGENTS.md` và đọc tài liệu Next.js được cài
  đặt mà file đó chỉ dẫn trước khi dựa vào trí nhớ.
- Với dữ liệu server được dùng ở nested layout/page, ưu tiên loader `React.cache()` theo
  request để dedupe session, authorization và query; luôn authorize trước khi trả fixture
  hoặc dữ liệu demo, và chỉ bật fixture ngoài production.

## 10. Quy tắc triển khai UI

- Tuân theo token và interaction pattern trong `docs/design-system.md`.
- Light theme mặc định dùng nền trắng/xanh rất nhạt; blue là primary/active,
  blue-900 là text chính, green/orange/purple chỉ dùng theo semantic token. Không
  tự thêm gradient, glow hoặc đổi palette ngoài design system đã duyệt.
- Làm loading, empty, validation, error, unauthorized và success ngay trong
  feature, không để thành cleanup sau.
- Mỗi vùng chỉ có một primary action rõ ràng.
- Header trang chỉ giữ title, mô tả ngắn và primary action khi chúng giúp người
  dùng hiểu trạng thái hoặc quyết định bước tiếp theo. Không thêm eyebrow/label
  chung chung như `Overview`, `Workflow` hoặc `Đang chuẩn bị` chỉ để lấp khoảng
  trống hay lặp lại title.
- AppTopbar mặc định là một panel trắng bo tròn, chỉ giữ title ngắn theo route,
  thông báo và tài khoản; không render mô tả dài hoặc breadcrumb chung. Không
  thêm Job Center vào header nếu thiết kế được duyệt không hiển thị nó.
- Eyebrow, badge và metadata phải thể hiện dữ liệu thật: số lượng, trạng thái,
  thời điểm hoặc ngữ cảnh cụ thể. Không dùng badge trạng thái cho cả một page
  nếu chưa có trạng thái domain tương ứng.
- Dùng tiếng Việt nhất quán cho copy giao diện; chỉ giữ thuật ngữ domain hoặc
  tên sản phẩm tiếng Anh khi cần chính xác, ví dụ `Product Facts`.
- Placeholder phải nói rõ phần nào đã sẵn sàng và phần nào chưa có, không giả
  lập dữ liệu hoặc status sản phẩm/project chưa tồn tại.
  - Với Base UI, `Button` render thành `Link` phải đặt `nativeButton={false}`;
    không lồng link và button vì sai semantics và tạo cảnh báo accessibility.
  - Giao diện mặc định phải tạo cảm giác mềm và dễ tiếp cận: dùng bo góc theo
    hierarchy (control 8–10 px, panel/card 12–14 px, dialog/drawer 18 px) và
    border/shadow nhẹ. Không dùng `rounded-none` cho button, input, select,
    textarea, menu, card, empty state hoặc active navigation. Chỉ để góc vuông
    cho divider, bảng dữ liệu dày đặc hoặc phần tử lồng bên trong một control đã
    có khung bo góc.
  - Không biểu diễn status chỉ bằng màu.
- Test dấu tiếng Việt, label dài, giá, đơn vị và URL.
- Shared primitive đặt trong `packages/ui`; feature composition đặt gần web
  feature.
- Không polish màn hình phía sau khi dữ liệu và behavior chưa tồn tại.

## 11. Quy tắc Fact Lock và AI

- Product Facts là nguồn sự thật.
- AI có thể tạo draft và đề xuất evidence; AI không tự phê duyệt claim.
- Fact Lock áp dụng cho một script version bất biến.
- Thay đổi nội dung chứa claim hoặc fact hỗ trợ làm kết quả cũ mất hiệu lực.
- TTS và Render bị chặn nếu run hiện tại chưa đạt quy tắc đã tài liệu hóa.
- Khi module được thêm, request tốn phí phải ghi provider/model, request ID,
  input version, cost và failure reason an toàn.
- Retry phải hữu hạn và idempotent.

## 12. Kiểm tra

Chọn mức kiểm tra tương xứng với thay đổi. Tối thiểu cho feature work:

```powershell
pnpm run check-types
pnpm run check
```

Hiện `pnpm run check` có thể ghi Biome fix. Phải xem diff sau khi chạy và không
đưa formatting không liên quan vào task.

Chạy thêm unit, integration, migration, build và Playwright test phù hợp khi đã
có. Nếu không chạy được kiểm tra bắt buộc, ghi lý do chính xác trong bàn giao và
`docs/ai-progress.md`.

Không khẳng định visual state đúng nếu chưa kiểm tra bằng browser hoặc rendered
artifact phù hợp.

## 13. Cập nhật tài liệu bắt buộc cho mỗi task

Trước khi kết thúc implementation đáng kể:

- thêm bản ghi ngắn vào `docs/ai-progress.md`;
- cập nhật `docs/changelog.md` cho thay đổi người dùng thấy, vận hành hoặc kiến
  trúc;
- cập nhật product, architecture, design hoặc roadmap nếu baseline thay đổi;
- thêm hoặc thay thế decision nếu có lựa chọn quan trọng.

Progress chỉ tóm tắt bằng chứng và kết quả; không chứa hidden reasoning, secret
hoặc raw terminal dump.

## 14. Git và hành động bên ngoài

- Giữ nguyên thay đổi của người dùng và phần worktree không liên quan.
- Không rewrite history, hard reset hoặc bỏ thay đổi nếu chưa được cho phép.
- Không commit, push, tạo PR, deploy, tạo hạ tầng trả phí hoặc gửi tin nhắn bên
  ngoài nếu chưa được yêu cầu rõ ràng.
- Giữ commit và diff trong phạm vi vertical slice đang làm.

## 15. Definition of Done

Task chỉ hoàn thành khi:

- Acceptance Criteria đã đạt;
- server-side invariant và authorization đã triển khai;
- UI state bắt buộc đã có;
- test/check liên quan đạt;
- migration và generated artifact đã review;
- tài liệu, changelog và AI progress đã cập nhật;
- diff không có secret hoặc thay đổi không liên quan;
- hạn chế còn lại và hành động an toàn tiếp theo được bàn giao rõ ràng.

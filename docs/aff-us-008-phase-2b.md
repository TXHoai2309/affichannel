# AFF-US-008 Phase 2B — Live TextProvider

- Trạng thái: Ready for acceptance; live smoke pending nếu chưa bật opt-in
- Ngày cập nhật: 2026-08-15

Phase 2B nối provider text thật vào abstraction của Phase 2A. Phạm vi chỉ gồm
server adapter, cấu hình, error/cost mapping, test mock và smoke test opt-in;
không gồm Script Studio UI, ScriptVersion, Fact Lock, TTS hoặc video.

## Contract audit APIKEY.FUN

Đã kiểm tra trang Docs chính thức [APIKEY.FUN Docs](https://apikey.fun/docs) và
landing chính thức [APIKEY.FUN](https://slb.apikey.fun/):

| Hạng mục | Kết quả đã xác minh | Quyết định triển khai |
| --- | --- | --- |
| Base URL | `https://api.apikey.fun` được công khai; docs dùng cùng host | Cho phép override `APIKEY_FUN_BASE_URL`, mặc định đặt ở adapter infrastructure |
| Auth | Docs dùng `Authorization: Bearer YOUR_API_KEY`; runtime probe không có key trả `API_KEY_REQUIRED` | Key chỉ đi trong request server-side |
| Endpoint | `POST /v1/messages`, Anthropic Messages | Adapter `ApikeyFunTextProvider` dùng SSE documented |
| Model | Docs hiển thị `claude-sonnet-4-6` cho Anthropic Messages | AI Settings lưu provider ID này; display name là Claude Sonnet 4.6 |
| Structured output | Docs hiện kiểm tra được chỉ mô tả text/vision Messages, không công bố JSON Schema/strict response contract | Chỉ yêu cầu JSON bằng prompt; vẫn parse + Zod/domain validate server-side |
| Usage/request ID | Docs không cam kết field cost/request ID cố định | Đọc usage/id/header nếu response thật sự có; thiếu thì giữ `null` |
| Pricing | Pricing page công khai hiển thị Claude Sonnet 4.6 ở USD 3/1M input và USD 15/1M output tại ngày kiểm tra; không có API billing contract ổn định | Dùng pricing config versioned server-side; thiếu config trả `COST_ESTIMATE_UNAVAILABLE` |

Pricing được kiểm tra ngày `2026-08-15` từ [APIKEY.FUN Pricing](https://apikey.fun/pricing)
(public model-pricing metadata). Giá này là căn cứ cấu hình ban đầu, không được scrape
trong production và vẫn cần đối chiếu dashboard billing trước khi bật live call.

Không gọi model thật trong audit. Probe không credential vào `/v1/models` và các
endpoint generation chỉ dùng để xác nhận gateway yêu cầu Bearer key; không gửi
secret và không tạo charge.

## Runtime mapping

`TextProviderMessage` được giữ ranh giới: `system` và `developer` trở thành các
block có nhãn trong Anthropic `system`, còn `user` trở thành `messages`. Input
Project/Product Facts vẫn là user data, không được nội suy vào trusted instruction.
Provider gửi `stream: true`, lấy text từ `content_block_delta`, usage từ
message events nếu có, rồi parse text thành JSON hoặc giữ raw text để domain
validator phân loại malformed output.

Provider output contract được gửi bằng trusted instructions/output-schema representation
được dựng từ `ScriptDraft v2` hiện tại: root keys exact, `hookVariants` 3–5 item,
`voiceoverSegments`, scene shape/order/reference, CTA, caption, hashtags, disclosure và
claim occurrence union. Repair chỉ được phép trả `schemaVersion`, `language` và các
section được yêu cầu; snapshot vẫn chứa parent/base context, valid/invalid sections,
Product Facts eligible, media metadata và settings dưới dạng untrusted data.

Structured output vẫn đi qua pipeline:

```text
APIKEY.FUN response
→ extract SSE text
→ JSON.parse nếu có thể
→ validateScriptDraftOutput / validateRepairScriptOutput
→ server merge + policy checks
→ completed / partial / failed
```

Repair không có đường tắt riêng: provider chỉ nhận `repairSections`, còn parent
subset, root metadata, preservation và persist child vẫn do service Phase 2A
enforce.

## Configuration

AI Settings có thể lưu:

```text
textProvider = apikeyfun
textModel = claude-sonnet-4-6
```

Nếu workspace chưa có AI Settings row, server dùng default cấu hình:

```text
TEXT_AI_DEFAULT_PROVIDER=apikeyfun
TEXT_AI_DEFAULT_MODEL=claude-sonnet-4-6
```

Provider credentials và runtime controls chỉ ở server env:

```text
APIKEY_FUN_API_KEY=
APIKEY_FUN_BASE_URL=https://api.apikey.fun
TEXT_AI_TIMEOUT_MS=120000
TEXT_AI_MAX_OUTPUT_TOKENS=8192
```

Cost preflight cần đủ pricing config versioned:

```text
APIKEY_FUN_PRICING_VERSION=apikeyfun-public-pricing-2026-08-15
APIKEY_FUN_PRICING_CURRENCY=USD
APIKEY_FUN_INPUT_PRICE_MICROS_PER_MILLION=3000000
APIKEY_FUN_OUTPUT_PRICE_MICROS_PER_MILLION=15000000
APIKEY_FUN_ESTIMATED_OUTPUT_TOKENS=2048
```

Giá trị `2048` là conservative initial output budget cho một ScriptDraft v2 đầy đủ
(nhiều section tiếng Việt), chỉ là estimate trước request; sau 5–10 generation bình
thường nên hiệu chỉnh theo usage thật. Các giá trị price vẫn cần chủ project xác nhận
với billing thực tế; không hard-code rải trong adapter và không quy đổi CNY/USD trong
TextProvider.

Production thiếu `APIKEY_FUN_API_KEY` sẽ trả `TEXT_PROVIDER_NOT_CONFIGURED`.
Không có silent fallback sang deterministic. Nếu thiếu pricing, generate dừng ở
preflight trước khi provider request được gửi.

## Error và timeout

| Provider condition | AffiChannel mapping |
| --- | --- |
| HTTP 401/403 | `AI_PROVIDER_ERROR`, thông báo nội bộ auth/config an toàn |
| HTTP 400 | `AI_PROVIDER_ERROR`, request/provider input không hợp lệ |
| HTTP 404 | `AI_PROVIDER_ERROR`, model config không tồn tại |
| HTTP 429 | `AI_PROVIDER_ERROR`, rate limit |
| HTTP 5xx/502/503 | `AI_PROVIDER_UNCERTAIN` → service lưu `AI_REQUEST_STATE_UNCERTAIN`/`indeterminate` |
| HTTP 408 | `AI_TIMEOUT_UNCERTAIN` → service lưu `AI_REQUEST_STATE_UNCERTAIN`/`indeterminate` |
| AbortController timeout khi chưa biết delivery | `AI_TIMEOUT_UNCERTAIN` → service lưu `AI_REQUEST_STATE_UNCERTAIN`/`indeterminate` |
| Network failure sau khi request bắt đầu | `AI_TIMEOUT_UNCERTAIN` → không retry tự động |
| SSE `event:error`, JSON error sau HTTP 200, malformed SSE hoặc stream đóng trước `message_stop` | `AI_PROVIDER_UNCERTAIN` → `indeterminate`, không coi là `AI_INVALID_OUTPUT` |
| Empty stream có `message_start` + `message_stop` | Provider success với content rỗng; domain mới quyết định `AI_INVALID_OUTPUT` |
| Malformed/non-JSON model output sau stream hoàn chỉnh | Provider result vẫn trả về; domain lưu `AI_INVALID_OUTPUT` hoặc partial theo validator |

HTTP 401/403/400/404/429 vẫn là provider rejection definite theo response status;
không automatic retry. Không có bằng chứng APIKEY.FUN chứng minh 408/5xx chưa được
upstream xử lý nên giữ policy bảo thủ.

APIKEY.FUN docs/runtime audit không yêu cầu `anthropic-version`; adapter không tự thêm
header theo native Anthropic docs. Request ID chỉ lấy từ body `id` hoặc
`request-id`/`x-request-id`; thiếu thì `null`.

Raw provider body không được đưa vào error, log hoặc UI. Authorization/API key
không được log.

## Cost và usage

`estimateCost()` không gọi generate và dùng pricing config đã version hóa. Input
token là approximation documented `UTF-8 bytes / 4`; output token dùng budget cấu
hình `APIKEY_FUN_ESTIMATED_OUTPUT_TOKENS`. Estimate/currency được ghi vào
`script_generation` trước provider call. Nếu provider trả usage thì map
`inputTokens`/`outputTokens`; nếu không trả thì giữ `null`. Provider request ID
lấy từ body `id` hoặc header `request-id`/`x-request-id`, không tự tạo ID giả.

## Verification

- Adapter unit test dùng mock `fetch`, không gọi API thật.
- Unit test phủ normal/multi-delta/message-stop/usage/request-id, `event:error`, JSON
  error sau HTTP 200, malformed/incomplete SSE, empty completed stream và HTTP
  408/5xx/network/abort uncertain mapping.
- Live smoke nằm ở `pnpm test:integration:script-generation-live`, mặc định
  `SKIPPED`; chỉ chạy khi `AFFICHANNEL_LIVE_AI_SMOKE=1`, có API key và pricing
  config. Output smoke chỉ log metadata đã redacted.
- Authenticated E2E baseline chạy `12 passed`.
- `pnpm test:integration:script-generation` chưa pass vì configured Neon runtime
  thiếu các bảng `channel_settings`/`script_generation` (`42P01`); không migrate
  shared Neon trong Phase 2B.
- Phase 2B không tạo migration.
- `getState` vẫn là DB-only và authorization không đổi.
- Runtime DB integration debt vẫn được ghi nhận; authenticated E2E final run không
  tái hiện regression AFF-US-004 và đạt `12 passed`.

Nếu live smoke chưa được bật thì Phase 2B implementation đã sẵn sàng nhưng trạng thái
acceptance cuối vẫn là `LIVE SMOKE PENDING`. AFF-US-008 tổng thể chưa Done.

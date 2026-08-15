# AFF-US-008 Phase 2B — Live TextProvider

- Trạng thái: Ready for review
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
| Pricing | Docs page không cung cấp contract pricing runtime đủ để preflight | Dùng pricing config versioned server-side; thiếu config trả `COST_ESTIMATE_UNAVAILABLE` |

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
APIKEY_FUN_PRICING_VERSION=...
APIKEY_FUN_PRICING_CURRENCY=CNY
APIKEY_FUN_INPUT_PRICE_MICROS_PER_MILLION=...
APIKEY_FUN_OUTPUT_PRICE_MICROS_PER_MILLION=...
APIKEY_FUN_ESTIMATED_OUTPUT_TOKENS=...
```

Các giá trị price là cấu hình do chủ project xác nhận từ billing thực tế của
provider; không lấy từ HTML pricing runtime, không hard-code rải trong adapter,
không quy đổi CNY/USD trong TextProvider.

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
| HTTP 5xx | `AI_PROVIDER_ERROR`, provider unavailable |
| HTTP 408 | `AI_TIMEOUT` — provider đã trả response timeout |
| AbortController timeout khi chưa biết delivery | `AI_TIMEOUT_UNCERTAIN` → service lưu `AI_REQUEST_STATE_UNCERTAIN`/`indeterminate` |
| Network failure sau khi request bắt đầu | `AI_TIMEOUT_UNCERTAIN` → không retry tự động |
| Malformed/non-JSON output | Provider result vẫn trả về; domain lưu `AI_INVALID_OUTPUT` hoặc partial theo validator |

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
- Live smoke nằm ở `pnpm test:integration:script-generation-live`, mặc định
  `SKIPPED`; chỉ chạy khi `AFFICHANNEL_LIVE_AI_SMOKE=1`, có API key và pricing
  config. Output smoke chỉ log metadata đã redacted.
- Phase 2B không tạo migration.
- `getState` vẫn là DB-only và authorization không đổi.
- Authenticated E2E regression AFF-US-004 browser Back và runtime DB integration
  debt của baseline vẫn được ghi nhận, không sửa tiện tay trong phase này.

AFF-US-008 Phase 2B is ready for review. AFF-US-008 tổng thể chưa Done.

# AFF-US-008 Phase 2A — Production AI input và cost preflight

- Trạng thái: Ready for acceptance — backend/domain Phase 2A
- Cập nhật: 2026-08-15
- Phạm vi: Channel Settings, AI provider settings, Media Metadata contract, Output Rules,
  structured draft v2 và production oRPC boundary

## Quyết định phạm vi

Phase 2A chỉ làm server/domain/persistence. Chưa thêm UI, provider SDK thật, ScriptVersion,
Fact Lock, TTS, render hoặc workflow advance. Không migrate shared Neon trong task này.

## Input contract

Generation snapshot v2 lưu đúng dữ liệu server đã dùng:

- project: id và name;
- contentBrief: platform, goal, duration, angle và description đã normalize;
- product và các Product Facts usable kèm revision, assessment, freshness và source;
- channelSettings: niche, target audience, tone, content pillar, default CTA, disclosure và
  avoid words;
- mediaMetadata: metadata tham chiếu, không chứa binary;
- outputRules: vi-VN, 9:16, subtitle safe area semantic standard, final CTA bắt buộc và
  claimLimit nullable;
- generationConfig: provider/model cùng prompt/output schema version, không có secret.

Channel Settings được lưu một bản ghi/workspace. Thiếu bản ghi hoặc thiếu trường bắt buộc sẽ
trả CHANNEL_SETTINGS_INCOMPLETE. AI settings chỉ lưu textProvider và textModel; provider
và model được server resolve, client không thể override trong request.

Media Metadata hiện chỉ là contract/persistence tối thiểu cho image/video/audio, aspect ratio,
duration, usage rights, status, scene suitability, tags và display/reference metadata. Upload,
MIME validation và binary storage thuộc slice media sau.

Khi claimLimit khác null, server validator áp dụng đúng giới hạn đã cấu hình; khi null, không có
business cap số lượng claim nào được tự phát minh.

## Final hardening contract

- Router tách rõ preflight và provider execution: lỗi resolve provider trả
	`TEXT_PROVIDER_NOT_CONFIGURED` khi thiếu credential hoặc `TEXT_PROVIDER_UNAVAILABLE` khi provider
	không tồn tại, lỗi estimate trả `COST_ESTIMATE_UNAVAILABLE`; lỗi ghi estimate và lỗi finalize là
	lỗi persistence/application được propagate nguyên trạng. Mỗi preflight failure chỉ finalize một
	lần, còn `provider.generate()` do service giữ semantics definite/uncertain.
- Repair chỉ thay các section trong `repairSections`. `schemaVersion` và `language` phải bằng parent;
  server merge lại root metadata từ parent và kiểm tra nội dung của mọi section hợp lệ của parent
  không nằm trong repair vẫn giữ nguyên. Snapshot repair lưu `baseValidSections` để proof dựa trên
  parent artifact, không dựa vào `validSections` rỗng của child pending.
- Output phải có `language` đúng `outputRules.language` và `disclosure` là chuỗi không rỗng đúng
  `channelSettings.affiliateDisclosure`. `avoidWords` được nhắc ở prompt level và kiểm tra lại ở
  domain level với trim, NFKC và so sánh không phân biệt hoa thường; vi phạm một section tạo partial
  để section đó có thể repair, không âm thầm thay nội dung.
- Provider chỉ nhận `mediaMetadata` usable: `status=ready` và `usageRights=owned|licensed`.
  Media archived, needs_review, restricted, unknown rights hoặc metadata không hợp lệ bị loại khỏi
  provider input; không có media usable vẫn là snapshot hợp lệ.

## ScriptDraft v2

hook đơn được thay bằng hookVariants, từ 3 đến 5 item, mỗi item có key unique và text.
Không có selectedHook. Claim occurrence ở hook phải có hookKey; server validate mọi
cross-reference trước khi persist. Output schema, input snapshot và prompt đều bump version sạch
lên v2; không tạo compatibility converter vì chưa có generated artifact shared cần giữ tương
thích.

Prompt builder tách ba vùng: trustedInstructions, outputSchema và untrustedInputData. Fact,
brief, media và settings luôn được serialize như data, không interpolate vào instruction.

## Provider và chi phí

TextProvider bắt buộc có estimateCost() và generate(). Production flow phải estimate thành
công trước khi gọi generate; thiếu estimate, provider không tồn tại hoặc config production chưa
có live adapter thì fail closed. Deterministic provider chỉ được registry bật ở development/test,
không phải fallback production. Không có automatic retry.

script_generation tiếp tục là usage log duy nhất, lưu provider/model, request id, token, cost,
currency và error code. Không tạo usage table trùng.

## API boundary

Protected oRPC procedure:

- scriptGeneration.estimate: dựng snapshot preview, resolve server config và trả cost estimate;
- scriptGeneration.generate: preflight estimate rồi mới gọi provider;
- scriptGeneration.repair: nhận project, base generation request id, sections và idempotency key,
  merge repair output server-side theo invariant foundation;
- scriptGeneration.getState: read model scoped theo workspace/project.

Cross-workspace record trả NOT_FOUND. Các lỗi chính gồm CHANNEL_SETTINGS_INCOMPLETE,
NO_USABLE_PRODUCT_FACTS, TEXT_PROVIDER_NOT_CONFIGURED, TEXT_PROVIDER_UNAVAILABLE,
COST_ESTIMATE_UNAVAILABLE, AI_TIMEOUT, AI_REQUEST_STATE_UNCERTAIN, AI_INVALID_OUTPUT,
AI_PROVIDER_ERROR, GENERATION_ALREADY_IN_PROGRESS, IDEMPOTENCY_CONFLICT và
INVALID_REPAIR_REQUEST.

## Database

Migration 0010_stormy_groot.sql thêm channel_settings, ai_settings và media_metadata; migration
0011_keen_king_bedlam.sql thêm output_rules. Các bảng có workspace/FK/index/check tương ứng.
Migration được generate và review; chỉ apply trên database disposable khi có driver test phù hợp,
không apply Neon shared.

## Deferred/runtime debt

Integration smoke hiện vẫn phụ thuộc Neon serverless driver nên không kết nối Docker PostgreSQL
localhost trong môi trường hiện tại. Chỉ thêm test-only driver nếu không làm thay đổi runtime
production; nếu chưa có adapter sạch, phải báo rõ thay vì claim integration pass.

AFF-US-008 Phase 2A is ready for acceptance. AFF-US-008 is not marked Done until the live provider,
Script Studio UI và authenticated end-to-end/live smoke được triển khai. Runtime integration hiện
chưa được claim pass do Neon serverless driver không kết nối Docker localhost. Authenticated E2E
hiện chạy được 11/12; test AFF-US-004 về browser Back còn fail vì route quay lại overview sau khi
đã đi qua product, nằm ngoài hardening Phase 2A và chưa được sửa trong vòng này.

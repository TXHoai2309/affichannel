import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({
	path: resolve(process.cwd(), "apps/web/.env"),
	override: true,
});

if (process.env.AFFICHANNEL_LIVE_AI_SMOKE !== "1") {
	console.log("SKIPPED — live paid call not explicitly enabled.");
	process.exit(0);
}

const { env } = await import("@affichannel/env/server");
const { ApikeyFunTextProvider } = await import(
	"../packages/api/src/providers/text/apikeyfun-text-provider.ts"
);
const { SCRIPT_OUTPUT_SCHEMA_VERSION, validateScriptDraftOutput } =
	await import("@affichannel/core");
const { renderScriptPrompt } = await import(
	"../packages/api/src/services/script-prompt.ts"
);

if (!env.APIKEY_FUN_API_KEY) {
	console.error(
		"FAIL — APIKEY_FUN_API_KEY is required when live smoke is enabled.",
	);
	process.exit(1);
}

if (
	!env.APIKEY_FUN_PRICING_VERSION ||
	!env.APIKEY_FUN_PRICING_CURRENCY ||
	!env.APIKEY_FUN_INPUT_PRICE_MICROS_PER_MILLION ||
	!env.APIKEY_FUN_OUTPUT_PRICE_MICROS_PER_MILLION ||
	env.APIKEY_FUN_ESTIMATED_OUTPUT_TOKENS === undefined
) {
	console.error(
		"FAIL — versioned APIKEY.FUN pricing configuration is required for live smoke.",
	);
	process.exit(1);
}

const provider = new ApikeyFunTextProvider({
	apiKey: env.APIKEY_FUN_API_KEY,
	baseUrl: env.APIKEY_FUN_BASE_URL,
	timeoutMs: env.TEXT_AI_TIMEOUT_MS,
	maxOutputTokens: env.TEXT_AI_MAX_OUTPUT_TOKENS,
	pricing: {
		version: env.APIKEY_FUN_PRICING_VERSION,
		currency: env.APIKEY_FUN_PRICING_CURRENCY,
		inputMicrosPerMillionTokens: BigInt(
			env.APIKEY_FUN_INPUT_PRICE_MICROS_PER_MILLION,
		),
		outputMicrosPerMillionTokens: BigInt(
			env.APIKEY_FUN_OUTPUT_PRICE_MICROS_PER_MILLION,
		),
		estimatedOutputTokens: env.APIKEY_FUN_ESTIMATED_OUTPUT_TOKENS,
	},
});

const smokeSnapshot = {
	snapshotVersion: "script-input.v2",
	request: { mode: "full" as const, repair: null },
	project: { id: "live-smoke-project", name: "AffiChannel live smoke" },
	contentBrief: {
		platform: "tiktok" as const,
		goal: "Tạo bản nháp review có thể kiểm chứng",
		durationSeconds: 30,
		angle: "Nêu trải nghiệm thực tế dựa trên Product Facts",
		description: "Smoke test an toàn, không dùng dữ liệu riêng tư.",
	},
	product: {
		id: "live-smoke-product",
		name: "Tai nghe AffiChannel",
		category: "Audio",
	},
	channelSettings: {
		niche: "Công nghệ",
		targetAudience: "Người dùng cần tai nghe",
		tone: "Tin cậy, rõ ràng",
		contentPillar: "Review sản phẩm",
		defaultCta: "Xem thêm thông tin",
		affiliateDisclosure: "Nội dung có liên kết affiliate.",
		avoidWords: [],
	},
	mediaMetadata: [],
	outputRules: {
		language: "vi-VN" as const,
		aspectRatio: "9:16" as const,
		subtitleSafeArea: "standard" as const,
		claimLimit: null,
		requireFinalCta: true as const,
	},
	generationConfig: {
		textProvider: "apikeyfun",
		textModel: env.TEXT_AI_DEFAULT_MODEL,
		promptVersion: "script-prompt.v2",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
	},
	facts: [
		{
			id: "live-smoke-fact",
			revision: 1,
			content: "Thời lượng pin lên đến 20 giờ theo thông tin sản phẩm.",
			type: "specification" as const,
			assessment: {
				verification: "verified" as const,
				evidence: "complete" as const,
				freshness: "not_applicable" as const,
				freshnessReason: "not_applicable" as const,
			},
			generationUsability: "allowed" as const,
			source: {
				type: "product_page",
				label: "Smoke test fixture",
				url: "https://example.invalid/smoke-source",
				confirmedAt: "2026-08-15",
				expiresAt: null,
			},
		},
	],
};
const prompt = renderScriptPrompt(smokeSnapshot);

const startedAt = Date.now();
try {
	const result = await provider.generate({
		messages: [
			{ role: "system", content: prompt.trustedInstructions },
			{ role: "developer", content: prompt.outputSchema },
			{ role: "user", content: prompt.untrustedInputData },
		],
		model: env.TEXT_AI_DEFAULT_MODEL,
		mode: "full",
		sections: [
			"hook",
			"voiceover",
			"scenes",
			"cta",
			"caption",
			"hashtags",
			"disclosure",
			"claims",
		],
		idempotencyKey: `live-smoke-${Date.now()}`,
	});
	const validation = validateScriptDraftOutput(
		result.content,
		smokeSnapshot.contentBrief.durationSeconds,
		smokeSnapshot.outputRules.claimLimit,
		{
			expectedLanguage: smokeSnapshot.outputRules.language,
			requiredDisclosure: smokeSnapshot.channelSettings.affiliateDisclosure,
		},
	);
	console.log(
		JSON.stringify({
			status: validation.status,
			provider: result.provider,
			model: result.model,
			providerRequestIdPresent: Boolean(result.providerRequestId),
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			estimatedCostMicros: result.estimatedCostMicros?.toString() ?? null,
			actualCostMicros: result.actualCostMicros?.toString() ?? null,
			currency: result.currency,
			latencyMs: Date.now() - startedAt,
		}),
	);
	if (validation.status === "failed") process.exitCode = 1;
} catch (error) {
	console.error(
		JSON.stringify({
			status: "FAIL",
			code:
				error instanceof Error && "code" in error
					? error.code
					: "AI_PROVIDER_ERROR",
			latencyMs: Date.now() - startedAt,
		}),
	);
	process.exitCode = 1;
}

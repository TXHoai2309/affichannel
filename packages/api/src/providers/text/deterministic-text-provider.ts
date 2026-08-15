import {
	SCRIPT_OUTPUT_SCHEMA_VERSION,
	ScriptGenerationError,
} from "@affichannel/core";
import type { ScriptGenerationInputSnapshot } from "@affichannel/core/script-generation/types";
import {
	type TextProvider,
	TextProviderError,
	type TextProviderEstimate,
	type TextProviderEstimateRequest,
	type TextProviderRequest,
	type TextProviderResult,
	type TextProviderScenario,
} from "./text-provider";

export type DeterministicTextProviderOptions = {
	scenario?: TextProviderScenario;
	snapshot: ScriptGenerationInputSnapshot;
};

function createDraft(snapshot: ScriptGenerationInputSnapshot) {
	const firstFact = snapshot.facts[0]?.content ?? "thông tin đã được xác thực";
	const draft = {
		schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		language: snapshot.outputRules.language,
		hookVariants: [
			{
				key: "curiosity",
				text: `Bạn đã biết ${snapshot.product.name} có gì đáng chú ý chưa?`,
			},
			{
				key: "benefit",
				text: `${snapshot.product.name} có điểm gì khiến bạn nên xem ngay?`,
			},
			{
				key: "problem",
				text: "Đang tìm giải pháp phù hợp hơn cho nhu cầu của bạn?",
			},
		],
		voiceoverSegments: [
			{ key: "intro", text: `${snapshot.product.name}: ${firstFact}` },
			{ key: "benefit", text: snapshot.contentBrief.angle },
		],
		scenes: [
			{
				order: 1,
				durationSeconds: Math.max(
					1,
					Math.round(snapshot.contentBrief.durationSeconds / 2),
				),
				visualDirection:
					snapshot.mediaMetadata[0]?.reference.displayName ??
					"Cận cảnh sản phẩm và chi tiết chính.",
				onScreenText: snapshot.product.name,
				voiceoverSegmentKeys: ["intro"],
			},
			{
				order: 2,
				durationSeconds:
					snapshot.contentBrief.durationSeconds -
					Math.max(1, Math.round(snapshot.contentBrief.durationSeconds / 2)),
				visualDirection:
					"Minh họa trải nghiệm sử dụng và lời kêu gọi hành động.",
				onScreenText: null,
				voiceoverSegmentKeys: ["benefit"],
			},
		],
		cta: { text: snapshot.channelSettings.defaultCta },
		caption: `${snapshot.product.name} — ${snapshot.contentBrief.goal}.`,
		hashtags: ["#affiliate", "#review", "#tiktok"],
		disclosure: snapshot.channelSettings.affiliateDisclosure,
		claims: [
			{
				text: firstFact,
				occurrence: { section: "voiceover", segmentKey: "intro" },
			},
		],
	};
	return draft;
}

export class DeterministicTextProvider implements TextProvider {
	readonly name = "deterministic";
	private readonly scenario: TextProviderScenario;
	private readonly snapshot: ScriptGenerationInputSnapshot;

	constructor(options: DeterministicTextProviderOptions) {
		this.scenario = options.scenario ?? "valid";
		this.snapshot = options.snapshot;
	}

	async estimateCost(
		request: TextProviderEstimateRequest,
	): Promise<TextProviderEstimate> {
		return {
			estimatedCostMicros: BigInt(0),
			currency: "VND",
			inputTokens: request.messages.reduce(
				(total, message) => total + message.content.length,
				0,
			),
			pricingBasis: "deterministic-test-provider",
		};
	}

	async generate(request: TextProviderRequest): Promise<TextProviderResult> {
		if (!request.idempotencyKey.trim()) {
			throw new ScriptGenerationError(
				"IDEMPOTENCY_CONFLICT",
				"Provider request requires an idempotency key.",
			);
		}
		if (this.scenario === "timeout")
			throw new TextProviderError(
				"AI_TIMEOUT",
				"Deterministic timeout before acceptance.",
			);
		if (this.scenario === "timeout_uncertain")
			throw new TextProviderError(
				"AI_TIMEOUT_UNCERTAIN",
				"Deterministic timeout with uncertain provider acceptance.",
			);
		if (this.scenario === "provider_error")
			throw new TextProviderError(
				"AI_PROVIDER_ERROR",
				"Deterministic provider failure.",
			);
		if (this.scenario === "provider_uncertain")
			throw new TextProviderError(
				"AI_PROVIDER_UNCERTAIN",
				"Deterministic provider failure with uncertain delivery.",
			);
		if (this.scenario === "malformed") {
			return {
				content: "not-json",
				providerRequestId: `det-${request.idempotencyKey}`,
				inputTokens: 10,
				outputTokens: 2,
				estimatedCostMicros: BigInt(0),
				actualCostMicros: BigInt(0),
				currency: "VND",
			};
		}
		const draft = createDraft(this.snapshot);
		const fullContent =
			this.scenario === "partial"
				? {
						schemaVersion: draft.schemaVersion,
						language: draft.language,
						hookVariants: draft.hookVariants,
						cta: draft.cta,
						caption: draft.caption,
						hashtags: draft.hashtags,
						disclosure: draft.disclosure,
					}
				: draft;
		const repairSections = new Set(request.sections);
		const content =
			request.mode === "repair"
				? Object.fromEntries([
						["schemaVersion", draft.schemaVersion],
						["language", draft.language],
						...[...repairSections].map((section) => [
							section === "hook"
								? "hookVariants"
								: section === "voiceover"
									? "voiceoverSegments"
									: section,
							(fullContent as Record<string, unknown>)[
								section === "hook"
									? "hookVariants"
									: section === "voiceover"
										? "voiceoverSegments"
										: section
							],
						]),
					])
				: fullContent;
		return {
			content,
			providerRequestId: `det-${request.idempotencyKey}`,
			inputTokens: request.messages.reduce(
				(total, message) => total + message.content.length,
				0,
			),
			outputTokens: JSON.stringify(content).length,
			estimatedCostMicros: BigInt(0),
			actualCostMicros: BigInt(0),
			currency: "VND",
		};
	}
}

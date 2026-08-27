import {
	SCRIPT_OUTPUT_SCHEMA_VERSION,
	ScriptGenerationError,
} from "@affichannel/core";
import type { FactLockInputSnapshot } from "@affichannel/core/fact-lock/types";
import type {
	ClaimOccurrence,
	ScriptGenerationInputSnapshot,
} from "@affichannel/core/script-generation/types";
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
	snapshot?: ScriptGenerationInputSnapshot;
	factLockSnapshot?: FactLockInputSnapshot;
};

type FactLockOccurrence = {
	occurrence: ClaimOccurrence;
	text: string;
};

const measurableAnchorPattern =
	/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?\s*(?:giờ|phút|ngày|tháng|kg|g|ml|lít|mah|w|v|hz|%)(?![\p{L}\p{N}])/giu;

function normalizeText(value: string) {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase("vi-VN")
		.replace(/\s+/g, " ")
		.trim();
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTextSpan(text: string, candidate: string) {
	const words = normalizeText(candidate)
		.split(" ")
		.filter(Boolean)
		.map(escapeRegExp);
	if (words.length === 0) return null;
	return text.match(new RegExp(words.join("\\s+"), "iu"))?.[0] ?? null;
}

function findFactualSpan(text: string, factContent: string) {
	const exact = findTextSpan(text, factContent);
	if (exact) return exact;
	for (const anchor of factContent.match(measurableAnchorPattern) ?? []) {
		const measurable = findTextSpan(text, anchor);
		if (measurable) return measurable;
	}
	return null;
}

function factLockOccurrences(
	snapshot: FactLockInputSnapshot,
): FactLockOccurrence[] {
	const script = snapshot.scriptVersion.snapshot;
	const occurrences: FactLockOccurrence[] = [];
	if (script.selectedHookKey) {
		const selected = script.hookVariants.find(
			(item) => item.key === script.selectedHookKey,
		);
		if (selected) {
			occurrences.push({
				occurrence: { section: "hook", hookKey: selected.key },
				text: selected.text,
			});
		}
	}
	for (const segment of script.voiceoverSegments)
		occurrences.push({
			occurrence: { section: "voiceover", segmentKey: segment.key },
			text: segment.text,
		});
	for (const scene of script.scenes)
		if (scene.onScreenText)
			occurrences.push({
				occurrence: { section: "scene", sceneOrder: scene.order },
				text: scene.onScreenText,
			});
	occurrences.push({ occurrence: { section: "cta" }, text: script.cta.text });
	occurrences.push({
		occurrence: { section: "caption" },
		text: script.caption,
	});
	return occurrences;
}

function deterministicFactLockClaims(snapshot: FactLockInputSnapshot) {
	const claims = [] as Array<Record<string, unknown>>;
	for (const [occurrenceIndex, candidate] of factLockOccurrences(
		snapshot,
	).entries()) {
		for (const fact of snapshot.productFacts) {
			const claimText = findFactualSpan(candidate.text, fact.content);
			if (!claimText) continue;
			claims.push({
				claimKey: `claim-${occurrenceIndex + 1}-${fact.id}`,
				claimText,
				occurrence: candidate.occurrence,
				classificationStatus: "SUPPORTED",
				reason: "Claim được đối chiếu với Product Fact trong snapshot.",
				confidence: 1,
				suggestionText: null,
				factMappings: [{ factId: fact.id, relation: "supports" }],
			});
		}
	}
	return claims;
}

function deterministicManifestFactLockClaims(request: TextProviderRequest) {
	const userMessage = request.messages.find(
		(message) => message.role === "user",
	);
	if (!userMessage) return null;
	try {
		const payload = JSON.parse(userMessage.content) as {
			claims?: Array<{ claimKey?: unknown }>;
			productFacts?: Array<{ id?: unknown }>;
		};
		if (!Array.isArray(payload.claims) || !Array.isArray(payload.productFacts))
			return null;
		const factId = payload.productFacts.find(
			(fact) => typeof fact.id === "string" && fact.id.trim(),
		)?.id;
		return payload.claims.flatMap((claim) => {
			if (typeof claim.claimKey !== "string" || !claim.claimKey.trim())
				return [];
			return [
				{
					claimKey: claim.claimKey,
					classificationStatus: "SUPPORTED",
					reason: "Claim được đối chiếu với Product Fact trong snapshot.",
					confidence: 1,
					suggestionText: null,
					factMappings: factId ? [{ factId, relation: "supports" }] : [],
				},
			];
		});
	} catch {
		return null;
	}
}

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
	private readonly snapshot?: ScriptGenerationInputSnapshot;
	private readonly factLockSnapshot?: FactLockInputSnapshot;

	constructor(options: DeterministicTextProviderOptions) {
		this.scenario = options.scenario ?? "valid";
		this.snapshot = options.snapshot;
		this.factLockSnapshot = options.factLockSnapshot;
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
		if (request.operation === "fact-lock") {
			const snapshot =
				this.factLockSnapshot ??
				(request.factLockSnapshot as FactLockInputSnapshot | undefined);
			if (!snapshot) {
				const manifestClaims = deterministicManifestFactLockClaims(request);
				if (manifestClaims) {
					const output = {
						schemaVersion: "fact-lock-output.v1",
						claims: manifestClaims,
					};
					return {
						content: output,
						providerRequestId: `det-fact-lock-${request.idempotencyKey}`,
						inputTokens: request.messages.reduce(
							(total, message) => total + message.content.length,
							0,
						),
						outputTokens: JSON.stringify(output).length,
						estimatedCostMicros: BigInt(0),
						actualCostMicros: BigInt(0),
						currency: "VND",
					};
				}
				throw new TextProviderError(
					"AI_PROVIDER_ERROR",
					"Fact Lock snapshot is missing.",
				);
			}
			const claims = deterministicFactLockClaims(snapshot);
			const output = {
				schemaVersion: "fact-lock-output.v1",
				claims,
			};
			return {
				content: output,
				providerRequestId: `det-fact-lock-${request.idempotencyKey}`,
				inputTokens: request.messages.reduce(
					(total, message) => total + message.content.length,
					0,
				),
				outputTokens: JSON.stringify(output).length,
				estimatedCostMicros: BigInt(0),
				actualCostMicros: BigInt(0),
				currency: "VND",
			};
		}
		if (!this.snapshot)
			throw new TextProviderError(
				"AI_PROVIDER_ERROR",
				"Script generation snapshot is missing.",
			);
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

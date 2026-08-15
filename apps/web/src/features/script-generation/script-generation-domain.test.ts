import { DeterministicTextProvider } from "@affichannel/api/providers/text/deterministic-text-provider";
import type {
	TextProvider,
	TextProviderResult,
} from "@affichannel/api/providers/text/text-provider";
import { executePreparedGeneration } from "@affichannel/api/routers/script-generation";
import {
	mergeRepairScriptOutput,
	runPreparedScriptGeneration,
} from "@affichannel/api/services/script-generation-service";
import { renderScriptPrompt } from "@affichannel/api/services/script-prompt";
import {
	canonicalizeJson,
	channelSettingsSchema,
	hookVariantsSchema,
	isUsableMediaMetadata,
	outputRulesSchema,
	SCRIPT_OUTPUT_SCHEMA_VERSION,
	ScriptGenerationError,
	validateRepairScriptOutput,
	validateScriptDraftOutput,
} from "@affichannel/core";
import type {
	PartialScriptDraft,
	ScriptGenerationArtifact,
	ScriptGenerationInputSnapshot,
} from "@affichannel/core/script-generation/types";
import { describe, expect, it, vi } from "vitest";

const snapshot = {
	snapshotVersion: "script-input.v2",
	request: { mode: "full" as const, repair: null },
	project: {
		id: "project-1",
		name: "Test project",
	},
	contentBrief: {
		platform: "tiktok" as const,
		goal: "Tạo chuyển đổi",
		durationSeconds: 30,
		angle: "Trải nghiệm trước và sau khi dùng",
		description: null,
	},
	product: { id: "product-1", name: "Tai nghe", category: "Audio" },
	channelSettings: {
		niche: "Công nghệ",
		targetAudience: "Người dùng cần tai nghe",
		tone: "Tin cậy",
		contentPillar: "Review sản phẩm",
		defaultCta: "Xem thêm",
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
		textProvider: "deterministic",
		textModel: "test-model",
		promptVersion: "script-prompt.v2",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
	},
	facts: [
		{
			id: "fact-1",
			revision: 1,
			content: "Pin dùng 20 giờ",
			type: "specification" as const,
			assessment: {
				verification: "verified" as const,
				evidence: "complete" as const,
				freshness: "not_applicable" as const,
				freshnessReason: "not_applicable" as const,
			},
			generationUsability: "allowed" as const,
			source: {
				type: null,
				label: null,
				url: null,
				confirmedAt: null,
				expiresAt: null,
			},
		},
	],
};

async function buildDeterministicOutput() {
	const provider = new DeterministicTextProvider({ snapshot });
	const result = await provider.generate({
		messages: [{ role: "user", content: "test" }],
		model: "test",
		mode: "full",
		sections: [],
		idempotencyKey: "unit-test-output",
	});
	return result.content as PartialScriptDraft;
}

function makeGeneration(): ScriptGenerationArtifact {
	return {
		id: "generation-1",
		workspaceId: "workspace-1",
		projectId: "project-1",
		createdByUserId: "user-1",
		idempotencyKey: "unit-test-generation",
		requestHash: "request-hash",
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "test-model",
		promptVersion: "script-prompt.v2",
		outputSchemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
		inputSnapshot: snapshot as ScriptGenerationInputSnapshot,
		inputHash: "input-hash",
		promptHash: "prompt-hash",
		status: "pending",
		output: null,
		validSections: [],
		invalidSections: [],
		providerRequestId: null,
		inputTokens: null,
		outputTokens: null,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: null,
		finishedAt: null,
		createdAt: new Date("2026-08-15T00:00:00.000Z"),
	};
}

const actor = { workspaceId: "workspace-1", userId: "user-1" };

describe("AFF-US-008 script-generation foundation", () => {
	it("enforces Phase 2A settings and hook variant contracts", () => {
		expect(
			channelSettingsSchema.safeParse({
				niche: "x",
				targetAudience: "x",
				tone: "x",
				contentPillar: "x",
				defaultCta: "x",
				affiliateDisclosure: "x",
				avoidWords: [],
			}).success,
		).toBe(true);
		expect(
			channelSettingsSchema.safeParse({
				niche: null,
				targetAudience: "x",
				tone: "x",
				contentPillar: "x",
				defaultCta: "x",
				affiliateDisclosure: "x",
				avoidWords: [],
			}).success,
		).toBe(false);
		expect(
			hookVariantsSchema.safeParse([
				{ key: "a", text: "a" },
				{ key: "b", text: "b" },
			]).success,
		).toBe(false);
		expect(
			hookVariantsSchema.safeParse([
				{ key: "a", text: "a" },
				{ key: "b", text: "b" },
				{ key: "c", text: "c" },
				{ key: "d", text: "d" },
				{ key: "e", text: "e" },
				{ key: "f", text: "f" },
			]).success,
		).toBe(false);
		expect(
			outputRulesSchema.parse({
				language: "vi-VN",
				aspectRatio: "9:16",
				subtitleSafeArea: "standard",
				claimLimit: null,
				requireFinalCta: true,
			}).claimLimit,
		).toBeNull();
	});

	it("separates trusted prompt roles from untrusted input data", () => {
		const prompt = renderScriptPrompt(snapshot);
		expect(prompt.trustedInstructions).not.toContain(snapshot.product.name);
		expect(prompt.outputSchema).toContain("hookVariants");
		expect(prompt.outputSchema).toContain("channelSettings.avoidWords");
		expect(prompt.untrustedInputData).toContain(snapshot.product.name);
	});

	it("canonicalizes object keys without reordering semantic arrays", () => {
		expect(canonicalizeJson({ b: 2, a: 1, items: ["b", "a"] })).toBe(
			'{"a":1,"b":2,"items":["b","a"]}',
		);
		expect(() => canonicalizeJson({ value: Number.NaN })).toThrow();
	});

	it("accepts a deterministic full draft and enforces duration tolerance", async () => {
		const provider = new DeterministicTextProvider({ snapshot });
		const result = await provider.generate({
			messages: [{ role: "user", content: "test" }],
			model: "test",
			mode: "full",
			sections: [],
			idempotencyKey: "unit-test-1",
		});
		const validation = validateScriptDraftOutput(result.content, 30);
		expect(validation.status).toBe("completed");
		expect(validation.validSections).toHaveLength(8);
		expect(validation.output?.schemaVersion).toBe(SCRIPT_OUTPUT_SCHEMA_VERSION);
	});

	it("applies a configured claim limit without inventing a default cap", async () => {
		const provider = new DeterministicTextProvider({ snapshot });
		const result = await provider.generate({
			messages: [{ role: "user", content: "test" }],
			model: "test",
			mode: "full",
			sections: [],
			idempotencyKey: "unit-test-claim-limit",
		});
		const output = {
			...(result.content as Record<string, unknown>),
			claims: [
				...((result.content as Record<string, unknown>).claims as Array<
					Record<string, unknown>
				>),
			],
		};
		const claims = output.claims as Array<Record<string, unknown>>;
		claims.push({
			text: "another claim",
			occurrence: { section: "voiceover", segmentKey: "benefit" },
		});
		const validation = validateScriptDraftOutput(output, 30, 1);
		expect(validation.status).toBe("failed");
		expect(validation.validSections).not.toContain("claims");
	});

	it("classifies missing scenes and claims as a usable partial draft", async () => {
		const provider = new DeterministicTextProvider({
			snapshot,
			scenario: "partial",
		});
		const result = await provider.generate({
			messages: [{ role: "user", content: "test" }],
			model: "test",
			mode: "full",
			sections: [],
			idempotencyKey: "unit-test-2",
		});
		const validation = validateScriptDraftOutput(result.content, 30);
		expect(validation.status).toBe("partial");
		expect(validation.validSections).toEqual([
			"hook",
			"cta",
			"caption",
			"hashtags",
			"disclosure",
		]);
		expect(validation.invalidSections).toEqual([
			"voiceover",
			"scenes",
			"claims",
		]);
	});

	it("rejects malformed, unknown-reference and out-of-budget output", () => {
		expect(validateScriptDraftOutput("not-json", 30).status).toBe("failed");
		expect(
			validateScriptDraftOutput(
				{
					schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
					language: "vi-VN",
					hookVariants: [
						{ key: "a", text: "x" },
						{ key: "b", text: "y" },
						{ key: "c", text: "z" },
					],
					voiceoverSegments: [{ key: "a", text: "x" }],
					scenes: [
						{
							order: 1,
							durationSeconds: 30,
							visualDirection: "x",
							onScreenText: null,
							voiceoverSegmentKeys: ["missing"],
						},
					],
					cta: { text: "x" },
					caption: "x",
					hashtags: [],
					disclosure: null,
					claims: [],
				},
				30,
			).status,
		).toBe("partial");
	});

	it("models timeout and provider failure without a live SDK", async () => {
		const request = {
			messages: [{ role: "user" as const, content: "test" }],
			model: "test",
			mode: "full" as const,
			sections: [],
			idempotencyKey: "unit-test-3",
		};
		await expect(
			new DeterministicTextProvider({ snapshot, scenario: "timeout" }).generate(
				request,
			),
		).rejects.toMatchObject({ code: "AI_TIMEOUT" });
		await expect(
			new DeterministicTextProvider({
				snapshot,
				scenario: "timeout_uncertain",
			}).generate(request),
		).rejects.toMatchObject({ code: "AI_TIMEOUT_UNCERTAIN" });
		await expect(
			new DeterministicTextProvider({
				snapshot,
				scenario: "provider_error",
			}).generate(request),
		).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });
	});

	it("does not validate cross-references against missing or invalid partial sections", () => {
		const output = validateScriptDraftOutput(
			{
				schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
				language: "vi-VN",
				scenes: [
					{
						order: 1,
						durationSeconds: 30,
						visualDirection: "x",
						onScreenText: null,
						voiceoverSegmentKeys: ["missing"],
					},
				],
				claims: [
					{
						text: "claim",
						occurrence: { section: "hook", hookKey: "missing" },
					},
				],
			},
			30,
		);
		expect(output.validSections).not.toContain("scenes");
		expect(output.validSections).not.toContain("claims");
	});

	it("normalizes hashtag uniqueness case-insensitively and audits duplicate scene refs", () => {
		const output = validateScriptDraftOutput(
			{
				schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
				language: "vi-VN",
				voiceoverSegments: [{ key: "a", text: "x" }],
				scenes: [
					{
						order: 1,
						durationSeconds: 30,
						visualDirection: "x",
						onScreenText: null,
						voiceoverSegmentKeys: ["a", "a"],
					},
				],
				hashtags: [" #Review ", "#review"],
			},
			30,
		);
		expect(output.validSections).not.toContain("scenes");
		expect(output.validSections).not.toContain("hashtags");
	});

	it("accepts only the requested sections in a repair payload", () => {
		const valid = validateRepairScriptOutput(
			{
				schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
				language: "vi-VN",
				claims: [],
			},
			["claims"],
		);
		const extra = validateRepairScriptOutput(
			{
				schemaVersion: SCRIPT_OUTPUT_SCHEMA_VERSION,
				language: "vi-VN",
				claims: [],
				hookVariants: [{ key: "a", text: "not allowed" }],
			},
			["claims"],
		);
		expect(valid.success).toBe(true);
		expect(extra.success).toBe(false);
	});
});

describe("AFF-US-008 Phase 2A final hardening", () => {
	it("enforces output language and the configured disclosure", async () => {
		const output = await buildDeterministicOutput();

		expect(
			validateScriptDraftOutput(output, 30, null, {
				expectedLanguage: "en-US",
			}).status,
		).toBe("failed");

		const wrongDisclosure = {
			...output,
			disclosure: "Đây là một chính sách disclosure khác.",
		};
		const validation = validateScriptDraftOutput(wrongDisclosure, 30, null, {
			requiredDisclosure: snapshot.channelSettings.affiliateDisclosure,
		});
		expect(validation.status).toBe("partial");
		expect(validation.invalidSections).toContain("disclosure");

		const missingDisclosure = { ...output };
		delete missingDisclosure.disclosure;
		const missingValidation = validateScriptDraftOutput(
			missingDisclosure,
			30,
			null,
			{ requiredDisclosure: snapshot.channelSettings.affiliateDisclosure },
		);
		expect(missingValidation.status).toBe("partial");
		expect(missingValidation.invalidSections).toContain("disclosure");
	});

	it("enforces avoidWords with Unicode-safe case normalization", async () => {
		const output = await buildDeterministicOutput();
		const forbiddenCaption = {
			...output,
			caption: "Sản phẩm KHẨN CẤP cần được kiểm tra thêm.",
		};
		const validation = validateScriptDraftOutput(forbiddenCaption, 30, null, {
			avoidWords: ["khẩn cấp"],
		});
		expect(validation.status).toBe("partial");
		expect(validation.validSections).not.toContain("caption");
		expect(validation.invalidSections).toContain("caption");
	});

	it("includes only ready media with owned or licensed rights", () => {
		const baseMedia = {
			id: "media-1",
			mediaType: "image" as const,
			aspectRatio: "9:16",
			durationSeconds: null,
			sceneSuitability: "product",
			tags: [],
			reference: { displayName: "Product image", referenceUrl: null },
		};
		expect(
			isUsableMediaMetadata({
				...baseMedia,
				status: "ready",
				usageRights: "owned",
			}),
		).toBe(true);
		expect(
			isUsableMediaMetadata({
				...baseMedia,
				status: "ready",
				usageRights: "licensed",
			}),
		).toBe(true);
		for (const media of [
			{ status: "archived" as const, usageRights: "owned" as const },
			{ status: "needs_review" as const, usageRights: "licensed" as const },
			{ status: "ready" as const, usageRights: "restricted" as const },
			{ status: "ready" as const, usageRights: "unknown" as const },
		]) {
			expect(isUsableMediaMetadata({ ...baseMedia, ...media })).toBe(false);
		}
		expect(snapshot.mediaMetadata).toEqual([]);
	});

	it("preserves parent root metadata and every valid section during repair", async () => {
		const fullOutput = await buildDeterministicOutput();
		const parentOutput: PartialScriptDraft = { ...fullOutput };
		delete parentOutput.scenes;
		const parentBeforeRepair = structuredClone(parentOutput);
		const repairOutput: PartialScriptDraft = {
			schemaVersion: fullOutput.schemaVersion,
			language: fullOutput.language,
			scenes: fullOutput.scenes,
		};
		const merged = mergeRepairScriptOutput(
			parentOutput,
			[
				"hook",
				"voiceover",
				"cta",
				"caption",
				"hashtags",
				"disclosure",
				"claims",
			],
			["scenes"],
			repairOutput,
		);

		expect(merged).not.toBeNull();
		if (!merged) return;
		expect(merged.output.schemaVersion).toBe(parentOutput.schemaVersion);
		expect(merged.output.language).toBe(parentOutput.language);
		expect(merged.output.hookVariants).toEqual(parentOutput.hookVariants);
		expect(merged.output.voiceoverSegments).toEqual(
			parentOutput.voiceoverSegments,
		);
		expect(merged.output.cta).toEqual(parentOutput.cta);
		expect(merged.output.caption).toBe(parentOutput.caption);
		expect(merged.output.hashtags).toEqual(parentOutput.hashtags);
		expect(merged.output.disclosure).toBe(parentOutput.disclosure);
		expect(merged.output.claims).toEqual(parentOutput.claims);
		expect(merged.output.scenes).toEqual(repairOutput.scenes);
		expect(parentOutput).toEqual(parentBeforeRepair);
	});

	it("keeps estimate persistence failures outside the provider error boundary", async () => {
		const provider = new DeterministicTextProvider({ snapshot });
		const estimate = {
			estimatedCostMicros: BigInt(1),
			currency: "VND",
			inputTokens: 1,
			pricingBasis: "test",
		};
		const finalize = vi.fn(async () => makeGeneration());
		const run = vi.fn(async () => makeGeneration());

		await expect(
			executePreparedGeneration(
				actor,
				{ provider: "deterministic" },
				makeGeneration(),
				{
					resolveProvider: () => provider,
					estimate: async () => estimate,
					recordEstimate: async () => {
						throw new Error("database estimate write failed");
					},
					run,
					finalize,
				},
			),
		).rejects.toThrow("database estimate write failed");
		expect(run).not.toHaveBeenCalled();
		expect(finalize).not.toHaveBeenCalled();
	});

	it("propagates finalize persistence failures without a second finalize", async () => {
		const result: TextProviderResult = {
			content: {},
			providerRequestId: "provider-request-1",
			inputTokens: 1,
			outputTokens: 1,
			estimatedCostMicros: BigInt(1),
			actualCostMicros: BigInt(1),
			currency: "VND",
		};
		const provider: TextProvider = {
			name: "test-provider",
			estimateCost: async () => ({
				estimatedCostMicros: BigInt(1),
				currency: "VND",
				inputTokens: 1,
				pricingBasis: "test",
			}),
			generate: async () => result,
		};
		const finalize = vi.fn(async () => {
			throw new Error("database finalize failed");
		});

		await expect(
			runPreparedScriptGeneration(actor, makeGeneration(), provider, finalize),
		).rejects.toThrow("database finalize failed");
		expect(finalize).toHaveBeenCalledTimes(1);
	});

	it.each([
		["provider_error", "AI_PROVIDER_ERROR"],
		["timeout_uncertain", "AI_REQUEST_STATE_UNCERTAIN"],
	] as const)("preserves %s provider semantics", async (scenario, code) => {
		const provider = new DeterministicTextProvider({ snapshot, scenario });
		const finalize = vi.fn(async () => makeGeneration());

		await runPreparedScriptGeneration(
			actor,
			makeGeneration(),
			provider,
			finalize,
		);
		expect(finalize).toHaveBeenCalledWith(actor, {
			generationId: "generation-1",
			outcome: { kind: "failure", code },
		});
	});

	it("finalizes provider resolution and estimate preflight failures once", async () => {
		const provider = new DeterministicTextProvider({ snapshot });
		for (const [phase, error] of [
			[
				"resolve",
				new ScriptGenerationError(
					"TEXT_PROVIDER_UNAVAILABLE",
					"provider unavailable",
				),
			],
			[
				"estimate",
				new ScriptGenerationError(
					"COST_ESTIMATE_UNAVAILABLE",
					"estimate unavailable",
				),
			],
		] as const) {
			const finalize = vi.fn(async () => makeGeneration());
			const dependencies =
				phase === "resolve"
					? {
							resolveProvider: () => {
								throw error;
							},
							estimate: async () => ({
								estimatedCostMicros: BigInt(1),
								currency: "VND",
								inputTokens: 1,
								pricingBasis: "test",
							}),
							recordEstimate: async () => makeGeneration(),
							run: async () => makeGeneration(),
							finalize,
						}
					: {
							resolveProvider: () => provider,
							estimate: async () => {
								throw error;
							},
							recordEstimate: async () => makeGeneration(),
							run: async () => makeGeneration(),
							finalize,
						};
			await expect(
				executePreparedGeneration(
					actor,
					{ provider: "deterministic" },
					makeGeneration(),
					dependencies,
				),
			).rejects.toMatchObject({ code: error.code });
			expect(finalize).toHaveBeenCalledTimes(1);
		}
	});
});

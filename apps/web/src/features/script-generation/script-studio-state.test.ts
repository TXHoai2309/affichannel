import type {
	ScriptGenerationArtifact,
	ScriptGenerationContext,
	ScriptGenerationReadModel,
} from "@affichannel/core/script-generation/types";
import type { ScriptVersionReadModel } from "@affichannel/core/script-version/types";
import { describe, expect, it } from "vitest";

import {
	canRepairSection,
	formatEstimatedCost,
	getEstimateViewState,
	getLatestUsableArtifact,
	getPersistedScriptGenerationErrorMessage,
	getScriptGenerationErrorMessage,
	getStudioStatus,
	hasNewerScriptGeneration,
	hasUsableFacts,
	isGenerationContextReady,
	isLatestUsableArtifactInvalidated,
} from "./script-studio-state";

const context: ScriptGenerationContext = {
	project: { id: "project-1", name: "Project 1" },
	contentBrief: {
		platform: "tiktok",
		goal: "Tạo nội dung",
		durationSeconds: 30,
		angle: "Trải nghiệm",
		description: null,
	},
	product: { id: "product-1", name: "Sản phẩm 1", category: null },
	channelSettings: {
		niche: "Công nghệ",
		targetAudience: "Người mua",
		tone: "Tự nhiên",
		contentPillar: "Review",
		defaultCta: "Xem thêm",
		affiliateDisclosure: "Đây là nội dung tiếp thị liên kết.",
		avoidWords: [],
	},
	mediaMetadata: [],
	outputRules: {
		language: "vi-VN",
		aspectRatio: "9:16",
		subtitleSafeArea: "standard",
		claimLimit: null,
		requireFinalCta: true,
	},
	generationConfig: {
		textProvider: "deterministic",
		textModel: "test-model",
		promptVersion: "test-prompt",
		outputSchemaVersion: "test-output",
	},
	facts: [
		{
			id: "fact-1",
			revision: 1,
			content: "Fact đủ điều kiện",
			type: "feature",
			assessment: {
				verification: "verified",
				evidence: "complete",
				freshness: "fresh",
				freshnessReason: "within_policy",
			},
			generationUsability: "allowed",
			source: {
				type: "official",
				label: "Nguồn chính thức",
				url: null,
				confirmedAt: "2026-08-16",
				expiresAt: null,
			},
		},
	],
};

function makeArtifact(
	overrides: Partial<ScriptGenerationArtifact> = {},
): ScriptGenerationArtifact {
	return {
		id: "generation-a",
		workspaceId: "workspace-1",
		projectId: "project-1",
		createdByUserId: "user-1",
		idempotencyKey: "script-studio-generate-a",
		requestHash: "request-hash",
		parentGenerationId: null,
		mode: "full",
		provider: "deterministic",
		model: "test-model",
		promptVersion: "test-prompt",
		outputSchemaVersion: "test-output",
		inputSnapshot: {
			snapshotVersion: "test",
			request: { mode: "full", repair: null },
			...context,
			channelSettings: context.channelSettings as NonNullable<
				ScriptGenerationContext["channelSettings"]
			>,
		},
		inputHash: "input-hash",
		promptHash: "prompt-hash",
		status: "completed",
		output: {
			schemaVersion: "test-output",
			language: "vi-VN",
		},
		validSections: [],
		invalidSections: [],
		providerRequestId: null,
		inputTokens: null,
		outputTokens: null,
		estimatedCostMicros: null,
		actualCostMicros: null,
		currency: null,
		errorCode: null,
		finishedAt: new Date("2026-08-16T00:00:00.000Z"),
		createdAt: new Date("2026-08-16T00:00:00.000Z"),
		...overrides,
	};
}

function makeModel(
	overrides: Partial<ScriptGenerationReadModel> = {},
): ScriptGenerationReadModel {
	return {
		context,
		latestRequest: null,
		latestUsableArtifact: null,
		dependencyState: null,
		...overrides,
	};
}

describe("Script Studio state", () => {
	it("keeps the latest usable artifact visible when a newer request is pending", () => {
		const usable = makeArtifact();
		const model = makeModel({
			latestRequest: makeArtifact({ id: "generation-b", status: "pending" }),
			latestUsableArtifact: usable,
		});

		expect(getStudioStatus(model)).toBe("pending");
		expect(getLatestUsableArtifact(model)?.id).toBe("generation-a");
	});

	it("detects a newer generation without changing the current ScriptVersion draft", () => {
		const draft = {
			id: "draft-1",
			workspaceId: "workspace-1",
			projectId: "project-1",
			sourceGenerationId: "generation-a",
			status: "draft" as const,
			versionNumber: null,
			editableSnapshot: {},
			revision: 3,
			restoredFromVersionId: null,
			createdByUserId: "user-1",
			createdAt: new Date("2026-08-17T00:00:00.000Z"),
			updatedAt: new Date("2026-08-17T00:00:00.000Z"),
			savedAt: null,
		} as ScriptVersionReadModel;
		const newer = makeArtifact({ id: "generation-b" });

		expect(hasNewerScriptGeneration(draft, newer)).toBe(true);
		expect(
			hasNewerScriptGeneration(draft, makeArtifact({ id: "generation-a" })),
		).toBe(false);
		expect(hasNewerScriptGeneration(null, newer)).toBe(false);
	});

	it.each(["failed", "indeterminate"] as const)(
		"keeps the usable artifact visible when a newer request is %s",
		(status) => {
			const model = makeModel({
				latestRequest: makeArtifact({ id: "generation-b", status }),
				latestUsableArtifact: makeArtifact(),
			});

			expect(getStudioStatus(model)).toBe(status);
			expect(getLatestUsableArtifact(model)?.id).toBe("generation-a");
		},
	);

	it("keeps a partial usable artifact visible for an indeterminate retry", () => {
		const partial = makeArtifact({
			status: "partial",
			validSections: ["hook", "voiceover", "cta"],
			invalidSections: ["scenes", "claims"],
		});
		const model = makeModel({
			latestRequest: makeArtifact({
				id: "generation-b",
				status: "indeterminate",
			}),
			latestUsableArtifact: partial,
		});

		expect(getStudioStatus(model)).toBe("indeterminate");
		expect(getLatestUsableArtifact(model)).toMatchObject({
			id: "generation-a",
			status: "partial",
		});
	});

	it("blocks repair when a partial artifact is invalidated", () => {
		const model = makeModel({
			latestUsableArtifact: makeArtifact({
				status: "partial",
				invalidSections: ["scenes"],
			}),
			dependencyState: { state: "invalidated", invalidatedFactCount: 1 },
		});

		expect(isLatestUsableArtifactInvalidated(model)).toBe(true);
		expect(canRepairSection(model, "scenes")).toBe(false);
	});

	it("allows repair for an invalid section while dependency is current", () => {
		const model = makeModel({
			latestUsableArtifact: makeArtifact({
				status: "partial",
				invalidSections: ["scenes"],
			}),
			dependencyState: { state: "current", invalidatedFactCount: 0 },
		});

		expect(isLatestUsableArtifactInvalidated(model)).toBe(false);
		expect(canRepairSection(model, "scenes")).toBe(true);
		expect(canRepairSection(model, "claims")).toBe(false);
	});

	it("only enables generation context when facts and channel settings are ready", () => {
		expect(isGenerationContextReady(makeModel())).toBe(true);
		expect(
			isGenerationContextReady(
				makeModel({
					context: { ...context, channelSettings: null },
				}),
			),
		).toBe(false);
	});

	it("blocks generation when no Fact is usable", () => {
		const blockedContext = {
			...context,
			facts: context.facts.map((fact) => ({
				...fact,
				generationUsability: "blocked" as const,
			})),
		};
		expect(hasUsableFacts(makeModel({ context: blockedContext }))).toBe(false);
		expect(hasUsableFacts(makeModel())).toBe(true);
	});

	it("models estimate loading, success, error and blocked states", () => {
		expect(
			getEstimateViewState({
				enabled: false,
				isFetching: false,
				isError: false,
				hasData: false,
			}),
		).toBe("blocked");
		expect(
			getEstimateViewState({
				enabled: true,
				isFetching: true,
				isError: false,
				hasData: false,
			}),
		).toBe("loading");
		expect(
			getEstimateViewState({
				enabled: true,
				isFetching: false,
				isError: false,
				hasData: true,
			}),
		).toBe("success");
		expect(
			getEstimateViewState({
				enabled: true,
				isFetching: false,
				isError: true,
				hasData: false,
			}),
		).toBe("error");
	});

	it("formats the provider currency without inventing a currency or zero", () => {
		expect(formatEstimatedCost(BigInt(27_000), "CNY")).toContain("¥");
		expect(formatEstimatedCost(null, "CNY")).toBeNull();
		expect(formatEstimatedCost(BigInt(0), null)).toBeNull();
	});

	it("maps provider and domain errors to safe Vietnamese copy", () => {
		expect(
			getScriptGenerationErrorMessage({ data: { code: "AI_PROVIDER_ERROR" } }),
		).toBe("Nhà cung cấp AI chưa hoàn tất yêu cầu.");
		expect(
			getScriptGenerationErrorMessage(new Error("raw provider body")),
		).not.toContain("raw provider body");
		expect(
			getScriptGenerationErrorMessage({
				data: { code: "AI_INVALID_OUTPUT:ROOT_NOT_JSON" },
			}),
		).toBe("AI trả về nội dung chưa đạt cấu trúc kịch bản.");
	});

	it("surfaces the persisted failed-request error without a mutation exception", () => {
		const failed = makeArtifact({
			status: "failed",
			output: null,
			errorCode: "AI_INVALID_OUTPUT",
		});

		expect(getPersistedScriptGenerationErrorMessage(failed)).toBe(
			"AI trả về nội dung chưa đạt cấu trúc kịch bản.",
		);
		expect(
			getPersistedScriptGenerationErrorMessage(
				makeArtifact({
					status: "failed",
					output: null,
					errorCode: "AI_OUTPUT_TRUNCATED",
				}),
			),
		).toContain("chạm giới hạn độ dài");
	});

	it.each(["pending", "indeterminate", "completed", "partial"] as const)(
		"does not treat %s as a persisted failed-request message",
		(status) => {
			expect(
				getPersistedScriptGenerationErrorMessage(
					makeArtifact({ status, errorCode: "AI_INVALID_OUTPUT" }),
				),
			).toBeNull();
		},
	);
});

import {
	scriptClaimRefreshInputSchema,
	toPublicScriptClaimRefreshResult,
	toScriptClaimRefreshPublicError,
} from "@affichannel/api/services/script-claim-refresh-public";
import { ScriptClaimRefreshRepositoryError } from "@affichannel/api/services/script-claim-refresh-repository";
import {
	type ScriptClaimRefreshExecutionResult,
	ScriptClaimRefreshServiceError,
} from "@affichannel/api/services/script-claim-refresh-service";
import type {
	ScriptClaimRefreshRun,
	ScriptVersionEditableSnapshot,
	ScriptVersionReadModel,
} from "@affichannel/core";
import { describe, expect, it } from "vitest";

const snapshot: ScriptVersionEditableSnapshot = {
	schemaVersion: "script-draft.v2",
	language: "vi-VN",
	hookVariants: [{ key: "hook-1", text: "Hook hiện tại" }],
	selectedHookKey: "hook-1",
	voiceoverSegments: [{ key: "voice-1", text: "Voice hiện tại" }],
	scenes: [
		{
			order: 1,
			durationSeconds: 5,
			visualDirection: "Visual",
			onScreenText: "Text",
			voiceoverSegmentKeys: ["voice-1"],
		},
	],
	cta: { text: "CTA" },
	caption: "Caption",
	hashtags: ["#current"],
	disclosure: "Disclosure",
	claims: [],
	claimsSourceRevision: 2,
	claimsStatus: "current",
};

const scriptVersion: ScriptVersionReadModel = {
	id: "script-version-1",
	workspaceId: "workspace-1",
	projectId: "project-1",
	sourceGenerationId: "generation-1",
	status: "draft",
	versionNumber: null,
	editableSnapshot: snapshot,
	revision: 2,
	restoredFromVersionId: null,
	createdByUserId: "user-1",
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	savedAt: null,
};

const completedRun: ScriptClaimRefreshRun = {
	id: "run-1",
	workspaceId: "workspace-1",
	projectId: "project-1",
	scriptVersionId: scriptVersion.id,
	sourceScriptRevision: 1,
	idempotencyKey: "private-key-123",
	requestHash: "a".repeat(64),
	inputSnapshotJson: { private: true },
	inputHash: "b".repeat(64),
	sourceContentHash: "c".repeat(64),
	promptHash: "d".repeat(64),
	provider: "private-provider",
	model: "private-model",
	promptVersion: "private-prompt",
	outputSchemaVersion: "private-output",
	status: "completed",
	providerRequestId: "private-provider-request",
	inputTokens: 1,
	outputTokens: 2,
	estimatedCostMicros: BigInt(3),
	actualCostMicros: BigInt(3),
	currency: "USD",
	errorCode: null,
	errorMessage: null,
	executionClaimedAt: new Date("2026-01-01T00:00:00.000Z"),
	createdByUserId: "user-1",
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	finishedAt: new Date("2026-01-01T00:01:00.000Z"),
	resultScriptRevision: 2,
};

function expectOrpcError(action: () => never, code: string, message: string) {
	try {
		action();
	} catch (error) {
		expect(error).toMatchObject({ code, message });
		return;
	}
	throw new Error("Expected an ORPC error.");
}

describe("CR-C public Claim Refresh boundary", () => {
	it("accepts only the strict public mutation input", () => {
		const parsed = scriptClaimRefreshInputSchema.safeParse({
			projectId: "project-1",
			scriptVersionId: "script-version-1",
			expectedScriptVersionRevision: 1,
			idempotencyKey: "claim-refresh-1",
		});
		expect(parsed.success).toBe(true);
		expect(
			scriptClaimRefreshInputSchema.safeParse({
				projectId: "project-1",
				scriptVersionId: "script-version-1",
				expectedScriptVersionRevision: 1,
				idempotencyKey: "claim-refresh-1",
				workspaceId: "should-not-be-accepted",
			}).success,
		).toBe(false);
	});

	it("returns a sanitized completed DTO without internal runtime fields", () => {
		const internal: ScriptClaimRefreshExecutionResult = {
			kind: "completed",
			run: completedRun,
			resultingScriptVersion: scriptVersion,
		};
		const result = toPublicScriptClaimRefreshResult(internal);
		expect(result).toEqual({
			kind: "completed",
			runId: "run-1",
			status: "completed",
			resultScriptRevision: 2,
			scriptVersion,
		});
		for (const privateField of [
			"idempotencyKey",
			"requestHash",
			"inputHash",
			"sourceContentHash",
			"promptHash",
			"inputSnapshotJson",
			"providerRequestId",
			"provider",
			"model",
		]) {
			expect(result).not.toHaveProperty(privateField);
		}
	});

	it("returns sanitized failed and indeterminate terminal DTOs", () => {
		const failed = toPublicScriptClaimRefreshResult({
			kind: "failed",
			run: {
				...completedRun,
				status: "failed",
				errorCode: "SCRIPT_CLAIM_REFRESH_PROVIDER_FAILED",
			},
		});
		const indeterminate = toPublicScriptClaimRefreshResult({
			kind: "indeterminate",
			run: {
				...completedRun,
				status: "indeterminate",
				errorCode: "SCRIPT_CLAIM_REFRESH_PROVIDER_INDETERMINATE",
			},
		});

		expect(failed).toEqual({
			kind: "failed",
			runId: "run-1",
			status: "failed",
			errorCode: "SCRIPT_CLAIM_REFRESH_PROVIDER_FAILED",
		});
		expect(indeterminate).toEqual({
			kind: "indeterminate",
			runId: "run-1",
			status: "indeterminate",
			errorCode: "SCRIPT_CLAIM_REFRESH_PROVIDER_INDETERMINATE",
		});
	});

	it("uses one non-enumerating error for cross-scope resources", () => {
		for (const code of [
			"SCRIPT_CLAIM_REFRESH_PROJECT_NOT_FOUND",
			"SCRIPT_CLAIM_REFRESH_SOURCE_NOT_FOUND",
			"SCRIPT_CLAIM_REFRESH_PRODUCT_NOT_FOUND",
			"SCRIPT_CLAIM_REFRESH_NOT_FOUND",
		] as const) {
			expectOrpcError(
				() =>
					toScriptClaimRefreshPublicError(
						code === "SCRIPT_CLAIM_REFRESH_NOT_FOUND"
							? new ScriptClaimRefreshRepositoryError(code)
							: new ScriptClaimRefreshServiceError(code),
					),
				"NOT_FOUND",
				"SCRIPT_CLAIM_REFRESH_NOT_FOUND",
			);
		}
	});

	it("maps revision and idempotency conflicts without storage details", () => {
		for (const code of [
			"SCRIPT_CLAIM_REFRESH_SOURCE_REVISION_CONFLICT",
			"SCRIPT_CLAIM_REFRESH_SOURCE_CHANGED",
			"SCRIPT_CLAIM_REFRESH_IDEMPOTENCY_CONFLICT",
		] as const) {
			expectOrpcError(
				() =>
					toScriptClaimRefreshPublicError(
						code === "SCRIPT_CLAIM_REFRESH_IDEMPOTENCY_CONFLICT"
							? new ScriptClaimRefreshRepositoryError(code)
							: new ScriptClaimRefreshServiceError(code),
					),
				"CONFLICT",
				code,
			);
		}
	});
});

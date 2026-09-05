import { FactLockGate } from "@affichannel/api/services/fact-lock-gate-service";
import { getProjectWorkflowSubject } from "@affichannel/api/services/project-repository";
import { findCurrentScriptVersion } from "@affichannel/api/services/script-version-repository";
import { resolveVoicePaidExecutionAuthorization } from "@affichannel/api/services/voice-paid-authorization-service";
import type { FactLockError } from "@affichannel/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@affichannel/api/services/fact-lock-gate-service", () => ({
	FactLockGate: { evaluate: vi.fn() },
}));
vi.mock("@affichannel/api/services/project-repository", () => ({
	getProjectWorkflowSubject: vi.fn(),
}));
vi.mock("@affichannel/api/services/script-version-repository", () => ({
	findCurrentScriptVersion: vi.fn(),
}));

const evaluateGate = vi.mocked(FactLockGate.evaluate);
const findSubject = vi.mocked(getProjectWorkflowSubject);
const findScript = vi.mocked(findCurrentScriptVersion);
const actor = { workspaceId: "workspace-1", userId: "user-1" };
const projectId = "project-1";

function subject(
	contentType: "AFFILIATE" | "ORGANIC",
	productId: string | null = null,
) {
	return {
		id: projectId,
		contentType,
		creationPath: "SCRIPTED",
		contentFormatKey: "SCRIPTED_STANDARD",
		contentFormatVersion: 1,
		productId,
		productAccessible: productId !== null,
	};
}

function script(claims: unknown[] = []) {
	return {
		id: "script-1",
		revision: 1,
		editableSnapshot: {
			schemaVersion: "script-draft.v3",
			claimsStatus: "current",
			claims,
		},
	} as Awaited<ReturnType<typeof findCurrentScriptVersion>>;
}

function gate(reason: "FACT_LOCK_NOT_RUN" | "FACT_LOCK_PASSED") {
	return {
		allowed: reason === "FACT_LOCK_PASSED",
		reason,
		currentScriptVersionId: "script-1",
		currentScriptRevision: 1,
		factLockRunId: reason === "FACT_LOCK_PASSED" ? "run-1" : null,
		blockingRunStatus: null,
	};
}

describe("Voice paid execution authorization", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		findScript.mockResolvedValue(script());
		evaluateGate.mockResolvedValue(gate("FACT_LOCK_NOT_RUN"));
	});

	it("allows Organic claimless/general-only content without a Fact Lock run", async () => {
		findSubject.mockResolvedValue(subject("ORGANIC"));
		evaluateGate.mockRejectedValue(
			new Error("historical Fact Lock row must not be read"),
		);

		await expect(
			resolveVoicePaidExecutionAuthorization(actor, projectId),
		).resolves.toMatchObject({
			allowed: true,
			factLockRequirement: "NOT_REQUIRED",
			reasonCode: "FACT_LOCK_NOT_REQUIRED_NO_PRODUCT_CLAIMS",
		});
		expect(evaluateGate).not.toHaveBeenCalled();
	});

	it("does not read Fact Lock history for confirmed Organic GENERAL claims", async () => {
		findSubject.mockResolvedValue(subject("ORGANIC"));
		findScript.mockResolvedValue(
			script([
				{
					text: "Một thói quen hữu ích.",
					occurrence: { section: "caption" },
					subject: { kind: "GENERAL" },
					subjectStatus: "CONFIRMED",
					subjectSource: "USER",
				},
			]),
		);
		evaluateGate.mockRejectedValue(new Error("historical Fact Lock row"));

		await expect(
			resolveVoicePaidExecutionAuthorization(actor, projectId),
		).resolves.toMatchObject({
			allowed: true,
			factLockRequirement: "NOT_REQUIRED",
		});
		expect(evaluateGate).not.toHaveBeenCalled();
	});

	it("returns the Product path for an unbound Organic Product claim", async () => {
		findSubject.mockResolvedValue(subject("ORGANIC"));
		findScript.mockResolvedValue(
			script([
				{
					text: "Sản phẩm bền hơn",
					occurrence: { section: "caption" },
					subject: { kind: "PRODUCT", binding: "PROJECT_PRODUCT" },
					subjectStatus: "CONFIRMED",
					subjectSource: "USER",
				},
			]),
		);
		evaluateGate.mockRejectedValue(new Error("historical Fact Lock row"));

		await expect(
			resolveVoicePaidExecutionAuthorization(actor, projectId),
		).resolves.toMatchObject({
			allowed: false,
			reasonCode: "PRODUCT_REQUIRED_FOR_PRODUCT_CLAIMS",
			state: "BLOCKED",
		});
		expect(evaluateGate).not.toHaveBeenCalled();
	});

	it("returns the claims-refresh path before any Fact Lock history read", async () => {
		findSubject.mockResolvedValue(subject("ORGANIC"));
		const current = script();
		if (!current) throw new Error("Expected a current ScriptVersion fixture.");
		findScript.mockResolvedValue({
			...current,
			editableSnapshot: {
				...current.editableSnapshot,
				claimsStatus: "stale",
			},
		} as NonNullable<Awaited<ReturnType<typeof findCurrentScriptVersion>>>);
		evaluateGate.mockRejectedValue(new Error("historical Fact Lock row"));

		await expect(
			resolveVoicePaidExecutionAuthorization(actor, projectId),
		).resolves.toMatchObject({
			allowed: false,
			reasonCode: "SCRIPT_CLAIMS_NOT_CURRENT",
			state: "STALE",
		});
		expect(evaluateGate).not.toHaveBeenCalled();
	});

	it("blocks Organic Product claims until the current Fact Lock passes", async () => {
		findSubject.mockResolvedValue(subject("ORGANIC", "product-1"));
		findScript.mockResolvedValue(
			script([
				{
					text: "Sản phẩm bền hơn",
					occurrence: { section: "voiceover", segmentKey: "intro" },
					subject: { kind: "PRODUCT", binding: "PROJECT_PRODUCT" },
					subjectStatus: "CONFIRMED",
					subjectSource: "USER",
				},
			]),
		);

		await expect(
			resolveVoicePaidExecutionAuthorization(actor, projectId),
		).resolves.toMatchObject({
			allowed: false,
			factLockRequirement: "REQUIRED",
		});
		evaluateGate.mockResolvedValue(gate("FACT_LOCK_PASSED"));
		await expect(
			resolveVoicePaidExecutionAuthorization(actor, projectId),
		).resolves.toMatchObject({
			allowed: true,
			factLockRequirement: "SATISFIED",
		});
	});

	it("preserves Affiliate Fact Lock enforcement", async () => {
		findSubject.mockResolvedValue(subject("AFFILIATE", "product-1"));

		await expect(
			resolveVoicePaidExecutionAuthorization(actor, projectId),
		).resolves.toMatchObject({
			allowed: false,
			factLockRequirement: "REQUIRED",
		});

		evaluateGate.mockResolvedValue(gate("FACT_LOCK_PASSED"));
		await expect(
			resolveVoicePaidExecutionAuthorization(actor, projectId),
		).resolves.toMatchObject({
			allowed: true,
			factLockRequirement: "SATISFIED",
		});
	});

	it("fails closed for an inaccessible project", async () => {
		findSubject.mockResolvedValue(undefined);
		await expect(
			resolveVoicePaidExecutionAuthorization(actor, projectId),
		).rejects.toMatchObject({
			code: "FACT_LOCK_NOT_FOUND",
		} satisfies Partial<FactLockError>);
	});
});

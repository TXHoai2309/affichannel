import {
	evaluateFactLockGate,
	type FactLockGateEvaluationInput,
} from "@affichannel/core/fact-lock/gate";
import type { ScriptVersionEditableSnapshot } from "@affichannel/core/script-version/types";
import { describe, expect, it } from "vitest";

const snapshot: ScriptVersionEditableSnapshot = {
	schemaVersion: "script-draft.v2",
	language: "vi-VN",
	hookVariants: [
		{ key: "hook-a", text: "Bạn có biết sản phẩm này hữu ích thế nào?" },
		{ key: "hook-b", text: "Một lựa chọn đáng cân nhắc cho bạn." },
		{ key: "hook-c", text: "Thử ngay trải nghiệm mới." },
	],
	selectedHookKey: "hook-a",
	voiceoverSegments: [
		{ key: "intro", text: "Đây là phần giới thiệu sản phẩm." },
	],
	scenes: [
		{
			order: 1,
			durationSeconds: 10,
			visualDirection: "Cận cảnh sản phẩm",
			onScreenText: "Thông tin sản phẩm",
			voiceoverSegmentKeys: ["intro"],
		},
	],
	cta: { text: "Xem thêm thông tin nhé." },
	caption: "Một gợi ý cho ngày hôm nay.",
	hashtags: ["#review"],
	disclosure: "Nội dung có liên kết affiliate.",
	claims: [],
	claimsSourceRevision: 1,
	claimsStatus: "current",
};

function input(
	overrides: Partial<FactLockGateEvaluationInput> = {},
): FactLockGateEvaluationInput {
	return {
		currentScriptVersion: {
			id: "script-1",
			revision: 4,
			snapshot,
		},
		runs: [],
		...overrides,
	};
}

function run(
	status: "pending" | "review_required" | "passed" | "failed" | "indeterminate",
	overrides: Partial<FactLockGateEvaluationInput["runs"][number]> = {},
) {
	const base: FactLockGateEvaluationInput["runs"][number] = {
		id: `run-${status}`,
		inputMode: "LEGACY",
		scriptVersionId: "script-1",
		sourceScriptRevision: 4,
		sourceCurrent: true,
		status,
		dependenciesCurrent: true,
		createdAt: "2026-08-18T00:00:00.000Z",
	};
	return { ...base, ...overrides };
}

function manifestRun(
	status: "pending" | "review_required" | "passed" | "failed" | "indeterminate",
	overrides: Partial<FactLockGateEvaluationInput["runs"][number]> = {},
) {
	return run(status, { inputMode: "MANIFEST_V1", ...overrides });
}

describe("FactLockGate", () => {
	it("blocks without a current ScriptVersion or Fact Lock run", () => {
		expect(
			evaluateFactLockGate({ currentScriptVersion: null, runs: [] }).reason,
		).toBe("NO_SCRIPT_VERSION");
		expect(evaluateFactLockGate(input()).reason).toBe("FACT_LOCK_NOT_RUN");
	});

	it("allows only a current, dependency-safe passed run", () => {
		expect(
			evaluateFactLockGate(input({ runs: [run("passed")] })),
		).toMatchObject({ allowed: true, reason: "FACT_LOCK_PASSED" });
	});

	it("covers pending, review, failed and indeterminate states", () => {
		for (const [status, reason] of [
			["pending", "FACT_LOCK_PENDING"],
			["review_required", "FACT_LOCK_REVIEW_REQUIRED"],
			["failed", "FACT_LOCK_FAILED"],
			["indeterminate", "FACT_LOCK_INDETERMINATE"],
		] as const) {
			expect(evaluateFactLockGate(input({ runs: [run(status)] })).reason).toBe(
				reason,
			);
		}
	});

	it("prioritizes stale script and stale facts before downstream access", () => {
		expect(
			evaluateFactLockGate(
				input({
					runs: [run("passed", { sourceScriptRevision: 3 })],
				}),
			).reason,
		).toBe("FACT_LOCK_STALE_SCRIPT");
		expect(
			evaluateFactLockGate(
				input({
					runs: [run("passed", { dependenciesCurrent: false })],
				}),
			).reason,
		).toBe("FACT_LOCK_STALE_FACTS");
	});

	it("prefers a current PASS over a historical PASS", () => {
		const historicalPass = run("passed", {
			id: "run-pass-rev-1",
			scriptVersionId: "script-1",
			sourceScriptRevision: 3,
			createdAt: "2026-08-18T00:01:00.000Z",
		});
		const currentPass = run("passed", {
			id: "run-pass-rev-2",
			createdAt: "2026-08-18T00:02:00.000Z",
		});

		expect(
			evaluateFactLockGate(input({ runs: [historicalPass, currentPass] })),
		).toMatchObject({
			allowed: true,
			reason: "FACT_LOCK_PASSED",
			factLockRunId: currentPass.id,
		});
	});

	it("uses historical PASS only when the current revision has no result", () => {
		const historicalPass = run("passed", {
			id: "run-pass-rev-1",
			sourceScriptRevision: 3,
		});

		expect(
			evaluateFactLockGate(input({ runs: [historicalPass] })),
		).toMatchObject({
			allowed: false,
			reason: "FACT_LOCK_STALE_SCRIPT",
			factLockRunId: historicalPass.id,
		});
	});

	it("prefers a current failed or indeterminate retry over an old PASS", () => {
		const historicalPass = run("passed", {
			id: "run-pass-rev-1",
			sourceScriptRevision: 3,
			createdAt: "2026-08-18T00:01:00.000Z",
		});
		const currentFailed = run("failed", {
			id: "run-failed-rev-2",
			createdAt: "2026-08-18T00:02:00.000Z",
		});
		const currentIndeterminate = run("indeterminate", {
			id: "run-indeterminate-rev-2",
			createdAt: "2026-08-18T00:02:00.000Z",
		});

		expect(
			evaluateFactLockGate(input({ runs: [historicalPass, currentFailed] })),
		).toMatchObject({ allowed: false, reason: "FACT_LOCK_FAILED" });
		expect(
			evaluateFactLockGate(
				input({ runs: [historicalPass, currentIndeterminate] }),
			),
		).toMatchObject({
			allowed: false,
			reason: "FACT_LOCK_INDETERMINATE",
		});
	});

	it("does not hide an applicable PASS behind a failed or indeterminate retry", () => {
		const passed = run("passed");
		const failed = run("failed", {
			id: "run-failed",
			createdAt: "2026-08-18T00:01:00.000Z",
		});
		const indeterminate = run("indeterminate", {
			id: "run-indeterminate",
			createdAt: "2026-08-18T00:02:00.000Z",
		});
		expect(
			evaluateFactLockGate(input({ runs: [indeterminate, failed, passed] })),
		).toMatchObject({
			allowed: true,
			reason: "FACT_LOCK_PASSED",
			factLockRunId: passed.id,
		});
	});

	it("does not hide a new current PASS behind an older stale-facts result", () => {
		const stalePass = run("passed", {
			id: "run-stale-facts",
			dependenciesCurrent: false,
			createdAt: "2026-08-18T00:01:00.000Z",
		});
		const currentPass = run("passed", {
			id: "run-current-facts",
			createdAt: "2026-08-18T00:02:00.000Z",
		});

		expect(
			evaluateFactLockGate(input({ runs: [stalePass, currentPass] })),
		).toMatchObject({
			allowed: true,
			reason: "FACT_LOCK_PASSED",
			factLockRunId: currentPass.id,
		});
	});

	it("reports script readiness separately from stale claims", () => {
		const malformed = { ...snapshot, selectedHookKey: null };
		expect(
			evaluateFactLockGate(
				input({
					currentScriptVersion: {
						id: "script-1",
						revision: 4,
						snapshot: malformed,
					},
				}),
			).reason,
		).toBe("SCRIPT_NOT_READY");
		expect(
			evaluateFactLockGate(
				input({
					currentScriptVersion: {
						id: "script-1",
						revision: 5,
						snapshot: { ...snapshot, claimsStatus: "stale" },
					},
					runs: [run("passed", { sourceScriptRevision: 4 })],
				}),
			).reason,
		).toBe("FACT_LOCK_STALE_SCRIPT");
	});

	it("applies the same pure gate contract to Manifest runs", () => {
		for (const [status, reason] of [
			["pending", "FACT_LOCK_PENDING"],
			["review_required", "FACT_LOCK_REVIEW_REQUIRED"],
			["failed", "FACT_LOCK_FAILED"],
			["indeterminate", "FACT_LOCK_INDETERMINATE"],
		] as const) {
			expect(
				evaluateFactLockGate(input({ runs: [manifestRun(status)] })).reason,
			).toBe(reason);
		}
		expect(
			evaluateFactLockGate(input({ runs: [manifestRun("passed")] })),
		).toMatchObject({ allowed: true, reason: "FACT_LOCK_PASSED" });
	});

	it("blocks a Manifest result when source or facts are stale", () => {
		expect(
			evaluateFactLockGate(
				input({ runs: [manifestRun("passed", { sourceCurrent: false })] }),
			),
		).toMatchObject({ reason: "FACT_LOCK_STALE_SCRIPT", allowed: false });
		expect(
			evaluateFactLockGate(
				input({
					runs: [manifestRun("passed", { dependenciesCurrent: false })],
				}),
			),
		).toMatchObject({ reason: "FACT_LOCK_STALE_FACTS", allowed: false });
	});

	it("keeps mixed legacy and Manifest history deterministic", () => {
		const legacy = run("passed", {
			id: "legacy-current",
			createdAt: "2026-08-18T00:01:00.000Z",
		});
		const manifest = manifestRun("passed", {
			id: "manifest-current",
			createdAt: "2026-08-18T00:02:00.000Z",
		});
		expect(
			evaluateFactLockGate(input({ runs: [legacy, manifest] })),
		).toMatchObject({
			allowed: true,
			reason: "FACT_LOCK_PASSED",
			factLockRunId: manifest.id,
		});
	});
});

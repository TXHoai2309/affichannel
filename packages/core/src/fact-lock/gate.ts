import type { ScriptVersionEditableSnapshot } from "../script-version/types";
import {
	validateScriptVersionForFactLock,
	validateScriptVersionForFactLockRun,
} from "../script-version/validation";
import type { FactLockRunStatus } from "./types";

export const factLockGateReasons = [
	"NO_SCRIPT_VERSION",
	"SCRIPT_NOT_READY",
	"FACT_LOCK_NOT_RUN",
	"FACT_LOCK_PENDING",
	"FACT_LOCK_REVIEW_REQUIRED",
	"FACT_LOCK_STALE_SCRIPT",
	"FACT_LOCK_STALE_FACTS",
	"FACT_LOCK_FAILED",
	"FACT_LOCK_INDETERMINATE",
	"FACT_LOCK_PASSED",
] as const;

export type FactLockGateReason = (typeof factLockGateReasons)[number];

export type FactLockGateRunInput = {
	id: string;
	scriptVersionId: string;
	sourceScriptRevision: number;
	status: FactLockRunStatus;
	dependenciesCurrent: boolean;
	createdAt: Date | string;
};

export type FactLockGateEvaluationInput = {
	currentScriptVersion: {
		id: string;
		revision: number;
		snapshot: ScriptVersionEditableSnapshot;
	} | null;
	runs: FactLockGateRunInput[];
};

export type FactLockGateResult = {
	allowed: boolean;
	reason: FactLockGateReason;
	currentScriptVersionId: string | null;
	currentScriptRevision: number | null;
	factLockRunId: string | null;
	blockingRunStatus: FactLockRunStatus | null;
};

function result(
	reason: FactLockGateReason,
	input: FactLockGateEvaluationInput,
	run: FactLockGateRunInput | undefined = undefined,
): FactLockGateResult {
	return {
		allowed: reason === "FACT_LOCK_PASSED",
		reason,
		currentScriptVersionId: input.currentScriptVersion?.id ?? null,
		currentScriptRevision: input.currentScriptVersion?.revision ?? null,
		factLockRunId: run?.id ?? null,
		blockingRunStatus: run?.status ?? null,
	};
}

/**
 * Pure Fact Lock gate decision. The API service must resolve every input from
 * the authenticated workspace before calling this function.
 */
export function evaluateFactLockGate(
	input: FactLockGateEvaluationInput,
): FactLockGateResult {
	if (!input.currentScriptVersion) return result("NO_SCRIPT_VERSION", input);

	const preRunValidation = validateScriptVersionForFactLock(
		input.currentScriptVersion.snapshot,
	);
	if (!preRunValidation.success) {
		const structurallyReady = validateScriptVersionForFactLockRun(
			input.currentScriptVersion.snapshot,
		).success;
		if (!structurallyReady) return result("SCRIPT_NOT_READY", input);
	}

	const runs = [...input.runs].sort(
		(left, right) =>
			new Date(right.createdAt).getTime() -
				new Date(left.createdAt).getTime() || right.id.localeCompare(left.id),
	);
	if (runs.length === 0) return result("FACT_LOCK_NOT_RUN", input);

	const current = input.currentScriptVersion;
	const currentScriptRuns = runs.filter(
		(run) =>
			run.scriptVersionId === current.id &&
			run.sourceScriptRevision === current.revision,
	);
	const resultBearingRuns = runs.filter(
		(run) => run.status === "passed" || run.status === "review_required",
	);

	// A script edit/restore invalidates a result-bearing run before any retry
	// status is considered. This keeps stale script state visible to the user.
	const hasPriorResult = resultBearingRuns.length > 0;
	if (
		(input.currentScriptVersion.snapshot.claimsStatus !== "current" &&
			hasPriorResult) ||
		resultBearingRuns.some(
			(run) =>
				run.scriptVersionId !== current.id ||
				run.sourceScriptRevision !== current.revision,
		)
	) {
		return result("FACT_LOCK_STALE_SCRIPT", input, resultBearingRuns[0]);
	}

	const staleFactsRun = resultBearingRuns.find(
		(run) =>
			run.scriptVersionId === current.id &&
			run.sourceScriptRevision === current.revision &&
			!run.dependenciesCurrent,
	);
	if (staleFactsRun)
		return result("FACT_LOCK_STALE_FACTS", input, staleFactsRun);

	// A successful run remains usable when a later retry is failed or
	// indeterminate. Prefer the newest applicable PASS over transient retries.
	const passedRun = currentScriptRuns.find(
		(run) => run.status === "passed" && run.dependenciesCurrent,
	);
	if (passedRun) return result("FACT_LOCK_PASSED", input, passedRun);

	const reviewRun = currentScriptRuns.find(
		(run) => run.status === "review_required" && run.dependenciesCurrent,
	);
	if (reviewRun) return result("FACT_LOCK_REVIEW_REQUIRED", input, reviewRun);

	const latestCurrentRun = currentScriptRuns[0];
	if (!latestCurrentRun) return result("FACT_LOCK_NOT_RUN", input);
	if (latestCurrentRun.status === "pending")
		return result("FACT_LOCK_PENDING", input, latestCurrentRun);
	if (latestCurrentRun.status === "failed")
		return result("FACT_LOCK_FAILED", input, latestCurrentRun);
	if (latestCurrentRun.status === "indeterminate")
		return result("FACT_LOCK_INDETERMINATE", input, latestCurrentRun);

	return result("FACT_LOCK_NOT_RUN", input, latestCurrentRun);
}

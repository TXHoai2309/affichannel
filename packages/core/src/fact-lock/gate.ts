import { scriptVersionEditableSnapshotSchema } from "../script-version/schema";
import type { ScriptVersionEditableSnapshot } from "../script-version/types";
import {
	validateScriptVersionForFactLock,
	validateScriptVersionForFactLockRun,
} from "../script-version/validation";
import type { FactLockReadInputMode, FactLockRunStatus } from "./types";

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
	inputMode: FactLockReadInputMode;
	scriptVersionId: string | null;
	sourceScriptRevision: number | null;
	sourceCurrent: boolean;
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

	const organicSnapshot = input.currentScriptVersion.snapshot;
	const isOrganicDraft = organicSnapshot.schemaVersion === "script-draft.v3";
	const preRunValidation = isOrganicDraft
		? scriptVersionEditableSnapshotSchema.safeParse(organicSnapshot).success &&
			organicSnapshot.selectedHookKey !== null &&
			organicSnapshot.claimsStatus === "current"
			? ({ success: true } as const)
			: ({ success: false } as const)
		: validateScriptVersionForFactLock(organicSnapshot);
	if (!preRunValidation.success) {
		const structurallyReady = isOrganicDraft
			? scriptVersionEditableSnapshotSchema.safeParse(organicSnapshot).success
			: validateScriptVersionForFactLockRun(organicSnapshot).success;
		if (!structurallyReady) return result("SCRIPT_NOT_READY", input);
	}

	const runs = [...input.runs].sort(
		(left, right) =>
			new Date(right.createdAt).getTime() -
				new Date(left.createdAt).getTime() || right.id.localeCompare(left.id),
	);
	if (runs.length === 0) return result("FACT_LOCK_NOT_RUN", input);

	const current = input.currentScriptVersion;
	const currentScriptRuns = runs.filter((run) =>
		run.inputMode === "LEGACY" || run.inputMode === "MANIFEST_V1"
			? run.scriptVersionId === current.id &&
				run.sourceScriptRevision === current.revision
			: false,
	);
	const currentResultRuns = currentScriptRuns.filter(
		(run) => run.status === "passed" || run.status === "review_required",
	);
	const historicalResultRuns = runs.filter(
		(run) =>
			(run.status === "passed" || run.status === "review_required") &&
			(run.scriptVersionId !== current.id ||
				run.sourceScriptRevision !== current.revision),
	);

	// Product Fact invalidation applies to a current result before any
	// historical script result is considered. A historical run cannot make a
	// valid current result stale by itself.
	const latestCurrentResultRun = currentResultRuns[0];
	if (latestCurrentResultRun && !latestCurrentResultRun.sourceCurrent)
		return result("FACT_LOCK_STALE_SCRIPT", input, latestCurrentResultRun);
	if (latestCurrentResultRun && !latestCurrentResultRun.dependenciesCurrent)
		return result("FACT_LOCK_STALE_FACTS", input, latestCurrentResultRun);

	// A current applicable result wins over every historical result. This is
	// the critical rule for PASS rev1 -> edit rev2 -> PASS rev2.
	if (preRunValidation.success) {
		if (
			latestCurrentResultRun?.status === "passed" &&
			latestCurrentResultRun.sourceCurrent &&
			latestCurrentResultRun.dependenciesCurrent
		)
			return result("FACT_LOCK_PASSED", input, latestCurrentResultRun);

		if (
			latestCurrentResultRun?.status === "review_required" &&
			latestCurrentResultRun.sourceCurrent &&
			latestCurrentResultRun.dependenciesCurrent
		)
			return result("FACT_LOCK_REVIEW_REQUIRED", input, latestCurrentResultRun);
	}

	const latestCurrentRun = currentScriptRuns[0];
	if (latestCurrentRun) {
		if (latestCurrentRun.status === "pending")
			return result("FACT_LOCK_PENDING", input, latestCurrentRun);
		if (latestCurrentRun.status === "failed")
			return result("FACT_LOCK_FAILED", input, latestCurrentRun);
		if (latestCurrentRun.status === "indeterminate")
			return result("FACT_LOCK_INDETERMINATE", input, latestCurrentRun);
		if (!preRunValidation.success && currentResultRuns.length > 0)
			return result("FACT_LOCK_STALE_SCRIPT", input, currentResultRuns[0]);
	}

	// Historical result runs explain why the current revision is stale only
	// after all current revision requests have been evaluated.
	if (historicalResultRuns.length > 0)
		return result("FACT_LOCK_STALE_SCRIPT", input, historicalResultRuns[0]);
	if (!latestCurrentRun) return result("FACT_LOCK_NOT_RUN", input);

	return result("FACT_LOCK_NOT_RUN", input, latestCurrentRun);
}

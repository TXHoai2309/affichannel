import type {
	RenderExecutionAdapter,
	RenderExecutionAdapterResult,
	TechnicalPreflightResult,
} from "@affichannel/core";
import {
	canonicalizeCompositionJson,
	classifyRenderExecutionOutcome,
	sha256Hex,
} from "@affichannel/core";
import type { CompositionBusinessPreflight } from "./composition-preflight-service";
import { preflightCompositionVersionInTransaction } from "./composition-preflight-service";
import { technicalPreflightCompositionVersion } from "./composition-technical-preflight-service";
import {
	authorizeAttempt,
	claimNextRenderAttempt,
	failJobAfterExecution,
	failTechnical,
	fenceAndRequeue,
	heartbeatRenderAttempt,
	loadExecutionSnapshot,
	markExecutionStarted,
	markIndeterminate,
	readRenderAttemptState,
	recordTechnicalEvidence,
	requeueAfterSideEffectFreeFailure,
} from "./render-job-repository";
import type { WorkspaceActor } from "./workspace";

export type RenderWorkerDependencies = {
	technicalPreflight?: typeof technicalPreflightCompositionVersion;
	businessPreflight?: (
		transaction: Parameters<typeof preflightCompositionVersionInTransaction>[0],
		actor: WorkspaceActor,
		compositionVersionId: string,
	) => Promise<CompositionBusinessPreflight>;
	execute?: RenderExecutionAdapter;
	leaseHeartbeat?: typeof heartbeatRenderAttempt;
	markIndeterminate?: typeof markIndeterminate;
	failJobAfterExecution?: typeof failJobAfterExecution;
	requeueAfterSideEffectFreeFailure?: typeof requeueAfterSideEffectFreeFailure;
};

export type RenderWorkerResult =
	| { kind: "IDLE"; persisted: false }
	| {
			kind: "FENCED" | "BLOCKED" | "FAILED" | "QUEUED" | "INDETERMINATE";
			persisted: true;
			reason: string;
	  }
	| {
			kind: "RECONCILIATION_REQUIRED";
			persisted: false;
			reason: "STATE_TRANSITION_LOST";
	  };

type WorkerAttemptIdentity = {
	actor: WorkspaceActor;
	jobId: string;
	attemptId: string;
	attemptNumber: number;
	leaseOwner: string;
};

function persistedResult(
	kind: Exclude<
		RenderWorkerResult,
		{ kind: "IDLE" | "RECONCILIATION_REQUIRED" }
	>["kind"],
	reason: string,
): RenderWorkerResult {
	return { kind, persisted: true, reason };
}

function reconciliationRequired(): RenderWorkerResult {
	return {
		kind: "RECONCILIATION_REQUIRED",
		persisted: false,
		reason: "STATE_TRANSITION_LOST",
	};
}

async function resolveStateTransitionLoss(
	input: WorkerAttemptIdentity,
	reason: string,
): Promise<RenderWorkerResult> {
	try {
		const state = await readRenderAttemptState(input.actor, {
			jobId: input.jobId,
			attemptId: input.attemptId,
			attemptNumber: input.attemptNumber,
		});
		if (
			!state ||
			state.jobId !== input.jobId ||
			state.attemptId !== input.attemptId ||
			state.attemptJobId !== input.jobId ||
			state.attemptNumber !== input.attemptNumber ||
			state.jobAttemptCount !== input.attemptNumber ||
			state.attemptWorkspaceId !== input.actor.workspaceId ||
			state.jobWorkspaceId !== input.actor.workspaceId
		)
			return reconciliationRequired();
		if (
			state.jobStatus === "RUNNING" &&
			state.attemptStatus === "RUNNING" &&
			state.leaseOwner !== input.leaseOwner
		)
			return reconciliationRequired();
		if (
			state.jobStatus === "INDETERMINATE" &&
			state.attemptStatus === "INDETERMINATE"
		)
			return persistedResult("INDETERMINATE", reason);
		if (state.jobStatus === "FAILED" && state.attemptStatus === "FAILED")
			return persistedResult("FAILED", reason);
		if (state.jobStatus === "QUEUED" && state.attemptStatus === "FENCED")
			return persistedResult("QUEUED", reason);
		if (state.jobStatus === "BLOCKED" && state.attemptStatus === "FENCED")
			return persistedResult("BLOCKED", reason);
		return reconciliationRequired();
	} catch {
		return reconciliationRequired();
	}
}

async function technicalEvidenceFingerprint(result: TechnicalPreflightResult) {
	if (!result.technicalManifest) return null;
	return sha256Hex(canonicalizeCompositionJson(result.technicalManifest));
}

/**
 * Runs exactly one claimed attempt. The adapter is intentionally injected:
 * 21C owns orchestration and fencing, while 21D owns immutable output proof.
 */
export async function runNextRenderAttempt(
	actor: WorkspaceActor,
	leaseOwner: string,
	dependencies: RenderWorkerDependencies = {},
): Promise<RenderWorkerResult> {
	const claimed = await claimNextRenderAttempt(actor.workspaceId, leaseOwner);
	if (!claimed) return { kind: "IDLE", persisted: false };
	const { job, attempt } = claimed;
	const attemptIdentity: WorkerAttemptIdentity = {
		actor,
		jobId: job.id,
		attemptId: attempt.id,
		attemptNumber: attempt.attemptNumber,
		leaseOwner,
	};
	const persistIndeterminate =
		dependencies.markIndeterminate ?? markIndeterminate;
	const persistPostExecutionFailure =
		dependencies.failJobAfterExecution ?? failJobAfterExecution;
	const persistSideEffectFreeRetry =
		dependencies.requeueAfterSideEffectFreeFailure ??
		requeueAfterSideEffectFreeFailure;
	const runTechnicalPreflight =
		dependencies.technicalPreflight ?? technicalPreflightCompositionVersion;
	let technical: TechnicalPreflightResult;
	try {
		technical = await runTechnicalPreflight(actor, job.compositionVersionId);
	} catch {
		const fenced = await fenceAndRequeue({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "TECHNICAL_PREFLIGHT_UNKNOWN",
			errorMessage:
				"Technical preflight could not be completed before execution.",
		});
		return fenced
			? persistedResult("QUEUED", "TECHNICAL_PREFLIGHT_UNKNOWN")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"TECHNICAL_PREFLIGHT_UNKNOWN",
				);
	}
	const evidenceFingerprint = await technicalEvidenceFingerprint(technical);
	const technicalIdentityMatches =
		technical.status !== "VALID" ||
		(technical.compositionVersionId === job.compositionVersionId &&
			technical.compositionFingerprint === job.compositionFingerprint &&
			technical.technicalManifest?.compositionFingerprint ===
				job.compositionFingerprint);
	if (!technicalIdentityMatches) {
		const mismatchRecorded = await recordTechnicalEvidence({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			status: "INVALID",
			reasonCode: "TECHNICAL_PREFLIGHT_IDENTITY_MISMATCH",
			technicalEvidenceFingerprint: evidenceFingerprint,
		});
		if (!mismatchRecorded)
			return await resolveStateTransitionLoss(
				attemptIdentity,
				"TECHNICAL_PREFLIGHT_IDENTITY_MISMATCH",
			);
		const failed = await failTechnical({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "TECHNICAL_PREFLIGHT_IDENTITY_MISMATCH",
			errorMessage:
				"Technical evidence did not bind to the queued composition identity.",
		});
		return failed
			? persistedResult("FAILED", "TECHNICAL_PREFLIGHT_IDENTITY_MISMATCH")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"TECHNICAL_PREFLIGHT_IDENTITY_MISMATCH",
				);
	}
	const evidenceRecorded = await recordTechnicalEvidence({
		attemptId: attempt.id,
		jobId: job.id,
		attemptNumber: attempt.attemptNumber,
		leaseOwner,
		status: technical.status,
		reasonCode: technical.reasonCode,
		technicalEvidenceFingerprint: evidenceFingerprint,
	});
	if (!evidenceRecorded)
		return await resolveStateTransitionLoss(
			attemptIdentity,
			"TECHNICAL_EVIDENCE_STATE_TRANSITION_LOST",
		);

	if (technical.status === "INVALID" || technical.status === "UNSUPPORTED") {
		const failed = await failTechnical({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: technical.reasonCode ?? "TECHNICAL_PREFLIGHT_FAILED",
			errorMessage: technical.issues.join(" "),
		});
		return failed
			? persistedResult("FAILED", technical.reasonCode ?? technical.status)
			: await resolveStateTransitionLoss(
					attemptIdentity,
					technical.reasonCode ?? technical.status,
				);
	}
	if (
		technical.status === "UNKNOWN" ||
		!technical.technicalManifest ||
		!evidenceFingerprint
	) {
		const fenced = await fenceAndRequeue({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: technical.reasonCode ?? "TECHNICAL_PREFLIGHT_UNKNOWN",
			errorMessage: technical.issues.join(" "),
		});
		return fenced
			? persistedResult(
					"QUEUED",
					technical.reasonCode ?? "TECHNICAL_PREFLIGHT_UNKNOWN",
				)
			: await resolveStateTransitionLoss(
					attemptIdentity,
					technical.reasonCode ?? "TECHNICAL_PREFLIGHT_UNKNOWN",
				);
	}

	const authorization = await authorizeAttempt({
		actor,
		jobId: job.id,
		attemptId: attempt.id,
		attemptNumber: attempt.attemptNumber,
		leaseOwner,
		technicalEvidenceFingerprint: evidenceFingerprint,
		businessGate: (transaction) =>
			(
				dependencies.businessPreflight ??
				preflightCompositionVersionInTransaction
			)(transaction, actor, job.compositionVersionId),
	});
	if (authorization.kind === "BLOCKED")
		return persistedResult("BLOCKED", "BUSINESS_AUTHORIZATION_BLOCKED");
	if (authorization.kind === "STALE")
		return persistedResult("FAILED", "COMPOSITION_STALE");
	if (authorization.kind === "RETRYABLE")
		return persistedResult("QUEUED", authorization.reason);
	if (authorization.kind !== "AUTHORIZED")
		return await resolveStateTransitionLoss(
			attemptIdentity,
			"AUTHORIZATION_STATE_TRANSITION_LOST",
		);

	const executionMarked = await markExecutionStarted({
		jobId: job.id,
		attemptId: attempt.id,
		attemptNumber: attempt.attemptNumber,
		leaseOwner,
	});
	if (!executionMarked) {
		const fenced = await fenceAndRequeue({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "LEASE_LOST_BEFORE_EXECUTION",
		});
		return fenced
			? persistedResult("FENCED", "LEASE_LOST_BEFORE_EXECUTION")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"LEASE_LOST_BEFORE_EXECUTION",
				);
	}

	let snapshot: Awaited<ReturnType<typeof loadExecutionSnapshot>>;
	try {
		snapshot = await loadExecutionSnapshot(actor, {
			jobId: job.id,
			attemptId: attempt.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			technicalManifest: technical.technicalManifest,
			technicalEvidenceFingerprint: evidenceFingerprint,
		});
	} catch (error) {
		const snapshotErrorCode =
			error instanceof Error && "code" in error
				? String((error as { code: unknown }).code)
				: "RENDER_EXECUTION_SNAPSHOT_INVALID";
		const persisted = await persistIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: snapshotErrorCode,
			errorMessage:
				error instanceof Error
					? error.message
					: "Execution snapshot could not be validated.",
		});
		return persisted
			? persistedResult("INDETERMINATE", snapshotErrorCode)
			: await resolveStateTransitionLoss(attemptIdentity, snapshotErrorCode);
	}
	if (!snapshot) {
		const persisted = await persistIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "LEASE_LOST_AFTER_EXECUTION_MARKER",
			errorMessage:
				"Execution marker was committed but the lease was no longer provable.",
		});
		return persisted
			? persistedResult("INDETERMINATE", "LEASE_LOST_AFTER_EXECUTION_MARKER")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"LEASE_LOST_AFTER_EXECUTION_MARKER",
				);
	}

	if (!dependencies.execute) {
		const persisted = await persistIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "RENDER_ADAPTER_NOT_CONFIGURED",
			errorMessage:
				"21C has no production renderer; immutable output proof belongs to 21D.",
		});
		return persisted
			? persistedResult("INDETERMINATE", "RENDER_ADAPTER_NOT_CONFIGURED")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"RENDER_ADAPTER_NOT_CONFIGURED",
				);
	}

	let result: RenderExecutionAdapterResult;
	try {
		result = await dependencies.execute({ snapshot });
	} catch (error) {
		const persisted = await persistIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "RENDER_ADAPTER_EXCEPTION",
			errorMessage:
				error instanceof Error
					? error.message
					: "Adapter threw an unknown error.",
		});
		return persisted
			? persistedResult("INDETERMINATE", "RENDER_ADAPTER_EXCEPTION")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"RENDER_ADAPTER_EXCEPTION",
				);
	}
	if (result.outcome === "SUCCESS") {
		const persisted = await persistIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "AWAITING_RENDER_ARTIFACT_PROOF",
			errorMessage:
				"21C execution succeeded without immutable 21D RenderArtifact proof.",
		});
		return persisted
			? persistedResult("INDETERMINATE", "AWAITING_RENDER_ARTIFACT_PROOF")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"AWAITING_RENDER_ARTIFACT_PROOF",
				);
	}
	const disposition = classifyRenderExecutionOutcome(result);
	if (disposition === "INDETERMINATE") {
		const persisted = await persistIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: result.errorCode,
			errorMessage: result.errorMessage,
		});
		return persisted
			? persistedResult("INDETERMINATE", result.errorCode)
			: await resolveStateTransitionLoss(attemptIdentity, result.errorCode);
	}
	if (disposition === "FAILED") {
		const persisted = await persistPostExecutionFailure({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: result.errorCode,
			errorMessage: result.errorMessage,
		});
		return persisted
			? persistedResult("FAILED", result.errorCode)
			: await resolveStateTransitionLoss(attemptIdentity, result.errorCode);
	}
	if (disposition === "QUEUED") {
		const persisted = await persistSideEffectFreeRetry({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: result.errorCode,
			errorMessage: result.errorMessage,
		});
		return persisted
			? persistedResult("QUEUED", result.errorCode)
			: await resolveStateTransitionLoss(attemptIdentity, result.errorCode);
	}
	const persisted = await persistIndeterminate({
		attemptId: attempt.id,
		jobId: job.id,
		attemptNumber: attempt.attemptNumber,
		leaseOwner,
		errorCode: result.errorCode,
		errorMessage: result.errorMessage,
	});
	return persisted
		? persistedResult("INDETERMINATE", result.errorCode)
		: await resolveStateTransitionLoss(attemptIdentity, result.errorCode);
}

export async function heartbeatOwnedRenderAttempt(
	input: {
		attemptId: string;
		jobId: string;
		attemptNumber: number;
		leaseOwner: string;
	},
	dependencies: Pick<RenderWorkerDependencies, "leaseHeartbeat"> = {},
) {
	return (dependencies.leaseHeartbeat ?? heartbeatRenderAttempt)(input);
}

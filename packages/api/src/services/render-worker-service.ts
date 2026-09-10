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
};

export type RenderWorkerResult =
	| { kind: "IDLE" }
	| { kind: "FENCED"; reason: string }
	| { kind: "BLOCKED"; reason: string }
	| { kind: "FAILED"; reason: string }
	| { kind: "QUEUED"; reason: string }
	| { kind: "INDETERMINATE"; reason: string };

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
	if (!claimed) return { kind: "IDLE" };
	const { job, attempt } = claimed;
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
			? { kind: "QUEUED", reason: "TECHNICAL_PREFLIGHT_UNKNOWN" }
			: { kind: "FENCED", reason: "LEASE_LOST" };
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
		if (!mismatchRecorded) return { kind: "FENCED", reason: "LEASE_LOST" };
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
			? { kind: "FAILED", reason: "TECHNICAL_PREFLIGHT_IDENTITY_MISMATCH" }
			: { kind: "FENCED", reason: "LEASE_LOST" };
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
	if (!evidenceRecorded) return { kind: "FENCED", reason: "LEASE_LOST" };

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
			? { kind: "FAILED", reason: technical.reasonCode ?? technical.status }
			: { kind: "FENCED", reason: "LEASE_LOST" };
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
			? {
					kind: "QUEUED",
					reason: technical.reasonCode ?? "TECHNICAL_PREFLIGHT_UNKNOWN",
				}
			: { kind: "FENCED", reason: "LEASE_LOST" };
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
		return { kind: "BLOCKED", reason: "BUSINESS_AUTHORIZATION_BLOCKED" };
	if (authorization.kind === "STALE")
		return { kind: "FAILED", reason: "COMPOSITION_STALE" };
	if (authorization.kind === "RETRYABLE")
		return { kind: "QUEUED", reason: authorization.reason };
	if (authorization.kind !== "AUTHORIZED")
		return { kind: "FENCED", reason: "LEASE_LOST" };

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
			? { kind: "FENCED", reason: "LEASE_LOST_BEFORE_EXECUTION" }
			: { kind: "FENCED", reason: "LEASE_LOST" };
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
		const persisted = await markIndeterminate({
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
		return {
			kind: "INDETERMINATE",
			reason: persisted
				? snapshotErrorCode
				: "LEASE_LOST_AFTER_EXECUTION_MARKER",
		};
	}
	if (!snapshot) {
		const persisted = await markIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "LEASE_LOST_AFTER_EXECUTION_MARKER",
			errorMessage:
				"Execution marker was committed but the lease was no longer provable.",
		});
		return {
			kind: "INDETERMINATE",
			reason: persisted
				? "LEASE_LOST_AFTER_EXECUTION_MARKER"
				: "LEASE_LOST_AFTER_EXECUTION_MARKER",
		};
	}

	if (!dependencies.execute) {
		const persisted = await markIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "RENDER_ADAPTER_NOT_CONFIGURED",
			errorMessage:
				"21C has no production renderer; immutable output proof belongs to 21D.",
		});
		return {
			kind: "INDETERMINATE",
			reason: persisted
				? "RENDER_ADAPTER_NOT_CONFIGURED"
				: "LEASE_LOST_AFTER_EXECUTION_MARKER",
		};
	}

	let result: RenderExecutionAdapterResult;
	try {
		result = await dependencies.execute({ snapshot });
	} catch (error) {
		const persisted = await markIndeterminate({
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
		return {
			kind: "INDETERMINATE",
			reason: persisted
				? "RENDER_ADAPTER_EXCEPTION"
				: "LEASE_LOST_AFTER_EXECUTION_MARKER",
		};
	}
	if (result.outcome === "SUCCESS") {
		const persisted = await markIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: "AWAITING_RENDER_ARTIFACT_PROOF",
			errorMessage:
				"21C execution succeeded without immutable 21D RenderArtifact proof.",
		});
		return {
			kind: "INDETERMINATE",
			reason: persisted
				? "AWAITING_RENDER_ARTIFACT_PROOF"
				: "LEASE_LOST_AFTER_EXECUTION_MARKER",
		};
	}
	const disposition = classifyRenderExecutionOutcome(result);
	if (disposition === "INDETERMINATE") {
		const persisted = await markIndeterminate({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: result.errorCode,
			errorMessage: result.errorMessage,
		});
		return {
			kind: "INDETERMINATE",
			reason: persisted
				? result.errorCode
				: "LEASE_LOST_AFTER_EXECUTION_MARKER",
		};
	}
	if (disposition === "FAILED") {
		const persisted = await failJobAfterExecution({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: result.errorCode,
			errorMessage: result.errorMessage,
		});
		return persisted
			? { kind: "FAILED", reason: result.errorCode }
			: { kind: "INDETERMINATE", reason: "LEASE_LOST_AFTER_EXECUTION_MARKER" };
	}
	if (disposition === "QUEUED") {
		const persisted = await requeueAfterSideEffectFreeFailure({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: result.errorCode,
			errorMessage: result.errorMessage,
		});
		return persisted
			? { kind: "QUEUED", reason: result.errorCode }
			: { kind: "INDETERMINATE", reason: "LEASE_LOST_AFTER_EXECUTION_MARKER" };
	}
	const persisted = await markIndeterminate({
		attemptId: attempt.id,
		jobId: job.id,
		attemptNumber: attempt.attemptNumber,
		leaseOwner,
		errorCode: result.errorCode,
		errorMessage: result.errorMessage,
	});
	return {
		kind: "INDETERMINATE",
		reason: persisted ? result.errorCode : "LEASE_LOST_AFTER_EXECUTION_MARKER",
	};
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

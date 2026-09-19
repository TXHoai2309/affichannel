import type {
	RenderExecutionAdapter,
	RenderExecutionAdapterResult,
	TechnicalPreflightResult,
} from "@affichannel/core";
import {
	canonicalizeCompositionJson,
	classifyRenderExecutionOutcome,
	quickImageOutputReadySchema,
	sha256Hex,
	t09OutputReadySchema,
} from "@affichannel/core";
import type { CompositionBusinessPreflight } from "./composition-preflight-service";
import { preflightCompositionVersionInTransaction } from "./composition-preflight-service";
import { technicalPreflightCompositionVersion } from "./composition-technical-preflight-service";
import {
	buildQuickImageExecutionContext,
	QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED,
	type QuickImageExecutionAdapter,
	type QuickImageExecutionAdapterResult,
} from "./quick-image-render-execution-adapter";
import {
	finalizeRenderArtifact,
	RenderArtifactError,
} from "./render-artifact-repository";
import {
	authorizeAttempt,
	blockRenderAttempt,
	blockRenderAttemptBeforeExecution,
	claimNextRenderAttempt,
	failJobAfterExecution,
	failTechnical,
	fenceAndRequeue,
	getRenderLeaseConfiguration,
	heartbeatRenderAttempt,
	loadExecutionSnapshot,
	markExecutionStarted,
	markIndeterminate,
	readRenderAttemptState,
	recordTechnicalEvidence,
	requeueAfterSideEffectFreeFailure,
} from "./render-job-repository";
import {
	RenderOutputUnsupportedError,
	RenderOutputValidationError,
} from "./render-output-validator";
import type { WorkspaceActor } from "./workspace";

export type RenderWorkerDependencies = {
	technicalPreflight?: typeof technicalPreflightCompositionVersion;
	businessPreflight?: (
		transaction: Parameters<typeof preflightCompositionVersionInTransaction>[0],
		actor: WorkspaceActor,
		compositionVersionId: string,
	) => Promise<CompositionBusinessPreflight>;
	execute?: RenderExecutionAdapter;
	/** Test-only Quick Image seam; production leaves this unset. */
	executeQuickImage?: QuickImageExecutionAdapter;
	quickImageStagingRoot?: string;
	finalizeRenderArtifact?: typeof finalizeRenderArtifact;
	leaseHeartbeat?: typeof heartbeatRenderAttempt;
	markIndeterminate?: typeof markIndeterminate;
	failJobAfterExecution?: typeof failJobAfterExecution;
	requeueAfterSideEffectFreeFailure?: typeof requeueAfterSideEffectFreeFailure;
};

export type RenderWorkerResult =
	| { kind: "IDLE"; persisted: false }
	| {
			kind:
				| "FENCED"
				| "BLOCKED"
				| "FAILED"
				| "QUEUED"
				| "COMPLETED"
				| "INDETERMINATE";
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

function isQuickImageJob(job: { requestSpec: { schemaVersion: string } }) {
	return job.requestSpec.schemaVersion === "render-request.quick-image.v1";
}

/** The V2 start gate already evaluated creation-time authorities. */
function quickImageFrozenBusinessPreflight(
	compositionVersionId: string,
): CompositionBusinessPreflight {
	return {
		compositionVersionId,
		currentness: { state: "CURRENT" },
		authorization: {
			allowed: true,
			reasonCode: "QUICK_IMAGE_FROZEN_COMPOSITION_AUTHORIZED",
			factLockRequirement: "NOT_REQUIRED",
			factLockOutcome: "NOT_EVALUATED",
		},
		applicability: null,
		factLock: {
			requirement: "NOT_REQUIRED",
			outcome: "NOT_EVALUATED",
			evidence: null,
		},
	};
}

function normalizeQuickImageResult(
	result: QuickImageExecutionAdapterResult,
): RenderExecutionAdapterResult {
	if (result.outcome === "SUCCESS_OUTPUT_READY")
		return { outcome: "SUCCESS", outputReady: result.outputReady };
	if (result.outcome === "INDETERMINATE")
		return {
			outcome: "FAILURE",
			classification: "RETRYABLE",
			sideEffectFree: false,
			errorCode: result.errorCode,
			errorMessage: result.errorMessage,
		};
	if (result.outcome === "BLOCKED")
		return {
			outcome: "FAILURE",
			classification: "DETERMINISTIC",
			sideEffectFree: true,
			terminal: true,
			errorCode: result.errorCode ?? QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED,
			errorMessage: result.errorMessage,
		};
	return {
		outcome: "FAILURE",
		classification: result.classification,
		sideEffectFree: result.sideEffectFree,
		errorCode: result.errorCode,
		errorMessage: result.errorMessage,
	};
}

function quickImageFailureIsTerminal(error: unknown) {
	return (
		error instanceof RenderOutputValidationError ||
		error instanceof RenderOutputUnsupportedError ||
		(error instanceof RenderArtifactError &&
			[
				"RENDER_ARTIFACT_PROOF_INVALID",
				"RENDER_ARTIFACT_PROVENANCE_INVALID",
				"RENDER_ARTIFACT_OUTPUT_CONTRACT_MISMATCH",
				"RENDER_ARTIFACT_OUTPUT_IDENTITY_MISMATCH",
			].includes(error.code))
	);
}

async function runQuickImageExecution(input: {
	snapshot: NonNullable<Awaited<ReturnType<typeof loadExecutionSnapshot>>>;
	claimedAttempt: { id: string; attemptNumber: number };
	leaseOwner: string;
	dependencies: RenderWorkerDependencies;
	attemptIdentity: WorkerAttemptIdentity;
}): Promise<RenderWorkerResult> {
	const {
		snapshot,
		claimedAttempt,
		leaseOwner,
		dependencies,
		attemptIdentity,
	} = input;
	const persistIndeterminate =
		dependencies.markIndeterminate ?? markIndeterminate;
	const persistPostExecutionFailure =
		dependencies.failJobAfterExecution ?? failJobAfterExecution;
	let context: Awaited<ReturnType<typeof buildQuickImageExecutionContext>>;
	try {
		context = await buildQuickImageExecutionContext(
			snapshot,
			dependencies.quickImageStagingRoot,
		);
	} catch (error) {
		const persisted = await persistPostExecutionFailure({
			attemptId: claimedAttempt.id,
			jobId: snapshot.jobId,
			attemptNumber: claimedAttempt.attemptNumber,
			leaseOwner,
			errorCode:
				error instanceof Error && "code" in error
					? String((error as { code: unknown }).code)
					: "QUICK_IMAGE_EXECUTION_CONTEXT_INVALID",
			errorMessage:
				error instanceof Error
					? error.message
					: "Quick Image context is invalid.",
		});
		return persisted
			? persistedResult("FAILED", "QUICK_IMAGE_EXECUTION_CONTEXT_INVALID")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"QUICK_IMAGE_EXECUTION_CONTEXT_INVALID",
				);
	}

	let quickResult: QuickImageExecutionAdapterResult | undefined;
	let wrappedResult: RenderExecutionAdapterResult | undefined;
	try {
		wrappedResult = await executeRenderAdapterWithHeartbeat({
			adapter: async ({ signal }) => {
				quickResult = await dependencies.executeQuickImage?.({
					...context,
					signal,
				});
				if (!quickResult)
					return {
						outcome: "FAILURE",
						classification: "DETERMINISTIC",
						sideEffectFree: true,
						errorCode: "QUICK_IMAGE_ADAPTER_NOT_CONFIGURED",
					};
				return normalizeQuickImageResult(quickResult);
			},
			snapshot,
			heartbeat: dependencies.leaseHeartbeat,
		});
	} catch (error) {
		const persisted = await persistIndeterminate({
			attemptId: claimedAttempt.id,
			jobId: snapshot.jobId,
			attemptNumber: claimedAttempt.attemptNumber,
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
	if (
		wrappedResult?.outcome === "FAILURE" &&
		wrappedResult.errorCode === "RENDER_LEASE_LOST_DURING_EXECUTION"
	) {
		const persisted = await persistIndeterminate({
			attemptId: claimedAttempt.id,
			jobId: snapshot.jobId,
			attemptNumber: claimedAttempt.attemptNumber,
			leaseOwner,
			errorCode: wrappedResult.errorCode,
			errorMessage: wrappedResult.errorMessage,
		});
		return persisted
			? persistedResult("INDETERMINATE", wrappedResult.errorCode)
			: await resolveStateTransitionLoss(
					attemptIdentity,
					wrappedResult.errorCode,
				);
	}

	if (!quickResult) {
		const persisted = await persistIndeterminate({
			attemptId: claimedAttempt.id,
			jobId: snapshot.jobId,
			attemptNumber: claimedAttempt.attemptNumber,
			leaseOwner,
			errorCode: "QUICK_IMAGE_ADAPTER_NOT_CONFIGURED",
		});
		return persisted
			? persistedResult("INDETERMINATE", "QUICK_IMAGE_ADAPTER_NOT_CONFIGURED")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"QUICK_IMAGE_ADAPTER_NOT_CONFIGURED",
				);
	}

	if (quickResult.outcome === "BLOCKED") {
		const blocked = await blockRenderAttempt({
			attemptId: claimedAttempt.id,
			jobId: snapshot.jobId,
			attemptNumber: claimedAttempt.attemptNumber,
			leaseOwner,
			errorCode:
				quickResult.errorCode ?? QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED,
			errorMessage: quickResult.errorMessage,
		});
		const reason =
			quickResult.errorCode ?? QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED;
		return blocked
			? persistedResult("BLOCKED", reason)
			: await resolveStateTransitionLoss(attemptIdentity, reason);
	}

	if (quickResult.outcome === "SUCCESS_OUTPUT_READY") {
		const outputReady = quickImageOutputReadySchema.safeParse(
			quickResult.outputReady,
		);
		if (
			!outputReady.success ||
			outputReady.data.jobId !== snapshot.jobId ||
			outputReady.data.attemptId !== snapshot.attemptId ||
			outputReady.data.attemptNumber !== snapshot.attemptNumber ||
			outputReady.data.outputReservationId !==
				snapshot.execution.outputReservationId
		) {
			const persisted = await persistIndeterminate({
				attemptId: claimedAttempt.id,
				jobId: snapshot.jobId,
				attemptNumber: claimedAttempt.attemptNumber,
				leaseOwner,
				errorCode: "OUTPUT_READY_IDENTITY_MISMATCH",
				errorMessage:
					"Quick Image OUTPUT_READY did not match the claimed attempt reservation.",
			});
			return persisted
				? persistedResult("INDETERMINATE", "OUTPUT_READY_IDENTITY_MISMATCH")
				: await resolveStateTransitionLoss(
						attemptIdentity,
						"OUTPUT_READY_IDENTITY_MISMATCH",
					);
		}
		if (!quickResult.storage) {
			const persisted = await persistIndeterminate({
				attemptId: claimedAttempt.id,
				jobId: snapshot.jobId,
				attemptNumber: claimedAttempt.attemptNumber,
				leaseOwner,
				errorCode: "AWAITING_RENDER_ARTIFACT_PROOF",
				errorMessage:
					"Quick Image execution succeeded without storage-backed output proof.",
			});
			return persisted
				? persistedResult("INDETERMINATE", "AWAITING_RENDER_ARTIFACT_PROOF")
				: await resolveStateTransitionLoss(
						attemptIdentity,
						"AWAITING_RENDER_ARTIFACT_PROOF",
					);
		}
		try {
			const finalize =
				dependencies.finalizeRenderArtifact ?? finalizeRenderArtifact;
			await finalize({
				jobId: snapshot.jobId,
				attemptId: snapshot.attemptId,
				attemptNumber: snapshot.attemptNumber,
				leaseOwner,
				storage: quickResult.storage,
				...(quickResult.body === undefined ? {} : { body: quickResult.body }),
			});
			return persistedResult("COMPLETED", "RENDER_ARTIFACT_FINALIZED");
		} catch (error) {
			const errorCode =
				error instanceof Error && "code" in error
					? String((error as { code: unknown }).code)
					: "RENDER_ARTIFACT_FINALIZE_UNKNOWN";
			if (quickImageFailureIsTerminal(error)) {
				const persisted = await persistPostExecutionFailure({
					attemptId: claimedAttempt.id,
					jobId: snapshot.jobId,
					attemptNumber: claimedAttempt.attemptNumber,
					leaseOwner,
					errorCode,
					errorMessage: error instanceof Error ? error.message : errorCode,
				});
				return persisted
					? persistedResult("FAILED", errorCode)
					: await resolveStateTransitionLoss(attemptIdentity, errorCode);
			}
			const persisted = await persistIndeterminate({
				attemptId: claimedAttempt.id,
				jobId: snapshot.jobId,
				attemptNumber: claimedAttempt.attemptNumber,
				leaseOwner,
				errorCode,
				errorMessage: error instanceof Error ? error.message : errorCode,
			});
			return persisted
				? persistedResult("INDETERMINATE", errorCode)
				: await resolveStateTransitionLoss(attemptIdentity, errorCode);
		} finally {
			await quickResult.cleanup?.().catch(() => undefined);
		}
	}

	const generic = normalizeQuickImageResult(quickResult);
	if (generic.outcome !== "FAILURE") {
		const persisted = await persistIndeterminate({
			attemptId: claimedAttempt.id,
			jobId: snapshot.jobId,
			attemptNumber: claimedAttempt.attemptNumber,
			leaseOwner,
			errorCode: "QUICK_IMAGE_EXECUTION_RESULT_INVALID",
		});
		return persisted
			? persistedResult("INDETERMINATE", "QUICK_IMAGE_EXECUTION_RESULT_INVALID")
			: await resolveStateTransitionLoss(
					attemptIdentity,
					"QUICK_IMAGE_EXECUTION_RESULT_INVALID",
				);
	}
	const disposition = classifyRenderExecutionOutcome(generic);
	if (disposition === "FAILED") {
		const persisted = await persistPostExecutionFailure({
			attemptId: claimedAttempt.id,
			jobId: snapshot.jobId,
			attemptNumber: claimedAttempt.attemptNumber,
			leaseOwner,
			errorCode: generic.errorCode,
			errorMessage: generic.errorMessage,
		});
		return persisted
			? persistedResult("FAILED", generic.errorCode)
			: await resolveStateTransitionLoss(attemptIdentity, generic.errorCode);
	}
	const persisted = await persistIndeterminate({
		attemptId: claimedAttempt.id,
		jobId: snapshot.jobId,
		attemptNumber: claimedAttempt.attemptNumber,
		leaseOwner,
		errorCode: generic.errorCode,
		errorMessage: generic.errorMessage,
	});
	return persisted
		? persistedResult("INDETERMINATE", generic.errorCode)
		: await resolveStateTransitionLoss(attemptIdentity, generic.errorCode);
}

const RENDER_HEARTBEAT_CHECK_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("RENDER_HEARTBEAT_CHECK_TIMEOUT")),
			timeoutMs,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

export async function executeRenderAdapterWithHeartbeat(input: {
	adapter: RenderExecutionAdapter;
	snapshot: NonNullable<Awaited<ReturnType<typeof loadExecutionSnapshot>>>;
	heartbeat?: typeof heartbeatRenderAttempt;
	heartbeatIntervalMs?: number;
}): Promise<RenderExecutionAdapterResult> {
	const controller = new AbortController();
	const heartbeat = input.heartbeat ?? heartbeatRenderAttempt;
	const heartbeatIntervalMs =
		input.heartbeatIntervalMs ??
		getRenderLeaseConfiguration().heartbeatIntervalSeconds * 1000;
	let leaseLost = false;
	let heartbeatInFlight: Promise<void> | null = null;

	const runHeartbeat = () => {
		if (heartbeatInFlight || leaseLost) return;
		const pending = withTimeout(
			Promise.resolve().then(() =>
				heartbeat({
					attemptId: input.snapshot.attemptId,
					jobId: input.snapshot.jobId,
					attemptNumber: input.snapshot.attemptNumber,
					leaseOwner: input.snapshot.leaseOwner,
				}),
			),
			RENDER_HEARTBEAT_CHECK_TIMEOUT_MS,
		)
			.then((owned) => {
				if (!owned) {
					leaseLost = true;
					controller.abort();
				}
			})
			.catch(() => {
				leaseLost = true;
				controller.abort();
			});
		let tracked!: Promise<void>;
		tracked = pending.finally(() => {
			if (heartbeatInFlight === tracked) heartbeatInFlight = null;
		});
		heartbeatInFlight = tracked;
	};

	const heartbeatTimer = setInterval(runHeartbeat, heartbeatIntervalMs);
	try {
		const result = await input.adapter({
			snapshot: input.snapshot,
			signal: controller.signal,
		});
		if (heartbeatInFlight) await heartbeatInFlight;
		if (leaseLost)
			return {
				outcome: "FAILURE",
				classification: "RETRYABLE",
				sideEffectFree: false,
				errorCode: "RENDER_LEASE_LOST_DURING_EXECUTION",
				errorMessage:
					"Render attempt lease ownership was lost while execution was active.",
			};
		return result;
	} finally {
		clearInterval(heartbeatTimer);
		if (heartbeatInFlight) await heartbeatInFlight;
	}
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

	const quickImage = isQuickImageJob(job);
	const authorization = await authorizeAttempt({
		actor,
		jobId: job.id,
		attemptId: attempt.id,
		attemptNumber: attempt.attemptNumber,
		leaseOwner,
		technicalEvidenceFingerprint: evidenceFingerprint,
		businessGate: quickImage
			? async () => quickImageFrozenBusinessPreflight(job.compositionVersionId)
			: (transaction) =>
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

	if (quickImage && !dependencies.executeQuickImage) {
		const blocked = await blockRenderAttemptBeforeExecution({
			attemptId: attempt.id,
			jobId: job.id,
			attemptNumber: attempt.attemptNumber,
			leaseOwner,
			errorCode: QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED,
			errorMessage:
				"Quick Image live execution remains disabled pending the D3 tool gate.",
		});
		return blocked
			? persistedResult("BLOCKED", QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED)
			: await resolveStateTransitionLoss(
					attemptIdentity,
					QUICK_IMAGE_LIVE_EXECUTION_NOT_APPROVED,
				);
	}

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

	if (quickImage)
		return runQuickImageExecution({
			snapshot,
			claimedAttempt: attempt,
			leaseOwner,
			dependencies,
			attemptIdentity,
		});

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
		result = await executeRenderAdapterWithHeartbeat({
			adapter: dependencies.execute,
			snapshot,
			heartbeat: dependencies.leaseHeartbeat,
		});
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
		if (result.outputReady) {
			const outputReady = t09OutputReadySchema.safeParse(result.outputReady);
			if (
				!outputReady.success ||
				outputReady.data.jobId !== snapshot.jobId ||
				outputReady.data.attemptId !== snapshot.attemptId ||
				outputReady.data.attemptNumber !== snapshot.attemptNumber ||
				outputReady.data.outputReservationId !==
					snapshot.execution.outputReservationId
			) {
				const persisted = await persistIndeterminate({
					attemptId: attempt.id,
					jobId: job.id,
					attemptNumber: attempt.attemptNumber,
					leaseOwner,
					errorCode: "OUTPUT_READY_IDENTITY_MISMATCH",
					errorMessage:
						"OUTPUT_READY did not exactly match the claimed attempt reservation.",
				});
				return persisted
					? persistedResult("INDETERMINATE", "OUTPUT_READY_IDENTITY_MISMATCH")
					: await resolveStateTransitionLoss(
							attemptIdentity,
							"OUTPUT_READY_IDENTITY_MISMATCH",
						);
			}
		}
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

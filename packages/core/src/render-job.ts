import type {
	CompositionInputV1,
	CompositionInputV2,
	CompositionTechnicalManifestV1,
	RenderRequestSpecV1,
} from "./composition";
import type { T09OutputReady } from "./render-prototype/output-ready";
import type { QuickImageRenderPlan } from "./render-prototype/quick-image-plan";
import type {
	QuickImageOutputReady,
	QuickImageRenderRequest,
} from "./render-prototype/quick-image-request";

export const renderJobOperations = ["START_RENDER", "RENDER_AGAIN"] as const;
export type RenderJobOperation = (typeof renderJobOperations)[number];

export type RenderRequestSpec = RenderRequestSpecV1 | QuickImageRenderRequest;

export const renderJobStatuses = [
	"QUEUED",
	"RUNNING",
	"BLOCKED",
	"COMPLETED",
	"FAILED",
	"INDETERMINATE",
] as const;
export type RenderJobStatus = (typeof renderJobStatuses)[number];

export const renderAttemptStatuses = [
	"RUNNING",
	"COMPLETED",
	"FAILED",
	"INDETERMINATE",
	"FENCED",
] as const;
export type RenderAttemptStatus = (typeof renderAttemptStatuses)[number];

export type RenderJobExecutionSnapshot = Readonly<{
	jobId: string;
	workspaceId: string;
	projectId: string;
	compositionVersionId: string;
	compositionFingerprint: string;
	requestSpec: RenderRequestSpec;
	compositionInput: CompositionInputV1 | CompositionInputV2;
	outputReservationId: string;
	/** Persisted discriminator selected from the frozen request and input. */
	renderKind?: "T09" | "QUICK_IMAGE";
	/** Present only for a validated Quick Image V2 execution snapshot. */
	quickImagePlan?: QuickImageRenderPlan;
}>;

export type RenderAttemptExecutionSnapshot = Readonly<{
	jobId: string;
	attemptId: string;
	attemptNumber: number;
	leaseOwner: string;
	execution: RenderJobExecutionSnapshot;
	technicalManifest: CompositionTechnicalManifestV1;
	technicalEvidenceFingerprint: string;
}>;

export type RenderExecutionAdapterResult =
	| {
			outcome: "SUCCESS";
			/**
			 * Identity-only handoff for the 21D proof path. This is optional for
			 * legacy 21C test adapters; a successful adapter result without it is
			 * still never trusted as completion.
			 */
			outputReady?: T09OutputReady | QuickImageOutputReady;
	  }
	| {
			outcome: "FAILURE";
			classification: "DETERMINISTIC" | "RETRYABLE";
			sideEffectFree: boolean;
			/** A proven terminal technical contract violation, even when bytes exist. */
			terminal?: boolean;
			errorCode: string;
			errorMessage?: string;
	  };

export type RenderExecutionAdapter = (input: {
	snapshot: RenderAttemptExecutionSnapshot;
	signal?: AbortSignal;
}) => Promise<RenderExecutionAdapterResult>;

export type RenderExecutionDisposition = "FAILED" | "QUEUED" | "INDETERMINATE";

export type RenderLeaseConfiguration = Readonly<{
	leaseTtlSeconds: number;
	heartbeatIntervalSeconds: number;
}>;

export function validateRenderLeaseConfiguration(
	input: RenderLeaseConfiguration,
): RenderLeaseConfiguration {
	if (!Number.isInteger(input.leaseTtlSeconds) || input.leaseTtlSeconds <= 0)
		throw new Error("RENDER_LEASE_TTL_INVALID");
	if (
		!Number.isInteger(input.heartbeatIntervalSeconds) ||
		input.heartbeatIntervalSeconds <= 0
	)
		throw new Error("RENDER_HEARTBEAT_INTERVAL_INVALID");
	if (input.heartbeatIntervalSeconds >= input.leaseTtlSeconds)
		throw new Error("RENDER_HEARTBEAT_INTERVAL_MUST_BE_LESS_THAN_LEASE_TTL");
	return input;
}

/** Owner-locked adapter outcome mapping. COMPLETED is intentionally absent. */
export function classifyRenderExecutionOutcome(
	result: RenderExecutionAdapterResult,
): RenderExecutionDisposition {
	if (result.outcome === "SUCCESS") return "INDETERMINATE";
	if (result.terminal && result.classification === "DETERMINISTIC")
		return "FAILED";
	if (result.sideEffectFree && result.classification === "DETERMINISTIC")
		return "FAILED";
	if (result.sideEffectFree && result.classification === "RETRYABLE")
		return "QUEUED";
	return "INDETERMINATE";
}

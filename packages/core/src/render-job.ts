import type {
	CompositionInputV1,
	CompositionTechnicalManifestV1,
	RenderRequestSpecV1,
} from "./composition";

export const renderJobOperations = ["START_RENDER", "RENDER_AGAIN"] as const;
export type RenderJobOperation = (typeof renderJobOperations)[number];

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
	requestSpec: RenderRequestSpecV1;
	compositionInput: CompositionInputV1;
	outputReservationId: string;
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
	| { outcome: "SUCCESS" }
	| {
			outcome: "FAILURE";
			classification: "DETERMINISTIC" | "RETRYABLE";
			sideEffectFree: boolean;
			errorCode: string;
			errorMessage?: string;
	  };

export type RenderExecutionAdapter = (input: {
	snapshot: RenderAttemptExecutionSnapshot;
}) => Promise<RenderExecutionAdapterResult>;

export type RenderExecutionDisposition = "FAILED" | "QUEUED" | "INDETERMINATE";

/** Owner-locked adapter outcome mapping. COMPLETED is intentionally absent. */
export function classifyRenderExecutionOutcome(
	result: RenderExecutionAdapterResult,
): RenderExecutionDisposition {
	if (result.outcome === "SUCCESS") return "INDETERMINATE";
	if (result.sideEffectFree && result.classification === "DETERMINISTIC")
		return "FAILED";
	if (result.sideEffectFree && result.classification === "RETRYABLE")
		return "QUEUED";
	return "INDETERMINATE";
}

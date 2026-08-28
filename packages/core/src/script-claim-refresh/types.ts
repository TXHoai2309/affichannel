export const scriptClaimRefreshRunStatuses = [
	"pending",
	"completed",
	"failed",
	"indeterminate",
] as const;

export type ScriptClaimRefreshRunStatus =
	(typeof scriptClaimRefreshRunStatuses)[number];

export type ScriptClaimRefreshRun = Readonly<{
	id: string;
	workspaceId: string;
	projectId: string;
	scriptVersionId: string;
	sourceScriptRevision: number;
	idempotencyKey: string;
	requestHash: string;
	inputSnapshotJson: unknown;
	inputHash: string;
	sourceContentHash: string;
	promptHash: string;
	provider: string;
	model: string;
	promptVersion: string;
	outputSchemaVersion: string;
	status: ScriptClaimRefreshRunStatus;
	providerRequestId: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	estimatedCostMicros: bigint | null;
	actualCostMicros: bigint | null;
	currency: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	executionClaimedAt: Date | null;
	createdByUserId: string;
	createdAt: Date;
	finishedAt: Date | null;
	resultScriptRevision: number | null;
}>;

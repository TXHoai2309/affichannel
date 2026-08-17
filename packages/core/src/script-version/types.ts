import type { ClaimOccurrence, ScriptDraft } from "../script-generation/types";

export const scriptVersionStatuses = ["draft", "saved"] as const;
export type ScriptVersionStatus = (typeof scriptVersionStatuses)[number];

export const scriptVersionClaimsStatuses = ["current", "stale"] as const;
export type ScriptVersionClaimsStatus =
	(typeof scriptVersionClaimsStatuses)[number];

export type ScriptVersionEditableSnapshot = ScriptDraft & {
	selectedHookKey: string | null;
	claimsSourceRevision: number;
	claimsStatus: ScriptVersionClaimsStatus;
};

export type ScriptVersionClaim = {
	text: string;
	occurrence: ClaimOccurrence;
};

export type ScriptVersionReadModel = {
	id: string;
	workspaceId: string;
	projectId: string;
	sourceGenerationId: string;
	status: ScriptVersionStatus;
	versionNumber: number | null;
	editableSnapshot: ScriptVersionEditableSnapshot;
	revision: number;
	restoredFromVersionId: string | null;
	createdByUserId: string;
	createdAt: Date;
	updatedAt: Date;
	savedAt: Date | null;
};

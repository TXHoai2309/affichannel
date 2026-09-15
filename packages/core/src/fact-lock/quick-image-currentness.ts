import type { FactLockEffectiveStatus, FactLockRunStatus } from "./types";

export type QuickImageFactLockSourceProvenance = Readonly<{
	sourceType: "NO_SCRIPT";
	sourceSchemaVersion: "quick-image-claim-source.v1";
	sourceRevision: string;
	sourceContentHash: string;
}>;

export function isCurrentQuickImageFactLockSource(input: {
	runSource: QuickImageFactLockSourceProvenance;
	currentSource: QuickImageFactLockSourceProvenance | null;
}): boolean {
	return (
		input.currentSource !== null &&
		input.runSource.sourceType === "NO_SCRIPT" &&
		input.currentSource.sourceType === "NO_SCRIPT" &&
		input.runSource.sourceSchemaVersion ===
			input.currentSource.sourceSchemaVersion &&
		input.runSource.sourceRevision === input.currentSource.sourceRevision &&
		input.runSource.sourceContentHash === input.currentSource.sourceContentHash
	);
}

export function deriveQuickImageFactLockEffectiveStatus(input: {
	status: FactLockRunStatus;
	sourceCurrent: boolean;
	dependenciesCurrent: boolean;
}): FactLockEffectiveStatus {
	if (
		(input.status === "passed" || input.status === "review_required") &&
		(!input.sourceCurrent || !input.dependenciesCurrent)
	)
		return "stale";
	return input.status;
}

export type QuickImageRenderUiState =
	| "READY"
	| "QUEUED"
	| "RUNNING"
	| "BLOCKED"
	| "FAILED"
	| "INDETERMINATE"
	| "COMPLETED";

export type QuickImageRenderStatusValue =
	| "QUEUED"
	| "RUNNING"
	| "BLOCKED"
	| "FAILED"
	| "INDETERMINATE"
	| "COMPLETED";

export function resolveQuickImageRenderUiState(input: {
	status: QuickImageRenderStatusValue | null;
}): QuickImageRenderUiState {
	return input.status ?? "READY";
}

export function shouldPollQuickImageRender(
	status: QuickImageRenderStatusValue | null,
) {
	return status === "QUEUED" || status === "RUNNING";
}

export function aiOperationStatusLabel(status: string) {
	if (status === "INDETERMINATE") return "Cần reconcile / review";
	if (status === "COMPLETED") return "Hoàn tất";
	if (status === "FAILED") return "Failed rõ ràng";
	return "Đang chờ";
}

export function aiOperationRecoveryLabel(status: string) {
	return status === "INDETERMINATE" ? "Review / reconcile" : "—";
}

export function aiExecutionIsBlocked(
	releaseGate: { paidExecutionReleased: boolean } | null | undefined,
) {
	return releaseGate?.paidExecutionReleased !== true;
}

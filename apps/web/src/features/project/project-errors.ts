const PROJECT_ERROR_MESSAGES: Record<string, string> = {
	PROJECT_NOT_FOUND: "Không tìm thấy dự án hoặc bạn không có quyền truy cập.",
	PRODUCT_NOT_FOUND:
		"Sản phẩm không tồn tại hoặc không thuộc workspace của bạn.",
	FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
	"Your account does not belong to an AffiChannel workspace.":
		"Tài khoản của bạn chưa thuộc workspace AffiChannel.",
};

export function getProjectErrorMessage(error: unknown, fallback: string) {
	if (!error || typeof error !== "object") {
		return fallback;
	}

	const candidate = error as { code?: unknown; message?: unknown };
	const code = typeof candidate.code === "string" ? candidate.code : undefined;
	const message =
		typeof candidate.message === "string" ? candidate.message : undefined;

	return (
		PROJECT_ERROR_MESSAGES[code ?? ""] ??
		PROJECT_ERROR_MESSAGES[message ?? ""] ??
		fallback
	);
}

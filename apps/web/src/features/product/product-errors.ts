type ProductErrorShape = {
	code?: string;
	message?: string;
	data?: {
		code?: string;
		projectCount?: number;
	};
};

function getProductErrorCode(error: unknown) {
	if (!error || typeof error !== "object") {
		return undefined;
	}

	const candidate = error as ProductErrorShape;
	return candidate.data?.code ?? candidate.code ?? candidate.message;
}

export function getProductErrorMessage(
	error: unknown,
	fallback = "Không thể xử lý sản phẩm. Hãy thử lại.",
) {
	switch (getProductErrorCode(error)) {
		case "PRODUCT_IN_USE": {
			const count = (error as ProductErrorShape).data?.projectCount ?? 0;
			return `Không thể xóa sản phẩm vì đang được dùng bởi ${count} dự án.`;
		}
		case "PRODUCT_NOT_FOUND":
			return "Không tìm thấy sản phẩm hoặc bạn không có quyền truy cập.";
		case "INVALID_CURSOR":
			return "Danh sách sản phẩm đã thay đổi. Hãy tải lại trang.";
		default:
			return fallback;
	}
}

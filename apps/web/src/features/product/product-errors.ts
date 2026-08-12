type ProductErrorShape = {
	code?: string;
	message?: string;
	data?: {
		code?: string;
		projectCount?: number;
		factCount?: number;
		factHistoryCount?: number;
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
			const data = (error as ProductErrorShape).data;
			const projectCount = data?.projectCount ?? 0;
			const factCount = data?.factCount ?? 0;
			const factHistoryCount = data?.factHistoryCount ?? 0;
			if (factCount > 0 || factHistoryCount > 0) {
				return "Không thể xóa sản phẩm vì đang có Product Facts hoặc lịch sử Fact. Hãy lưu trữ sản phẩm thay thế.";
			}
			return `Không thể xóa sản phẩm vì đang được dùng bởi ${projectCount} dự án.`;
		}
		case "PRODUCT_NOT_FOUND":
			return "Không tìm thấy sản phẩm hoặc bạn không có quyền truy cập.";
		case "INVALID_CURSOR":
			return "Danh sách sản phẩm đã thay đổi. Hãy tải lại trang.";
		default:
			return fallback;
	}
}

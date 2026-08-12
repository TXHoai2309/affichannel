type ProductFactErrorShape = {
	code?: string;
	message?: string;
	data?: { code?: string };
};

function getFactErrorCode(error: unknown) {
	if (!error || typeof error !== "object") {
		return undefined;
	}
	const candidate = error as ProductFactErrorShape;
	return candidate.data?.code ?? candidate.code ?? candidate.message;
}

export function getFactErrorMessage(
	error: unknown,
	fallback = "Không thể xử lý Product Fact. Hãy thử lại.",
) {
	switch (getFactErrorCode(error)) {
		case "FACT_EVIDENCE_REQUIRED":
			return "Fact này cần nguồn, nhãn hoặc URL nguồn, và ngày xác nhận trước khi được xác minh.";
		case "FACT_INVALID_DATE_RANGE":
			return "Ngày hết hạn phải bằng hoặc sau ngày xác nhận.";
		case "PRODUCT_NOT_FOUND":
			return "Không tìm thấy sản phẩm hoặc bạn không có quyền truy cập.";
		case "FACT_NOT_FOUND":
			return "Product Fact không còn tồn tại hoặc bạn không có quyền truy cập.";
		case "INVALID_CURSOR":
			return "Danh sách Product Facts đã thay đổi. Hãy tải lại trang.";
		case "FACT_CONCURRENT_MODIFICATION":
			return "Product Fact vừa được thay đổi ở nơi khác. Hãy tải lại dữ liệu trước khi tiếp tục.";
		default:
			return fallback;
	}
}

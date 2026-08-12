import type {
	ProductFactSourceType,
	ProductFactStatus,
	ProductFactType,
} from "@affichannel/core/product-fact/types";

export const FACT_TYPE_LABELS: Record<ProductFactType, string> = {
	price: "Giá",
	promotion: "Khuyến mãi",
	specification: "Thông số",
	feature: "Tính năng",
	claim: "Claim",
	policy: "Chính sách",
	other: "Khác",
};

export const FACT_STATUS_LABELS: Record<ProductFactStatus, string> = {
	draft: "Bản nháp",
	verified: "Đã xác minh",
	inactive: "Không sử dụng",
};

export const FACT_SOURCE_LABELS: Record<ProductFactSourceType, string> = {
	official: "Nguồn chính thức",
	marketplace: "Marketplace",
	document: "Tài liệu",
};

export const FACT_TYPES = Object.keys(FACT_TYPE_LABELS) as ProductFactType[];
export const FACT_STATUSES = Object.keys(
	FACT_STATUS_LABELS,
) as ProductFactStatus[];
export const FACT_SOURCE_TYPES = Object.keys(
	FACT_SOURCE_LABELS,
) as ProductFactSourceType[];

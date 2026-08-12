import type { ProjectStepKey } from "@affichannel/core/project/project-types";

export type ProductStatus = "active" | "inactive";
export type ProductArchiveScope = "activeOnly" | "archivedOnly" | "all";

export type ProductListItem = {
	id: string;
	name: string;
	category: string | null;
	status: string;
	thumbnailUrl: string | null;
	sourceUrl: string | null;
	affiliateUrl: string | null;
	priceAmount: number | null;
	currency: string;
	archivedAt: string | Date | null;
	createdByUserId: string;
	createdAt: string | Date;
	updatedAt: string | Date;
};

export type ProductUsage = {
	referenceCount: number;
	activeProjectCount: number;
	projects: Array<{
		id: string;
		name: string;
		currentStepKey: ProjectStepKey;
		archivedAt: string | Date | null;
	}>;
};

export type ProductDetails = ProductListItem & {
	usage: ProductUsage;
};

export function isArchivedProduct(
	product: Pick<ProductListItem, "archivedAt">,
) {
	return Boolean(product.archivedAt);
}

export function getProductStatusLabel(
	product: Pick<ProductListItem, "status" | "archivedAt">,
) {
	if (isArchivedProduct(product)) {
		return "Đã lưu trữ";
	}

	return product.status === "inactive" ? "Tạm ngưng" : "Đang hoạt động";
}

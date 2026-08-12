import { Badge } from "@affichannel/ui/components/badge";

import {
	getProductStatusLabel,
	isArchivedProduct,
	type ProductListItem,
} from "./product-types";

export function ProductStatusBadge({
	product,
}: {
	product: Pick<ProductListItem, "status" | "archivedAt">;
}) {
	const label = getProductStatusLabel(product);

	return (
		<Badge
			variant={
				isArchivedProduct(product)
					? "outline"
					: product.status === "inactive"
						? "warning"
						: "success"
			}
		>
			{label}
		</Badge>
	);
}

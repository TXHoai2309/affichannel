import { Card, CardContent, CardHeader } from "@affichannel/ui/components/card";
import type { Route } from "next";
import Link from "next/link";

import { ProductStatusBadge } from "./product-status-badge";
import { ProductThumbnail } from "./product-thumbnail";
import type { ProductListItem } from "./product-types";

const PRICE_FORMATTER = new Intl.NumberFormat("vi-VN", {
	style: "currency",
	currency: "VND",
	maximumFractionDigits: 0,
});

function formatPrice(priceAmount: number | null) {
	return priceAmount === null
		? "Chưa khai báo giá"
		: PRICE_FORMATTER.format(priceAmount);
}

export function ProductCard({ product }: { product: ProductListItem }) {
	return (
		<Link
			aria-label={`Mở chi tiết sản phẩm ${product.name}`}
			className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
			href={`/products/${product.id}` as Route}
		>
			<Card className="h-full transition-shadow group-hover:shadow-md group-focus-visible:shadow-md">
				<ProductThumbnail
					className="h-36 w-full rounded-none"
					name={product.name}
					thumbnailUrl={product.thumbnailUrl}
				/>
				<CardHeader className="gap-3">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<h2 className="truncate font-semibold text-base tracking-tight">
								{product.name}
							</h2>
							<p className="mt-1 truncate text-muted-foreground text-sm">
								{product.category || "Chưa phân loại"}
							</p>
						</div>
						<ProductStatusBadge product={product} />
					</div>
				</CardHeader>
				<CardContent className="mt-auto border-t pt-3 text-muted-foreground text-xs">
					<div className="flex items-center justify-between gap-3">
						<span>Giá tham khảo</span>
						<span className="font-medium text-foreground">
							{formatPrice(product.priceAmount)}
						</span>
					</div>
				</CardContent>
			</Card>
		</Link>
	);
}

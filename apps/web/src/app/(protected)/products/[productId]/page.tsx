import { ProductDetail } from "@/features/product/product-detail";

export default async function ProductDetailPage({
	params,
}: {
	params: Promise<{ productId: string }>;
}) {
	const { productId } = await params;
	return <ProductDetail productId={productId} />;
}

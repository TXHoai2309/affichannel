import { ProductForm } from "@/features/product/product-form";

export default async function EditProductPage({
	params,
}: {
	params: Promise<{ productId: string }>;
}) {
	const { productId } = await params;
	return <ProductForm productId={productId} />;
}

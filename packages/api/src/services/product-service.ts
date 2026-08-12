import { randomUUID } from "node:crypto";
import { ProductServiceError } from "@affichannel/core/product/product-errors";
import type {
	CreateMinimalProductInput,
	CreateProductInput,
	ListProductInput,
	UpdateProductInput,
} from "@affichannel/core/product/validation";
import {
	archiveProductRecord,
	deleteProductRecord,
	findProduct,
	findProductUsage,
	insertProduct,
	listMinimalProducts as listMinimalProductRecords,
	listProducts as listProductRecords,
	restoreProductRecord,
	updateProductRecord,
} from "./product-repository";
import type { WorkspaceActor } from "./workspace";

export async function listMinimalProducts(
	actor: WorkspaceActor,
	input: { selectableOnly?: boolean } = {},
) {
	return listMinimalProductRecords(actor, input.selectableOnly ?? true);
}

export async function createMinimalProduct(
	actor: WorkspaceActor,
	input: CreateMinimalProductInput,
) {
	const createdProduct = await insertProduct(actor, {
		id: randomUUID(),
		name: input.name,
		category: input.category,
		status: "active",
		priceAmount: null,
		currency: "VND",
	});

	if (!createdProduct) {
		throw new Error("Could not create the product.");
	}

	return {
		id: createdProduct.id,
		name: createdProduct.name,
		category: createdProduct.category,
	};
}

export async function listProducts(
	actor: WorkspaceActor,
	input: ListProductInput,
) {
	const result = await listProductRecords(actor, input);

	if (result.kind === "invalid_cursor") {
		throw new ProductServiceError("INVALID_CURSOR");
	}

	return result;
}

export async function getProduct(actor: WorkspaceActor, productId: string) {
	const [record, usage] = await Promise.all([
		findProduct(actor, productId),
		findProductUsage(actor, productId),
	]);

	if (!record) {
		throw new ProductServiceError("PRODUCT_NOT_FOUND");
	}

	return { ...record, usage };
}

export async function createProduct(
	actor: WorkspaceActor,
	input: CreateProductInput,
) {
	const record = await insertProduct(actor, {
		id: randomUUID(),
		...input,
	});

	if (!record) {
		throw new Error("Could not create the product.");
	}

	return { ...record, usage: await findProductUsage(actor, record.id) };
}

export async function updateProduct(
	actor: WorkspaceActor,
	productId: string,
	input: UpdateProductInput,
) {
	const record = await updateProductRecord(actor, productId, input);

	if (!record) {
		throw new ProductServiceError("PRODUCT_NOT_FOUND");
	}

	return { ...record, usage: await findProductUsage(actor, record.id) };
}

export async function archiveProduct(actor: WorkspaceActor, productId: string) {
	const record = await archiveProductRecord(actor, productId);

	if (record) {
		return { ...record, usage: await findProductUsage(actor, record.id) };
	}

	return getProduct(actor, productId);
}

export async function restoreProduct(actor: WorkspaceActor, productId: string) {
	const record = await restoreProductRecord(actor, productId);

	if (record) {
		return { ...record, usage: await findProductUsage(actor, record.id) };
	}

	return getProduct(actor, productId);
}

export async function deleteProduct(actor: WorkspaceActor, productId: string) {
	const result = await deleteProductRecord(actor, productId);

	if (result.kind === "not_found") {
		throw new ProductServiceError("PRODUCT_NOT_FOUND");
	}

	if (result.kind === "in_use") {
		throw new ProductServiceError("PRODUCT_IN_USE", {
			projectCount: result.referenceCount,
		});
	}

	return { deleted: true };
}

import { randomUUID } from "node:crypto";
import type { CreateMinimalProductInput } from "@affichannel/core/product/validation";
import { db, product } from "@affichannel/db";
import { and, desc, eq, isNull } from "drizzle-orm";

import type { WorkspaceActor } from "./workspace";

export type MinimalProduct = {
	id: string;
	name: string;
	category: string | null;
};

export async function listMinimalProducts(
	actor: WorkspaceActor,
): Promise<MinimalProduct[]> {
	return db
		.select({
			id: product.id,
			name: product.name,
			category: product.category,
		})
		.from(product)
		.where(
			and(
				eq(product.workspaceId, actor.workspaceId),
				isNull(product.archivedAt),
			),
		)
		.orderBy(desc(product.updatedAt));
}

export async function createMinimalProduct(
	actor: WorkspaceActor,
	input: CreateMinimalProductInput,
): Promise<MinimalProduct> {
	const [createdProduct] = await db
		.insert(product)
		.values({
			id: randomUUID(),
			workspaceId: actor.workspaceId,
			name: input.name,
			category: input.category,
			createdByUserId: actor.userId,
		})
		.returning({
			id: product.id,
			name: product.name,
			category: product.category,
		});

	if (!createdProduct) {
		throw new Error("Could not create the product.");
	}

	return createdProduct;
}

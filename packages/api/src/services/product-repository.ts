import {
	db,
	product,
	productFact,
	productFactHistory,
	project,
} from "@affichannel/db";
import {
	and,
	desc,
	eq,
	ilike,
	isNotNull,
	isNull,
	lt,
	or,
	sql,
} from "drizzle-orm";

import type { WorkspaceActor } from "./workspace";

export type ProductRecord = {
	id: string;
	workspaceId: string;
	name: string;
	category: string | null;
	status: "active" | "inactive";
	thumbnailUrl: string | null;
	sourceUrl: string | null;
	affiliateUrl: string | null;
	priceAmount: number | null;
	currency: "VND";
	archivedAt: Date | null;
	createdByUserId: string;
	createdAt: Date;
	updatedAt: Date;
};

function toProductRecord(
	record: Omit<ProductRecord, "status" | "currency"> & {
		status: string;
		currency: string;
	},
): ProductRecord {
	return {
		...record,
		status: record.status as ProductRecord["status"],
		currency: record.currency as ProductRecord["currency"],
	};
}

export type ProductUsageRecord = {
	referenceCount: number;
	activeProjectCount: number;
	factCount: number;
	factHistoryCount: number;
	verifiedFactCount: number;
	draftFactCount: number;
	inactiveFactCount: number;
	projects: Array<{
		id: string;
		name: string;
		archivedAt: Date | null;
	}>;
};

const productColumns = {
	id: product.id,
	workspaceId: product.workspaceId,
	name: product.name,
	category: product.category,
	status: product.status,
	thumbnailUrl: product.thumbnailUrl,
	sourceUrl: product.sourceUrl,
	affiliateUrl: product.affiliateUrl,
	priceAmount: product.priceAmount,
	currency: product.currency,
	archivedAt: product.archivedAt,
	createdByUserId: product.createdByUserId,
	createdAt: product.createdAt,
	updatedAt: product.updatedAt,
};

function escapeLikePattern(value: string) {
	return value.replace(/[\\%_]/g, "\\$&");
}

type ProductCursor = {
	updatedAt: string;
	id: string;
};

export function encodeProductCursor(cursor: ProductCursor) {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProductCursor(value: string): ProductCursor | undefined {
	try {
		const parsed = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		) as Partial<ProductCursor>;

		if (
			typeof parsed.updatedAt !== "string" ||
			typeof parsed.id !== "string" ||
			!parsed.id
		) {
			return undefined;
		}

		const date = new Date(parsed.updatedAt);
		return Number.isNaN(date.getTime())
			? undefined
			: { updatedAt: date.toISOString(), id: parsed.id };
	} catch {
		return undefined;
	}
}

export async function listMinimalProducts(
	actor: WorkspaceActor,
	selectableOnly = true,
) {
	const conditions = [
		eq(product.workspaceId, actor.workspaceId),
		...(selectableOnly
			? [eq(product.status, "active"), isNull(product.archivedAt)]
			: []),
	];

	return db
		.select({
			id: product.id,
			name: product.name,
			category: product.category,
			status: product.status,
			archivedAt: product.archivedAt,
		})
		.from(product)
		.where(and(...conditions))
		.orderBy(desc(product.updatedAt), desc(product.id));
}

export async function listProducts(
	actor: WorkspaceActor,
	input: {
		search?: string;
		category?: string;
		status?: "active" | "inactive";
		archiveScope: "activeOnly" | "archivedOnly" | "all";
		limit: number;
		cursor?: string;
	},
) {
	const conditions = [eq(product.workspaceId, actor.workspaceId)];

	if (input.archiveScope === "activeOnly") {
		conditions.push(isNull(product.archivedAt));
	} else if (input.archiveScope === "archivedOnly") {
		conditions.push(isNotNull(product.archivedAt));
	}

	if (input.search) {
		conditions.push(
			ilike(product.name, `%${escapeLikePattern(input.search)}%`),
		);
	}

	if (input.category) {
		conditions.push(ilike(product.category, input.category));
	}

	if (input.status) {
		conditions.push(eq(product.status, input.status));
	}

	if (input.cursor) {
		const cursor = decodeProductCursor(input.cursor);

		if (!cursor) {
			return { kind: "invalid_cursor" as const };
		}

		const cursorCondition = or(
			lt(product.updatedAt, new Date(cursor.updatedAt)),
			and(
				eq(product.updatedAt, new Date(cursor.updatedAt)),
				lt(product.id, cursor.id),
			),
		);

		if (cursorCondition) {
			conditions.push(cursorCondition);
		}
	}

	const records = await db
		.select(productColumns)
		.from(product)
		.where(and(...conditions))
		.orderBy(desc(product.updatedAt), desc(product.id))
		.limit(input.limit + 1);

	const hasNextPage = records.length > input.limit;
	const items = records.slice(0, input.limit);
	const lastItem = items.at(-1);

	return {
		kind: "success" as const,
		items: items.map(toProductRecord),
		nextCursor:
			hasNextPage && lastItem
				? encodeProductCursor({
						updatedAt: lastItem.updatedAt.toISOString(),
						id: lastItem.id,
					})
				: null,
	};
}

export async function findProduct(
	actor: WorkspaceActor,
	productId: string,
): Promise<ProductRecord | undefined> {
	const [record] = await db
		.select(productColumns)
		.from(product)
		.where(
			and(
				eq(product.id, productId),
				eq(product.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);

	return record ? toProductRecord(record) : undefined;
}

export async function findProductUsage(
	actor: WorkspaceActor,
	productId: string,
): Promise<ProductUsageRecord> {
	const [projectRecords, factCounts, factHistoryCountRows] = await Promise.all([
		db
			.select({
				id: project.id,
				name: project.name,
				archivedAt: project.archivedAt,
			})
			.from(project)
			.where(
				and(
					eq(project.productId, productId),
					eq(project.workspaceId, actor.workspaceId),
				),
			)
			.orderBy(desc(project.updatedAt), desc(project.id)),
		db
			.select({
				status: productFact.status,
				count: sql<number>`count(*)::int`,
			})
			.from(productFact)
			.where(
				and(
					eq(productFact.productId, productId),
					eq(productFact.workspaceId, actor.workspaceId),
				),
			)
			.groupBy(productFact.status),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(productFactHistory)
			.where(
				and(
					eq(productFactHistory.productId, productId),
					eq(productFactHistory.workspaceId, actor.workspaceId),
				),
			),
	]);

	const factsByStatus = new Map(
		factCounts.map((row) => [row.status, row.count]),
	);
	const factCount = factCounts.reduce((total, row) => total + row.count, 0);
	const factHistoryCount = factHistoryCountRows[0]?.count ?? 0;

	return {
		referenceCount: projectRecords.length,
		activeProjectCount: projectRecords.filter(
			(projectRecord) => projectRecord.archivedAt === null,
		).length,
		factCount,
		verifiedFactCount: factsByStatus.get("verified") ?? 0,
		draftFactCount: factsByStatus.get("draft") ?? 0,
		inactiveFactCount: factsByStatus.get("inactive") ?? 0,
		factHistoryCount,
		projects: projectRecords,
	};
}

export async function insertProduct(
	actor: WorkspaceActor,
	values: {
		id: string;
		name: string;
		category?: string;
		status: "active" | "inactive";
		thumbnailUrl?: string;
		sourceUrl?: string;
		affiliateUrl?: string;
		priceAmount: number | null;
		currency: "VND";
	},
) {
	const [record] = await db
		.insert(product)
		.values({
			id: values.id,
			workspaceId: actor.workspaceId,
			name: values.name,
			category: values.category,
			status: values.status,
			thumbnailUrl: values.thumbnailUrl,
			sourceUrl: values.sourceUrl,
			affiliateUrl: values.affiliateUrl,
			priceAmount: values.priceAmount,
			currency: values.currency,
			createdByUserId: actor.userId,
		})
		.returning(productColumns);

	return record ? toProductRecord(record) : undefined;
}

export async function updateProductRecord(
	actor: WorkspaceActor,
	productId: string,
	values: Omit<Parameters<typeof insertProduct>[1], "id">,
) {
	const [record] = await db
		.update(product)
		.set({
			name: values.name,
			category: values.category,
			status: values.status,
			thumbnailUrl: values.thumbnailUrl,
			sourceUrl: values.sourceUrl,
			affiliateUrl: values.affiliateUrl,
			priceAmount: values.priceAmount,
			currency: values.currency,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(product.id, productId),
				eq(product.workspaceId, actor.workspaceId),
			),
		)
		.returning(productColumns);

	return record ? toProductRecord(record) : undefined;
}

export async function archiveProductRecord(
	actor: WorkspaceActor,
	productId: string,
) {
	const [record] = await db
		.update(product)
		.set({ archivedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(product.id, productId),
				eq(product.workspaceId, actor.workspaceId),
				isNull(product.archivedAt),
			),
		)
		.returning(productColumns);

	return record ? toProductRecord(record) : undefined;
}

export async function restoreProductRecord(
	actor: WorkspaceActor,
	productId: string,
) {
	const [record] = await db
		.update(product)
		.set({ archivedAt: null, updatedAt: new Date() })
		.where(
			and(
				eq(product.id, productId),
				eq(product.workspaceId, actor.workspaceId),
				isNotNull(product.archivedAt),
			),
		)
		.returning(productColumns);

	return record ? toProductRecord(record) : undefined;
}

export async function deleteProductRecord(
	actor: WorkspaceActor,
	productId: string,
) {
	return db.transaction(async (transaction) => {
		const [existingProduct] = await transaction
			.select({ id: product.id })
			.from(product)
			.where(
				and(
					eq(product.id, productId),
					eq(product.workspaceId, actor.workspaceId),
				),
			)
			.limit(1);

		if (!existingProduct) {
			return { kind: "not_found" as const };
		}

		const [references, facts, factHistory] = await Promise.all([
			transaction
				.select({ count: sql<number>`count(*)::int` })
				.from(project)
				.where(
					and(
						eq(project.productId, productId),
						eq(project.workspaceId, actor.workspaceId),
					),
				),
			transaction
				.select({ count: sql<number>`count(*)::int` })
				.from(productFact)
				.where(
					and(
						eq(productFact.productId, productId),
						eq(productFact.workspaceId, actor.workspaceId),
					),
				),
			transaction
				.select({ count: sql<number>`count(*)::int` })
				.from(productFactHistory)
				.where(
					and(
						eq(productFactHistory.productId, productId),
						eq(productFactHistory.workspaceId, actor.workspaceId),
					),
				),
		]);
		const projectCount = references[0]?.count ?? 0;
		const factCount = facts[0]?.count ?? 0;
		const factHistoryCount = factHistory[0]?.count ?? 0;

		if (projectCount > 0 || factCount > 0 || factHistoryCount > 0) {
			return {
				kind: "in_use" as const,
				projectCount,
				factCount,
				factHistoryCount,
			};
		}

		await transaction
			.delete(product)
			.where(
				and(
					eq(product.id, productId),
					eq(product.workspaceId, actor.workspaceId),
				),
			);

		return { kind: "deleted" as const };
	});
}

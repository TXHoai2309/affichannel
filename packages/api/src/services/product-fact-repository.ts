import { randomUUID } from "node:crypto";
import { hasDependencyRelevantFactChanges } from "@affichannel/core/product-fact/eligibility";
import type {
	ProductFactHistoryAction,
	ProductFactRecord,
	ProductFactSourceType,
	ProductFactStatus,
	ProductFactType,
} from "@affichannel/core/product-fact/types";
import type { ProductFactFields } from "@affichannel/core/product-fact/validation";
import { db, product, productFact, productFactHistory } from "@affichannel/db";
import { and, desc, eq, ilike, lt, or } from "drizzle-orm";
import { invalidateFactDependencies } from "./fact-dependency-repository";
import type { WorkspaceActor } from "./workspace";

const factColumns = {
	id: productFact.id,
	workspaceId: productFact.workspaceId,
	productId: productFact.productId,
	revision: productFact.revision,
	content: productFact.content,
	type: productFact.type,
	status: productFact.status,
	sourceType: productFact.sourceType,
	sourceLabel: productFact.sourceLabel,
	sourceUrl: productFact.sourceUrl,
	confirmedAt: productFact.confirmedAt,
	expiresAt: productFact.expiresAt,
	notes: productFact.notes,
	createdByUserId: productFact.createdByUserId,
	updatedByUserId: productFact.updatedByUserId,
	createdAt: productFact.createdAt,
	updatedAt: productFact.updatedAt,
};

const historyColumns = {
	id: productFactHistory.id,
	productFactId: productFactHistory.productFactId,
	productId: productFactHistory.productId,
	workspaceId: productFactHistory.workspaceId,
	revision: productFactHistory.revision,
	action: productFactHistory.action,
	content: productFactHistory.content,
	type: productFactHistory.type,
	status: productFactHistory.status,
	sourceType: productFactHistory.sourceType,
	sourceLabel: productFactHistory.sourceLabel,
	sourceUrl: productFactHistory.sourceUrl,
	confirmedAt: productFactHistory.confirmedAt,
	expiresAt: productFactHistory.expiresAt,
	notes: productFactHistory.notes,
	changedByUserId: productFactHistory.changedByUserId,
	changedAt: productFactHistory.changedAt,
};

type RawFactRecord = typeof productFact.$inferSelect;

function toFactRecord(record: RawFactRecord): ProductFactRecord {
	return {
		...record,
		type: record.type as ProductFactType,
		status: record.status as ProductFactStatus,
		sourceType: record.sourceType as ProductFactSourceType | null,
	};
}

type RawHistoryRecord = typeof productFactHistory.$inferSelect;

function toHistoryRecord(record: RawHistoryRecord) {
	return {
		...record,
		action: record.action as ProductFactHistoryAction,
		type: record.type as ProductFactType,
		status: record.status as ProductFactStatus,
		sourceType: record.sourceType as ProductFactSourceType | null,
	};
}

function escapeLikePattern(value: string) {
	return value.replace(/[\\%_]/g, "\\$&");
}

type ProductFactCursor = {
	updatedAt: string;
	id: string;
};

export function encodeProductFactCursor(cursor: ProductFactCursor) {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProductFactCursor(
	value: string,
): ProductFactCursor | undefined {
	try {
		const parsed = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		) as Partial<ProductFactCursor>;
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

async function findProductParent(actor: WorkspaceActor, productId: string) {
	const [parent] = await db
		.select({ id: product.id })
		.from(product)
		.where(
			and(
				eq(product.id, productId),
				eq(product.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return parent;
}

function snapshotValues(
	fact: Pick<
		ProductFactRecord,
		| "id"
		| "productId"
		| "workspaceId"
		| "revision"
		| "content"
		| "type"
		| "status"
		| "sourceType"
		| "sourceLabel"
		| "sourceUrl"
		| "confirmedAt"
		| "expiresAt"
		| "notes"
	>,
	action: ProductFactHistoryAction,
	changedByUserId: string,
) {
	return {
		id: randomUUID(),
		productFactId: fact.id,
		productId: fact.productId,
		workspaceId: fact.workspaceId,
		revision: fact.revision,
		action,
		content: fact.content,
		type: fact.type,
		status: fact.status,
		sourceType: fact.sourceType,
		sourceLabel: fact.sourceLabel,
		sourceUrl: fact.sourceUrl,
		confirmedAt: fact.confirmedAt,
		expiresAt: fact.expiresAt,
		notes: fact.notes,
		changedByUserId,
	};
}

export async function listProductFactRecords(
	actor: WorkspaceActor,
	input: {
		productId: string;
		search?: string;
		type?: string;
		status?: string;
		limit: number;
		cursor?: string;
	},
) {
	const parent = await findProductParent(actor, input.productId);
	if (!parent) {
		return { kind: "product_not_found" as const };
	}

	const conditions = [
		eq(productFact.productId, input.productId),
		eq(productFact.workspaceId, actor.workspaceId),
		eq(product.workspaceId, actor.workspaceId),
	];
	if (input.search) {
		conditions.push(
			ilike(productFact.content, `%${escapeLikePattern(input.search)}%`),
		);
	}
	if (input.type) {
		conditions.push(eq(productFact.type, input.type));
	}
	if (input.status) {
		conditions.push(eq(productFact.status, input.status));
	}
	if (input.cursor) {
		const cursor = decodeProductFactCursor(input.cursor);
		if (!cursor) {
			return { kind: "invalid_cursor" as const };
		}
		const cursorCondition = or(
			lt(productFact.updatedAt, new Date(cursor.updatedAt)),
			and(
				eq(productFact.updatedAt, new Date(cursor.updatedAt)),
				lt(productFact.id, cursor.id),
			),
		);
		if (cursorCondition) {
			conditions.push(cursorCondition);
		}
	}

	const records = await db
		.select(factColumns)
		.from(productFact)
		.innerJoin(product, eq(product.id, productFact.productId))
		.where(and(...conditions))
		.orderBy(desc(productFact.updatedAt), desc(productFact.id))
		.limit(input.limit + 1);

	const hasNextPage = records.length > input.limit;
	const items = records.slice(0, input.limit);
	const lastItem = items.at(-1);
	return {
		kind: "success" as const,
		items: items.map((record) => toFactRecord(record as RawFactRecord)),
		nextCursor:
			hasNextPage && lastItem
				? encodeProductFactCursor({
						updatedAt: lastItem.updatedAt.toISOString(),
						id: lastItem.id,
					})
				: null,
	};
}

export async function findProductFactRecord(
	actor: WorkspaceActor,
	factId: string,
) {
	const [record] = await db
		.select(factColumns)
		.from(productFact)
		.innerJoin(product, eq(product.id, productFact.productId))
		.where(
			and(
				eq(productFact.id, factId),
				eq(productFact.workspaceId, actor.workspaceId),
				eq(product.workspaceId, actor.workspaceId),
			),
		)
		.limit(1);
	return record ? toFactRecord(record as RawFactRecord) : undefined;
}

export async function insertProductFactRecord(
	actor: WorkspaceActor,
	productId: string,
	data: ProductFactFields,
) {
	return db.transaction(async (transaction) => {
		const [parent] = await transaction
			.select({ id: product.id })
			.from(product)
			.where(
				and(
					eq(product.id, productId),
					eq(product.workspaceId, actor.workspaceId),
				),
			)
			.limit(1);
		if (!parent) {
			return { kind: "product_not_found" as const };
		}

		const id = randomUUID();
		const [created] = await transaction
			.insert(productFact)
			.values({
				id,
				workspaceId: actor.workspaceId,
				productId,
				...data,
				createdByUserId: actor.userId,
				updatedByUserId: actor.userId,
			})
			.returning(factColumns);
		if (!created) {
			throw new Error("Could not create the Product Fact.");
		}

		const record = toFactRecord(created as RawFactRecord);
		await transaction
			.insert(productFactHistory)
			.values(snapshotValues(record, "created", actor.userId));
		return { kind: "success" as const, record };
	});
}

export async function updateProductFactRecord(
	actor: WorkspaceActor,
	factId: string,
	data: ProductFactFields,
	expectedRevision: number,
) {
	return db.transaction(async (transaction) => {
		const [current] = await transaction
			.select(factColumns)
			.from(productFact)
			.innerJoin(product, eq(product.id, productFact.productId))
			.where(
				and(
					eq(productFact.id, factId),
					eq(productFact.workspaceId, actor.workspaceId),
					eq(product.workspaceId, actor.workspaceId),
				),
			)
			.limit(1)
			.for("update", { of: productFact });
		if (!current) {
			return { kind: "not_found" as const };
		}

		const currentRecord = toFactRecord(current as RawFactRecord);
		if (currentRecord.revision !== expectedRevision) {
			return { kind: "concurrent_modification" as const };
		}

		const dependencyRelevantChanged = hasDependencyRelevantFactChanges(
			currentRecord,
			data,
		);
		const nextRevision = dependencyRelevantChanged
			? currentRecord.revision + 1
			: currentRecord.revision;
		const action: ProductFactHistoryAction =
			currentRecord.status !== data.status &&
			currentRecord.content === data.content &&
			currentRecord.type === data.type &&
			currentRecord.sourceType === data.sourceType &&
			currentRecord.sourceLabel === data.sourceLabel &&
			currentRecord.sourceUrl === data.sourceUrl &&
			currentRecord.confirmedAt === data.confirmedAt &&
			currentRecord.expiresAt === data.expiresAt &&
			currentRecord.notes === data.notes
				? "status_changed"
				: "updated";
		const [updated] = await transaction
			.update(productFact)
			.set({
				...data,
				revision: nextRevision,
				updatedByUserId: actor.userId,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(productFact.id, factId),
					eq(productFact.workspaceId, actor.workspaceId),
					eq(productFact.revision, expectedRevision),
				),
			)
			.returning(factColumns);
		if (!updated) {
			return { kind: "concurrent_modification" as const };
		}
		await transaction
			.insert(productFactHistory)
			.values(snapshotValues(currentRecord, action, actor.userId));
		if (dependencyRelevantChanged) {
			const reason =
				data.status === "inactive" && currentRecord.status !== "inactive"
					? ("fact_deactivated" as const)
					: ("fact_changed" as const);
			await invalidateFactDependencies(transaction, {
				workspaceId: actor.workspaceId,
				productFactId: factId,
				fromRevision: currentRecord.revision,
				toRevision: nextRevision,
				reason,
				triggeredByUserId: actor.userId,
			});
		}
		return {
			kind: "success" as const,
			record: toFactRecord(updated as RawFactRecord),
		};
	});
}

export async function deleteProductFactRecord(
	actor: WorkspaceActor,
	factId: string,
	expectedRevision: number,
) {
	return db.transaction(async (transaction) => {
		const [current] = await transaction
			.select(factColumns)
			.from(productFact)
			.innerJoin(product, eq(product.id, productFact.productId))
			.where(
				and(
					eq(productFact.id, factId),
					eq(productFact.workspaceId, actor.workspaceId),
					eq(product.workspaceId, actor.workspaceId),
				),
			)
			.limit(1)
			.for("update", { of: productFact });
		if (!current) {
			return { kind: "not_found" as const };
		}

		const record = toFactRecord(current as RawFactRecord);
		if (record.revision !== expectedRevision) {
			return { kind: "concurrent_modification" as const };
		}
		const [deleted] = await transaction
			.delete(productFact)
			.where(
				and(
					eq(productFact.id, factId),
					eq(productFact.workspaceId, actor.workspaceId),
					eq(productFact.revision, expectedRevision),
				),
			)
			.returning({ id: productFact.id });
		if (!deleted) {
			return { kind: "concurrent_modification" as const };
		}
		await transaction
			.insert(productFactHistory)
			.values(snapshotValues(record, "deleted", actor.userId));
		await invalidateFactDependencies(transaction, {
			workspaceId: actor.workspaceId,
			productFactId: factId,
			fromRevision: record.revision,
			toRevision: null,
			reason: "fact_deleted",
			triggeredByUserId: actor.userId,
		});
		return { kind: "deleted" as const, productId: record.productId };
	});
}

export async function listProductFactHistoryRecords(
	actor: WorkspaceActor,
	input: { productId: string; factId?: string; limit: number },
) {
	const parent = await findProductParent(actor, input.productId);
	if (!parent) {
		return { kind: "product_not_found" as const };
	}

	const conditions = [
		eq(productFactHistory.productId, input.productId),
		eq(productFactHistory.workspaceId, actor.workspaceId),
	];
	if (input.factId) {
		conditions.push(eq(productFactHistory.productFactId, input.factId));
	}

	const records = await db
		.select(historyColumns)
		.from(productFactHistory)
		.where(and(...conditions))
		.orderBy(desc(productFactHistory.changedAt), desc(productFactHistory.id))
		.limit(input.limit);
	return {
		kind: "success" as const,
		items: records.map((record) => toHistoryRecord(record as RawHistoryRecord)),
	};
}

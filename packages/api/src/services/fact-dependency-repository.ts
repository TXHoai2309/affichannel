import { randomUUID } from "node:crypto";
import type {
	FactDependencyRecord,
	FactDependentType,
	FactInvalidationEventRecord,
	FactInvalidationReason,
	RegisterFactDependencyInput,
	ReplaceFactDependenciesInput,
} from "@affichannel/core/product-fact/dependency";
import {
	db,
	factDependency,
	factInvalidationEvent,
	product,
	productFact,
} from "@affichannel/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { WorkspaceActor } from "./workspace";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const dependencyColumns = {
	id: factDependency.id,
	workspaceId: factDependency.workspaceId,
	productFactId: factDependency.productFactId,
	factRevision: factDependency.factRevision,
	dependentType: factDependency.dependentType,
	dependentId: factDependency.dependentId,
	createdAt: factDependency.createdAt,
	detachedAt: factDependency.detachedAt,
	invalidatedAt: factDependency.invalidatedAt,
	invalidationReason: factDependency.invalidationReason,
};

const invalidationEventColumns = {
	id: factInvalidationEvent.id,
	dependencyId: factInvalidationEvent.dependencyId,
	workspaceId: factInvalidationEvent.workspaceId,
	productFactId: factInvalidationEvent.productFactId,
	fromRevision: factInvalidationEvent.fromRevision,
	toRevision: factInvalidationEvent.toRevision,
	dependentType: factInvalidationEvent.dependentType,
	dependentId: factInvalidationEvent.dependentId,
	reason: factInvalidationEvent.reason,
	triggeredByUserId: factInvalidationEvent.triggeredByUserId,
	createdAt: factInvalidationEvent.createdAt,
};

function toDependencyRecord(
	record: typeof factDependency.$inferSelect,
): FactDependencyRecord {
	return {
		...record,
		dependentType: record.dependentType as FactDependentType,
		invalidationReason:
			record.invalidationReason as FactInvalidationReason | null,
	};
}

function toInvalidationEventRecord(
	record: typeof factInvalidationEvent.$inferSelect,
): FactInvalidationEventRecord {
	return {
		...record,
		dependentType: record.dependentType as FactDependentType,
		reason: record.reason as FactInvalidationReason,
	};
}

async function findFactForActor(
	transaction: DbTransaction,
	actor: WorkspaceActor,
	productFactId: string,
) {
	const [record] = await transaction
		.select({
			id: productFact.id,
			revision: productFact.revision,
		})
		.from(productFact)
		.innerJoin(product, eq(product.id, productFact.productId))
		.where(
			and(
				eq(productFact.id, productFactId),
				eq(productFact.workspaceId, actor.workspaceId),
				eq(product.workspaceId, actor.workspaceId),
			),
		)
		.limit(1)
		.for("update", { of: productFact });
	return record;
}

async function insertActiveDependency(
	transaction: DbTransaction,
	actor: WorkspaceActor,
	fact: { id: string; revision: number },
	dependentType: FactDependentType,
	dependentId: string,
) {
	const [existing] = await transaction
		.select(dependencyColumns)
		.from(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				eq(factDependency.productFactId, fact.id),
				eq(factDependency.factRevision, fact.revision),
				eq(factDependency.dependentType, dependentType),
				eq(factDependency.dependentId, dependentId),
				isNull(factDependency.detachedAt),
				isNull(factDependency.invalidatedAt),
			),
		)
		.limit(1);
	if (existing) return toDependencyRecord(existing);

	const [created] = await transaction
		.insert(factDependency)
		.values({
			id: randomUUID(),
			workspaceId: actor.workspaceId,
			productFactId: fact.id,
			factRevision: fact.revision,
			dependentType,
			dependentId,
		})
		.onConflictDoNothing()
		.returning(dependencyColumns);
	if (created) return toDependencyRecord(created);

	const [retried] = await transaction
		.select(dependencyColumns)
		.from(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				eq(factDependency.productFactId, fact.id),
				eq(factDependency.factRevision, fact.revision),
				eq(factDependency.dependentType, dependentType),
				eq(factDependency.dependentId, dependentId),
				isNull(factDependency.detachedAt),
				isNull(factDependency.invalidatedAt),
			),
		)
		.limit(1);
	if (!retried) throw new Error("Could not register Fact dependency.");
	return toDependencyRecord(retried);
}

export async function registerFactDependenciesInTransaction(
	transaction: DbTransaction,
	actor: WorkspaceActor,
	input: {
		dependentType: FactDependentType;
		dependentId: string;
		facts: Array<{ id: string; revision: number }>;
	},
) {
	const dependencies = [];
	for (const fact of [...input.facts].sort((left, right) => left.id.localeCompare(right.id))) {
		dependencies.push(
			await insertActiveDependency(
				transaction,
				actor,
				fact,
				input.dependentType,
				input.dependentId,
			),
		);
	}
	return dependencies;
}

export async function detachFactDependenciesInTransaction(
	transaction: DbTransaction,
	actor: WorkspaceActor,
	input: { dependentType: FactDependentType; dependentId: string },
) {
	const detachedAt = new Date();
	const detached = await transaction
		.update(factDependency)
		.set({ detachedAt })
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				eq(factDependency.dependentType, input.dependentType),
				eq(factDependency.dependentId, input.dependentId),
				isNull(factDependency.detachedAt),
				isNull(factDependency.invalidatedAt),
			),
		)
		.returning({ id: factDependency.id });
	return detached.length;
}

export async function invalidateFactDependencies(
	transaction: DbTransaction,
	input: {
		workspaceId: string;
		productFactId: string;
		fromRevision: number;
		toRevision: number | null;
		reason: FactInvalidationReason;
		triggeredByUserId: string | null;
	},
) {
	const activeDependencies = await transaction
		.select(dependencyColumns)
		.from(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, input.workspaceId),
				eq(factDependency.productFactId, input.productFactId),
				eq(factDependency.factRevision, input.fromRevision),
				isNull(factDependency.detachedAt),
				isNull(factDependency.invalidatedAt),
			),
		);
	if (activeDependencies.length === 0) return [];

	const invalidatedAt = new Date();
	await transaction
		.update(factDependency)
		.set({ invalidatedAt, invalidationReason: input.reason })
		.where(
			inArray(
				factDependency.id,
				activeDependencies.map((dependency) => dependency.id),
			),
		);

	const events = activeDependencies.map((dependency) => ({
		id: randomUUID(),
		dependencyId: dependency.id,
		workspaceId: input.workspaceId,
		productFactId: input.productFactId,
		fromRevision: input.fromRevision,
		toRevision: input.toRevision,
		dependentType: dependency.dependentType,
		dependentId: dependency.dependentId,
		reason: input.reason,
		triggeredByUserId: input.triggeredByUserId,
		createdAt: invalidatedAt,
	}));
	await transaction
		.insert(factInvalidationEvent)
		.values(events)
		.onConflictDoNothing({ target: factInvalidationEvent.dependencyId });
	return events;
}

export async function registerFactDependency(
	actor: WorkspaceActor,
	input: RegisterFactDependencyInput,
) {
	return db.transaction(async (transaction) => {
		const fact = await findFactForActor(
			transaction,
			actor,
			input.productFactId,
		);
		if (!fact) return { kind: "fact_not_found" as const };

		const [dependency] = await registerFactDependenciesInTransaction(
			transaction,
			actor,
			{ ...input, facts: [fact] },
		);
		return { kind: "success" as const, dependency };
	});
}

export async function replaceFactDependencies(
	actor: WorkspaceActor,
	input: ReplaceFactDependenciesInput,
) {
	const productFactIds = [...new Set(input.productFactIds)];
	return db.transaction(async (transaction) => {
		const facts = [];
		for (const productFactId of [...productFactIds].sort()) {
			const fact = await findFactForActor(transaction, actor, productFactId);
			if (!fact) {
				return { kind: "fact_not_found" as const };
			}
			facts.push(fact);
		}

		const activeDependencies = await transaction
			.select(dependencyColumns)
			.from(factDependency)
			.where(
				and(
					eq(factDependency.workspaceId, actor.workspaceId),
					eq(factDependency.dependentType, input.dependentType),
					eq(factDependency.dependentId, input.dependentId),
					isNull(factDependency.detachedAt),
					isNull(factDependency.invalidatedAt),
				),
			);
		const desiredFactIds = new Set(productFactIds);
		const toDetach = activeDependencies.filter(
			(dependency) => !desiredFactIds.has(dependency.productFactId),
		);
		if (toDetach.length > 0) {
			await transaction
				.update(factDependency)
				.set({ detachedAt: new Date() })
				.where(
					inArray(
						factDependency.id,
						toDetach.map((dependency) => dependency.id),
					),
				);
		}

		const dependencies = await registerFactDependenciesInTransaction(
			transaction,
			actor,
			{ ...input, facts },
		);
		return { kind: "success" as const, dependencies };
	});
}

export async function listFactDependenciesForDependent(
	actor: WorkspaceActor,
	input: { dependentType: FactDependentType; dependentId: string },
) {
	const records = await db
		.select(dependencyColumns)
		.from(factDependency)
		.where(
			and(
				eq(factDependency.workspaceId, actor.workspaceId),
				eq(factDependency.dependentType, input.dependentType),
				eq(factDependency.dependentId, input.dependentId),
			),
		);
	return records.map(toDependencyRecord);
}

export async function listFactInvalidationEventsForDependent(
	actor: WorkspaceActor,
	input: { dependentType: FactDependentType; dependentId: string },
) {
	const records = await db
		.select(invalidationEventColumns)
		.from(factInvalidationEvent)
		.where(
			and(
				eq(factInvalidationEvent.workspaceId, actor.workspaceId),
				eq(factInvalidationEvent.dependentType, input.dependentType),
				eq(factInvalidationEvent.dependentId, input.dependentId),
			),
		);
	return records.map(toInvalidationEventRecord);
}

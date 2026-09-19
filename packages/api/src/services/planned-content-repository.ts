import { randomUUID } from "node:crypto";
import {
	addCalendarDays,
	type CalendarWindow,
	calculateMixActualCounts,
	calculateMixTargetCounts,
	createProject,
	createProjectInputSchema,
	generateDeterministicPlan,
	getSevenDayWindow,
	type PlannedContentItemReadModel,
	type PlannedContentItemSemantic,
	ProjectServiceError,
	plannedContentItemSemanticSchema,
} from "@affichannel/core";
import {
	channelStrategy,
	db,
	plannedContentItem,
	product,
	workspace,
} from "@affichannel/db";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { getCurrentChannelStrategy } from "./channel-strategy-repository";
import type { DbTransaction } from "./fact-dependency-repository";
import {
	createProjectRepository,
	type ProjectDetails,
} from "./project-repository";
import type { WorkspaceActor } from "./workspace";

type DbQuery = typeof db | DbTransaction;

export type PlannedContentItemErrorCode =
	| "PLANNED_CONTENT_ITEM_NOT_FOUND"
	| "PLANNED_CONTENT_ITEM_VERSION_CONFLICT"
	| "PLANNED_CONTENT_ITEM_PRODUCT_NOT_FOUND"
	| "PLANNED_CONTENT_ITEM_PRODUCT_NOT_ALLOWED"
	| "PLANNED_CONTENT_ITEM_NO_STRATEGY"
	| "PLANNED_CONTENT_ITEM_STRATEGY_VERSION_CONFLICT"
	| "PLANNED_CONTENT_ITEM_CONVERSION_NOT_SUPPORTED";

export class PlannedContentItemError extends Error {
	constructor(public readonly code: PlannedContentItemErrorCode) {
		super(code);
		this.name = "PlannedContentItemError";
	}
}

export type CalendarReadModel = {
	window: CalendarWindow;
	strategyVersion: number | null;
	items: PlannedContentItemReadModel[];
	mix: {
		target: ReturnType<typeof calculateMixTargetCounts> | null;
		actual: ReturnType<typeof calculateMixActualCounts>;
		deviates: boolean;
	};
};

function readSemantic(record: typeof plannedContentItem.$inferSelect) {
	return plannedContentItemSemanticSchema.parse({
		scheduledDate: record.scheduledDate,
		scheduledTime: record.scheduledTime,
		timezone: record.timezone,
		contentType: record.contentType,
		creationPath: record.creationPath,
		contentFormat: {
			key: record.contentFormatKey,
			version: record.contentFormatVersion,
		},
		pillar: record.pillar,
		series: record.series,
		title: record.title,
		brief: record.brief,
		productId: record.productId,
	});
}

function toReadModel(record: typeof plannedContentItem.$inferSelect) {
	const semantic = readSemantic(record);
	return {
		...semantic,
		id: record.id,
		workspaceId: record.workspaceId,
		strategyId: record.strategyId,
		strategyVersion: record.strategyVersion,
		version: record.version,
		conversionState: record.conversionProjectId ? "CONVERTED" : "UNCONVERTED",
		conversionProjectId: record.conversionProjectId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	} satisfies PlannedContentItemReadModel;
}

async function readWorkspace(query: DbQuery, workspaceId: string) {
	const [record] = await query
		.select({ timezone: workspace.timezone })
		.from(workspace)
		.where(eq(workspace.id, workspaceId))
		.limit(1);
	return record?.timezone ?? "Asia/Ho_Chi_Minh";
}

async function readItems(
	query: DbQuery,
	workspaceId: string,
	window: CalendarWindow,
) {
	return query
		.select()
		.from(plannedContentItem)
		.where(
			and(
				eq(plannedContentItem.workspaceId, workspaceId),
				gte(plannedContentItem.scheduledDate, window.startDate),
				lte(plannedContentItem.scheduledDate, window.endDate),
			),
		)
		.orderBy(
			asc(plannedContentItem.scheduledDate),
			asc(plannedContentItem.scheduledTime),
		);
}

async function readCalendarWithQuery(
	query: DbQuery,
	actor: WorkspaceActor,
	startDate?: string,
): Promise<CalendarReadModel> {
	const timezone = await readWorkspace(query, actor.workspaceId);
	const window = startDate
		? { startDate, endDate: addCalendarDays(startDate, 6), timezone }
		: getSevenDayWindow(new Date(), timezone);
	const [strategy] = await query
		.select({
			id: channelStrategy.id,
			version: channelStrategy.version,
			organicPercentage: channelStrategy.organicPercentage,
			affiliatePercentage: channelStrategy.affiliatePercentage,
			postsPerWeek: channelStrategy.postsPerWeek,
		})
		.from(channelStrategy)
		.where(eq(channelStrategy.workspaceId, actor.workspaceId))
		.limit(1);
	const records = await readItems(query, actor.workspaceId, window);
	const items = records.map(toReadModel);
	const actual = calculateMixActualCounts(items);
	const target = strategy
		? calculateMixTargetCounts(strategy.postsPerWeek, {
				organicPercentage: strategy.organicPercentage,
				affiliatePercentage: strategy.affiliatePercentage,
			})
		: null;
	return {
		window,
		strategyVersion: strategy?.version ?? null,
		items,
		mix: {
			target,
			actual,
			deviates: target
				? actual.organic !== target.organic ||
					actual.affiliate !== target.affiliate
				: false,
		},
	};
}

async function assertProduct(
	query: DbQuery,
	actor: WorkspaceActor,
	productId: string | null,
) {
	if (!productId) return;
	const [available] = await query
		.select({ id: product.id })
		.from(product)
		.where(
			and(
				eq(product.id, productId),
				eq(product.workspaceId, actor.workspaceId),
				eq(product.status, "active"),
				isNull(product.archivedAt),
			),
		)
		.limit(1);
	if (!available) {
		throw new PlannedContentItemError("PLANNED_CONTENT_ITEM_PRODUCT_NOT_FOUND");
	}
}

function itemCreateValues(
	actor: WorkspaceActor,
	semantic: PlannedContentItemSemantic,
	strategy: { id: string; version: number } | null,
) {
	return {
		id: randomUUID(),
		workspaceId: actor.workspaceId,
		scheduledDate: semantic.scheduledDate,
		scheduledTime: semantic.scheduledTime,
		timezone: semantic.timezone,
		contentType: semantic.contentType,
		creationPath: semantic.creationPath,
		contentFormatKey: semantic.contentFormat.key,
		contentFormatVersion: semantic.contentFormat.version,
		pillar: semantic.pillar,
		series: semantic.series,
		title: semantic.title,
		brief: semantic.brief,
		productId: semantic.productId,
		strategyId: strategy?.id ?? null,
		strategyVersion: strategy?.version ?? null,
		createdByUserId: actor.userId,
	};
}

async function normalizeWorkspaceSemantic(
	actor: WorkspaceActor,
	input: PlannedContentItemSemantic,
) {
	const timezone = await readWorkspace(db, actor.workspaceId);
	return plannedContentItemSemanticSchema.parse({ ...input, timezone });
}

export function createPlannedContentItemRepository() {
	return {
		getCalendar(actor: WorkspaceActor, startDate?: string) {
			return readCalendarWithQuery(db, actor, startDate);
		},
		async create(actor: WorkspaceActor, input: PlannedContentItemSemantic) {
			const semantic = await normalizeWorkspaceSemantic(actor, input);
			await assertProduct(db, actor, semantic.productId);
			const [strategy] = await db
				.select({ id: channelStrategy.id, version: channelStrategy.version })
				.from(channelStrategy)
				.where(eq(channelStrategy.workspaceId, actor.workspaceId))
				.limit(1);
			const values = itemCreateValues(actor, semantic, strategy ?? null);
			const [created] = await db
				.insert(plannedContentItem)
				.values(values)
				.returning();
			if (!created) {
				throw new Error("Could not create the planned content item.");
			}
			return toReadModel(created);
		},
		async generate(
			actor: WorkspaceActor,
			startDate: string | undefined,
			expectedStrategyVersion?: number,
		) {
			const strategy = await getCurrentChannelStrategy(actor);
			if (!strategy) {
				throw new PlannedContentItemError("PLANNED_CONTENT_ITEM_NO_STRATEGY");
			}
			if (
				expectedStrategyVersion !== undefined &&
				expectedStrategyVersion !== strategy.version
			) {
				throw new PlannedContentItemError(
					"PLANNED_CONTENT_ITEM_STRATEGY_VERSION_CONFLICT",
				);
			}
			const timezone = await readWorkspace(db, actor.workspaceId);
			const window = startDate
				? { startDate, endDate: addCalendarDays(startDate, 6), timezone }
				: getSevenDayWindow(new Date(), timezone);
			const generated = generateDeterministicPlan(strategy, window);
			await db.transaction(async (transaction) => {
				const [lockedStrategy] = await transaction
					.select({ id: channelStrategy.id, version: channelStrategy.version })
					.from(channelStrategy)
					.where(eq(channelStrategy.workspaceId, actor.workspaceId))
					.for("update")
					.limit(1);
				if (!lockedStrategy || lockedStrategy.version !== strategy.version) {
					throw new PlannedContentItemError(
						"PLANNED_CONTENT_ITEM_STRATEGY_VERSION_CONFLICT",
					);
				}
				await transaction
					.delete(plannedContentItem)
					.where(
						and(
							eq(plannedContentItem.workspaceId, actor.workspaceId),
							gte(plannedContentItem.scheduledDate, window.startDate),
							lte(plannedContentItem.scheduledDate, window.endDate),
							isNull(plannedContentItem.conversionProjectId),
						),
					);
				if (generated.length > 0) {
					await transaction.insert(plannedContentItem).values(
						generated.map((item) =>
							itemCreateValues(actor, item, {
								id: strategy.id,
								version: strategy.version,
							}),
						),
					);
				}
			});
			return readCalendarWithQuery(db, actor, window.startDate);
		},
		async update(
			actor: WorkspaceActor,
			id: string,
			semanticInput: PlannedContentItemSemantic,
			expectedVersion: number,
		) {
			const [current] = await db
				.select({ id: plannedContentItem.id })
				.from(plannedContentItem)
				.where(
					and(
						eq(plannedContentItem.id, id),
						eq(plannedContentItem.workspaceId, actor.workspaceId),
					),
				)
				.limit(1);
			if (!current) {
				throw new PlannedContentItemError("PLANNED_CONTENT_ITEM_NOT_FOUND");
			}
			const semantic = await normalizeWorkspaceSemantic(actor, semanticInput);
			await assertProduct(db, actor, semantic.productId);
			const [updated] = await db
				.update(plannedContentItem)
				.set({
					scheduledDate: semantic.scheduledDate,
					scheduledTime: semantic.scheduledTime,
					timezone: semantic.timezone,
					contentType: semantic.contentType,
					creationPath: semantic.creationPath,
					contentFormatKey: semantic.contentFormat.key,
					contentFormatVersion: semantic.contentFormat.version,
					pillar: semantic.pillar,
					series: semantic.series,
					title: semantic.title,
					brief: semantic.brief,
					productId: semantic.productId,
					version: expectedVersion + 1,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(plannedContentItem.id, id),
						eq(plannedContentItem.workspaceId, actor.workspaceId),
						eq(plannedContentItem.version, expectedVersion),
					),
				)
				.returning();
			if (!updated) {
				throw new PlannedContentItemError(
					"PLANNED_CONTENT_ITEM_VERSION_CONFLICT",
				);
			}
			return toReadModel(updated);
		},
		async move(
			actor: WorkspaceActor,
			id: string,
			scheduledDate: string,
			scheduledTime: string,
			expectedVersion: number,
		) {
			const [current] = await db
				.select()
				.from(plannedContentItem)
				.where(
					and(
						eq(plannedContentItem.id, id),
						eq(plannedContentItem.workspaceId, actor.workspaceId),
					),
				)
				.limit(1);
			if (!current)
				throw new PlannedContentItemError("PLANNED_CONTENT_ITEM_NOT_FOUND");
			return this.update(
				actor,
				id,
				{
					...readSemantic(current),
					timezone: await readWorkspace(db, actor.workspaceId),
					scheduledDate,
					scheduledTime,
				},
				expectedVersion,
			);
		},
		async attachProduct(
			actor: WorkspaceActor,
			id: string,
			productId: string | null,
			expectedVersion: number,
		) {
			const [current] = await db
				.select({ id: plannedContentItem.id })
				.from(plannedContentItem)
				.where(
					and(
						eq(plannedContentItem.id, id),
						eq(plannedContentItem.workspaceId, actor.workspaceId),
					),
				)
				.limit(1);
			if (!current) {
				throw new PlannedContentItemError("PLANNED_CONTENT_ITEM_NOT_FOUND");
			}
			await assertProduct(db, actor, productId);
			const [updated] = await db
				.update(plannedContentItem)
				.set({
					productId,
					version: expectedVersion + 1,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(plannedContentItem.id, id),
						eq(plannedContentItem.workspaceId, actor.workspaceId),
						eq(plannedContentItem.version, expectedVersion),
					),
				)
				.returning();
			if (!updated) {
				throw new PlannedContentItemError(
					"PLANNED_CONTENT_ITEM_VERSION_CONFLICT",
				);
			}
			return toReadModel(updated);
		},
		async convert(
			actor: WorkspaceActor,
			id: string,
			expectedVersion: number,
		): Promise<{
			status: "CONVERTED" | "ALREADY_CONVERTED";
			project: ProjectDetails;
		}> {
			return db.transaction(async (transaction) => {
				const [current] = await transaction
					.select()
					.from(plannedContentItem)
					.where(
						and(
							eq(plannedContentItem.id, id),
							eq(plannedContentItem.workspaceId, actor.workspaceId),
						),
					)
					.for("update")
					.limit(1);
				if (!current) {
					throw new PlannedContentItemError("PLANNED_CONTENT_ITEM_NOT_FOUND");
				}
				if (current.conversionProjectId) {
					const projectRepository = createProjectRepository(transaction);
					const existing = await projectRepository.findProject({
						workspaceId: actor.workspaceId,
						projectId: current.conversionProjectId,
					});
					if (!existing) {
						throw new PlannedContentItemError("PLANNED_CONTENT_ITEM_NOT_FOUND");
					}
					return { status: "ALREADY_CONVERTED", project: existing };
				}
				if (current.version !== expectedVersion) {
					throw new PlannedContentItemError(
						"PLANNED_CONTENT_ITEM_VERSION_CONFLICT",
					);
				}
				if (current.contentType === "AFFILIATE" && !current.productId) {
					throw new PlannedContentItemError(
						"PLANNED_CONTENT_ITEM_PRODUCT_NOT_ALLOWED",
					);
				}
				const semantic = readSemantic(current);
				const input = createProjectInputSchema.parse({
					name: semantic.title,
					productId: semantic.productId,
					platform: "tiktok",
					goal: semantic.brief.slice(0, 240),
					durationSeconds: 30,
					angle: semantic.pillar.slice(0, 240),
					description: semantic.brief,
					contentType: semantic.contentType,
					creationPath: semantic.creationPath,
					contentFormat: semantic.contentFormat,
				});
				let project: ProjectDetails;
				try {
					project = await createProject(
						createProjectRepository(transaction, {
							channelStrategySnapshot:
								current.strategyId && current.strategyVersion
									? {
											id: current.strategyId,
											version: current.strategyVersion,
										}
									: null,
						}),
						actor,
						input,
					);
				} catch (error) {
					if (
						error instanceof ProjectServiceError &&
						error.code === "PRODUCT_NOT_FOUND"
					) {
						throw new PlannedContentItemError(
							"PLANNED_CONTENT_ITEM_PRODUCT_NOT_FOUND",
						);
					}
					if (error instanceof ProjectServiceError) {
						throw new PlannedContentItemError(
							"PLANNED_CONTENT_ITEM_CONVERSION_NOT_SUPPORTED",
						);
					}
					throw error;
				}
				const [claimed] = await transaction
					.update(plannedContentItem)
					.set({
						conversionProjectId: project.id,
						convertedAt: new Date(),
						version: current.version + 1,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(plannedContentItem.id, id),
							eq(plannedContentItem.workspaceId, actor.workspaceId),
							eq(plannedContentItem.version, expectedVersion),
							isNull(plannedContentItem.conversionProjectId),
						),
					)
					.returning({ id: plannedContentItem.id });
				if (!claimed) {
					throw new PlannedContentItemError(
						"PLANNED_CONTENT_ITEM_VERSION_CONFLICT",
					);
				}
				return { status: "CONVERTED", project };
			});
		},
	};
}

export const plannedContentItemRepository =
	createPlannedContentItemRepository();

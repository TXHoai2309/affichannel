import { randomUUID } from "node:crypto";
import {
	type ChannelStrategyReadModel,
	type ChannelStrategySaveInput,
	channelStrategyInputSchema,
} from "@affichannel/core";
import {
	channelStrategy,
	channelStrategyPillar,
	channelStrategyPreferredContentFormat,
	channelStrategyPreferredCreationPath,
	channelStrategySeries,
	db,
} from "@affichannel/db";
import { and, asc, eq } from "drizzle-orm";

import type { DbTransaction } from "./fact-dependency-repository";
import type { WorkspaceActor } from "./workspace";

type StrategyQuery = typeof db | DbTransaction;

export type ChannelStrategyErrorCode =
	| "CHANNEL_STRATEGY_ALREADY_EXISTS"
	| "CHANNEL_STRATEGY_NOT_FOUND"
	| "CHANNEL_STRATEGY_VERSION_CONFLICT";

export class ChannelStrategyError extends Error {
	constructor(public readonly code: ChannelStrategyErrorCode) {
		super(code);
		this.name = "ChannelStrategyError";
	}
}

function isUniqueViolation(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

async function readStrategy(
	query: StrategyQuery,
	workspaceId: string,
): Promise<ChannelStrategyReadModel | null> {
	const [record] = await query
		.select()
		.from(channelStrategy)
		.where(eq(channelStrategy.workspaceId, workspaceId))
		.limit(1);
	if (!record) return null;

	const pillars = await query
		.select({ name: channelStrategyPillar.name })
		.from(channelStrategyPillar)
		.where(eq(channelStrategyPillar.strategyId, record.id))
		.orderBy(asc(channelStrategyPillar.position));
	const series = await query
		.select({ name: channelStrategySeries.name })
		.from(channelStrategySeries)
		.where(eq(channelStrategySeries.strategyId, record.id))
		.orderBy(asc(channelStrategySeries.position));
	const preferredPaths = await query
		.select({ creationPath: channelStrategyPreferredCreationPath.creationPath })
		.from(channelStrategyPreferredCreationPath)
		.where(eq(channelStrategyPreferredCreationPath.strategyId, record.id))
		.orderBy(asc(channelStrategyPreferredCreationPath.position));
	const preferredFormats = await query
		.select({
			key: channelStrategyPreferredContentFormat.contentFormatKey,
			version: channelStrategyPreferredContentFormat.contentFormatVersion,
		})
		.from(channelStrategyPreferredContentFormat)
		.where(eq(channelStrategyPreferredContentFormat.strategyId, record.id))
		.orderBy(asc(channelStrategyPreferredContentFormat.position));

	return {
		...channelStrategyInputSchema.parse({
			niche: record.niche,
			targetAudience: record.targetAudience,
			presenceMode: record.presenceMode,
			tone: record.tone,
			contentPillars: pillars.map((pillar) => pillar.name),
			contentSeries: series.map((item) => item.name),
			preferredCreationPaths: preferredPaths.map((item) => item.creationPath),
			preferredContentFormats: preferredFormats,
			postingFrequency: {
				postsPerWeek: record.postsPerWeek,
				preferredDays: record.preferredPostingDays,
			},
			visualStyle: record.visualStyle,
			organicAffiliateMixTarget: {
				organicPercentage: record.organicPercentage,
				affiliatePercentage: record.affiliatePercentage,
			},
		}),
		id: record.id,
		workspaceId: record.workspaceId,
		version: record.version,
		createdByUserId: record.createdByUserId,
		updatedByUserId: record.updatedByUserId,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

export function getCurrentChannelStrategy(actor: WorkspaceActor) {
	return readStrategy(db, actor.workspaceId);
}

async function replaceChildren(
	transaction: DbTransaction,
	strategyId: string,
	input: ReturnType<typeof channelStrategyInputSchema.parse>,
) {
	await transaction
		.delete(channelStrategyPillar)
		.where(eq(channelStrategyPillar.strategyId, strategyId));
	await transaction
		.delete(channelStrategySeries)
		.where(eq(channelStrategySeries.strategyId, strategyId));
	await transaction
		.delete(channelStrategyPreferredCreationPath)
		.where(eq(channelStrategyPreferredCreationPath.strategyId, strategyId));
	await transaction
		.delete(channelStrategyPreferredContentFormat)
		.where(eq(channelStrategyPreferredContentFormat.strategyId, strategyId));

	await transaction.insert(channelStrategyPillar).values(
		input.contentPillars.map((name, position) => ({
			id: randomUUID(),
			strategyId,
			position,
			name,
		})),
	);
	await transaction.insert(channelStrategySeries).values(
		input.contentSeries.map((name, position) => ({
			id: randomUUID(),
			strategyId,
			position,
			name,
		})),
	);
	await transaction.insert(channelStrategyPreferredCreationPath).values(
		input.preferredCreationPaths.map((creationPath, position) => ({
			id: randomUUID(),
			strategyId,
			position,
			creationPath,
		})),
	);
	await transaction.insert(channelStrategyPreferredContentFormat).values(
		input.preferredContentFormats.map((format, position) => ({
			id: randomUUID(),
			strategyId,
			position,
			contentFormatKey: format.key,
			contentFormatVersion: format.version,
		})),
	);
}

export async function saveCurrentChannelStrategy(
	actor: WorkspaceActor,
	input: ChannelStrategySaveInput,
) {
	const { expectedVersion, ...aggregateInput } = input;
	const strategyInput = channelStrategyInputSchema.parse(aggregateInput);
	try {
		return await db.transaction(async (transaction) => {
			const [current] = await transaction
				.select()
				.from(channelStrategy)
				.where(eq(channelStrategy.workspaceId, actor.workspaceId))
				.for("update", { of: channelStrategy })
				.limit(1);

			if (expectedVersion === null) {
				if (current) {
					throw new ChannelStrategyError("CHANNEL_STRATEGY_ALREADY_EXISTS");
				}
				const strategyId = randomUUID();
				await transaction.insert(channelStrategy).values({
					id: strategyId,
					workspaceId: actor.workspaceId,
					version: 1,
					niche: strategyInput.niche,
					targetAudience: strategyInput.targetAudience,
					presenceMode: strategyInput.presenceMode,
					tone: strategyInput.tone,
					postsPerWeek: strategyInput.postingFrequency.postsPerWeek,
					preferredPostingDays: strategyInput.postingFrequency.preferredDays,
					visualStyle: strategyInput.visualStyle,
					organicPercentage:
						strategyInput.organicAffiliateMixTarget.organicPercentage,
					affiliatePercentage:
						strategyInput.organicAffiliateMixTarget.affiliatePercentage,
					createdByUserId: actor.userId,
					updatedByUserId: actor.userId,
				});
				await replaceChildren(transaction, strategyId, strategyInput);
				return readStrategy(transaction, actor.workspaceId);
			}

			if (!current) {
				throw new ChannelStrategyError("CHANNEL_STRATEGY_NOT_FOUND");
			}
			if (current.version !== expectedVersion) {
				throw new ChannelStrategyError("CHANNEL_STRATEGY_VERSION_CONFLICT");
			}

			const [updated] = await transaction
				.update(channelStrategy)
				.set({
					version: current.version + 1,
					niche: strategyInput.niche,
					targetAudience: strategyInput.targetAudience,
					presenceMode: strategyInput.presenceMode,
					tone: strategyInput.tone,
					postsPerWeek: strategyInput.postingFrequency.postsPerWeek,
					preferredPostingDays: strategyInput.postingFrequency.preferredDays,
					visualStyle: strategyInput.visualStyle,
					organicPercentage:
						strategyInput.organicAffiliateMixTarget.organicPercentage,
					affiliatePercentage:
						strategyInput.organicAffiliateMixTarget.affiliatePercentage,
					updatedByUserId: actor.userId,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(channelStrategy.id, current.id),
						eq(channelStrategy.workspaceId, actor.workspaceId),
						eq(channelStrategy.version, expectedVersion),
					),
				)
				.returning({ id: channelStrategy.id });
			if (!updated) {
				throw new ChannelStrategyError("CHANNEL_STRATEGY_VERSION_CONFLICT");
			}

			await replaceChildren(transaction, current.id, strategyInput);
			return readStrategy(transaction, actor.workspaceId);
		});
	} catch (error) {
		if (error instanceof ChannelStrategyError) throw error;
		if (isUniqueViolation(error)) {
			throw new ChannelStrategyError("CHANNEL_STRATEGY_ALREADY_EXISTS");
		}
		throw error;
	}
}

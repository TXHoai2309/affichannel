import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { workspace } from "./workspace";

export const channelStrategy = pgTable(
	"channel_strategy",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		version: integer("version").notNull().default(1),
		niche: text("niche").notNull(),
		targetAudience: text("target_audience").notNull(),
		presenceMode: text("presence_mode").notNull(),
		tone: text("tone").notNull(),
		postsPerWeek: integer("posts_per_week").notNull(),
		preferredPostingDays: integer("preferred_posting_days")
			.array()
			.notNull()
			.default(sql.raw("ARRAY[]::integer[]")),
		visualStyle: text("visual_style").notNull(),
		organicPercentage: integer("organic_percentage").notNull(),
		affiliatePercentage: integer("affiliate_percentage").notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		updatedByUserId: text("updated_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		check("channel_strategy_version_check", sql`${table.version} > 0`),
		check(
			"channel_strategy_presence_mode_check",
			sql`${table.presenceMode} in ('FACELESS', 'FACE_PREFERRED', 'FLEXIBLE')`,
		),
		check(
			"channel_strategy_posts_per_week_check",
			sql`${table.postsPerWeek} between 1 and 7`,
		),
		check(
			"channel_strategy_posting_days_check",
			sql`array_position(${table.preferredPostingDays}, null) is null and ${table.preferredPostingDays} <@ array[0,1,2,3,4,5,6]::integer[]`,
		),
		check(
			"channel_strategy_mix_target_check",
			sql`${table.organicPercentage} between 0 and 100 and ${table.affiliatePercentage} between 0 and 100 and ${table.organicPercentage} + ${table.affiliatePercentage} = 100`,
		),
		check(
			"channel_strategy_text_length_check",
			sql`length(trim(${table.niche})) between 1 and 500 and length(trim(${table.targetAudience})) between 1 and 500 and length(trim(${table.tone})) between 1 and 500 and length(trim(${table.visualStyle})) between 1 and 500`,
		),
		uniqueIndex("channel_strategy_workspace_unique").on(table.workspaceId),
		index("channel_strategy_created_by_user_idx").on(table.createdByUserId),
		index("channel_strategy_updated_by_user_idx").on(table.updatedByUserId),
	],
);

export const channelStrategyPillar = pgTable(
	"channel_strategy_pillar",
	{
		id: text("id").primaryKey(),
		strategyId: text("strategy_id")
			.notNull()
			.references(() => channelStrategy.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		name: text("name").notNull(),
	},
	(table) => [
		check(
			"channel_strategy_pillar_position_check",
			sql`${table.position} between 0 and 4`,
		),
		check(
			"channel_strategy_pillar_name_check",
			sql`length(trim(${table.name})) between 1 and 160`,
		),
		uniqueIndex("channel_strategy_pillar_strategy_position_unique").on(
			table.strategyId,
			table.position,
		),
		index("channel_strategy_pillar_strategy_idx").on(table.strategyId),
	],
);

export const channelStrategySeries = pgTable(
	"channel_strategy_series",
	{
		id: text("id").primaryKey(),
		strategyId: text("strategy_id")
			.notNull()
			.references(() => channelStrategy.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		name: text("name").notNull(),
	},
	(table) => [
		check(
			"channel_strategy_series_position_check",
			sql`${table.position} between 0 and 19`,
		),
		check(
			"channel_strategy_series_name_check",
			sql`length(trim(${table.name})) between 1 and 160`,
		),
		uniqueIndex("channel_strategy_series_strategy_position_unique").on(
			table.strategyId,
			table.position,
		),
		index("channel_strategy_series_strategy_idx").on(table.strategyId),
	],
);

export const channelStrategyPreferredCreationPath = pgTable(
	"channel_strategy_preferred_creation_path",
	{
		id: text("id").primaryKey(),
		strategyId: text("strategy_id")
			.notNull()
			.references(() => channelStrategy.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		creationPath: text("creation_path").notNull(),
	},
	(table) => [
		check(
			"channel_strategy_preferred_path_position_check",
			sql`${table.position} between 0 and 2`,
		),
		check(
			"channel_strategy_preferred_path_value_check",
			sql`${table.creationPath} in ('QUICK_IMAGE', 'SCRIPTED', 'MEDIA_FIRST')`,
		),
		uniqueIndex("channel_strategy_preferred_path_strategy_position_unique").on(
			table.strategyId,
			table.position,
		),
		index("channel_strategy_preferred_path_strategy_idx").on(table.strategyId),
	],
);

export const channelStrategyPreferredContentFormat = pgTable(
	"channel_strategy_preferred_content_format",
	{
		id: text("id").primaryKey(),
		strategyId: text("strategy_id")
			.notNull()
			.references(() => channelStrategy.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		contentFormatKey: text("content_format_key").notNull(),
		contentFormatVersion: integer("content_format_version").notNull(),
	},
	(table) => [
		check(
			"channel_strategy_preferred_format_position_check",
			sql`${table.position} between 0 and 2`,
		),
		check(
			"channel_strategy_preferred_format_key_check",
			sql`length(trim(${table.contentFormatKey})) between 1 and 120`,
		),
		check(
			"channel_strategy_preferred_format_version_check",
			sql`${table.contentFormatVersion} > 0`,
		),
		uniqueIndex(
			"channel_strategy_preferred_format_strategy_position_unique",
		).on(table.strategyId, table.position),
		index("channel_strategy_preferred_format_strategy_idx").on(
			table.strategyId,
		),
	],
);

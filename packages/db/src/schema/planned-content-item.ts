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
import { channelStrategy } from "./channel-strategy";
import { product } from "./product";
import { project } from "./project";
import { workspace } from "./workspace";

export const plannedContentItem = pgTable(
	"planned_content_item",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		scheduledDate: text("scheduled_date").notNull(),
		scheduledTime: text("scheduled_time").notNull(),
		timezone: text("timezone").notNull(),
		contentType: text("content_type").notNull(),
		creationPath: text("creation_path").notNull(),
		contentFormatKey: text("content_format_key").notNull(),
		contentFormatVersion: integer("content_format_version").notNull(),
		pillar: text("pillar").notNull(),
		series: text("series"),
		title: text("title").notNull(),
		brief: text("brief").notNull(),
		productId: text("product_id").references(() => product.id, {
			onDelete: "set null",
		}),
		strategyId: text("strategy_id").references(() => channelStrategy.id, {
			onDelete: "set null",
		}),
		strategyVersion: integer("strategy_version"),
		version: integer("version").notNull().default(1),
		conversionProjectId: text("conversion_project_id").references(
			() => project.id,
			{ onDelete: "restrict" },
		),
		convertedAt: timestamp("converted_at", { withTimezone: true }),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		check(
			"planned_content_item_date_check",
			sql`${table.scheduledDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
		),
		check(
			"planned_content_item_time_check",
			sql`${table.scheduledTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
		),
		check(
			"planned_content_item_content_type_check",
			sql`${table.contentType} in ('ORGANIC', 'AFFILIATE')`,
		),
		check(
			"planned_content_item_creation_path_check",
			sql`${table.creationPath} in ('QUICK_IMAGE', 'SCRIPTED', 'MEDIA_FIRST')`,
		),
		check(
			"planned_content_item_format_version_check",
			sql`${table.contentFormatVersion} > 0`,
		),
		check("planned_content_item_version_check", sql`${table.version} > 0`),
		check(
			"planned_content_item_strategy_snapshot_check",
			sql`(${table.strategyId} is null and ${table.strategyVersion} is null) or (${table.strategyId} is not null and ${table.strategyVersion} is not null and ${table.strategyVersion} > 0)`,
		),
		check(
			"planned_content_item_conversion_state_check",
			sql`(${table.conversionProjectId} is null and ${table.convertedAt} is null) or (${table.conversionProjectId} is not null and ${table.convertedAt} is not null)`,
		),
		index("planned_content_item_workspace_schedule_idx").on(
			table.workspaceId,
			table.scheduledDate,
			table.scheduledTime,
		),
		index("planned_content_item_workspace_conversion_idx").on(
			table.workspaceId,
			table.conversionProjectId,
		),
		uniqueIndex("planned_content_item_conversion_project_unique").on(
			table.conversionProjectId,
		),
	],
);

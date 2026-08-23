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
import { product } from "./product";
import { workspace } from "./workspace";

export const project = pgTable(
	"project",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		productId: text("product_id").references(() => product.id, {
			onDelete: "restrict",
		}),
		contentType: text("content_type"),
		creationPath: text("creation_path"),
		contentFormatKey: text("content_format_key"),
		contentFormatVersion: integer("content_format_version"),
		currentStepKey: text("current_step_key").notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
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
			"project_content_type_check",
			sql`${table.contentType} is null or ${table.contentType} in ('ORGANIC', 'AFFILIATE')`,
		),
		check(
			"project_creation_path_check",
			sql`${table.creationPath} is null or ${table.creationPath} in ('QUICK_IMAGE', 'SCRIPTED', 'MEDIA_FIRST')`,
		),
		check(
			"project_content_format_pair_check",
			sql`(
				(${table.contentFormatKey} is null and ${table.contentFormatVersion} is null)
				or
				(
					${table.contentFormatKey} is not null
					and ${table.contentFormatVersion} is not null
					and ${table.contentFormatVersion} > 0
				)
			)`,
		),
		check(
			"project_current_step_key_check",
			sql`${table.currentStepKey} in ('product', 'content', 'fact-lock', 'voice', 'video', 'preview', 'completed')`,
		),
		index("project_workspace_active_updated_idx").on(
			table.workspaceId,
			table.archivedAt,
			table.updatedAt,
		),
		index("project_product_id_idx").on(table.productId),
		index("project_created_by_user_id_idx").on(table.createdByUserId),
	],
);

export const contentBrief = pgTable(
	"content_brief",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		platform: text("platform").notNull(),
		goal: text("goal").notNull(),
		durationSeconds: integer("duration_seconds").notNull(),
		angle: text("angle").notNull(),
		description: text("description"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("content_brief_project_id_unique").on(table.projectId),
		check("content_brief_platform_check", sql`${table.platform} = 'tiktok'`),
		check(
			"content_brief_duration_seconds_check",
			sql`${table.durationSeconds} between 15 and 180`,
		),
	],
);

export const projectStepStatus = pgTable(
	"project_step_status",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		stepKey: text("step_key").notNull(),
		status: text("status").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("project_step_status_project_step_unique").on(
			table.projectId,
			table.stepKey,
		),
		check(
			"project_step_status_step_key_check",
			sql`${table.stepKey} in ('product', 'content', 'fact-lock', 'voice', 'video', 'preview', 'completed')`,
		),
		check(
			"project_step_status_status_check",
			sql`${table.status} in ('not_started', 'completed', 'needs_review', 'blocked')`,
		),
	],
);

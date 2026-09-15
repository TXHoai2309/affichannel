import { sql } from "drizzle-orm";
import {
	check,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { project } from "./project";
import { workspace } from "./workspace";

export const quickImageSettings = pgTable(
	"quick_image_settings",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		durationSeconds: integer("duration_seconds").notNull(),
		revision: integer("revision").notNull().default(1),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		check(
			"quick_image_settings_duration_check",
			sql`${table.durationSeconds} in (5, 10, 15)`,
		),
		check("quick_image_settings_revision_check", sql`${table.revision} > 0`),
		uniqueIndex("quick_image_settings_workspace_project_unique").on(
			table.workspaceId,
			table.projectId,
		),
	],
);

export type QuickImageSettingsRow = typeof quickImageSettings.$inferSelect;

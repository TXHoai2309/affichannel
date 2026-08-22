import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project } from "./project";
import { workspace } from "./workspace";

export const voiceConfig = pgTable(
	"voice_config",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		provider: text("provider").notNull(),
		voiceId: text("voice_id").notNull(),
		language: text("language").notNull(),
		speed: real("speed").notNull(),
		revision: integer("revision").notNull().default(1),
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
			.notNull(),
	},
	(table) => [
		check("voice_config_provider_check", sql`${table.provider} = 'apikeyfun'`),
		check("voice_config_revision_check", sql`${table.revision} >= 1`),
		check(
			"voice_config_speed_check",
			sql`${table.speed} >= 0.7 and ${table.speed} <= 1.5`,
		),
		uniqueIndex("voice_config_workspace_project_unique").on(
			table.workspaceId,
			table.projectId,
		),
		index("voice_config_created_by_user_idx").on(table.createdByUserId),
		index("voice_config_updated_by_user_idx").on(table.updatedByUserId),
	],
);

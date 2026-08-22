import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { workspace } from "./workspace";

export const aiSettings = pgTable(
	"ai_settings",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		textProvider: text("text_provider"),
		textModel: text("text_model"),
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
		check(
			"ai_settings_text_config_length_check",
			sql.raw(
				"(text_provider is null or length(trim(text_provider)) between 1 and 100) and (text_model is null or length(trim(text_model)) between 1 and 200)",
			),
		),
		uniqueIndex("ai_settings_workspace_unique").on(table.workspaceId),
		index("ai_settings_created_by_user_idx").on(table.createdByUserId),
		index("ai_settings_updated_by_user_idx").on(table.updatedByUserId),
	],
);

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

export const workspace = pgTable(
	"workspace",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		timezone: text("timezone").notNull().default("Asia/Ho_Chi_Minh"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [check("workspace_timezone_check", sql`${table.timezone} <> ''`)],
);

export const workspaceMember = pgTable(
	"workspace_member",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("workspace_member_workspace_user_unique").on(
			table.workspaceId,
			table.userId,
		),
		index("workspace_member_user_id_idx").on(table.userId),
	],
);

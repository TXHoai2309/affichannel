import { sql } from "drizzle-orm";
import {
	check,
	date,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { product } from "./product";
import { workspace } from "./workspace";

export const productFactHistory = pgTable(
	"product_fact_history",
	{
		id: text("id").primaryKey(),
		productFactId: text("product_fact_id").notNull(),
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "restrict" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		revision: integer("revision").notNull().default(1),
		action: text("action").notNull(),
		content: text("content").notNull(),
		type: text("type").notNull(),
		status: text("status").notNull(),
		sourceType: text("source_type"),
		sourceLabel: text("source_label"),
		sourceUrl: text("source_url"),
		confirmedAt: date("confirmed_at", { mode: "string" }),
		expiresAt: date("expires_at", { mode: "string" }),
		notes: text("notes"),
		changedByUserId: text("changed_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		changedAt: timestamp("changed_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"product_fact_history_action_check",
			sql`${table.action} in ('created', 'updated', 'status_changed', 'deleted')`,
		),
		check(
			"product_fact_history_type_check",
			sql`${table.type} in ('price', 'promotion', 'specification', 'feature', 'claim', 'policy', 'other')`,
		),
		check(
			"product_fact_history_status_check",
			sql`${table.status} in ('draft', 'verified', 'inactive')`,
		),
		check(
			"product_fact_history_source_type_check",
			sql`${table.sourceType} is null or ${table.sourceType} in ('official', 'marketplace', 'document')`,
		),
		check(
			"product_fact_history_date_order_check",
			sql`${table.confirmedAt} is null or ${table.expiresAt} is null or ${table.confirmedAt} <= ${table.expiresAt}`,
		),
		check("product_fact_history_revision_check", sql`${table.revision} > 0`),
		index("product_fact_history_product_changed_idx").on(
			table.productId,
			table.changedAt,
			table.id,
		),
		index("product_fact_history_fact_changed_idx").on(
			table.productFactId,
			table.changedAt,
			table.id,
		),
		index("product_fact_history_workspace_id_idx").on(table.workspaceId),
	],
);

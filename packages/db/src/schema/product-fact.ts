import { sql } from "drizzle-orm";
import {
	check,
	date,
	index,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { product } from "./product";
import { workspace } from "./workspace";

export const productFact = pgTable(
	"product_fact",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "restrict" }),
		content: text("content").notNull(),
		type: text("type").notNull().default("other"),
		status: text("status").notNull().default("draft"),
		sourceType: text("source_type"),
		sourceLabel: text("source_label"),
		sourceUrl: text("source_url"),
		confirmedAt: date("confirmed_at", { mode: "string" }),
		expiresAt: date("expires_at", { mode: "string" }),
		notes: text("notes"),
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
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		check(
			"product_fact_type_check",
			sql`${table.type} in ('price', 'promotion', 'specification', 'feature', 'claim', 'policy', 'other')`,
		),
		check(
			"product_fact_status_check",
			sql`${table.status} in ('draft', 'verified', 'inactive')`,
		),
		check(
			"product_fact_source_type_check",
			sql`${table.sourceType} is null or ${table.sourceType} in ('official', 'marketplace', 'document')`,
		),
		check(
			"product_fact_date_order_check",
			sql`${table.confirmedAt} is null or ${table.expiresAt} is null or ${table.confirmedAt} <= ${table.expiresAt}`,
		),
		index("product_fact_product_updated_idx").on(
			table.productId,
			table.updatedAt,
			table.id,
		),
		index("product_fact_product_type_updated_idx").on(
			table.productId,
			table.type,
			table.updatedAt,
			table.id,
		),
		index("product_fact_product_status_updated_idx").on(
			table.productId,
			table.status,
			table.updatedAt,
			table.id,
		),
		index("product_fact_workspace_id_idx").on(table.workspaceId),
		index("product_fact_created_by_user_id_idx").on(table.createdByUserId),
		index("product_fact_updated_by_user_id_idx").on(table.updatedByUserId),
	],
);

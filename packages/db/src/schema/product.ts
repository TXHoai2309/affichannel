import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { workspace } from "./workspace";

export const product = pgTable(
	"product",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		category: text("category"),
		status: text("status").notNull().default("active"),
		thumbnailUrl: text("thumbnail_url"),
		sourceUrl: text("source_url"),
		affiliateUrl: text("affiliate_url"),
		priceAmount: integer("price_amount"),
		currency: text("currency").notNull().default("VND"),
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
			"product_status_check",
			sql`${table.status} in ('active', 'inactive')`,
		),
		check("product_currency_check", sql`${table.currency} = 'VND'`),
		check(
			"product_price_amount_check",
			sql`${table.priceAmount} is null or ${table.priceAmount} >= 0`,
		),
		index("product_workspace_active_updated_idx").on(
			table.workspaceId,
			table.archivedAt,
			table.updatedAt,
		),
		index("product_created_by_user_id_idx").on(table.createdByUserId),
	],
);

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

import { workspace } from "./workspace";

export const factDependency = pgTable(
	"fact_dependency",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		productFactId: text("product_fact_id").notNull(),
		factRevision: integer("fact_revision").notNull(),
		dependentType: text("dependent_type").notNull(),
		dependentId: text("dependent_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		detachedAt: timestamp("detached_at", { withTimezone: true }),
		invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
		invalidationReason: text("invalidation_reason"),
	},
	(table) => [
		check("fact_dependency_revision_check", sql`${table.factRevision} > 0`),
		check(
			"fact_dependency_type_check",
			sql`${table.dependentType} in ('script', 'fact_lock', 'voice', 'video', 'render')`,
		),
		check(
			"fact_dependency_reason_check",
			sql`${table.invalidationReason} is null or ${table.invalidationReason} in ('fact_changed', 'fact_deactivated', 'fact_deleted')`,
		),
		uniqueIndex("fact_dependency_active_unique")
			.on(
				table.workspaceId,
				table.productFactId,
				table.factRevision,
				table.dependentType,
				table.dependentId,
			)
			.where(
				sql`${table.detachedAt} is null and ${table.invalidatedAt} is null`,
			),
		index("fact_dependency_fact_revision_idx").on(
			table.productFactId,
			table.factRevision,
		),
		index("fact_dependency_dependent_idx").on(
			table.dependentType,
			table.dependentId,
		),
		index("fact_dependency_workspace_state_idx").on(
			table.workspaceId,
			table.invalidatedAt,
			table.detachedAt,
		),
	],
);

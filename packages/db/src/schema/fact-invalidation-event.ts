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
import { factDependency } from "./fact-dependency";
import { workspace } from "./workspace";

export const factInvalidationEvent = pgTable(
	"fact_invalidation_event",
	{
		id: text("id").primaryKey(),
		dependencyId: text("dependency_id")
			.notNull()
			.references(() => factDependency.id, { onDelete: "restrict" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		productFactId: text("product_fact_id").notNull(),
		fromRevision: integer("from_revision").notNull(),
		toRevision: integer("to_revision"),
		dependentType: text("dependent_type").notNull(),
		dependentId: text("dependent_id").notNull(),
		reason: text("reason").notNull(),
		triggeredByUserId: text("triggered_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"fact_invalidation_from_revision_check",
			sql`${table.fromRevision} > 0`,
		),
		check(
			"fact_invalidation_to_revision_check",
			sql`${table.toRevision} is null or ${table.toRevision} > ${table.fromRevision}`,
		),
		check(
			"fact_invalidation_type_check",
			sql`${table.dependentType} in ('script', 'script_generation', 'fact_lock', 'voice', 'video', 'render')`,
		),
		check(
			"fact_invalidation_reason_check",
			sql`${table.reason} in ('fact_changed', 'fact_deactivated', 'fact_deleted')`,
		),
		uniqueIndex("fact_invalidation_dependency_unique").on(table.dependencyId),
		index("fact_invalidation_fact_created_idx").on(
			table.productFactId,
			table.createdAt,
		),
		index("fact_invalidation_dependent_created_idx").on(
			table.dependentType,
			table.dependentId,
			table.createdAt,
		),
	],
);

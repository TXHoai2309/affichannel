import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { workspace } from "./workspace";

export const outputRules = pgTable(
	"output_rules",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		language: text("language").notNull().default("vi-VN"),
		aspectRatio: text("aspect_ratio").notNull().default("9:16"),
		subtitleSafeArea: text("subtitle_safe_area").notNull().default("standard"),
		claimLimit: integer("claim_limit"),
		requireFinalCta: boolean("require_final_cta").notNull().default(true),
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
		check("output_rules_language_check", sql.raw("language = 'vi-VN'")),
		check("output_rules_aspect_ratio_check", sql.raw("aspect_ratio = '9:16'")),
		check(
			"output_rules_safe_area_check",
			sql.raw("subtitle_safe_area = 'standard'"),
		),
		check(
			"output_rules_claim_limit_check",
			sql.raw("claim_limit is null or claim_limit > 0"),
		),
		check("output_rules_final_cta_check", sql.raw("require_final_cta = true")),
		uniqueIndex("output_rules_workspace_unique").on(table.workspaceId),
		index("output_rules_created_by_user_idx").on(table.createdByUserId),
		index("output_rules_updated_by_user_idx").on(table.updatedByUserId),
	],
);

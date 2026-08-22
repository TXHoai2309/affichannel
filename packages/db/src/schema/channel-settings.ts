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

export const channelSettings = pgTable(
	"channel_settings",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		niche: text("niche"),
		targetAudience: text("target_audience"),
		tone: text("tone"),
		contentPillar: text("content_pillar"),
		defaultCta: text("default_cta"),
		affiliateDisclosure: text("affiliate_disclosure"),
		avoidWords: text("avoid_words")
			.array()
			.notNull()
			.default(sql.raw("ARRAY[]::text[]")),
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
			"channel_settings_text_length_check",
			sql.raw(
				"(niche is null or length(trim(niche)) between 1 and 500) and (target_audience is null or length(trim(target_audience)) between 1 and 500) and (tone is null or length(trim(tone)) between 1 and 500) and (content_pillar is null or length(trim(content_pillar)) between 1 and 500) and (default_cta is null or length(trim(default_cta)) between 1 and 500) and (affiliate_disclosure is null or length(trim(affiliate_disclosure)) between 1 and 500)",
			),
		),
		uniqueIndex("channel_settings_workspace_unique").on(table.workspaceId),
		index("channel_settings_created_by_user_idx").on(table.createdByUserId),
		index("channel_settings_updated_by_user_idx").on(table.updatedByUserId),
	],
);

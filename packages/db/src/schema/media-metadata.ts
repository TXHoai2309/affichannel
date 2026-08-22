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
import { project } from "./project";
import { workspace } from "./workspace";

export const mediaMetadata = pgTable(
	"media_metadata",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		mediaType: text("media_type").notNull(),
		aspectRatio: text("aspect_ratio").notNull(),
		durationSeconds: integer("duration_seconds"),
		usageRights: text("usage_rights").notNull().default("unknown"),
		status: text("status").notNull().default("needs_review"),
		sceneSuitability: text("scene_suitability").notNull().default("unknown"),
		tags: text("tags").array().notNull().default(sql.raw("ARRAY[]::text[]")),
		displayName: text("display_name").notNull(),
		referenceUrl: text("reference_url"),
		createdByUserId: text("created_by_user_id")
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
			"media_metadata_type_check",
			sql.raw("media_type in ('image', 'video', 'audio')"),
		),
		check(
			"media_metadata_aspect_ratio_check",
			sql.raw("length(trim(aspect_ratio)) between 1 and 32"),
		),
		check(
			"media_metadata_duration_check",
			sql.raw("duration_seconds is null or duration_seconds >= 0"),
		),
		check(
			"media_metadata_usage_rights_check",
			sql.raw("usage_rights in ('owned', 'licensed', 'unknown', 'restricted')"),
		),
		check(
			"media_metadata_status_check",
			sql.raw("status in ('ready', 'needs_review', 'archived')"),
		),
		check(
			"media_metadata_scene_suitability_check",
			sql.raw("length(trim(scene_suitability)) between 1 and 120"),
		),
		uniqueIndex("media_metadata_workspace_project_id_unique").on(
			table.workspaceId,
			table.projectId,
			table.id,
		),
		index("media_metadata_workspace_project_idx").on(
			table.workspaceId,
			table.projectId,
			table.updatedAt,
		),
		index("media_metadata_project_id_idx").on(table.projectId),
		index("media_metadata_created_by_user_idx").on(table.createdByUserId),
	],
);

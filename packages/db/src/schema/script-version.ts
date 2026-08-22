import { scriptVersionStatuses } from "@affichannel/core";
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project } from "./project";
import { scriptGeneration } from "./script-generation";
import { workspace } from "./workspace";

export const scriptVersion = pgTable(
	"script_version",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		sourceGenerationId: text("source_generation_id")
			.notNull()
			.references(() => scriptGeneration.id, { onDelete: "restrict" }),
		status: text("status").notNull(),
		versionNumber: integer("version_number"),
		editableSnapshotJson: jsonb("editable_snapshot_json").notNull(),
		revision: integer("revision").notNull().default(1),
		restoredFromVersionId: text("restored_from_version_id"),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		savedAt: timestamp("saved_at", { withTimezone: true }),
	},
	(table) => [
		check(
			"script_version_status_check",
			sql`${table.status} in (${sql.raw(scriptVersionStatuses.map((value) => `'${value}'`).join(", "))})`,
		),
		check("script_version_revision_check", sql`${table.revision} > 0`),
		check(
			"script_version_status_shape_check",
			sql`(${table.status} = 'draft' and ${table.versionNumber} is null and ${table.savedAt} is null) or (${table.status} = 'saved' and ${table.versionNumber} is not null and ${table.versionNumber} > 0 and ${table.savedAt} is not null)`,
		),
		uniqueIndex("script_version_draft_unique")
			.on(table.workspaceId, table.projectId)
			.where(sql`${table.status} = 'draft'`),
		uniqueIndex("script_version_saved_number_unique")
			.on(table.workspaceId, table.projectId, table.versionNumber)
			.where(sql`${table.status} = 'saved'`),
		index("script_version_project_history_idx").on(
			table.workspaceId,
			table.projectId,
			table.status,
			table.updatedAt,
			table.versionNumber,
		),
		index("script_version_source_generation_idx").on(
			table.workspaceId,
			table.sourceGenerationId,
		),
		index("script_version_created_by_user_idx").on(table.createdByUserId),
		foreignKey({
			name: "script_version_restored_from_version_fk",
			columns: [table.restoredFromVersionId],
			foreignColumns: [table.id],
		}),
	],
);

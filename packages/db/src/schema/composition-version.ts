import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project } from "./project";
import { scriptVersion } from "./script-version";
import { workspace } from "./workspace";

/** Immutable, engine-independent CompositionInput snapshot. */
export const compositionVersion = pgTable(
	"composition_version",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		schemaVersion: text("schema_version").notNull(),
		compositionInputJson: jsonb("composition_input_json").notNull(),
		compositionFingerprint: text("composition_fingerprint").notNull(),
		sourceScriptVersionId: text("source_script_version_id")
			.notNull()
			.references(() => scriptVersion.id, { onDelete: "restrict" }),
		sourceScriptRevision: integer("source_script_revision").notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"composition_version_schema_version_check",
			sql`${table.schemaVersion} = 'composition-input.v1'`,
		),
		check(
			"composition_version_source_revision_check",
			sql`${table.sourceScriptRevision} > 0`,
		),
		check(
			"composition_version_fingerprint_check",
			sql`${table.compositionFingerprint} ~ '^[a-f0-9]{64}$'`,
		),
		index("composition_version_project_history_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
			table.id,
		),
		index("composition_version_source_script_idx").on(
			table.workspaceId,
			table.sourceScriptVersionId,
			table.sourceScriptRevision,
		),
		index("composition_version_fingerprint_idx").on(
			table.workspaceId,
			table.compositionFingerprint,
		),
	],
);

export type CompositionVersionRow = typeof compositionVersion.$inferSelect;

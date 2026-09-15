import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { project } from "./project";
import { workspace } from "./workspace";

export const quickImageClaimSource = pgTable(
	"quick_image_claim_source",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		revision: integer("revision").notNull().default(1),
		sourceSchemaVersion: text("source_schema_version").notNull(),
		sourceJson: jsonb("source_json").notNull(),
		sourceContentHashSha256: text("source_content_hash_sha256").notNull(),
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
			"quick_image_claim_source_revision_check",
			sql`${table.revision} > 0`,
		),
		check(
			"quick_image_claim_source_schema_version_check",
			sql`${table.sourceSchemaVersion} = 'quick-image-claim-source.v1'`,
		),
		check(
			"quick_image_claim_source_json_check",
			sql`jsonb_typeof(${table.sourceJson}) = 'object'`,
		),
		check(
			"quick_image_claim_source_hash_check",
			sql`${table.sourceContentHashSha256} ~ '^[a-f0-9]{64}$'`,
		),
		uniqueIndex("quick_image_claim_source_workspace_project_unique").on(
			table.workspaceId,
			table.projectId,
		),
		index("quick_image_claim_source_project_revision_idx").on(
			table.workspaceId,
			table.projectId,
			table.revision,
		),
	],
);

export type QuickImageClaimSourceRow =
	typeof quickImageClaimSource.$inferSelect;

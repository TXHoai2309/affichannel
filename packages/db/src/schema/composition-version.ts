import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { mediaAsset } from "./media-asset";
import { project } from "./project";
import { scriptVersion } from "./script-version";
import { workspace } from "./workspace";

type LegacyScriptedColumn<T extends { _: { notNull: boolean } }> = T & {
	_: T["_"] & { notNull: true };
};

const sourceScriptVersionId = text("source_script_version_id").references(
	() => scriptVersion.id,
	{ onDelete: "restrict" },
);
const sourceScriptRevision = integer("source_script_revision");

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
		// The runtime default preserves the existing Slice 1 Scripted writer without
		// leaving a SQL default that could silently classify future rows.
		sourceKind: text("source_kind")
			.notNull()
			.$defaultFn(() => "SCRIPTED"),
		// These casts preserve the pre-Slice-2 Scripted API's type contract while
		// the runtime columns remain nullable for the QUICK_IMAGE branch.
		sourceScriptVersionId: sourceScriptVersionId as LegacyScriptedColumn<
			typeof sourceScriptVersionId
		>,
		sourceScriptRevision: sourceScriptRevision as LegacyScriptedColumn<
			typeof sourceScriptRevision
		>,
		sourceMediaAssetId: text("source_media_asset_id").references(
			() => mediaAsset.id,
			{ onDelete: "restrict" },
		),
		sourceMediaChecksumSha256: text("source_media_checksum_sha256"),
		sourceMediaStorageProvider: text("source_media_storage_provider"),
		sourceMediaStorageKey: text("source_media_storage_key"),
		sourceMediaMimeType: text("source_media_mime_type"),
		sourceMediaByteSize: bigint("source_media_byte_size", { mode: "number" }),
		sourceMediaWidth: integer("source_media_width"),
		sourceMediaHeight: integer("source_media_height"),
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
			sql`${table.schemaVersion} in ('composition-input.v1', 'composition-input.v2')`,
		),
		check(
			"composition_version_source_lineage_check",
			sql`(
				(${table.sourceKind} = 'SCRIPTED'
					and ${table.sourceScriptVersionId} is not null
					and ${table.sourceScriptRevision} is not null
					and ${table.sourceScriptRevision} > 0
					and ${table.sourceMediaAssetId} is null
					and ${table.sourceMediaChecksumSha256} is null
					and ${table.sourceMediaStorageProvider} is null
					and ${table.sourceMediaStorageKey} is null
					and ${table.sourceMediaMimeType} is null
					and ${table.sourceMediaByteSize} is null
					and ${table.sourceMediaWidth} is null
					and ${table.sourceMediaHeight} is null)
				or
				(${table.sourceKind} = 'QUICK_IMAGE'
					and ${table.sourceScriptVersionId} is null
					and ${table.sourceScriptRevision} is null
					and ${table.sourceMediaAssetId} is not null
					and ${table.sourceMediaChecksumSha256} is not null
					and ${table.sourceMediaChecksumSha256} ~ '^[a-f0-9]{64}$'
					and ${table.sourceMediaStorageProvider} is not null
					and ${table.sourceMediaStorageProvider} in ('local', 'r2')
					and ${table.sourceMediaStorageKey} is not null
					and length(trim(${table.sourceMediaStorageKey})) > 0
					and ${table.sourceMediaMimeType} is not null
					and ${table.sourceMediaMimeType} in ('image/jpeg', 'image/png', 'image/webp')
					and ${table.sourceMediaByteSize} is not null
					and ${table.sourceMediaByteSize} > 0
					and ${table.sourceMediaWidth} is not null
					and ${table.sourceMediaWidth} > 0
					and ${table.sourceMediaHeight} is not null
					and ${table.sourceMediaHeight} > 0)
			)`,
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
		index("composition_version_source_media_asset_idx").on(
			table.workspaceId,
			table.sourceMediaAssetId,
		),
		index("composition_version_fingerprint_idx").on(
			table.workspaceId,
			table.compositionFingerprint,
		),
	],
);

export type CompositionVersionRow = typeof compositionVersion.$inferSelect;

import {
	mediaAssetMediaTypes,
	mediaAssetOrigins,
	mediaAssetStatuses,
	mediaAssetStorageProviders,
	mediaAssetUsageTypes,
	mediaUsageRights,
} from "@affichannel/core";
import { sql } from "drizzle-orm";
import {
	bigint,
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

const sqlEnum = (values: readonly string[]) =>
	sql.raw(values.map((value) => `'${value}'`).join(", "));

export const mediaAsset = pgTable(
	"media_asset",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		origin: text("origin").notNull().default("user_upload"),
		mediaType: text("media_type").notNull(),
		status: text("status").notNull().default("pending_upload"),
		storageProvider: text("storage_provider").notNull(),
		storageKey: text("storage_key").notNull(),
		uploadSessionId: text("upload_session_id").notNull(),
		prepareIdempotencyKey: text("prepare_idempotency_key").notNull(),
		uploadExpiresAt: timestamp("upload_expires_at", {
			withTimezone: true,
		}).notNull(),
		originalFilename: text("original_filename").notNull(),
		displayName: text("display_name").notNull(),
		declaredMimeType: text("declared_mime_type"),
		mimeType: text("mime_type"),
		byteSize: bigint("byte_size", { mode: "number" }),
		checksumSha256: text("checksum_sha256"),
		width: integer("width"),
		height: integer("height"),
		durationMs: bigint("duration_ms", { mode: "number" }),
		usageRights: text("usage_rights").notNull().default("unknown"),
		tags: text("tags").array().notNull().default(sql.raw("ARRAY[]::text[]")),
		failureCode: text("failure_code"),
		finalizedAt: timestamp("finalized_at", { withTimezone: true }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
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
			"media_asset_origin_check",
			sql`${table.origin} in (${sqlEnum(mediaAssetOrigins)})`,
		),
		check(
			"media_asset_media_type_check",
			sql`${table.mediaType} in (${sqlEnum(mediaAssetMediaTypes)})`,
		),
		check(
			"media_asset_status_check",
			sql`${table.status} in (${sqlEnum(mediaAssetStatuses)})`,
		),
		check(
			"media_asset_storage_provider_check",
			sql`${table.storageProvider} in (${sqlEnum(mediaAssetStorageProviders)})`,
		),
		check(
			"media_asset_usage_rights_check",
			sql`${table.usageRights} in (${sqlEnum(mediaUsageRights)})`,
		),
		check(
			"media_asset_usage_metadata_check",
			sql`length(trim(${table.originalFilename})) between 1 and 255
				and length(trim(${table.displayName})) between 1 and 240
				and cardinality(${table.tags}) <= 50`,
		),
		check(
			"media_asset_binary_metadata_check",
			sql`(${table.byteSize} is null or ${table.byteSize} > 0)
				and (${table.width} is null or ${table.width} > 0)
				and (${table.height} is null or ${table.height} > 0)
				and (${table.durationMs} is null or ${table.durationMs} > 0)`,
		),
		check(
			"media_asset_checksum_check",
			sql`${table.checksumSha256} is null or ${table.checksumSha256} ~ '^[a-f0-9]{64}$'`,
		),
		check(
			"media_asset_mime_check",
			sql`${table.mimeType} is null or ${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg')`,
		),
		check(
			"media_asset_lifecycle_shape_check",
			sql`(
				(${table.status} in ('pending_upload', 'validating') and ${table.finalizedAt} is null and ${table.archivedAt} is null)
				or (${table.status} in ('ready', 'failed') and ${table.finalizedAt} is not null and ${table.archivedAt} is null)
				or (${table.status} = 'archived' and ${table.archivedAt} is not null and ${table.finalizedAt} is not null)
			)`,
		),
		check(
			"media_asset_failure_shape_check",
			sql`(${table.status} <> 'failed' or ${table.failureCode} is not null)`,
		),
		check(
			"media_asset_ready_shape_check",
			sql`(${table.status} <> 'ready' or (
				${table.mimeType} is not null
				and ${table.byteSize} > 0
				and ${table.checksumSha256} is not null
				and (
					(${table.mediaType} = 'image' and ${table.width} > 0 and ${table.height} > 0)
					or (${table.mediaType} = 'audio' and ${table.durationMs} > 0)
					or ${table.mediaType} = 'video'
				)
			))`,
		),
		uniqueIndex("media_asset_prepare_idempotency_unique").on(
			table.workspaceId,
			table.prepareIdempotencyKey,
		),
		uniqueIndex("media_asset_upload_session_unique").on(
			table.workspaceId,
			table.uploadSessionId,
		),
		uniqueIndex("media_asset_storage_identity_unique").on(
			table.storageProvider,
			table.storageKey,
		),
		uniqueIndex("media_asset_workspace_id_unique").on(
			table.workspaceId,
			table.id,
		),
		index("media_asset_workspace_status_updated_idx").on(
			table.workspaceId,
			table.status,
			table.updatedAt,
			table.id,
		),
		index("media_asset_workspace_type_status_updated_idx").on(
			table.workspaceId,
			table.mediaType,
			table.status,
			table.updatedAt,
			table.id,
		),
	],
);

export const mediaAssetLink = pgTable(
	"media_asset_link",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		mediaAssetId: text("media_asset_id")
			.notNull()
			.references(() => mediaAsset.id, { onDelete: "restrict" }),
		usageType: text("usage_type").notNull().default("project_resource"),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"media_asset_link_usage_type_check",
			sql`${table.usageType} in (${sqlEnum(mediaAssetUsageTypes)})`,
		),
		uniqueIndex("media_asset_link_scope_unique").on(
			table.workspaceId,
			table.projectId,
			table.mediaAssetId,
			table.usageType,
		),
		index("media_asset_link_project_created_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
			table.id,
		),
		index("media_asset_link_asset_created_idx").on(
			table.workspaceId,
			table.mediaAssetId,
			table.createdAt,
			table.id,
		),
	],
);

import {
	analyticsAttributionScopes,
	analyticsMetricFamilies,
	analyticsSourceTypes,
} from "@affichannel/core";
import { sql } from "drizzle-orm";
import {
	check,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import {
	channelStrategyPillar,
	channelStrategySeries,
} from "./channel-strategy";
import { plannedContentItem } from "./planned-content-item";
import { product } from "./product";
import { project } from "./project";
import { workspace } from "./workspace";

const sourceTypeSql = sql.raw(
	analyticsSourceTypes.map((value) => `'${value}'`).join(", "),
);
const familySql = sql.raw(
	analyticsMetricFamilies.map((value) => `'${value}'`).join(", "),
);
const attributionScopeSql = sql.raw(
	analyticsAttributionScopes.map((value) => `'${value}'`).join(", "),
);

export const analyticsImportBatch = pgTable(
	"analytics_import_batch",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		sourceType: text("source_type").notNull(),
		sourceIdentity: text("source_identity"),
		originalFilename: text("original_filename").notNull(),
		fileSha256: text("file_sha256").notNull(),
		recordedRangeStart: date("recorded_range_start", {
			mode: "string",
		}).notNull(),
		recordedRangeEnd: date("recorded_range_end", { mode: "string" }).notNull(),
		workspaceTimezone: text("workspace_timezone").notNull(),
		mappingVersion: text("mapping_version").notNull(),
		mappingFingerprint: text("mapping_fingerprint").notNull(),
		mappingJson: jsonb("mapping_json").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		rowCount: integer("row_count").notNull(),
		acceptedCount: integer("accepted_count").notNull(),
		rejectedCount: integer("rejected_count").notNull(),
		duplicateCount: integer("duplicate_count").notNull().default(0),
		idempotencyKey: text("idempotency_key").notNull(),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"analytics_import_batch_source_type_check",
			sql`${table.sourceType} in (${sourceTypeSql})`,
		),
		check(
			"analytics_import_batch_file_hash_check",
			sql`${table.fileSha256} ~ '^[a-f0-9]{64}$'`,
		),
		check(
			"analytics_import_batch_mapping_hash_check",
			sql`${table.mappingFingerprint} ~ '^[a-f0-9]{64}$'`,
		),
		check(
			"analytics_import_batch_date_check",
			sql`${table.recordedRangeEnd} >= ${table.recordedRangeStart}`,
		),
		check(
			"analytics_import_batch_count_check",
			sql`${table.rowCount} >= 0 and ${table.acceptedCount} >= 0 and ${table.rejectedCount} >= 0 and ${table.duplicateCount} >= 0 and ${table.acceptedCount} + ${table.rejectedCount} = ${table.rowCount}`,
		),
		check(
			"analytics_import_batch_mapping_shape_check",
			sql`jsonb_typeof(${table.mappingJson}) = 'object'`,
		),
		check(
			"analytics_import_batch_filename_check",
			sql`length(trim(${table.originalFilename})) between 1 and 255 and ${table.originalFilename} not like '%/%' and ${table.originalFilename} not like '%\\%'`,
		),
		uniqueIndex("analytics_import_batch_workspace_idempotency_unique").on(
			table.workspaceId,
			table.idempotencyKey,
		),
		uniqueIndex("analytics_import_batch_workspace_dedupe_unique").on(
			table.workspaceId,
			table.dedupeKey,
		),
		index("analytics_import_batch_workspace_created_idx").on(
			table.workspaceId,
			table.createdAt,
		),
		index("analytics_import_batch_workspace_range_idx").on(
			table.workspaceId,
			table.recordedRangeStart,
			table.recordedRangeEnd,
		),
	],
);

export const analyticsMetricSnapshot = pgTable(
	"analytics_metric_snapshot",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		importBatchId: text("import_batch_id")
			.notNull()
			.references(() => analyticsImportBatch.id, { onDelete: "restrict" }),
		recordedRangeStart: date("recorded_range_start", {
			mode: "string",
		}).notNull(),
		recordedRangeEnd: date("recorded_range_end", { mode: "string" }).notNull(),
		metricFamily: text("metric_family").notNull(),
		metricKey: text("metric_key").notNull(),
		metricValue: numeric("metric_value", {
			precision: 24,
			scale: 6,
			mode: "number",
		}).notNull(),
		unit: text("unit").notNull(),
		sourceIdentity: text("source_identity"),
		attributionScope: text("attribution_scope").notNull(),
		projectId: text("project_id").references(() => project.id, {
			onDelete: "restrict",
		}),
		plannedContentItemId: text("planned_content_item_id").references(
			() => plannedContentItem.id,
			{ onDelete: "restrict" },
		),
		productId: text("product_id").references(() => product.id, {
			onDelete: "restrict",
		}),
		pillarId: text("pillar_id").references(() => channelStrategyPillar.id, {
			onDelete: "restrict",
		}),
		seriesId: text("series_id").references(() => channelStrategySeries.id, {
			onDelete: "restrict",
		}),
		contentType: text("content_type"),
		contentFormatKey: text("content_format_key"),
		contentFormatVersion: integer("content_format_version"),
		creationPath: text("creation_path"),
		usageRecordType: text("usage_record_type"),
		usageRecordId: text("usage_record_id"),
		sourceRowHash: text("source_row_hash").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"analytics_metric_snapshot_family_check",
			sql`${table.metricFamily} in (${familySql})`,
		),
		check(
			"analytics_metric_snapshot_scope_check",
			sql`${table.attributionScope} in (${attributionScopeSql})`,
		),
		check(
			"analytics_metric_snapshot_value_check",
			sql`${table.metricValue} <> 'NaN'::numeric`,
		),
		check(
			"analytics_metric_snapshot_range_check",
			sql`${table.recordedRangeEnd} >= ${table.recordedRangeStart}`,
		),
		check(
			"analytics_metric_snapshot_hash_check",
			sql`${table.sourceRowHash} ~ '^[a-f0-9]{64}$' and ${table.dedupeKey} ~ '^[a-f0-9]{64}$'`,
		),
		check(
			"analytics_metric_snapshot_content_type_check",
			sql`${table.contentType} is null or ${table.contentType} in ('ORGANIC', 'AFFILIATE')`,
		),
		check(
			"analytics_metric_snapshot_creation_path_check",
			sql`${table.creationPath} is null or ${table.creationPath} in ('QUICK_IMAGE', 'SCRIPTED', 'MEDIA_FIRST')`,
		),
		check(
			"analytics_metric_snapshot_format_version_check",
			sql`${table.contentFormatVersion} is null or ${table.contentFormatVersion} > 0`,
		),
		uniqueIndex("analytics_metric_snapshot_workspace_dedupe_unique").on(
			table.workspaceId,
			table.dedupeKey,
		),
		index("analytics_metric_snapshot_workspace_range_idx").on(
			table.workspaceId,
			table.recordedRangeStart,
			table.recordedRangeEnd,
		),
		index("analytics_metric_snapshot_workspace_family_idx").on(
			table.workspaceId,
			table.metricFamily,
			table.metricKey,
		),
		index("analytics_metric_snapshot_batch_idx").on(table.importBatchId),
		index("analytics_metric_snapshot_dimension_idx").on(
			table.workspaceId,
			table.contentType,
			table.pillarId,
			table.seriesId,
			table.contentFormatKey,
			table.creationPath,
			table.productId,
		),
	],
);

export type AnalyticsImportBatchRow = typeof analyticsImportBatch.$inferSelect;
export type AnalyticsMetricSnapshotRow =
	typeof analyticsMetricSnapshot.$inferSelect;

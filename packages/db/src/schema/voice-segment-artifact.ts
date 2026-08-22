import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project } from "./project";
import { scriptVersion } from "./script-version";
import { workspace } from "./workspace";

export const voiceSegmentArtifact = pgTable(
	"voice_segment_artifact",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		sourceScriptVersionId: text("source_script_version_id")
			.notNull()
			.references(() => scriptVersion.id, { onDelete: "restrict" }),
		sourceScriptRevision: integer("source_script_revision").notNull(),
		segmentKey: text("segment_key").notNull(),
		segmentTextSnapshot: text("segment_text_snapshot").notNull(),
		textHash: text("text_hash").notNull(),
		voiceConfigRevision: integer("voice_config_revision").notNull(),
		provider: text("provider").notNull(),
		voiceId: text("voice_id").notNull(),
		language: text("language").notNull(),
		speed: real("speed").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		requestHash: text("request_hash").notNull(),
		status: text("status").notNull(),
		providerRequestId: text("provider_request_id"),
		errorCode: text("error_code"),
		storageProvider: text("storage_provider"),
		storageKey: text("storage_key"),
		mimeType: text("mime_type"),
		byteSize: bigint("byte_size", { mode: "number" }),
		checksum: text("checksum"),
		durationMs: bigint("duration_ms", { mode: "number" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(table) => [
		check(
			"voice_segment_artifact_status_check",
			sql`${table.status} in ('pending', 'completed', 'failed', 'indeterminate')`,
		),
		check(
			"voice_segment_artifact_source_revision_check",
			sql`${table.sourceScriptRevision} >= 1`,
		),
		check(
			"voice_segment_artifact_voice_config_revision_check",
			sql`${table.voiceConfigRevision} >= 1`,
		),
		check(
			"voice_segment_artifact_segment_key_check",
			sql`length(trim(${table.segmentKey})) between 1 and 120`,
		),
		check(
			"voice_segment_artifact_hash_check",
			sql`${table.textHash} ~ '^[a-f0-9]{64}$' and ${table.requestHash} ~ '^[a-f0-9]{64}$' and (${table.checksum} is null or ${table.checksum} ~ '^[a-f0-9]{64}$')`,
		),
		check(
			"voice_segment_artifact_idempotency_key_check",
			sql`length(trim(${table.idempotencyKey})) between 8 and 200`,
		),
		check(
			"voice_segment_artifact_speed_check",
			sql`${table.speed} >= 0.7 and ${table.speed} <= 1.5`,
		),
		check(
			"voice_segment_artifact_storage_provider_check",
			sql`${table.storageProvider} is null or ${table.storageProvider} in ('local', 'r2')`,
		),
		check(
			"voice_segment_artifact_mime_check",
			sql`${table.mimeType} is null or ${table.mimeType} = 'audio/mpeg'`,
		),
		check(
			"voice_segment_artifact_audio_metadata_check",
			sql`(${table.byteSize} is null or ${table.byteSize} > 0) and (${table.durationMs} is null or ${table.durationMs} > 0)`,
		),
		check(
			"voice_segment_artifact_finished_shape_check",
			sql`(${table.status} = 'pending' and ${table.finishedAt} is null) or (${table.status} <> 'pending' and ${table.finishedAt} is not null)`,
		),
		check(
			"voice_segment_artifact_completed_shape_check",
			sql`(${table.status} <> 'completed') or (${table.storageProvider} is not null and ${table.storageKey} is not null and ${table.mimeType} = 'audio/mpeg' and ${table.byteSize} > 0 and ${table.checksum} is not null and ${table.durationMs} > 0)`,
		),
		uniqueIndex("voice_segment_artifact_idempotency_unique").on(
			table.workspaceId,
			table.idempotencyKey,
		),
		uniqueIndex("voice_segment_artifact_pending_request_unique")
			.on(table.workspaceId, table.projectId, table.requestHash)
			.where(sql`${table.status} = 'pending'`),
		index("voice_segment_artifact_project_latest_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
			table.id,
		),
		index("voice_segment_artifact_project_segment_latest_idx").on(
			table.workspaceId,
			table.projectId,
			table.segmentKey,
			table.createdAt,
			table.id,
		),
		index("voice_segment_artifact_source_segment_idx").on(
			table.workspaceId,
			table.sourceScriptVersionId,
			table.sourceScriptRevision,
			table.segmentKey,
		),
		index("voice_segment_artifact_created_by_user_idx").on(
			table.createdByUserId,
		),
	],
);

import { aiVisualGenerationStatuses } from "@affichannel/core";
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
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { aiOperation } from "./ai-governance";
import { user } from "./auth";
import { mediaAsset } from "./media-asset";
import { project } from "./project";
import { workspace } from "./workspace";

const sqlEnum = (values: readonly string[]) =>
	sql.raw(values.map((value) => `'${value}'`).join(", "));

export const aiVisualGeneration = pgTable(
	"ai_visual_generation",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "restrict" }),
		sourceMediaAssetId: text("source_media_asset_id")
			.notNull()
			.references(() => mediaAsset.id, { onDelete: "restrict" }),
		operationId: text("operation_id")
			.notNull()
			.references(() => aiOperation.id, { onDelete: "restrict" }),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		requestHash: text("request_hash").notNull(),
		hashVersion: text("hash_version").notNull(),
		requestJson: jsonb("request_json").notNull(),
		sourceProofJson: jsonb("source_proof_json").notNull(),
		status: text("status").notNull().default("PENDING"),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		completedMediaAssetId: text("completed_media_asset_id").references(
			() => mediaAsset.id,
			{ onDelete: "restrict" },
		),
		failureCode: text("failure_code"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		check(
			"ai_visual_generation_status_check",
			sql`${table.status} in (${sqlEnum(aiVisualGenerationStatuses)})`,
		),
		check(
			"ai_visual_generation_hash_check",
			sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
		),
		check(
			"ai_visual_generation_terminal_shape_check",
			sql`(${table.status} <> 'COMPLETED' or ${table.completedMediaAssetId} is not null)`,
		),
		uniqueIndex("ai_visual_generation_operation_unique").on(table.operationId),
		uniqueIndex("ai_visual_generation_workspace_hash_unique").on(
			table.workspaceId,
			table.requestHash,
		),
		index("ai_visual_generation_workspace_project_created_idx").on(
			table.workspaceId,
			table.projectId,
			table.createdAt,
		),
		index("ai_visual_generation_source_idx").on(
			table.workspaceId,
			table.sourceMediaAssetId,
		),
	],
);

export const aiVisualArtifact = pgTable(
	"ai_visual_artifact",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspace.id, { onDelete: "cascade" }),
		generationId: text("generation_id")
			.notNull()
			.references(() => aiVisualGeneration.id, { onDelete: "cascade" }),
		mediaAssetId: text("media_asset_id").references(() => mediaAsset.id, {
			onDelete: "restrict",
		}),
		storageProvider: text("storage_provider").notNull(),
		storageKey: text("storage_key").notNull(),
		status: text("status").notNull().default("TEMP"),
		providerRequestId: text("provider_request_id"),
		mimeType: text("mime_type").notNull(),
		byteSize: bigint("byte_size", { mode: "number" }).notNull(),
		checksumSha256: text("checksum_sha256").notNull(),
		durationMs: integer("duration_ms").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		finalizedAt: timestamp("finalized_at", { withTimezone: true }),
	},
	(table) => [
		check(
			"ai_visual_artifact_status_check",
			sql`${table.status} in ('TEMP', 'FINAL', 'ORPHAN', 'DELETED')`,
		),
		check(
			"ai_visual_artifact_storage_provider_check",
			sql`${table.storageProvider} in ('local', 'r2')`,
		),
		check(
			"ai_visual_artifact_media_shape_check",
			sql`(${table.status} = 'FINAL' and ${table.mediaAssetId} is not null and ${table.finalizedAt} is not null) or (${table.status} <> 'FINAL')`,
		),
		check(
			"ai_visual_artifact_mime_check",
			sql`${table.mimeType} = 'video/mp4' and ${table.byteSize} > 0 and ${table.durationMs} > 0 and ${table.checksumSha256} ~ '^[a-f0-9]{64}$'`,
		),
		uniqueIndex("ai_visual_artifact_generation_unique").on(table.generationId),
		uniqueIndex("ai_visual_artifact_media_asset_unique").on(table.mediaAssetId),
		uniqueIndex("ai_visual_artifact_storage_unique").on(
			table.storageProvider,
			table.storageKey,
		),
		index("ai_visual_artifact_workspace_created_idx").on(
			table.workspaceId,
			table.createdAt,
		),
	],
);

export type AiVisualGenerationRow = typeof aiVisualGeneration.$inferSelect;
export type AiVisualArtifactRow = typeof aiVisualArtifact.$inferSelect;

CREATE TABLE "voice_segment_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"source_script_version_id" text NOT NULL,
	"source_script_revision" integer NOT NULL,
	"segment_key" text NOT NULL,
	"segment_text_snapshot" text NOT NULL,
	"text_hash" text NOT NULL,
	"voice_config_revision" integer NOT NULL,
	"provider" text NOT NULL,
	"voice_id" text NOT NULL,
	"language" text NOT NULL,
	"speed" real NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"provider_request_id" text,
	"error_code" text,
	"storage_provider" text,
	"storage_key" text,
	"mime_type" text,
	"byte_size" bigint,
	"checksum" text,
	"duration_ms" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "voice_segment_artifact_status_check" CHECK ("voice_segment_artifact"."status" in ('pending', 'completed', 'failed', 'indeterminate')),
	CONSTRAINT "voice_segment_artifact_source_revision_check" CHECK ("voice_segment_artifact"."source_script_revision" >= 1),
	CONSTRAINT "voice_segment_artifact_voice_config_revision_check" CHECK ("voice_segment_artifact"."voice_config_revision" >= 1),
	CONSTRAINT "voice_segment_artifact_segment_key_check" CHECK (length(trim("voice_segment_artifact"."segment_key")) between 1 and 120),
	CONSTRAINT "voice_segment_artifact_hash_check" CHECK ("voice_segment_artifact"."text_hash" ~ '^[a-f0-9]{64}$' and "voice_segment_artifact"."request_hash" ~ '^[a-f0-9]{64}$' and ("voice_segment_artifact"."checksum" is null or "voice_segment_artifact"."checksum" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "voice_segment_artifact_idempotency_key_check" CHECK (length(trim("voice_segment_artifact"."idempotency_key")) between 8 and 200),
	CONSTRAINT "voice_segment_artifact_speed_check" CHECK ("voice_segment_artifact"."speed" >= 0.7 and "voice_segment_artifact"."speed" <= 1.5),
	CONSTRAINT "voice_segment_artifact_storage_provider_check" CHECK ("voice_segment_artifact"."storage_provider" is null or "voice_segment_artifact"."storage_provider" in ('local', 'r2')),
	CONSTRAINT "voice_segment_artifact_mime_check" CHECK ("voice_segment_artifact"."mime_type" is null or "voice_segment_artifact"."mime_type" = 'audio/mpeg'),
	CONSTRAINT "voice_segment_artifact_audio_metadata_check" CHECK (("voice_segment_artifact"."byte_size" is null or "voice_segment_artifact"."byte_size" > 0) and ("voice_segment_artifact"."duration_ms" is null or "voice_segment_artifact"."duration_ms" > 0)),
	CONSTRAINT "voice_segment_artifact_finished_shape_check" CHECK (("voice_segment_artifact"."status" = 'pending' and "voice_segment_artifact"."finished_at" is null) or ("voice_segment_artifact"."status" <> 'pending' and "voice_segment_artifact"."finished_at" is not null)),
	CONSTRAINT "voice_segment_artifact_completed_shape_check" CHECK (("voice_segment_artifact"."status" <> 'completed') or ("voice_segment_artifact"."storage_provider" is not null and "voice_segment_artifact"."storage_key" is not null and "voice_segment_artifact"."mime_type" = 'audio/mpeg' and "voice_segment_artifact"."byte_size" > 0 and "voice_segment_artifact"."checksum" is not null and "voice_segment_artifact"."duration_ms" > 0))
);
--> statement-breakpoint
ALTER TABLE "voice_segment_artifact" ADD CONSTRAINT "voice_segment_artifact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_segment_artifact" ADD CONSTRAINT "voice_segment_artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_segment_artifact" ADD CONSTRAINT "voice_segment_artifact_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_segment_artifact" ADD CONSTRAINT "voice_segment_artifact_source_script_version_id_script_version_id_fk" FOREIGN KEY ("source_script_version_id") REFERENCES "public"."script_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_segment_artifact_idempotency_unique" ON "voice_segment_artifact" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_segment_artifact_pending_request_unique" ON "voice_segment_artifact" USING btree ("workspace_id","project_id","request_hash") WHERE "voice_segment_artifact"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "voice_segment_artifact_project_latest_idx" ON "voice_segment_artifact" USING btree ("workspace_id","project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "voice_segment_artifact_project_segment_latest_idx" ON "voice_segment_artifact" USING btree ("workspace_id","project_id","segment_key","created_at","id");--> statement-breakpoint
CREATE INDEX "voice_segment_artifact_source_segment_idx" ON "voice_segment_artifact" USING btree ("workspace_id","source_script_version_id","source_script_revision","segment_key");--> statement-breakpoint
CREATE INDEX "voice_segment_artifact_created_by_user_idx" ON "voice_segment_artifact" USING btree ("created_by_user_id");
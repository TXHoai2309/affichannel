CREATE TABLE "ai_visual_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"generation_id" text NOT NULL,
	"media_asset_id" text,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'TEMP' NOT NULL,
	"provider_request_id" text,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "ai_visual_artifact_status_check" CHECK ("ai_visual_artifact"."status" in ('TEMP', 'FINAL', 'ORPHAN', 'DELETED')),
	CONSTRAINT "ai_visual_artifact_media_shape_check" CHECK (("ai_visual_artifact"."status" = 'FINAL' and "ai_visual_artifact"."media_asset_id" is not null and "ai_visual_artifact"."finalized_at" is not null) or ("ai_visual_artifact"."status" <> 'FINAL')),
	CONSTRAINT "ai_visual_artifact_mime_check" CHECK ("ai_visual_artifact"."mime_type" = 'video/mp4' and "ai_visual_artifact"."byte_size" > 0 and "ai_visual_artifact"."duration_ms" > 0 and "ai_visual_artifact"."checksum_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ai_visual_generation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_media_asset_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"hash_version" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"source_proof_json" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_media_asset_id" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_visual_generation_status_check" CHECK ("ai_visual_generation"."status" in ('PENDING', 'COMPLETED', 'FAILED', 'INDETERMINATE')),
	CONSTRAINT "ai_visual_generation_hash_check" CHECK ("ai_visual_generation"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "ai_visual_generation_terminal_shape_check" CHECK (("ai_visual_generation"."status" <> 'COMPLETED' or "ai_visual_generation"."completed_media_asset_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "ai_visual_artifact" ADD CONSTRAINT "ai_visual_artifact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visual_artifact" ADD CONSTRAINT "ai_visual_artifact_generation_id_ai_visual_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."ai_visual_generation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visual_artifact" ADD CONSTRAINT "ai_visual_artifact_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visual_generation" ADD CONSTRAINT "ai_visual_generation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visual_generation" ADD CONSTRAINT "ai_visual_generation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visual_generation" ADD CONSTRAINT "ai_visual_generation_source_media_asset_id_media_asset_id_fk" FOREIGN KEY ("source_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visual_generation" ADD CONSTRAINT "ai_visual_generation_operation_id_ai_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visual_generation" ADD CONSTRAINT "ai_visual_generation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visual_generation" ADD CONSTRAINT "ai_visual_generation_completed_media_asset_id_media_asset_id_fk" FOREIGN KEY ("completed_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visual_artifact_generation_unique" ON "ai_visual_artifact" USING btree ("generation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visual_artifact_media_asset_unique" ON "ai_visual_artifact" USING btree ("media_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visual_artifact_storage_unique" ON "ai_visual_artifact" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE INDEX "ai_visual_artifact_workspace_created_idx" ON "ai_visual_artifact" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visual_generation_operation_unique" ON "ai_visual_generation" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_visual_generation_workspace_hash_unique" ON "ai_visual_generation" USING btree ("workspace_id","request_hash");--> statement-breakpoint
CREATE INDEX "ai_visual_generation_workspace_project_created_idx" ON "ai_visual_generation" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_visual_generation_source_idx" ON "ai_visual_generation" USING btree ("workspace_id","source_media_asset_id");
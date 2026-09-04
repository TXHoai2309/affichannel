CREATE TABLE "media_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"origin" text DEFAULT 'user_upload' NOT NULL,
	"media_type" text NOT NULL,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"upload_session_id" text NOT NULL,
	"prepare_idempotency_key" text NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"original_filename" text NOT NULL,
	"display_name" text NOT NULL,
	"declared_mime_type" text,
	"mime_type" text,
	"byte_size" bigint,
	"checksum_sha256" text,
	"width" integer,
	"height" integer,
	"duration_ms" bigint,
	"usage_rights" text DEFAULT 'unknown' NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"failure_code" text,
	"finalized_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_asset_origin_check" CHECK ("media_asset"."origin" in ('user_upload', 'ai_generated', 'voice_generated', 'imported')),
	CONSTRAINT "media_asset_media_type_check" CHECK ("media_asset"."media_type" in ('image', 'video', 'audio')),
	CONSTRAINT "media_asset_status_check" CHECK ("media_asset"."status" in ('pending_upload', 'validating', 'ready', 'failed', 'archived')),
	CONSTRAINT "media_asset_storage_provider_check" CHECK ("media_asset"."storage_provider" in ('local', 'r2')),
	CONSTRAINT "media_asset_usage_rights_check" CHECK ("media_asset"."usage_rights" in ('owned', 'licensed', 'unknown', 'restricted')),
	CONSTRAINT "media_asset_usage_metadata_check" CHECK (length(trim("media_asset"."original_filename")) between 1 and 255
				and length(trim("media_asset"."display_name")) between 1 and 240
				and cardinality("media_asset"."tags") <= 50),
	CONSTRAINT "media_asset_binary_metadata_check" CHECK (("media_asset"."byte_size" is null or "media_asset"."byte_size" > 0)
				and ("media_asset"."width" is null or "media_asset"."width" > 0)
				and ("media_asset"."height" is null or "media_asset"."height" > 0)
				and ("media_asset"."duration_ms" is null or "media_asset"."duration_ms" > 0)),
	CONSTRAINT "media_asset_checksum_check" CHECK ("media_asset"."checksum_sha256" is null or "media_asset"."checksum_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "media_asset_mime_check" CHECK ("media_asset"."mime_type" is null or "media_asset"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg')),
	CONSTRAINT "media_asset_lifecycle_shape_check" CHECK ((
				("media_asset"."status" in ('pending_upload', 'validating') and "media_asset"."finalized_at" is null and "media_asset"."archived_at" is null)
				or ("media_asset"."status" in ('ready', 'failed') and "media_asset"."finalized_at" is not null and "media_asset"."archived_at" is null)
				or ("media_asset"."status" = 'archived' and "media_asset"."archived_at" is not null and "media_asset"."finalized_at" is not null)
			)),
	CONSTRAINT "media_asset_failure_shape_check" CHECK (("media_asset"."status" <> 'failed' or "media_asset"."failure_code" is not null)),
	CONSTRAINT "media_asset_ready_shape_check" CHECK (("media_asset"."status" <> 'ready' or (
				"media_asset"."mime_type" is not null
				and "media_asset"."byte_size" > 0
				and "media_asset"."checksum_sha256" is not null
				and (
					("media_asset"."media_type" = 'image' and "media_asset"."width" > 0 and "media_asset"."height" > 0)
					or ("media_asset"."media_type" = 'audio' and "media_asset"."duration_ms" > 0)
					or "media_asset"."media_type" = 'video'
				)
			)))
);
--> statement-breakpoint
CREATE TABLE "media_asset_link" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"media_asset_id" text NOT NULL,
	"usage_type" text DEFAULT 'project_resource' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_asset_link_usage_type_check" CHECK ("media_asset_link"."usage_type" in ('project_resource'))
);
--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_link" ADD CONSTRAINT "media_asset_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_link" ADD CONSTRAINT "media_asset_link_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_link" ADD CONSTRAINT "media_asset_link_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_link" ADD CONSTRAINT "media_asset_link_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_prepare_idempotency_unique" ON "media_asset" USING btree ("workspace_id","prepare_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_upload_session_unique" ON "media_asset" USING btree ("workspace_id","upload_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_storage_identity_unique" ON "media_asset" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_workspace_id_unique" ON "media_asset" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "media_asset_workspace_status_updated_idx" ON "media_asset" USING btree ("workspace_id","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "media_asset_workspace_type_status_updated_idx" ON "media_asset" USING btree ("workspace_id","media_type","status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_link_scope_unique" ON "media_asset_link" USING btree ("workspace_id","project_id","media_asset_id","usage_type");--> statement-breakpoint
CREATE INDEX "media_asset_link_project_created_idx" ON "media_asset_link" USING btree ("workspace_id","project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "media_asset_link_asset_created_idx" ON "media_asset_link" USING btree ("workspace_id","media_asset_id","created_at","id");
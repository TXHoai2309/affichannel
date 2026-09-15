CREATE TABLE "quick_image_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quick_image_settings_duration_check" CHECK ("quick_image_settings"."duration_seconds" in (5, 10, 15)),
	CONSTRAINT "quick_image_settings_revision_check" CHECK ("quick_image_settings"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "composition_version" DROP CONSTRAINT "composition_version_source_revision_check";--> statement-breakpoint
ALTER TABLE "composition_version" DROP CONSTRAINT "composition_version_schema_version_check";--> statement-breakpoint
ALTER TABLE "media_asset_link" DROP CONSTRAINT "media_asset_link_usage_type_check";--> statement-breakpoint
ALTER TABLE "composition_version" ALTER COLUMN "source_script_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "composition_version" ALTER COLUMN "source_script_revision" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "composition_version" ADD COLUMN "source_kind" text;--> statement-breakpoint
UPDATE "composition_version" SET "source_kind" = 'SCRIPTED' WHERE "source_kind" IS NULL;--> statement-breakpoint
ALTER TABLE "composition_version" ALTER COLUMN "source_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "composition_version" ADD COLUMN "source_media_asset_id" text;--> statement-breakpoint
ALTER TABLE "composition_version" ADD COLUMN "source_media_checksum_sha256" text;--> statement-breakpoint
ALTER TABLE "composition_version" ADD COLUMN "source_media_storage_provider" text;--> statement-breakpoint
ALTER TABLE "composition_version" ADD COLUMN "source_media_storage_key" text;--> statement-breakpoint
ALTER TABLE "composition_version" ADD COLUMN "source_media_mime_type" text;--> statement-breakpoint
ALTER TABLE "composition_version" ADD COLUMN "source_media_byte_size" bigint;--> statement-breakpoint
ALTER TABLE "composition_version" ADD COLUMN "source_media_width" integer;--> statement-breakpoint
ALTER TABLE "composition_version" ADD COLUMN "source_media_height" integer;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "image_analysis_version" text;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "image_frame_count" integer;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "image_exif_orientation" integer;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "image_has_transparency" boolean;--> statement-breakpoint
ALTER TABLE "quick_image_settings" ADD CONSTRAINT "quick_image_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_image_settings" ADD CONSTRAINT "quick_image_settings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quick_image_settings_workspace_project_unique" ON "quick_image_settings" USING btree ("workspace_id","project_id");--> statement-breakpoint
ALTER TABLE "composition_version" ADD CONSTRAINT "composition_version_source_media_asset_id_media_asset_id_fk" FOREIGN KEY ("source_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composition_version_source_media_asset_idx" ON "composition_version" USING btree ("workspace_id","source_media_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_link_current_source_unique" ON "media_asset_link" USING btree ("workspace_id","project_id") WHERE "media_asset_link"."usage_type" = 'quick_image_current_source';--> statement-breakpoint
ALTER TABLE "composition_version" ADD CONSTRAINT "composition_version_source_lineage_check" CHECK ((
				("composition_version"."source_kind" = 'SCRIPTED'
					and "composition_version"."source_script_version_id" is not null
					and "composition_version"."source_script_revision" is not null
					and "composition_version"."source_script_revision" > 0
					and "composition_version"."source_media_asset_id" is null
					and "composition_version"."source_media_checksum_sha256" is null
					and "composition_version"."source_media_storage_provider" is null
					and "composition_version"."source_media_storage_key" is null
					and "composition_version"."source_media_mime_type" is null
					and "composition_version"."source_media_byte_size" is null
					and "composition_version"."source_media_width" is null
					and "composition_version"."source_media_height" is null)
				or
				("composition_version"."source_kind" = 'QUICK_IMAGE'
					and "composition_version"."source_script_version_id" is null
					and "composition_version"."source_script_revision" is null
					and "composition_version"."source_media_asset_id" is not null
					and "composition_version"."source_media_checksum_sha256" is not null
					and "composition_version"."source_media_checksum_sha256" ~ '^[a-f0-9]{64}$'
					and "composition_version"."source_media_storage_provider" is not null
					and "composition_version"."source_media_storage_provider" in ('local', 'r2')
					and "composition_version"."source_media_storage_key" is not null
					and length(trim("composition_version"."source_media_storage_key")) > 0
					and "composition_version"."source_media_mime_type" is not null
					and "composition_version"."source_media_mime_type" in ('image/jpeg', 'image/png', 'image/webp')
					and "composition_version"."source_media_byte_size" is not null
					and "composition_version"."source_media_byte_size" > 0
					and "composition_version"."source_media_width" is not null
					and "composition_version"."source_media_width" > 0
					and "composition_version"."source_media_height" is not null
					and "composition_version"."source_media_height" > 0)
			));--> statement-breakpoint
ALTER TABLE "composition_version" ADD CONSTRAINT "composition_version_schema_version_check" CHECK ("composition_version"."schema_version" in ('composition-input.v1', 'composition-input.v2'));--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_image_analysis_frame_count_check" CHECK ("media_asset"."image_frame_count" is null or "media_asset"."image_frame_count" > 0);--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_image_analysis_orientation_check" CHECK ("media_asset"."image_exif_orientation" is null or "media_asset"."image_exif_orientation" between 1 and 8);--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_image_analysis_shape_check" CHECK ((
				("media_asset"."image_analysis_version" is null
					and "media_asset"."image_frame_count" is null
					and "media_asset"."image_exif_orientation" is null
					and "media_asset"."image_has_transparency" is null)
				or
				("media_asset"."media_type" = 'image'
					and "media_asset"."image_analysis_version" is not null
					and "media_asset"."image_analysis_version" = 'static-raster-v1'
					and "media_asset"."image_frame_count" is not null
					and "media_asset"."image_exif_orientation" is not null
					and "media_asset"."image_has_transparency" is not null)
			));--> statement-breakpoint
ALTER TABLE "media_asset_link" ADD CONSTRAINT "media_asset_link_usage_type_check" CHECK ("media_asset_link"."usage_type" in ('project_resource', 'quick_image_current_source'));

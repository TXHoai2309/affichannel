CREATE TABLE "ai_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"text_provider" text,
	"text_model" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_text_config_length_check" CHECK ((text_provider is null or length(trim(text_provider)) between 1 and 100) and (text_model is null or length(trim(text_model)) between 1 and 200))
);
--> statement-breakpoint
CREATE TABLE "channel_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"niche" text,
	"target_audience" text,
	"tone" text,
	"content_pillar" text,
	"default_cta" text,
	"affiliate_disclosure" text,
	"avoid_words" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_settings_text_length_check" CHECK ((niche is null or length(trim(niche)) between 1 and 500) and (target_audience is null or length(trim(target_audience)) between 1 and 500) and (tone is null or length(trim(tone)) between 1 and 500) and (content_pillar is null or length(trim(content_pillar)) between 1 and 500) and (default_cta is null or length(trim(default_cta)) between 1 and 500) and (affiliate_disclosure is null or length(trim(affiliate_disclosure)) between 1 and 500))
);
--> statement-breakpoint
CREATE TABLE "media_metadata" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"media_type" text NOT NULL,
	"aspect_ratio" text NOT NULL,
	"duration_seconds" integer,
	"usage_rights" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"scene_suitability" text DEFAULT 'unknown' NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"display_name" text NOT NULL,
	"reference_url" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_metadata_type_check" CHECK (media_type in ('image', 'video', 'audio')),
	CONSTRAINT "media_metadata_aspect_ratio_check" CHECK (length(trim(aspect_ratio)) between 1 and 32),
	CONSTRAINT "media_metadata_duration_check" CHECK (duration_seconds is null or duration_seconds >= 0),
	CONSTRAINT "media_metadata_usage_rights_check" CHECK (usage_rights in ('owned', 'licensed', 'unknown', 'restricted')),
	CONSTRAINT "media_metadata_status_check" CHECK (status in ('ready', 'needs_review', 'archived')),
	CONSTRAINT "media_metadata_scene_suitability_check" CHECK (length(trim(scene_suitability)) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_settings" ADD CONSTRAINT "channel_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_settings" ADD CONSTRAINT "channel_settings_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_settings" ADD CONSTRAINT "channel_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_metadata" ADD CONSTRAINT "media_metadata_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_metadata" ADD CONSTRAINT "media_metadata_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_metadata" ADD CONSTRAINT "media_metadata_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_settings_workspace_unique" ON "ai_settings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ai_settings_created_by_user_idx" ON "ai_settings" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "ai_settings_updated_by_user_idx" ON "ai_settings" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_settings_workspace_unique" ON "channel_settings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "channel_settings_created_by_user_idx" ON "channel_settings" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "channel_settings_updated_by_user_idx" ON "channel_settings" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_metadata_workspace_project_id_unique" ON "media_metadata" USING btree ("workspace_id","project_id","id");--> statement-breakpoint
CREATE INDEX "media_metadata_workspace_project_idx" ON "media_metadata" USING btree ("workspace_id","project_id","updated_at");--> statement-breakpoint
CREATE INDEX "media_metadata_project_id_idx" ON "media_metadata" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "media_metadata_created_by_user_idx" ON "media_metadata" USING btree ("created_by_user_id");
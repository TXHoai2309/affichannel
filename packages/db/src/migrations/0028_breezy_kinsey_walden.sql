CREATE TABLE "channel_strategy" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"niche" text NOT NULL,
	"target_audience" text NOT NULL,
	"presence_mode" text NOT NULL,
	"tone" text NOT NULL,
	"posts_per_week" integer NOT NULL,
	"preferred_posting_days" integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
	"visual_style" text NOT NULL,
	"organic_percentage" integer NOT NULL,
	"affiliate_percentage" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_strategy_version_check" CHECK ("channel_strategy"."version" > 0),
	CONSTRAINT "channel_strategy_presence_mode_check" CHECK ("channel_strategy"."presence_mode" in ('FACELESS', 'FACE_PREFERRED', 'FLEXIBLE')),
	CONSTRAINT "channel_strategy_posts_per_week_check" CHECK ("channel_strategy"."posts_per_week" between 1 and 7),
	CONSTRAINT "channel_strategy_posting_days_check" CHECK (array_position("channel_strategy"."preferred_posting_days", null) is null and "channel_strategy"."preferred_posting_days" <@ array[0,1,2,3,4,5,6]::integer[]),
	CONSTRAINT "channel_strategy_mix_target_check" CHECK ("channel_strategy"."organic_percentage" between 0 and 100 and "channel_strategy"."affiliate_percentage" between 0 and 100 and "channel_strategy"."organic_percentage" + "channel_strategy"."affiliate_percentage" = 100),
	CONSTRAINT "channel_strategy_text_length_check" CHECK (length(trim("channel_strategy"."niche")) between 1 and 500 and length(trim("channel_strategy"."target_audience")) between 1 and 500 and length(trim("channel_strategy"."tone")) between 1 and 500 and length(trim("channel_strategy"."visual_style")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "channel_strategy_pillar" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "channel_strategy_pillar_position_check" CHECK ("channel_strategy_pillar"."position" between 0 and 4),
	CONSTRAINT "channel_strategy_pillar_name_check" CHECK (length(trim("channel_strategy_pillar"."name")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "channel_strategy_preferred_content_format" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"position" integer NOT NULL,
	"content_format_key" text NOT NULL,
	"content_format_version" integer NOT NULL,
	CONSTRAINT "channel_strategy_preferred_format_position_check" CHECK ("channel_strategy_preferred_content_format"."position" between 0 and 2),
	CONSTRAINT "channel_strategy_preferred_format_key_check" CHECK (length(trim("channel_strategy_preferred_content_format"."content_format_key")) between 1 and 120),
	CONSTRAINT "channel_strategy_preferred_format_version_check" CHECK ("channel_strategy_preferred_content_format"."content_format_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "channel_strategy_preferred_creation_path" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"position" integer NOT NULL,
	"creation_path" text NOT NULL,
	CONSTRAINT "channel_strategy_preferred_path_position_check" CHECK ("channel_strategy_preferred_creation_path"."position" between 0 and 2),
	CONSTRAINT "channel_strategy_preferred_path_value_check" CHECK ("channel_strategy_preferred_creation_path"."creation_path" in ('QUICK_IMAGE', 'SCRIPTED', 'MEDIA_FIRST'))
);
--> statement-breakpoint
CREATE TABLE "channel_strategy_series" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "channel_strategy_series_position_check" CHECK ("channel_strategy_series"."position" between 0 and 19),
	CONSTRAINT "channel_strategy_series_name_check" CHECK (length(trim("channel_strategy_series"."name")) between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "channel_strategy_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "channel_strategy_version" integer;--> statement-breakpoint
ALTER TABLE "channel_strategy" ADD CONSTRAINT "channel_strategy_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_strategy" ADD CONSTRAINT "channel_strategy_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_strategy" ADD CONSTRAINT "channel_strategy_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_strategy_pillar" ADD CONSTRAINT "channel_strategy_pillar_strategy_id_channel_strategy_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."channel_strategy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_strategy_preferred_content_format" ADD CONSTRAINT "channel_strategy_preferred_content_format_strategy_id_channel_strategy_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."channel_strategy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_strategy_preferred_creation_path" ADD CONSTRAINT "channel_strategy_preferred_creation_path_strategy_id_channel_strategy_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."channel_strategy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_strategy_series" ADD CONSTRAINT "channel_strategy_series_strategy_id_channel_strategy_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."channel_strategy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_strategy_workspace_unique" ON "channel_strategy" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "channel_strategy_created_by_user_idx" ON "channel_strategy" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "channel_strategy_updated_by_user_idx" ON "channel_strategy" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_strategy_pillar_strategy_position_unique" ON "channel_strategy_pillar" USING btree ("strategy_id","position");--> statement-breakpoint
CREATE INDEX "channel_strategy_pillar_strategy_idx" ON "channel_strategy_pillar" USING btree ("strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_strategy_preferred_format_strategy_position_unique" ON "channel_strategy_preferred_content_format" USING btree ("strategy_id","position");--> statement-breakpoint
CREATE INDEX "channel_strategy_preferred_format_strategy_idx" ON "channel_strategy_preferred_content_format" USING btree ("strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_strategy_preferred_path_strategy_position_unique" ON "channel_strategy_preferred_creation_path" USING btree ("strategy_id","position");--> statement-breakpoint
CREATE INDEX "channel_strategy_preferred_path_strategy_idx" ON "channel_strategy_preferred_creation_path" USING btree ("strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_strategy_series_strategy_position_unique" ON "channel_strategy_series" USING btree ("strategy_id","position");--> statement-breakpoint
CREATE INDEX "channel_strategy_series_strategy_idx" ON "channel_strategy_series" USING btree ("strategy_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_channel_strategy_id_channel_strategy_id_fk" FOREIGN KEY ("channel_strategy_id") REFERENCES "public"."channel_strategy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_channel_strategy_snapshot_check" CHECK (("project"."channel_strategy_id" is null and "project"."channel_strategy_version" is null) or ("project"."channel_strategy_id" is not null and "project"."channel_strategy_version" is not null and "project"."channel_strategy_version" > 0));
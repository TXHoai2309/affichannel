CREATE TABLE "planned_content_item" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scheduled_date" text NOT NULL,
	"scheduled_time" text NOT NULL,
	"timezone" text NOT NULL,
	"content_type" text NOT NULL,
	"creation_path" text NOT NULL,
	"content_format_key" text NOT NULL,
	"content_format_version" integer NOT NULL,
	"pillar" text NOT NULL,
	"series" text,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"product_id" text,
	"strategy_id" text,
	"strategy_version" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"conversion_project_id" text,
	"converted_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_content_item_date_check" CHECK ("planned_content_item"."scheduled_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "planned_content_item_time_check" CHECK ("planned_content_item"."scheduled_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "planned_content_item_content_type_check" CHECK ("planned_content_item"."content_type" in ('ORGANIC', 'AFFILIATE')),
	CONSTRAINT "planned_content_item_creation_path_check" CHECK ("planned_content_item"."creation_path" in ('QUICK_IMAGE', 'SCRIPTED', 'MEDIA_FIRST')),
	CONSTRAINT "planned_content_item_format_version_check" CHECK ("planned_content_item"."content_format_version" > 0),
	CONSTRAINT "planned_content_item_version_check" CHECK ("planned_content_item"."version" > 0),
	CONSTRAINT "planned_content_item_strategy_snapshot_check" CHECK (("planned_content_item"."strategy_id" is null and "planned_content_item"."strategy_version" is null) or ("planned_content_item"."strategy_id" is not null and "planned_content_item"."strategy_version" is not null and "planned_content_item"."strategy_version" > 0)),
	CONSTRAINT "planned_content_item_conversion_state_check" CHECK (("planned_content_item"."conversion_project_id" is null and "planned_content_item"."converted_at" is null) or ("planned_content_item"."conversion_project_id" is not null and "planned_content_item"."converted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "timezone" text DEFAULT 'Asia/Ho_Chi_Minh' NOT NULL;--> statement-breakpoint
ALTER TABLE "planned_content_item" ADD CONSTRAINT "planned_content_item_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_content_item" ADD CONSTRAINT "planned_content_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_content_item" ADD CONSTRAINT "planned_content_item_strategy_id_channel_strategy_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."channel_strategy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_content_item" ADD CONSTRAINT "planned_content_item_conversion_project_id_project_id_fk" FOREIGN KEY ("conversion_project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_content_item" ADD CONSTRAINT "planned_content_item_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_content_item_workspace_schedule_idx" ON "planned_content_item" USING btree ("workspace_id","scheduled_date","scheduled_time");--> statement-breakpoint
CREATE INDEX "planned_content_item_workspace_conversion_idx" ON "planned_content_item" USING btree ("workspace_id","conversion_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_content_item_conversion_project_unique" ON "planned_content_item" USING btree ("conversion_project_id");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_timezone_check" CHECK ("workspace"."timezone" <> '');
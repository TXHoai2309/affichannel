CREATE TABLE "analytics_import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_identity" text,
	"original_filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"recorded_range_start" date NOT NULL,
	"recorded_range_end" date NOT NULL,
	"workspace_timezone" text NOT NULL,
	"mapping_version" text NOT NULL,
	"mapping_fingerprint" text NOT NULL,
	"mapping_json" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"row_count" integer NOT NULL,
	"accepted_count" integer NOT NULL,
	"rejected_count" integer NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_import_batch_source_type_check" CHECK ("analytics_import_batch"."source_type" in ('MANUAL_CSV', 'MANUAL_XLSX')),
	CONSTRAINT "analytics_import_batch_file_hash_check" CHECK ("analytics_import_batch"."file_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "analytics_import_batch_mapping_hash_check" CHECK ("analytics_import_batch"."mapping_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "analytics_import_batch_date_check" CHECK ("analytics_import_batch"."recorded_range_end" >= "analytics_import_batch"."recorded_range_start"),
	CONSTRAINT "analytics_import_batch_count_check" CHECK ("analytics_import_batch"."row_count" >= 0 and "analytics_import_batch"."accepted_count" >= 0 and "analytics_import_batch"."rejected_count" >= 0 and "analytics_import_batch"."duplicate_count" >= 0 and "analytics_import_batch"."accepted_count" + "analytics_import_batch"."rejected_count" = "analytics_import_batch"."row_count"),
	CONSTRAINT "analytics_import_batch_mapping_shape_check" CHECK (jsonb_typeof("analytics_import_batch"."mapping_json") = 'object'),
	CONSTRAINT "analytics_import_batch_filename_check" CHECK (length(trim("analytics_import_batch"."original_filename")) between 1 and 255 and "analytics_import_batch"."original_filename" not like '%/%' and "analytics_import_batch"."original_filename" not like '%\%')
);
--> statement-breakpoint
CREATE TABLE "analytics_metric_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"import_batch_id" text NOT NULL,
	"recorded_range_start" date NOT NULL,
	"recorded_range_end" date NOT NULL,
	"metric_family" text NOT NULL,
	"metric_key" text NOT NULL,
	"metric_value" numeric(24, 6) NOT NULL,
	"unit" text NOT NULL,
	"source_identity" text,
	"attribution_scope" text NOT NULL,
	"project_id" text,
	"planned_content_item_id" text,
	"product_id" text,
	"pillar_id" text,
	"series_id" text,
	"content_type" text,
	"content_format_key" text,
	"content_format_version" integer,
	"creation_path" text,
	"usage_record_type" text,
	"usage_record_id" text,
	"source_row_hash" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_metric_snapshot_family_check" CHECK ("analytics_metric_snapshot"."metric_family" in ('CHANNEL_GROWTH', 'AFFILIATE_MONETIZATION', 'AI_RENDER_COST')),
	CONSTRAINT "analytics_metric_snapshot_scope_check" CHECK ("analytics_metric_snapshot"."attribution_scope" in ('CHANNEL', 'CONTENT', 'PRODUCT', 'UNATTRIBUTED')),
	CONSTRAINT "analytics_metric_snapshot_value_check" CHECK ("analytics_metric_snapshot"."metric_value" <> 'NaN'::numeric),
	CONSTRAINT "analytics_metric_snapshot_range_check" CHECK ("analytics_metric_snapshot"."recorded_range_end" >= "analytics_metric_snapshot"."recorded_range_start"),
	CONSTRAINT "analytics_metric_snapshot_hash_check" CHECK ("analytics_metric_snapshot"."source_row_hash" ~ '^[a-f0-9]{64}$' and "analytics_metric_snapshot"."dedupe_key" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "analytics_metric_snapshot_content_type_check" CHECK ("analytics_metric_snapshot"."content_type" is null or "analytics_metric_snapshot"."content_type" in ('ORGANIC', 'AFFILIATE')),
	CONSTRAINT "analytics_metric_snapshot_creation_path_check" CHECK ("analytics_metric_snapshot"."creation_path" is null or "analytics_metric_snapshot"."creation_path" in ('QUICK_IMAGE', 'SCRIPTED', 'MEDIA_FIRST')),
	CONSTRAINT "analytics_metric_snapshot_format_version_check" CHECK ("analytics_metric_snapshot"."content_format_version" is null or "analytics_metric_snapshot"."content_format_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "analytics_import_batch" ADD CONSTRAINT "analytics_import_batch_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_import_batch" ADD CONSTRAINT "analytics_import_batch_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_metric_snapshot" ADD CONSTRAINT "analytics_metric_snapshot_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_metric_snapshot" ADD CONSTRAINT "analytics_metric_snapshot_import_batch_id_analytics_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."analytics_import_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_metric_snapshot" ADD CONSTRAINT "analytics_metric_snapshot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_metric_snapshot" ADD CONSTRAINT "analytics_metric_snapshot_planned_content_item_id_planned_content_item_id_fk" FOREIGN KEY ("planned_content_item_id") REFERENCES "public"."planned_content_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_metric_snapshot" ADD CONSTRAINT "analytics_metric_snapshot_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_metric_snapshot" ADD CONSTRAINT "analytics_metric_snapshot_pillar_id_channel_strategy_pillar_id_fk" FOREIGN KEY ("pillar_id") REFERENCES "public"."channel_strategy_pillar"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_metric_snapshot" ADD CONSTRAINT "analytics_metric_snapshot_series_id_channel_strategy_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."channel_strategy_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_import_batch_workspace_idempotency_unique" ON "analytics_import_batch" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_import_batch_workspace_dedupe_unique" ON "analytics_import_batch" USING btree ("workspace_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "analytics_import_batch_workspace_created_idx" ON "analytics_import_batch" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "analytics_import_batch_workspace_range_idx" ON "analytics_import_batch" USING btree ("workspace_id","recorded_range_start","recorded_range_end");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_metric_snapshot_workspace_dedupe_unique" ON "analytics_metric_snapshot" USING btree ("workspace_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "analytics_metric_snapshot_workspace_range_idx" ON "analytics_metric_snapshot" USING btree ("workspace_id","recorded_range_start","recorded_range_end");--> statement-breakpoint
CREATE INDEX "analytics_metric_snapshot_workspace_family_idx" ON "analytics_metric_snapshot" USING btree ("workspace_id","metric_family","metric_key");--> statement-breakpoint
CREATE INDEX "analytics_metric_snapshot_batch_idx" ON "analytics_metric_snapshot" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_snapshot_dimension_idx" ON "analytics_metric_snapshot" USING btree ("workspace_id","content_type","pillar_id","series_id","content_format_key","creation_path","product_id");
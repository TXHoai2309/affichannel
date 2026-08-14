CREATE TABLE "script_generation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"parent_generation_id" text,
	"mode" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"output_schema_version" text NOT NULL,
	"input_snapshot_json" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"status" text NOT NULL,
	"output_json" jsonb,
	"valid_sections" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"invalid_sections" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"provider_request_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_micros" bigint,
	"actual_cost_micros" bigint,
	"currency" text,
	"error_code" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_generation_status_check" CHECK ("script_generation"."status" in ('pending', 'completed', 'partial', 'failed', 'indeterminate')),
	CONSTRAINT "script_generation_mode_check" CHECK ("script_generation"."mode" in ('full', 'repair')),
	CONSTRAINT "script_generation_request_hash_check" CHECK ("script_generation"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "script_generation_input_hash_check" CHECK ("script_generation"."input_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "script_generation_prompt_hash_check" CHECK ("script_generation"."prompt_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "script_generation_idempotency_key_check" CHECK (length(trim("script_generation"."idempotency_key")) between 8 and 200),
	CONSTRAINT "script_generation_mode_parent_check" CHECK (("script_generation"."mode" = 'full' and "script_generation"."parent_generation_id" is null) or ("script_generation"."mode" = 'repair' and "script_generation"."parent_generation_id" is not null)),
	CONSTRAINT "script_generation_status_output_check" CHECK (("script_generation"."status" in ('completed', 'partial') and "script_generation"."output_json" is not null) or ("script_generation"."status" in ('pending', 'failed', 'indeterminate') and "script_generation"."output_json" is null)),
	CONSTRAINT "script_generation_status_finished_check" CHECK (("script_generation"."status" = 'pending' and "script_generation"."finished_at" is null) or ("script_generation"."status" <> 'pending' and "script_generation"."finished_at" is not null)),
	CONSTRAINT "script_generation_sections_check" CHECK ("script_generation"."valid_sections" <@ ARRAY['hook','voiceover','scenes','cta','caption','hashtags','disclosure','claims']::text[] and "script_generation"."invalid_sections" <@ ARRAY['hook','voiceover','scenes','cta','caption','hashtags','disclosure','claims']::text[] and not ("script_generation"."valid_sections" && "script_generation"."invalid_sections")),
	CONSTRAINT "script_generation_token_check" CHECK ("script_generation"."input_tokens" is null or "script_generation"."input_tokens" >= 0),
	CONSTRAINT "script_generation_output_token_check" CHECK ("script_generation"."output_tokens" is null or "script_generation"."output_tokens" >= 0),
	CONSTRAINT "script_generation_estimated_cost_check" CHECK ("script_generation"."estimated_cost_micros" is null or "script_generation"."estimated_cost_micros" >= 0),
	CONSTRAINT "script_generation_actual_cost_check" CHECK ("script_generation"."actual_cost_micros" is null or "script_generation"."actual_cost_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "script_generation" ADD CONSTRAINT "script_generation_scope_id_unique" UNIQUE("workspace_id","project_id","id");--> statement-breakpoint
ALTER TABLE "fact_dependency" DROP CONSTRAINT "fact_dependency_type_check";--> statement-breakpoint
ALTER TABLE "fact_invalidation_event" DROP CONSTRAINT "fact_invalidation_type_check";--> statement-breakpoint
ALTER TABLE "script_generation" ADD CONSTRAINT "script_generation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_generation" ADD CONSTRAINT "script_generation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_generation" ADD CONSTRAINT "script_generation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_generation" ADD CONSTRAINT "script_generation_parent_scope_fk" FOREIGN KEY ("workspace_id","project_id","parent_generation_id") REFERENCES "public"."script_generation"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "script_generation_idempotency_unique" ON "script_generation" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "script_generation_pending_project_unique" ON "script_generation" USING btree ("workspace_id","project_id") WHERE "script_generation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "script_generation_latest_idx" ON "script_generation" USING btree ("workspace_id","project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "script_generation_parent_idx" ON "script_generation" USING btree ("workspace_id","parent_generation_id");--> statement-breakpoint
CREATE INDEX "script_generation_created_by_user_idx" ON "script_generation" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "fact_dependency" ADD CONSTRAINT "fact_dependency_type_check" CHECK ("fact_dependency"."dependent_type" in ('script', 'script_generation', 'fact_lock', 'voice', 'video', 'render'));--> statement-breakpoint
ALTER TABLE "fact_invalidation_event" ADD CONSTRAINT "fact_invalidation_type_check" CHECK ("fact_invalidation_event"."dependent_type" in ('script', 'script_generation', 'fact_lock', 'voice', 'video', 'render'));

CREATE TABLE "script_claim_refresh_run" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"script_version_id" text NOT NULL,
	"source_script_revision" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"input_snapshot_json" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"source_content_hash" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"output_schema_version" text NOT NULL,
	"status" text NOT NULL,
	"provider_request_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_micros" bigint,
	"actual_cost_micros" bigint,
	"currency" text,
	"error_code" text,
	"error_message" text,
	"execution_claimed_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"result_script_revision" integer,
	CONSTRAINT "script_claim_refresh_source_revision_check" CHECK ("script_claim_refresh_run"."source_script_revision" > 0),
	CONSTRAINT "script_claim_refresh_result_revision_check" CHECK ("script_claim_refresh_run"."result_script_revision" is null or "script_claim_refresh_run"."result_script_revision" = "script_claim_refresh_run"."source_script_revision" + 1),
	CONSTRAINT "script_claim_refresh_hash_check" CHECK ("script_claim_refresh_run"."request_hash" ~ '^[0-9a-f]{64}$'
				and "script_claim_refresh_run"."input_hash" ~ '^[0-9a-f]{64}$'
				and "script_claim_refresh_run"."source_content_hash" ~ '^[0-9a-f]{64}$'
				and "script_claim_refresh_run"."prompt_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "script_claim_refresh_status_check" CHECK ("script_claim_refresh_run"."status" in ('pending', 'completed', 'failed', 'indeterminate')),
	CONSTRAINT "script_claim_refresh_status_shape_check" CHECK ((
				("script_claim_refresh_run"."status" = 'pending'
					and "script_claim_refresh_run"."finished_at" is null
					and "script_claim_refresh_run"."result_script_revision" is null)
				or
				("script_claim_refresh_run"."status" = 'completed'
					and "script_claim_refresh_run"."finished_at" is not null
					and "script_claim_refresh_run"."result_script_revision" is not null
					and "script_claim_refresh_run"."error_code" is null
					and "script_claim_refresh_run"."error_message" is null)
				or
				("script_claim_refresh_run"."status" in ('failed', 'indeterminate')
					and "script_claim_refresh_run"."finished_at" is not null
					and "script_claim_refresh_run"."result_script_revision" is null)
			)),
	CONSTRAINT "script_claim_refresh_error_pair_check" CHECK (("script_claim_refresh_run"."error_code" is null and "script_claim_refresh_run"."error_message" is null)
				or ("script_claim_refresh_run"."error_code" is not null and "script_claim_refresh_run"."error_message" is not null)),
	CONSTRAINT "script_claim_refresh_idempotency_key_check" CHECK (length(trim("script_claim_refresh_run"."idempotency_key")) between 8 and 200),
	CONSTRAINT "script_claim_refresh_token_check" CHECK (("script_claim_refresh_run"."input_tokens" is null or "script_claim_refresh_run"."input_tokens" >= 0)
				and ("script_claim_refresh_run"."output_tokens" is null or "script_claim_refresh_run"."output_tokens" >= 0)),
	CONSTRAINT "script_claim_refresh_cost_check" CHECK (("script_claim_refresh_run"."estimated_cost_micros" is null or "script_claim_refresh_run"."estimated_cost_micros" >= 0)
				and ("script_claim_refresh_run"."actual_cost_micros" is null or "script_claim_refresh_run"."actual_cost_micros" >= 0)),
	CONSTRAINT "script_claim_refresh_currency_check" CHECK ((("script_claim_refresh_run"."estimated_cost_micros" is null and "script_claim_refresh_run"."actual_cost_micros" is null and "script_claim_refresh_run"."currency" is null)
				or (("script_claim_refresh_run"."estimated_cost_micros" is not null or "script_claim_refresh_run"."actual_cost_micros" is not null)
					and "script_claim_refresh_run"."currency" ~ '^[A-Z]{3}$')))
);
--> statement-breakpoint
ALTER TABLE "script_claim_refresh_run" ADD CONSTRAINT "script_claim_refresh_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_claim_refresh_run" ADD CONSTRAINT "script_claim_refresh_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_claim_refresh_run" ADD CONSTRAINT "script_claim_refresh_run_script_version_id_script_version_id_fk" FOREIGN KEY ("script_version_id") REFERENCES "public"."script_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_claim_refresh_run" ADD CONSTRAINT "script_claim_refresh_run_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "script_claim_refresh_idempotency_unique" ON "script_claim_refresh_run" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "script_claim_refresh_pending_semantic_unique" ON "script_claim_refresh_run" USING btree ("workspace_id","project_id","request_hash") WHERE "script_claim_refresh_run"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "script_claim_refresh_project_history_idx" ON "script_claim_refresh_run" USING btree ("workspace_id","project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "script_claim_refresh_script_history_idx" ON "script_claim_refresh_run" USING btree ("workspace_id","script_version_id","source_script_revision","created_at","id");
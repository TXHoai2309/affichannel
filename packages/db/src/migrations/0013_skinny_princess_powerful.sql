CREATE TABLE "fact_lock_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"claim_key" text NOT NULL,
	"claim_text" text NOT NULL,
	"occurrence_json" jsonb NOT NULL,
	"classification_status" text NOT NULL,
	"review_status" text NOT NULL,
	"reason" text NOT NULL,
	"confidence" real,
	"suggestion_text" text,
	"fact_revision" integer,
	"checked_at" timestamp with time zone NOT NULL,
	"reviewed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fact_lock_claim_classification_check" CHECK ("fact_lock_claim"."classification_status" in ('SUPPORTED', 'NEEDS_REVIEW', 'UNSUPPORTED', 'PROHIBITED')),
	CONSTRAINT "fact_lock_claim_review_check" CHECK (("fact_lock_claim"."classification_status" = 'SUPPORTED' and "fact_lock_claim"."review_status" = 'AUTO_PASSED') or ("fact_lock_claim"."classification_status" in ('NEEDS_REVIEW', 'UNSUPPORTED', 'PROHIBITED') and "fact_lock_claim"."review_status" in ('UNRESOLVED', 'MANUAL_APPROVED'))),
	CONSTRAINT "fact_lock_claim_confidence_check" CHECK ("fact_lock_claim"."confidence" is null or ("fact_lock_claim"."confidence" >= 0 and "fact_lock_claim"."confidence" <= 1)),
	CONSTRAINT "fact_lock_claim_revision_check" CHECK ("fact_lock_claim"."fact_revision" is null or "fact_lock_claim"."fact_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "fact_lock_claim_fact" (
	"claim_id" text NOT NULL,
	"fact_id" text NOT NULL,
	"fact_revision" integer NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "fact_lock_claim_fact_claim_id_fact_id_fact_revision_relation_pk" PRIMARY KEY("claim_id","fact_id","fact_revision","relation"),
	CONSTRAINT "fact_lock_claim_fact_revision_check" CHECK ("fact_lock_claim_fact"."fact_revision" > 0),
	CONSTRAINT "fact_lock_claim_fact_relation_check" CHECK ("fact_lock_claim_fact"."relation" in ('supports', 'contradicts', 'context'))
);
--> statement-breakpoint
CREATE TABLE "fact_lock_run" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"script_version_id" text NOT NULL,
	"source_script_revision" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"input_snapshot_json" jsonb NOT NULL,
	"input_hash" text NOT NULL,
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
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "fact_lock_run_status_check" CHECK ("fact_lock_run"."status" in ('pending', 'review_required', 'passed', 'failed', 'indeterminate')),
	CONSTRAINT "fact_lock_run_source_revision_check" CHECK ("fact_lock_run"."source_script_revision" > 0),
	CONSTRAINT "fact_lock_run_idempotency_length_check" CHECK (length(trim("fact_lock_run"."idempotency_key")) between 8 and 200),
	CONSTRAINT "fact_lock_run_hash_check" CHECK ("fact_lock_run"."request_hash" ~ '^[a-f0-9]{64}$' and "fact_lock_run"."input_hash" ~ '^[a-f0-9]{64}$' and "fact_lock_run"."prompt_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "fact_lock_run_token_check" CHECK (("fact_lock_run"."input_tokens" is null or "fact_lock_run"."input_tokens" >= 0) and ("fact_lock_run"."output_tokens" is null or "fact_lock_run"."output_tokens" >= 0)),
	CONSTRAINT "fact_lock_run_cost_check" CHECK (("fact_lock_run"."estimated_cost_micros" is null or "fact_lock_run"."estimated_cost_micros" >= 0) and ("fact_lock_run"."actual_cost_micros" is null or "fact_lock_run"."actual_cost_micros" >= 0)),
	CONSTRAINT "fact_lock_run_currency_check" CHECK ((("fact_lock_run"."estimated_cost_micros" is null and "fact_lock_run"."actual_cost_micros" is null and "fact_lock_run"."currency" is null) or (("fact_lock_run"."estimated_cost_micros" is not null or "fact_lock_run"."actual_cost_micros" is not null) and "fact_lock_run"."currency" ~ '^[A-Z]{3}$'))),
	CONSTRAINT "fact_lock_run_finished_shape_check" CHECK (("fact_lock_run"."status" = 'pending' and "fact_lock_run"."finished_at" is null) or ("fact_lock_run"."status" <> 'pending' and "fact_lock_run"."finished_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "fact_lock_claim" ADD CONSTRAINT "fact_lock_claim_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_lock_claim" ADD CONSTRAINT "fact_lock_claim_run_id_fact_lock_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."fact_lock_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_lock_claim" ADD CONSTRAINT "fact_lock_claim_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_lock_claim_fact" ADD CONSTRAINT "fact_lock_claim_fact_claim_id_fact_lock_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."fact_lock_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_script_version_id_script_version_id_fk" FOREIGN KEY ("script_version_id") REFERENCES "public"."script_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_lock_claim_run_key_unique" ON "fact_lock_claim" USING btree ("run_id","claim_key");--> statement-breakpoint
CREATE INDEX "fact_lock_claim_workspace_run_idx" ON "fact_lock_claim" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE INDEX "fact_lock_claim_classification_idx" ON "fact_lock_claim" USING btree ("workspace_id","classification_status","review_status");--> statement-breakpoint
CREATE INDEX "fact_lock_claim_fact_fact_revision_idx" ON "fact_lock_claim_fact" USING btree ("fact_id","fact_revision");--> statement-breakpoint
CREATE INDEX "fact_lock_claim_fact_claim_idx" ON "fact_lock_claim_fact" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_lock_run_idempotency_unique" ON "fact_lock_run" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_lock_run_pending_scope_unique" ON "fact_lock_run" USING btree ("workspace_id","project_id","script_version_id","source_script_revision") WHERE "fact_lock_run"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "fact_lock_run_project_latest_idx" ON "fact_lock_run" USING btree ("workspace_id","project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "fact_lock_run_script_version_idx" ON "fact_lock_run" USING btree ("workspace_id","script_version_id","source_script_revision");--> statement-breakpoint
CREATE INDEX "fact_lock_run_status_idx" ON "fact_lock_run" USING btree ("workspace_id","status","created_at");
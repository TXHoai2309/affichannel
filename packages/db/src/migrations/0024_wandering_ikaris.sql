CREATE TABLE "render_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"render_job_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"lease_owner" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone,
	"authorization_evidence_fingerprint" text,
	"technical_preflight_version" text,
	"technical_preflight_status" text,
	"technical_preflight_reason_code" text,
	"technical_evidence_fingerprint" text,
	"technical_checked_at" timestamp with time zone,
	"execution_started_at" timestamp with time zone,
	"output_reservation_id" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "render_attempt_number_check" CHECK ("render_attempt"."attempt_number" > 0),
	CONSTRAINT "render_attempt_status_check" CHECK ("render_attempt"."status" in ('RUNNING', 'COMPLETED', 'FAILED', 'INDETERMINATE', 'FENCED')),
	CONSTRAINT "render_attempt_hash_check" CHECK (("render_attempt"."authorization_evidence_fingerprint" is null or "render_attempt"."authorization_evidence_fingerprint" ~ '^[a-f0-9]{64}$') and ("render_attempt"."technical_evidence_fingerprint" is null or "render_attempt"."technical_evidence_fingerprint" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "render_attempt_preflight_status_check" CHECK ("render_attempt"."technical_preflight_status" is null or "render_attempt"."technical_preflight_status" in ('VALID', 'INVALID', 'UNSUPPORTED', 'UNKNOWN')),
	CONSTRAINT "render_attempt_finished_shape_check" CHECK (("render_attempt"."status" = 'RUNNING' and "render_attempt"."finished_at" is null) or ("render_attempt"."status" <> 'RUNNING' and "render_attempt"."finished_at" is not null)),
	CONSTRAINT "render_attempt_execution_marker_check" CHECK ("render_attempt"."execution_started_at" is null or "render_attempt"."authorized_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "render_job" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"composition_version_id" text NOT NULL,
	"composition_fingerprint" text NOT NULL,
	"canonical_request_hash" text NOT NULL,
	"request_spec_json" jsonb NOT NULL,
	"output_encoding_profile_json" jsonb NOT NULL,
	"output_encoding_profile_fingerprint" text NOT NULL,
	"output_contract_version" text NOT NULL,
	"operation" text NOT NULL,
	"source_render_job_id" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"reason_code" text,
	"error_code" text,
	"error_message" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "render_job_scope_hash_check" CHECK ("render_job"."composition_fingerprint" ~ '^[a-f0-9]{64}$' and "render_job"."canonical_request_hash" ~ '^[a-f0-9]{64}$' and "render_job"."output_encoding_profile_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "render_job_operation_check" CHECK ("render_job"."operation" in ('START_RENDER', 'RENDER_AGAIN')),
	CONSTRAINT "render_job_operation_source_check" CHECK (("render_job"."operation" = 'START_RENDER' and "render_job"."source_render_job_id" is null) or ("render_job"."operation" = 'RENDER_AGAIN' and "render_job"."source_render_job_id" is not null)),
	CONSTRAINT "render_job_status_check" CHECK ("render_job"."status" in ('QUEUED', 'RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED', 'INDETERMINATE')),
	CONSTRAINT "render_job_attempt_count_check" CHECK ("render_job"."attempt_count" >= 0),
	CONSTRAINT "render_job_idempotency_key_check" CHECK (length(trim("render_job"."idempotency_key")) between 8 and 200),
	CONSTRAINT "render_job_finished_shape_check" CHECK (("render_job"."status" in ('QUEUED', 'RUNNING', 'BLOCKED') and "render_job"."finished_at" is null) or ("render_job"."status" in ('COMPLETED', 'FAILED', 'INDETERMINATE') and "render_job"."finished_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "render_attempt" ADD CONSTRAINT "render_attempt_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_attempt" ADD CONSTRAINT "render_attempt_render_job_id_render_job_id_fk" FOREIGN KEY ("render_job_id") REFERENCES "public"."render_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_composition_version_id_composition_version_id_fk" FOREIGN KEY ("composition_version_id") REFERENCES "public"."composition_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_source_render_job_fk" FOREIGN KEY ("source_render_job_id") REFERENCES "public"."render_job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "render_attempt_job_number_unique" ON "render_attempt" USING btree ("render_job_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "render_attempt_active_job_unique" ON "render_attempt" USING btree ("render_job_id") WHERE "render_attempt"."status" = 'RUNNING';--> statement-breakpoint
CREATE UNIQUE INDEX "render_attempt_output_reservation_unique" ON "render_attempt" USING btree ("output_reservation_id");--> statement-breakpoint
CREATE INDEX "render_attempt_lease_idx" ON "render_attempt" USING btree ("status","lease_expires_at","id");--> statement-breakpoint
CREATE INDEX "render_attempt_job_status_idx" ON "render_attempt" USING btree ("render_job_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "render_job_workspace_idempotency_unique" ON "render_job" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "render_job_active_identity_unique" ON "render_job" USING btree ("workspace_id","project_id","composition_version_id","canonical_request_hash") WHERE "render_job"."status" in ('QUEUED', 'RUNNING', 'BLOCKED', 'INDETERMINATE');--> statement-breakpoint
CREATE INDEX "render_job_claim_queue_idx" ON "render_job" USING btree ("workspace_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "render_job_project_created_idx" ON "render_job" USING btree ("workspace_id","project_id","created_at","id");
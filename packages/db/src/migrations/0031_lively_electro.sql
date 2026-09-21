CREATE TABLE "ai_budget_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"amount_micros" bigint NOT NULL,
	"currency" text NOT NULL,
	"period_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "ai_budget_reservation_status_check" CHECK ("ai_budget_reservation"."status" in ('ACTIVE', 'SETTLED', 'RELEASED', 'UNCERTAIN')),
	CONSTRAINT "ai_budget_reservation_amount_check" CHECK ("ai_budget_reservation"."amount_micros" >= 0 and "ai_budget_reservation"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "ai_governance_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_enabled" boolean DEFAULT false NOT NULL,
	"model_enabled" boolean DEFAULT false NOT NULL,
	"kill_switch" boolean DEFAULT true NOT NULL,
	"pricing_version" text,
	"budget_period" text DEFAULT 'MONTHLY' NOT NULL,
	"budget_period_start" date NOT NULL,
	"budget_limit_micros" bigint NOT NULL,
	"budget_currency" text NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"settled_micros" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_governance_settings_period_check" CHECK ("ai_governance_settings"."budget_period" in ('MONTHLY')),
	CONSTRAINT "ai_governance_settings_amount_check" CHECK ("ai_governance_settings"."budget_limit_micros" >= 0 and "ai_governance_settings"."reserved_micros" >= 0 and "ai_governance_settings"."settled_micros" >= 0),
	CONSTRAINT "ai_governance_settings_currency_check" CHECK ("ai_governance_settings"."budget_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ai_governance_settings_version_check" CHECK ("ai_governance_settings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"created_by_user_id" text NOT NULL,
	"operation_kind" text NOT NULL,
	"capability" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"hash_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"request_metadata_json" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"call_stage" text DEFAULT 'NOT_STARTED' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"fence_token" integer DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider_request_id" text,
	"pricing_version" text,
	"currency" text,
	"estimated_cost_micros" bigint NOT NULL,
	"reserved_cost_micros" bigint NOT NULL,
	"actual_cost_micros" bigint,
	"input_tokens" integer,
	"output_tokens" integer,
	"usage_json" jsonb,
	"safe_error_json" jsonb,
	"artifact_evidence_json" jsonb,
	"error_category" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_operation_status_check" CHECK ("ai_operation"."status" in ('PENDING', 'COMPLETED', 'FAILED', 'INDETERMINATE')),
	CONSTRAINT "ai_operation_call_stage_check" CHECK ("ai_operation"."call_stage" in ('NOT_STARTED', 'POSSIBLY_SENT', 'REQUEST_IDENTIFIED', 'RESPONSE_RECEIVED', 'FINALIZED')),
	CONSTRAINT "ai_operation_hash_check" CHECK ("ai_operation"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "ai_operation_amount_check" CHECK ("ai_operation"."estimated_cost_micros" >= 0 and "ai_operation"."reserved_cost_micros" >= 0 and ("ai_operation"."actual_cost_micros" is null or "ai_operation"."actual_cost_micros" >= 0)),
	CONSTRAINT "ai_operation_currency_check" CHECK ("ai_operation"."currency" is null or "ai_operation"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ai_operation_finished_shape_check" CHECK (("ai_operation"."status" = 'PENDING' and "ai_operation"."finished_at" is null) or ("ai_operation"."status" <> 'PENDING' and "ai_operation"."finished_at" is not null)),
	CONSTRAINT "ai_operation_lease_shape_check" CHECK (("ai_operation"."lease_owner" is null and "ai_operation"."lease_expires_at" is null) or ("ai_operation"."lease_owner" is not null and "ai_operation"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "ai_operation_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"correlation_id" text NOT NULL,
	"provider_request_id" text,
	"safe_metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_pricing_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"operation_kind" text NOT NULL,
	"pricing_version" text NOT NULL,
	"currency" text NOT NULL,
	"unit" text NOT NULL,
	"input_micros_per_million_tokens" bigint NOT NULL,
	"output_micros_per_million_tokens" bigint NOT NULL,
	"fixed_micros" bigint DEFAULT 0 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_pricing_version_amount_check" CHECK ("ai_pricing_version"."input_micros_per_million_tokens" >= 0 and "ai_pricing_version"."output_micros_per_million_tokens" >= 0 and "ai_pricing_version"."fixed_micros" >= 0),
	CONSTRAINT "ai_pricing_version_currency_check" CHECK ("ai_pricing_version"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ai_pricing_version_unit_check" CHECK ("ai_pricing_version"."unit" in ('REQUEST', 'TOKENS'))
);
--> statement-breakpoint
CREATE TABLE "ai_reconciliation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"evidence_json" jsonb,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_budget_reservation" ADD CONSTRAINT "ai_budget_reservation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_budget_reservation" ADD CONSTRAINT "ai_budget_reservation_operation_id_ai_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_settings" ADD CONSTRAINT "ai_governance_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_settings" ADD CONSTRAINT "ai_governance_settings_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_governance_settings" ADD CONSTRAINT "ai_governance_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operation" ADD CONSTRAINT "ai_operation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operation" ADD CONSTRAINT "ai_operation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operation" ADD CONSTRAINT "ai_operation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operation_audit" ADD CONSTRAINT "ai_operation_audit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operation_audit" ADD CONSTRAINT "ai_operation_audit_operation_id_ai_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_pricing_version" ADD CONSTRAINT "ai_pricing_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_pricing_version" ADD CONSTRAINT "ai_pricing_version_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reconciliation" ADD CONSTRAINT "ai_reconciliation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reconciliation" ADD CONSTRAINT "ai_reconciliation_operation_id_ai_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reconciliation" ADD CONSTRAINT "ai_reconciliation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_budget_reservation_operation_unique" ON "ai_budget_reservation" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "ai_budget_reservation_workspace_status_idx" ON "ai_budget_reservation" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_governance_settings_workspace_unique" ON "ai_governance_settings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ai_governance_settings_provider_idx" ON "ai_governance_settings" USING btree ("workspace_id","provider_id","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_operation_workspace_idempotency_unique" ON "ai_operation" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_operation_workspace_hash_unique" ON "ai_operation" USING btree ("workspace_id","request_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_operation_workspace_provider_request_unique" ON "ai_operation" USING btree ("workspace_id","provider_request_id");--> statement-breakpoint
CREATE INDEX "ai_operation_workspace_created_idx" ON "ai_operation" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_operation_workspace_filter_idx" ON "ai_operation" USING btree ("workspace_id","provider_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_operation_lease_idx" ON "ai_operation" USING btree ("status","lease_expires_at","id");--> statement-breakpoint
CREATE INDEX "ai_operation_project_idx" ON "ai_operation" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_operation_audit_operation_created_idx" ON "ai_operation_audit" USING btree ("operation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_operation_audit_workspace_created_idx" ON "ai_operation_audit" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_pricing_version_identity_unique" ON "ai_pricing_version" USING btree ("workspace_id","provider_id","model_id","operation_kind","pricing_version");--> statement-breakpoint
CREATE INDEX "ai_pricing_version_workspace_idx" ON "ai_pricing_version" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_reconciliation_operation_created_idx" ON "ai_reconciliation" USING btree ("operation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_reconciliation_workspace_created_idx" ON "ai_reconciliation" USING btree ("workspace_id","created_at");
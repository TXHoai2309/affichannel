CREATE TABLE "fact_dependency" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_fact_id" text NOT NULL,
	"fact_revision" integer NOT NULL,
	"dependent_type" text NOT NULL,
	"dependent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detached_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	CONSTRAINT "fact_dependency_revision_check" CHECK ("fact_dependency"."fact_revision" > 0),
	CONSTRAINT "fact_dependency_type_check" CHECK ("fact_dependency"."dependent_type" in ('script', 'fact_lock', 'voice', 'video', 'render')),
	CONSTRAINT "fact_dependency_reason_check" CHECK ("fact_dependency"."invalidation_reason" is null or "fact_dependency"."invalidation_reason" in ('fact_changed', 'fact_deactivated', 'fact_deleted'))
);
--> statement-breakpoint
CREATE TABLE "fact_invalidation_event" (
	"id" text PRIMARY KEY NOT NULL,
	"dependency_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"product_fact_id" text NOT NULL,
	"from_revision" integer NOT NULL,
	"to_revision" integer,
	"dependent_type" text NOT NULL,
	"dependent_id" text NOT NULL,
	"reason" text NOT NULL,
	"triggered_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fact_invalidation_from_revision_check" CHECK ("fact_invalidation_event"."from_revision" > 0),
	CONSTRAINT "fact_invalidation_to_revision_check" CHECK ("fact_invalidation_event"."to_revision" is null or "fact_invalidation_event"."to_revision" > "fact_invalidation_event"."from_revision"),
	CONSTRAINT "fact_invalidation_type_check" CHECK ("fact_invalidation_event"."dependent_type" in ('script', 'fact_lock', 'voice', 'video', 'render')),
	CONSTRAINT "fact_invalidation_reason_check" CHECK ("fact_invalidation_event"."reason" in ('fact_changed', 'fact_deactivated', 'fact_deleted'))
);
--> statement-breakpoint
ALTER TABLE "product_fact" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_fact_history" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_dependency" ADD CONSTRAINT "fact_dependency_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_invalidation_event" ADD CONSTRAINT "fact_invalidation_event_dependency_id_fact_dependency_id_fk" FOREIGN KEY ("dependency_id") REFERENCES "public"."fact_dependency"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_invalidation_event" ADD CONSTRAINT "fact_invalidation_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_invalidation_event" ADD CONSTRAINT "fact_invalidation_event_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_dependency_active_unique" ON "fact_dependency" USING btree ("workspace_id","product_fact_id","fact_revision","dependent_type","dependent_id") WHERE "fact_dependency"."detached_at" is null and "fact_dependency"."invalidated_at" is null;--> statement-breakpoint
CREATE INDEX "fact_dependency_fact_revision_idx" ON "fact_dependency" USING btree ("product_fact_id","fact_revision");--> statement-breakpoint
CREATE INDEX "fact_dependency_dependent_idx" ON "fact_dependency" USING btree ("dependent_type","dependent_id");--> statement-breakpoint
CREATE INDEX "fact_dependency_workspace_state_idx" ON "fact_dependency" USING btree ("workspace_id","invalidated_at","detached_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_invalidation_dependency_unique" ON "fact_invalidation_event" USING btree ("dependency_id");--> statement-breakpoint
CREATE INDEX "fact_invalidation_fact_created_idx" ON "fact_invalidation_event" USING btree ("product_fact_id","created_at");--> statement-breakpoint
CREATE INDEX "fact_invalidation_dependent_created_idx" ON "fact_invalidation_event" USING btree ("dependent_type","dependent_id","created_at");--> statement-breakpoint
CREATE INDEX "product_fact_workspace_type_status_idx" ON "product_fact" USING btree ("workspace_id","type","status");--> statement-breakpoint
ALTER TABLE "product_fact" ADD CONSTRAINT "product_fact_revision_check" CHECK ("product_fact"."revision" > 0);--> statement-breakpoint
ALTER TABLE "product_fact_history" ADD CONSTRAINT "product_fact_history_revision_check" CHECK ("product_fact_history"."revision" > 0);
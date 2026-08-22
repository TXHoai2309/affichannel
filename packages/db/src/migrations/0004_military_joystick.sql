CREATE TABLE "product_fact" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"content" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_type" text,
	"source_label" text,
	"source_url" text,
	"confirmed_at" date,
	"expires_at" date,
	"notes" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_fact_type_check" CHECK ("product_fact"."type" in ('price', 'promotion', 'specification', 'feature', 'claim', 'policy', 'other')),
	CONSTRAINT "product_fact_status_check" CHECK ("product_fact"."status" in ('draft', 'verified', 'inactive')),
	CONSTRAINT "product_fact_source_type_check" CHECK ("product_fact"."source_type" is null or "product_fact"."source_type" in ('official', 'marketplace', 'document')),
	CONSTRAINT "product_fact_date_order_check" CHECK ("product_fact"."confirmed_at" is null or "product_fact"."expires_at" is null or "product_fact"."confirmed_at" <= "product_fact"."expires_at")
);
--> statement-breakpoint
CREATE TABLE "product_fact_history" (
	"id" text PRIMARY KEY NOT NULL,
	"product_fact_id" text NOT NULL,
	"product_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"action" text NOT NULL,
	"content" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"source_type" text,
	"source_label" text,
	"source_url" text,
	"confirmed_at" date,
	"expires_at" date,
	"notes" text,
	"changed_by_user_id" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_fact_history_action_check" CHECK ("product_fact_history"."action" in ('created', 'updated', 'status_changed', 'deleted')),
	CONSTRAINT "product_fact_history_type_check" CHECK ("product_fact_history"."type" in ('price', 'promotion', 'specification', 'feature', 'claim', 'policy', 'other')),
	CONSTRAINT "product_fact_history_status_check" CHECK ("product_fact_history"."status" in ('draft', 'verified', 'inactive')),
	CONSTRAINT "product_fact_history_source_type_check" CHECK ("product_fact_history"."source_type" is null or "product_fact_history"."source_type" in ('official', 'marketplace', 'document')),
	CONSTRAINT "product_fact_history_date_order_check" CHECK ("product_fact_history"."confirmed_at" is null or "product_fact_history"."expires_at" is null or "product_fact_history"."confirmed_at" <= "product_fact_history"."expires_at")
);
--> statement-breakpoint
ALTER TABLE "product_fact" ADD CONSTRAINT "product_fact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_fact" ADD CONSTRAINT "product_fact_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_fact" ADD CONSTRAINT "product_fact_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_fact" ADD CONSTRAINT "product_fact_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_fact_history" ADD CONSTRAINT "product_fact_history_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_fact_history" ADD CONSTRAINT "product_fact_history_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_fact_history" ADD CONSTRAINT "product_fact_history_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_fact_product_updated_idx" ON "product_fact" USING btree ("product_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "product_fact_product_type_updated_idx" ON "product_fact" USING btree ("product_id","type","updated_at","id");--> statement-breakpoint
CREATE INDEX "product_fact_product_status_updated_idx" ON "product_fact" USING btree ("product_id","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "product_fact_workspace_id_idx" ON "product_fact" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "product_fact_created_by_user_id_idx" ON "product_fact" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "product_fact_updated_by_user_id_idx" ON "product_fact" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE INDEX "product_fact_history_product_changed_idx" ON "product_fact_history" USING btree ("product_id","changed_at","id");--> statement-breakpoint
CREATE INDEX "product_fact_history_fact_changed_idx" ON "product_fact_history" USING btree ("product_fact_id","changed_at","id");--> statement-breakpoint
CREATE INDEX "product_fact_history_workspace_id_idx" ON "product_fact_history" USING btree ("workspace_id");
CREATE TABLE "quick_image_claim_source" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source_schema_version" text NOT NULL,
	"source_json" jsonb NOT NULL,
	"source_content_hash_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quick_image_claim_source_revision_check" CHECK ("quick_image_claim_source"."revision" > 0),
	CONSTRAINT "quick_image_claim_source_schema_version_check" CHECK ("quick_image_claim_source"."source_schema_version" = 'quick-image-claim-source.v1'),
	CONSTRAINT "quick_image_claim_source_json_check" CHECK (jsonb_typeof("quick_image_claim_source"."source_json") = 'object'),
	CONSTRAINT "quick_image_claim_source_hash_check" CHECK ("quick_image_claim_source"."source_content_hash_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "quick_image_claim_source" ADD CONSTRAINT "quick_image_claim_source_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_image_claim_source" ADD CONSTRAINT "quick_image_claim_source_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quick_image_claim_source_workspace_project_unique" ON "quick_image_claim_source" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "quick_image_claim_source_project_revision_idx" ON "quick_image_claim_source" USING btree ("workspace_id","project_id","revision");
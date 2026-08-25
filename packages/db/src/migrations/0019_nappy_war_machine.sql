CREATE TABLE "claim_manifest" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_script_version_id" text,
	"source_script_revision" integer,
	"source_snapshot_json" jsonb NOT NULL,
	"source_content_hash" text NOT NULL,
	"product_id" text,
	"schema_version" text NOT NULL,
	"builder_version" text NOT NULL,
	"claims_json" jsonb NOT NULL,
	"claim_count" integer NOT NULL,
	"is_empty" boolean NOT NULL,
	"fingerprint" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_manifest_source_type_check" CHECK ("claim_manifest"."source_type" in ('SCRIPT_VERSION', 'NO_SCRIPT')),
	CONSTRAINT "claim_manifest_source_pair_check" CHECK ((
				("claim_manifest"."source_type" = 'SCRIPT_VERSION'
					and "claim_manifest"."source_script_version_id" is not null
					and "claim_manifest"."source_script_revision" is not null
					and "claim_manifest"."source_script_revision" > 0)
				or
				("claim_manifest"."source_type" = 'NO_SCRIPT'
					and "claim_manifest"."source_script_version_id" is null
					and "claim_manifest"."source_script_revision" is null)
			)),
	CONSTRAINT "claim_manifest_source_snapshot_check" CHECK (jsonb_typeof("claim_manifest"."source_snapshot_json") = 'object'
				and "claim_manifest"."source_snapshot_json" ->> 'sourceType' = "claim_manifest"."source_type"),
	CONSTRAINT "claim_manifest_source_content_hash_check" CHECK ("claim_manifest"."source_content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "claim_manifest_schema_version_check" CHECK ("claim_manifest"."schema_version" = 'claim-manifest.v1'),
	CONSTRAINT "claim_manifest_builder_version_check" CHECK ("claim_manifest"."builder_version" ~ '^claim-manifest-builder\.v[1-9][0-9]*$'),
	CONSTRAINT "claim_manifest_claims_array_check" CHECK (jsonb_typeof("claim_manifest"."claims_json") = 'array'),
	CONSTRAINT "claim_manifest_claim_count_check" CHECK ("claim_manifest"."claim_count" between 0 and 64),
	CONSTRAINT "claim_manifest_claim_count_matches_check" CHECK (case
				when jsonb_typeof("claim_manifest"."claims_json") = 'array'
				then jsonb_array_length("claim_manifest"."claims_json") = "claim_manifest"."claim_count"
				else false
			end),
	CONSTRAINT "claim_manifest_is_empty_check" CHECK ("claim_manifest"."is_empty" = ("claim_manifest"."claim_count" = 0)),
	CONSTRAINT "claim_manifest_fingerprint_check" CHECK ("claim_manifest"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "claim_manifest" ADD CONSTRAINT "claim_manifest_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_manifest" ADD CONSTRAINT "claim_manifest_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_manifest" ADD CONSTRAINT "claim_manifest_source_script_version_id_script_version_id_fk" FOREIGN KEY ("source_script_version_id") REFERENCES "public"."script_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_manifest" ADD CONSTRAINT "claim_manifest_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_manifest" ADD CONSTRAINT "claim_manifest_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_manifest_scope_fingerprint_unique" ON "claim_manifest" USING btree ("workspace_id","project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "claim_manifest_project_history_idx" ON "claim_manifest" USING btree ("workspace_id","project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "claim_manifest_script_source_idx" ON "claim_manifest" USING btree ("workspace_id","source_script_version_id","source_script_revision");--> statement-breakpoint
CREATE INDEX "claim_manifest_product_id_idx" ON "claim_manifest" USING btree ("product_id");
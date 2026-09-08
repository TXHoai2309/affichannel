CREATE TABLE "composition_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"schema_version" text NOT NULL,
	"composition_input_json" jsonb NOT NULL,
	"composition_fingerprint" text NOT NULL,
	"source_script_version_id" text NOT NULL,
	"source_script_revision" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "composition_version_schema_version_check" CHECK ("composition_version"."schema_version" = 'composition-input.v1'),
	CONSTRAINT "composition_version_source_revision_check" CHECK ("composition_version"."source_script_revision" > 0),
	CONSTRAINT "composition_version_fingerprint_check" CHECK ("composition_version"."composition_fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "composition_version" ADD CONSTRAINT "composition_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_version" ADD CONSTRAINT "composition_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_version" ADD CONSTRAINT "composition_version_source_script_version_id_script_version_id_fk" FOREIGN KEY ("source_script_version_id") REFERENCES "public"."script_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_version" ADD CONSTRAINT "composition_version_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "composition_version_project_history_idx" ON "composition_version" USING btree ("workspace_id","project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "composition_version_source_script_idx" ON "composition_version" USING btree ("workspace_id","source_script_version_id","source_script_revision");--> statement-breakpoint
CREATE INDEX "composition_version_fingerprint_idx" ON "composition_version" USING btree ("workspace_id","composition_fingerprint");
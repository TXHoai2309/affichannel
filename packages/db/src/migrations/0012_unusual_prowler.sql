CREATE TABLE "script_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_generation_id" text NOT NULL,
	"status" text NOT NULL,
	"version_number" integer,
	"editable_snapshot_json" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"restored_from_version_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"saved_at" timestamp with time zone,
	CONSTRAINT "script_version_status_check" CHECK ("script_version"."status" in ('draft', 'saved')),
	CONSTRAINT "script_version_revision_check" CHECK ("script_version"."revision" > 0),
	CONSTRAINT "script_version_status_shape_check" CHECK (("script_version"."status" = 'draft' and "script_version"."version_number" is null and "script_version"."saved_at" is null) or ("script_version"."status" = 'saved' and "script_version"."version_number" is not null and "script_version"."version_number" > 0 and "script_version"."saved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_source_generation_id_script_generation_id_fk" FOREIGN KEY ("source_generation_id") REFERENCES "public"."script_generation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_version" ADD CONSTRAINT "script_version_restored_from_version_fk" FOREIGN KEY ("restored_from_version_id") REFERENCES "public"."script_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "script_version_draft_unique" ON "script_version" USING btree ("workspace_id","project_id") WHERE "script_version"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "script_version_saved_number_unique" ON "script_version" USING btree ("workspace_id","project_id","version_number") WHERE "script_version"."status" = 'saved';--> statement-breakpoint
CREATE INDEX "script_version_project_history_idx" ON "script_version" USING btree ("workspace_id","project_id","status","updated_at","version_number");--> statement-breakpoint
CREATE INDEX "script_version_source_generation_idx" ON "script_version" USING btree ("workspace_id","source_generation_id");--> statement-breakpoint
CREATE INDEX "script_version_created_by_user_idx" ON "script_version" USING btree ("created_by_user_id");
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"created_by_user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_brief" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"platform" text NOT NULL,
	"goal" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"angle" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_brief_platform_check" CHECK ("content_brief"."platform" = 'tiktok'),
	CONSTRAINT "content_brief_duration_seconds_check" CHECK ("content_brief"."duration_seconds" between 15 and 180)
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"product_id" text NOT NULL,
	"current_step_key" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_current_step_key_check" CHECK ("project"."current_step_key" in ('product', 'fact-lock', 'research', 'script', 'production', 'qa', 'published'))
);
--> statement-breakpoint
CREATE TABLE "project_step_status" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"step_key" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_step_status_step_key_check" CHECK ("project_step_status"."step_key" in ('product', 'fact-lock', 'research', 'script', 'production', 'qa', 'published')),
	CONSTRAINT "project_step_status_status_check" CHECK ("project_step_status"."status" in ('not_started', 'completed', 'needs_review', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "workspace" ("id", "name")
VALUES ('internal', 'AffiChannel Internal')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_brief" ADD CONSTRAINT "content_brief_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_step_status" ADD CONSTRAINT "project_step_status_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_workspace_active_updated_idx" ON "product" USING btree ("workspace_id","archived_at","updated_at");--> statement-breakpoint
CREATE INDEX "product_created_by_user_id_idx" ON "product" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_brief_project_id_unique" ON "content_brief" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_workspace_active_updated_idx" ON "project" USING btree ("workspace_id","archived_at","updated_at");--> statement-breakpoint
CREATE INDEX "project_product_id_idx" ON "project" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "project_created_by_user_id_idx" ON "project" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_step_status_project_step_unique" ON "project_step_status" USING btree ("project_id","step_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_member_workspace_user_unique" ON "workspace_member" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_member_user_id_idx" ON "workspace_member" USING btree ("user_id");

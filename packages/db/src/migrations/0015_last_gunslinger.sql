CREATE TABLE "voice_config" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"voice_id" text NOT NULL,
	"language" text NOT NULL,
	"speed" real NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_config_provider_check" CHECK ("voice_config"."provider" = 'apikeyfun'),
	CONSTRAINT "voice_config_revision_check" CHECK ("voice_config"."revision" >= 1),
	CONSTRAINT "voice_config_speed_check" CHECK ("voice_config"."speed" >= 0.7 and "voice_config"."speed" <= 1.5)
);
--> statement-breakpoint
ALTER TABLE "voice_config" ADD CONSTRAINT "voice_config_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_config" ADD CONSTRAINT "voice_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_config" ADD CONSTRAINT "voice_config_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_config" ADD CONSTRAINT "voice_config_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_config_workspace_project_unique" ON "voice_config" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "voice_config_created_by_user_idx" ON "voice_config" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "voice_config_updated_by_user_idx" ON "voice_config" USING btree ("updated_by_user_id");
CREATE TABLE "output_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"language" text DEFAULT 'vi-VN' NOT NULL,
	"aspect_ratio" text DEFAULT '9:16' NOT NULL,
	"subtitle_safe_area" text DEFAULT 'standard' NOT NULL,
	"claim_limit" integer,
	"require_final_cta" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "output_rules_language_check" CHECK (language = 'vi-VN'),
	CONSTRAINT "output_rules_aspect_ratio_check" CHECK (aspect_ratio = '9:16'),
	CONSTRAINT "output_rules_safe_area_check" CHECK (subtitle_safe_area = 'standard'),
	CONSTRAINT "output_rules_claim_limit_check" CHECK (claim_limit is null or claim_limit > 0),
	CONSTRAINT "output_rules_final_cta_check" CHECK (require_final_cta = true)
);
--> statement-breakpoint
ALTER TABLE "output_rules" ADD CONSTRAINT "output_rules_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_rules" ADD CONSTRAINT "output_rules_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_rules" ADD CONSTRAINT "output_rules_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "output_rules_workspace_unique" ON "output_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "output_rules_created_by_user_idx" ON "output_rules" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "output_rules_updated_by_user_idx" ON "output_rules" USING btree ("updated_by_user_id");
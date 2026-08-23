ALTER TABLE "project" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "creation_path" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "content_format_key" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "content_format_version" integer;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_content_type_check" CHECK ("project"."content_type" is null or "project"."content_type" in ('ORGANIC', 'AFFILIATE'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_creation_path_check" CHECK ("project"."creation_path" is null or "project"."creation_path" in ('QUICK_IMAGE', 'SCRIPTED', 'MEDIA_FIRST'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_content_format_pair_check" CHECK ((
				("project"."content_format_key" is null and "project"."content_format_version" is null)
				or
				(
					"project"."content_format_key" is not null
					and "project"."content_format_version" is not null
					and "project"."content_format_version" > 0
				)
			));
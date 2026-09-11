CREATE TABLE "render_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"render_job_id" text NOT NULL,
	"render_attempt_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"composition_version_id" text NOT NULL,
	"composition_fingerprint" text NOT NULL,
	"canonical_request_hash" text NOT NULL,
	"output_encoding_profile_fingerprint" text NOT NULL,
	"output_contract_version" text NOT NULL,
	"output_reservation_id" text NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"validation_version" text NOT NULL,
	"validated_metadata_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_artifact_attempt_number_check" CHECK ("render_artifact"."attempt_number" > 0),
	CONSTRAINT "render_artifact_scope_hash_check" CHECK ("render_artifact"."composition_fingerprint" ~ '^[a-f0-9]{64}$' and "render_artifact"."canonical_request_hash" ~ '^[a-f0-9]{64}$' and "render_artifact"."output_encoding_profile_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "render_artifact_storage_provider_check" CHECK ("render_artifact"."storage_provider" in ('local', 'r2')),
	CONSTRAINT "render_artifact_storage_key_check" CHECK (length(trim("render_artifact"."storage_key")) > 0 and "render_artifact"."storage_key" like 'render-artifacts/v1/%'),
	CONSTRAINT "render_artifact_media_check" CHECK ("render_artifact"."mime_type" = 'video/mp4' and "render_artifact"."byte_size" > 0),
	CONSTRAINT "render_artifact_checksum_check" CHECK ("render_artifact"."checksum_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "render_artifact_metadata_check" CHECK (length(trim("render_artifact"."validation_version")) > 0 and jsonb_typeof("render_artifact"."validated_metadata_json") = 'object')
);
--> statement-breakpoint
ALTER TABLE "render_artifact" ADD CONSTRAINT "render_artifact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_artifact" ADD CONSTRAINT "render_artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_artifact" ADD CONSTRAINT "render_artifact_render_job_id_render_job_id_fk" FOREIGN KEY ("render_job_id") REFERENCES "public"."render_job"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_artifact" ADD CONSTRAINT "render_artifact_render_attempt_id_render_attempt_id_fk" FOREIGN KEY ("render_attempt_id") REFERENCES "public"."render_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_artifact" ADD CONSTRAINT "render_artifact_composition_version_id_composition_version_id_fk" FOREIGN KEY ("composition_version_id") REFERENCES "public"."composition_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "render_artifact_attempt_unique" ON "render_artifact" USING btree ("render_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "render_artifact_reservation_unique" ON "render_artifact" USING btree ("output_reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "render_artifact_storage_identity_unique" ON "render_artifact" USING btree ("storage_provider","storage_key");--> statement-breakpoint
CREATE INDEX "render_artifact_job_created_idx" ON "render_artifact" USING btree ("workspace_id","render_job_id","created_at","id");--> statement-breakpoint
CREATE INDEX "render_artifact_project_created_idx" ON "render_artifact" USING btree ("workspace_id","project_id","created_at","id");
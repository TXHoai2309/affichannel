ALTER TABLE "fact_lock_run" DROP CONSTRAINT "fact_lock_run_source_revision_check";--> statement-breakpoint
DROP INDEX "fact_lock_run_pending_scope_unique";--> statement-breakpoint
ALTER TABLE "fact_lock_run" ALTER COLUMN "script_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ALTER COLUMN "source_script_revision" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD COLUMN "input_mode" text;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD COLUMN "claim_manifest_id" text;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD COLUMN "claim_manifest_fingerprint" text;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_claim_manifest_id_claim_manifest_id_fk" FOREIGN KEY ("claim_manifest_id") REFERENCES "public"."claim_manifest"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fact_lock_run_manifest_pending_scope_unique" ON "fact_lock_run" USING btree ("workspace_id","project_id","request_hash") WHERE "fact_lock_run"."status" = 'pending' and "fact_lock_run"."input_mode" = 'MANIFEST_V1';--> statement-breakpoint
CREATE INDEX "fact_lock_run_claim_manifest_idx" ON "fact_lock_run" USING btree ("workspace_id","claim_manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_lock_run_pending_scope_unique" ON "fact_lock_run" USING btree ("workspace_id","project_id","script_version_id","source_script_revision") WHERE "fact_lock_run"."status" = 'pending' and "fact_lock_run"."input_mode" is null;--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_script_provenance_pair_check" CHECK (("fact_lock_run"."script_version_id" is null and "fact_lock_run"."source_script_revision" is null) or ("fact_lock_run"."script_version_id" is not null and "fact_lock_run"."source_script_revision" is not null and "fact_lock_run"."source_script_revision" > 0));--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_input_mode_check" CHECK ("fact_lock_run"."input_mode" is null or "fact_lock_run"."input_mode" = 'MANIFEST_V1');--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_mode_shape_check" CHECK ((
				("fact_lock_run"."input_mode" is null
					and "fact_lock_run"."claim_manifest_id" is null
					and "fact_lock_run"."claim_manifest_fingerprint" is null
					and "fact_lock_run"."script_version_id" is not null
					and "fact_lock_run"."source_script_revision" is not null
					and "fact_lock_run"."source_script_revision" > 0)
				or
				("fact_lock_run"."input_mode" is not null
					and "fact_lock_run"."input_mode" = 'MANIFEST_V1'
					and "fact_lock_run"."claim_manifest_id" is not null
					and "fact_lock_run"."claim_manifest_fingerprint" is not null
					and "fact_lock_run"."claim_manifest_fingerprint" ~ '^[a-f0-9]{64}$'
					and (("fact_lock_run"."script_version_id" is null and "fact_lock_run"."source_script_revision" is null)
						or ("fact_lock_run"."script_version_id" is not null and "fact_lock_run"."source_script_revision" is not null and "fact_lock_run"."source_script_revision" > 0)))
			));--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_manifest_fingerprint_check" CHECK ("fact_lock_run"."claim_manifest_fingerprint" is null or "fact_lock_run"."claim_manifest_fingerprint" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "fact_lock_run" ADD CONSTRAINT "fact_lock_run_source_revision_check" CHECK ("fact_lock_run"."source_script_revision" is null or "fact_lock_run"."source_script_revision" > 0);
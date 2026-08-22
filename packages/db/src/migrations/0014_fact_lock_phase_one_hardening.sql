ALTER TABLE "fact_lock_run" ADD COLUMN "execution_claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "fact_lock_claim" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "fact_lock_claim" ADD COLUMN "review_note" text;
--> statement-breakpoint
ALTER TABLE "fact_lock_claim" DROP CONSTRAINT "fact_lock_claim_review_check";
--> statement-breakpoint
ALTER TABLE "fact_lock_claim_fact" DROP CONSTRAINT "fact_lock_claim_fact_relation_check";
--> statement-breakpoint
UPDATE "fact_lock_claim_fact"
SET "relation" = 'related'
WHERE "relation" = 'context';
--> statement-breakpoint
ALTER TABLE "fact_lock_claim" ADD CONSTRAINT "fact_lock_claim_review_check" CHECK (("fact_lock_claim"."classification_status" = 'SUPPORTED' and "fact_lock_claim"."review_status" = 'AUTO_PASSED') or ("fact_lock_claim"."classification_status" = 'NEEDS_REVIEW' and "fact_lock_claim"."review_status" in ('UNRESOLVED', 'MANUAL_APPROVED')) or ("fact_lock_claim"."classification_status" in ('UNSUPPORTED', 'PROHIBITED') and "fact_lock_claim"."review_status" = 'UNRESOLVED'));
--> statement-breakpoint
ALTER TABLE "fact_lock_claim" ADD CONSTRAINT "fact_lock_claim_review_metadata_check" CHECK ((("fact_lock_claim"."review_status" = 'MANUAL_APPROVED' and "fact_lock_claim"."reviewed_by_user_id" is not null and "fact_lock_claim"."reviewed_at" is not null) or ("fact_lock_claim"."review_status" in ('AUTO_PASSED', 'UNRESOLVED') and "fact_lock_claim"."reviewed_by_user_id" is null and "fact_lock_claim"."reviewed_at" is null)));
--> statement-breakpoint
ALTER TABLE "fact_lock_claim_fact" ADD CONSTRAINT "fact_lock_claim_fact_relation_check" CHECK ("fact_lock_claim_fact"."relation" in ('supports', 'related', 'contradicts'));

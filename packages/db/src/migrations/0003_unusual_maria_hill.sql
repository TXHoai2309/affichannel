ALTER TABLE "product" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "affiliate_url" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "price_amount" integer;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "currency" text DEFAULT 'VND' NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_status_check" CHECK ("product"."status" in ('active', 'inactive'));--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_currency_check" CHECK ("product"."currency" = 'VND');--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_price_amount_check" CHECK ("product"."price_amount" is null or "product"."price_amount" >= 0);
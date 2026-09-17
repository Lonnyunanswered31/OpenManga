ALTER TABLE "ai_usage" ADD COLUMN "images" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "characters" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_rate_snapshots" ADD COLUMN "character_rate" numeric(12, 6) DEFAULT '0' NOT NULL;
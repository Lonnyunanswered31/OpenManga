ALTER TYPE "public"."job_status" ADD VALUE 'paused';--> statement-breakpoint
DROP INDEX "narration_lines_chapter_idx";--> statement-breakpoint
ALTER TABLE "narration_lines" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "panels" ADD COLUMN "qa" jsonb;--> statement-breakpoint
CREATE INDEX "narration_lines_chapter_idx" ON "narration_lines" USING btree ("chapter_id","language","order");--> statement-breakpoint
UPDATE "narration_lines" nl SET "language" = p."language" FROM "projects" p WHERE p."id" = nl."project_id";

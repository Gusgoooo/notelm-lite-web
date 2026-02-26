ALTER TABLE "notebooks" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "notebooks" ADD COLUMN "is_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notebooks" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notebooks" ADD COLUMN "forked_from_notebook_id" text;--> statement-breakpoint
ALTER TABLE "notebooks" ADD CONSTRAINT "notebooks_forked_from_notebook_id_notebooks_id_fk" FOREIGN KEY ("forked_from_notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notebooks_published_idx" ON "notebooks" USING btree ("is_published","published_at");--> statement-breakpoint
CREATE INDEX "notebooks_forked_from_idx" ON "notebooks" USING btree ("forked_from_notebook_id");
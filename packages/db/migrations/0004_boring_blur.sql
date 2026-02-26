CREATE TABLE "script_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"notebook_id" text NOT NULL,
	"code" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"memory_limit_mb" integer DEFAULT 256 NOT NULL,
	"output" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "script_jobs" ADD CONSTRAINT "script_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_jobs" ADD CONSTRAINT "script_jobs_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "script_jobs_user_idx" ON "script_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "script_jobs_notebook_idx" ON "script_jobs" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "script_jobs_status_idx" ON "script_jobs" USING btree ("status","created_at");
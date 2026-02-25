CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "notebooks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"notebook_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"notebook_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"page_start" integer,
	"page_end" integer,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"notebook_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_url" text NOT NULL,
	"mime" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_notebook_idx" ON "conversations" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "notes_notebook_idx" ON "notes" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "source_chunks_source_idx" ON "source_chunks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "source_chunks_embedding_idx" ON "source_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "sources_notebook_idx" ON "sources" USING btree ("notebook_id");
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"openrouter_api_key" text,
	"openrouter_base_url" text DEFAULT 'https://openrouter.ai/api/v1' NOT NULL,
	"models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

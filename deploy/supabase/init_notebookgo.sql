-- NotebookGo schema bootstrap for Supabase (idempotent)
-- Safe to run multiple times.

create extension if not exists vector;

create table if not exists users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  name text,
  created_at timestamp with time zone not null default now()
);

create table if not exists notebooks (
  id text primary key,
  user_id text,
  title text not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists sources (
  id text primary key,
  notebook_id text not null,
  filename text not null,
  file_url text not null,
  mime text,
  status text not null default 'PENDING',
  error_message text,
  created_at timestamp with time zone not null default now()
);

create table if not exists source_chunks (
  id text primary key,
  source_id text not null,
  chunk_index integer not null,
  content text not null,
  page_start integer,
  page_end integer,
  embedding vector(1536),
  created_at timestamp with time zone not null default now()
);

create table if not exists conversations (
  id text primary key,
  notebook_id text not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists messages (
  id text primary key,
  conversation_id text not null,
  role text not null,
  content text not null,
  citations jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists notes (
  id text primary key,
  notebook_id text not null,
  title text not null,
  content text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists app_settings (
  id text primary key,
  openrouter_api_key text,
  openrouter_base_url text not null default 'https://openrouter.ai/api/v1',
  models jsonb not null default '{}'::jsonb,
  prompts jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notebooks_user_id_users_id_fk'
  ) then
    alter table notebooks
      add constraint notebooks_user_id_users_id_fk
      foreign key (user_id) references users(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sources_notebook_id_notebooks_id_fk'
  ) then
    alter table sources
      add constraint sources_notebook_id_notebooks_id_fk
      foreign key (notebook_id) references notebooks(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'source_chunks_source_id_sources_id_fk'
  ) then
    alter table source_chunks
      add constraint source_chunks_source_id_sources_id_fk
      foreign key (source_id) references sources(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conversations_notebook_id_notebooks_id_fk'
  ) then
    alter table conversations
      add constraint conversations_notebook_id_notebooks_id_fk
      foreign key (notebook_id) references notebooks(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_conversation_id_conversations_id_fk'
  ) then
    alter table messages
      add constraint messages_conversation_id_conversations_id_fk
      foreign key (conversation_id) references conversations(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notes_notebook_id_notebooks_id_fk'
  ) then
    alter table notes
      add constraint notes_notebook_id_notebooks_id_fk
      foreign key (notebook_id) references notebooks(id)
      on delete cascade;
  end if;
end $$;

create index if not exists notebooks_user_idx on notebooks (user_id);
create index if not exists sources_notebook_idx on sources (notebook_id);
create index if not exists source_chunks_source_idx on source_chunks (source_id);
create index if not exists source_chunks_embedding_idx
  on source_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists conversations_notebook_idx on conversations (notebook_id);
create index if not exists messages_conversation_idx on messages (conversation_id);
create index if not exists notes_notebook_idx on notes (notebook_id);

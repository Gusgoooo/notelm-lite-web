-- Postgres schema for NotebookLM-lite (mirrors Prisma schema)

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notebooks
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id);

-- Sources (type: 'pdf' | 'web' | 'md'; status: 'pending' | 'processing' | 'ready' | 'failed')
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,

  type TEXT NOT NULL,
  title TEXT NOT NULL,
  original_uri TEXT,
  original_name TEXT,
  stored_uri TEXT,
  status TEXT NOT NULL,
  error_message TEXT,

  content_hash TEXT NOT NULL,
  parse_meta_json TEXT,

  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_notebook ON sources(notebook_id);
CREATE INDEX IF NOT EXISTS idx_sources_hash ON sources(content_hash);

-- Source segments (PDF page text, web paragraphs, etc.)
CREATE TABLE IF NOT EXISTS source_segments (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,

  segment_type TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  anchor TEXT,
  text TEXT NOT NULL,

  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_segments_source ON source_segments(source_id);

-- Chunks
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,

  segment_id TEXT REFERENCES source_segments(id) ON DELETE SET NULL,
  chunk_index INTEGER NOT NULL,

  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  char_start INTEGER,
  char_end INTEGER,

  page_or_index INTEGER,
  anchor TEXT,
  snippet TEXT,

  token_count INTEGER,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chunks_source_index ON chunks(source_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(text_hash);

-- Vector embeddings
CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  embedding BYTEA NOT NULL,
  dim INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_notebook ON conversations(notebook_id);

-- Messages (role: 'system' | 'user' | 'assistant')
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,

  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- Message citations
CREATE TABLE IF NOT EXISTS message_citations (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,

  cite_key TEXT NOT NULL,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  score DOUBLE PRECISION,

  source_id TEXT NOT NULL,
  page_or_index INTEGER,
  anchor TEXT,
  snippet TEXT,

  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_citations_message ON message_citations(message_id);

-- Notes
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  type TEXT NOT NULL,

  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id);

-- Note citations
CREATE TABLE IF NOT EXISTS note_citations (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,

  cite_key TEXT NOT NULL,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,

  source_id TEXT NOT NULL,
  page_or_index INTEGER,
  anchor TEXT,
  snippet TEXT,

  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_citations_note ON note_citations(note_id);

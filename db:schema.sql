PRAGMA foreign_keys = ON;

-- Notebooks
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Sources
-- type: 'pdf' | 'web' | 'md'
-- status: 'pending' | 'processing' | 'ready' | 'failed'
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,

  type TEXT NOT NULL,
  title TEXT NOT NULL,
  original_uri TEXT,          -- file path or url
  stored_uri TEXT,            -- local stored path (pdf/md/html snapshot)
  status TEXT NOT NULL,
  error_message TEXT,

  content_hash TEXT NOT NULL, -- for dedupe & incremental
  parse_meta_json TEXT,       -- json string: page_count, fetched_at, etc.

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_notebook ON sources(notebook_id);
CREATE INDEX IF NOT EXISTS idx_sources_hash ON sources(content_hash);

-- Source pages/segments (for PDF page text, web paragraphs, etc.)
-- For PDF: segment_index == page number (1-based or 0-based; be consistent)
CREATE TABLE IF NOT EXISTS source_segments (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,

  segment_type TEXT NOT NULL,      -- 'pdf_page' | 'web_para' | 'md_section'
  segment_index INTEGER NOT NULL,  -- page number or paragraph index
  anchor TEXT,                     -- e.g., '#heading-1' or xpath
  text TEXT NOT NULL,

  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_segments_source ON source_segments(source_id);

-- Chunks
-- location fields allow citation navigation
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,

  segment_id TEXT REFERENCES source_segments(id) ON DELETE SET NULL,
  chunk_index INTEGER NOT NULL,

  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,          -- stable hash for incremental embed
  char_start INTEGER,               -- start offset within segment text
  char_end INTEGER,                 -- end offset within segment text

  -- for viewer jump convenience:
  page_or_index INTEGER,            -- pdf page or paragraph index
  anchor TEXT,                      -- anchor within web/md
  snippet TEXT,                     -- small excerpt for UI

  token_count INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chunks_source_index
  ON chunks(source_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(text_hash);

-- Vector embeddings
-- Option A: store vector blob for custom search
-- Option B: use sqlite-vec virtual table and keep chunk_id mapping
CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  dim INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_notebook ON conversations(notebook_id);

-- Messages
-- role: 'system' | 'user' | 'assistant'
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,

  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- Message citations (machine-readable)
CREATE TABLE IF NOT EXISTS message_citations (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,

  cite_key TEXT NOT NULL,         -- e.g. "c1", "c2"
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  score REAL,                     -- retrieval similarity score

  source_id TEXT NOT NULL,
  page_or_index INTEGER,
  anchor TEXT,
  snippet TEXT,

  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_citations_message ON message_citations(message_id);

-- Notes (Artifacts output stored here too)
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  type TEXT NOT NULL,             -- 'manual' | 'artifact_summary' | 'artifact_outline' | 'artifact_compare' | 'artifact_timeline'

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id);

-- Note citations (optional but recommended for artifact)
CREATE TABLE IF NOT EXISTS note_citations (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,

  cite_key TEXT NOT NULL,
  chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,

  source_id TEXT NOT NULL,
  page_or_index INTEGER,
  anchor TEXT,
  snippet TEXT,

  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_citations_note ON note_citations(note_id);
-- NotebookLM-lite database schema

CREATE TABLE IF NOT EXISTS "User" (
  "id"         TEXT PRIMARY KEY,
  "email"      TEXT UNIQUE NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Notebook" (
  "id"         TEXT PRIMARY KEY,
  "user_id"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "title"      TEXT NOT NULL,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Source" (
  "id"              TEXT PRIMARY KEY,
  "notebook_id"     TEXT NOT NULL REFERENCES "Notebook"("id") ON DELETE CASCADE,
  "type"            TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "original_uri"    TEXT,
  "original_name"   TEXT,
  "stored_uri"      TEXT,
  "status"          TEXT NOT NULL,
  "error_message"   TEXT,
  "content_hash"    TEXT NOT NULL,
  "parse_meta_json" TEXT,
  "created_at"      BIGINT NOT NULL,
  "updated_at"      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "SourceSegment" (
  "id"            TEXT PRIMARY KEY,
  "source_id"     TEXT NOT NULL REFERENCES "Source"("id") ON DELETE CASCADE,
  "segment_type"  TEXT NOT NULL,
  "segment_index" INT NOT NULL,
  "anchor"        TEXT,
  "text"          TEXT NOT NULL,
  "created_at"    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Chunk" (
  "id"            TEXT PRIMARY KEY,
  "source_id"     TEXT NOT NULL REFERENCES "Source"("id") ON DELETE CASCADE,
  "segment_id"    TEXT REFERENCES "SourceSegment"("id") ON DELETE SET NULL,
  "chunk_index"   INT NOT NULL,
  "text"          TEXT NOT NULL,
  "text_hash"     TEXT NOT NULL,
  "char_start"    INT,
  "char_end"      INT,
  "page_or_index" INT,
  "anchor"        TEXT,
  "snippet"       TEXT,
  "token_count"   INT,
  "created_at"    BIGINT NOT NULL,
  "updated_at"    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "ChunkEmbedding" (
  "chunk_id"   TEXT PRIMARY KEY REFERENCES "Chunk"("id") ON DELETE CASCADE,
  "embedding"  BYTEA NOT NULL,
  "dim"        INT NOT NULL,
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Conversation" (
  "id"          TEXT PRIMARY KEY,
  "notebook_id" TEXT NOT NULL REFERENCES "Notebook"("id") ON DELETE CASCADE,
  "title"       TEXT,
  "created_at"  BIGINT NOT NULL,
  "updated_at"  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Message" (
  "id"              TEXT PRIMARY KEY,
  "conversation_id" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
  "role"            TEXT NOT NULL,
  "content"         TEXT NOT NULL,
  "created_at"      BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "MessageCitation" (
  "id"           TEXT PRIMARY KEY,
  "message_id"   TEXT NOT NULL REFERENCES "Message"("id") ON DELETE CASCADE,
  "cite_key"     TEXT NOT NULL,
  "chunk_id"     TEXT NOT NULL REFERENCES "Chunk"("id") ON DELETE CASCADE,
  "score"        DOUBLE PRECISION,
  "source_id"    TEXT NOT NULL,
  "page_or_index" INT,
  "anchor"       TEXT,
  "snippet"      TEXT,
  "created_at"   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Note" (
  "id"          TEXT PRIMARY KEY,
  "notebook_id" TEXT NOT NULL REFERENCES "Notebook"("id") ON DELETE CASCADE,
  "title"       TEXT NOT NULL,
  "content_md"  TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "created_at"  BIGINT NOT NULL,
  "updated_at"  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "NoteCitation" (
  "id"           TEXT PRIMARY KEY,
  "note_id"      TEXT NOT NULL REFERENCES "Note"("id") ON DELETE CASCADE,
  "cite_key"     TEXT NOT NULL,
  "chunk_id"     TEXT NOT NULL REFERENCES "Chunk"("id") ON DELETE CASCADE,
  "source_id"    TEXT NOT NULL,
  "page_or_index" INT,
  "anchor"       TEXT,
  "snippet"      TEXT,
  "created_at"   BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notebook" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "Notebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "notebook_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "original_uri" TEXT,
    "original_name" TEXT,
    "stored_uri" TEXT,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "content_hash" TEXT NOT NULL,
    "parse_meta_json" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSegment" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "segment_type" TEXT NOT NULL,
    "segment_index" INTEGER NOT NULL,
    "anchor" TEXT,
    "text" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "SourceSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "segment_id" TEXT,
    "chunk_index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "char_start" INTEGER,
    "char_end" INTEGER,
    "page_or_index" INTEGER,
    "anchor" TEXT,
    "snippet" TEXT,
    "token_count" INTEGER,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChunkEmbedding" (
    "chunk_id" TEXT NOT NULL,
    "embedding" BYTEA NOT NULL,
    "dim" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "ChunkEmbedding_pkey" PRIMARY KEY ("chunk_id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "notebook_id" TEXT NOT NULL,
    "title" TEXT,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageCitation" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "cite_key" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "source_id" TEXT NOT NULL,
    "page_or_index" INTEGER,
    "anchor" TEXT,
    "snippet" TEXT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "MessageCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "notebook_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content_md" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteCitation" (
    "id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "cite_key" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "page_or_index" INTEGER,
    "anchor" TEXT,
    "snippet" TEXT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "NoteCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Notebook" ADD CONSTRAINT "Notebook_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_notebook_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSegment" ADD CONSTRAINT "SourceSegment_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "SourceSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkEmbedding" ADD CONSTRAINT "ChunkEmbedding_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_notebook_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCitation" ADD CONSTRAINT "MessageCitation_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCitation" ADD CONSTRAINT "MessageCitation_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_notebook_id_fkey" FOREIGN KEY ("notebook_id") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteCitation" ADD CONSTRAINT "NoteCitation_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteCitation" ADD CONSTRAINT "NoteCitation_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

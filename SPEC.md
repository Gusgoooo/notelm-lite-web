# NotebookLM-lite (Phase 1) — SPEC

## 0. Goals
Build a working MVP that enables:
1) Create "Notebooks" (projects)
2) Import sources (PDF + Web Snapshot + Markdown) into a notebook
3) Parse → chunk → embed → index (incremental)
4) Grounded chat: answer ONLY from sources (with citations)
5) Citation UX: click citation → open source viewer at page/anchor and highlight
6) Artifact templates: generate Summary / Outline / Comparison / Timeline and save as Notes with citations

Non-goals (Phase 1):
- Collaboration / sync / cloud
- Audio overview
- Quiz / flashcards
- Fine-grained permissions
- OCR (optional, Phase 2)

## 1. Product Requirements

### 1.1 Notebooks
- A Notebook is a container for sources, chats, and notes.
- User can create, rename, delete notebook.
- Deleting notebook removes all related data.

### 1.2 Sources (Document ingestion)
Supported source types in Phase 1:
- PDF (file)
- Web Snapshot (URL → extracted readable content + metadata + fetched_at)
- Markdown (file)

Source states:
- `pending` → `processing` → `ready` OR `failed`
- Each source has `hash` for dedupe.

Required metadata:
- title, type, original_uri/path, created_at, fetched_at (web), parse_meta (json)

### 1.3 Chunking + Indexing
- Chunking must preserve "location" for citations:
  - PDF: page number + char offsets within page text
  - Web: dom anchor or paragraph index + char offsets
  - Markdown: heading path + line range or char offsets
- Store chunk text + location + stable chunk hash.
- Incremental indexing:
  - Re-ingest only when source hash changes.
  - Only embed new/changed chunks (hash mismatch).
- Retrieval:
  - Use vector similarity topK = 8 (configurable).
  - Optional rerank Phase 2.

### 1.4 Grounded Chat + Citations
Modes:
- Phase 1 only: `grounded_only = true` (default and no toggle in MVP)

Rules:
- The assistant must not use external knowledge.
- If evidence is insufficient (below confidence threshold or empty retrieval), respond:
  - "Insufficient sources" + suggest what sources are needed.
- Answer must include citations for each paragraph:
  - Use footnote format `[^c1] [^c2] ...`
- Citations must map to chunk ids and location.

Conversation data:
- A conversation belongs to a notebook.
- Messages include role, content, created_at.
- Each assistant message stores a machine-readable citations array.

### 1.5 Citation UX
- Source Viewer panel:
  - For PDF: open file and navigate to cited page, highlight snippet.
  - For Web Snapshot: open stored html/text and scroll to anchor/paragraph, highlight snippet.
  - For Markdown: open file content and highlight range.
- Clicking citation in answer jumps viewer to that citation location.

### 1.6 Notes & Artifacts
Notes are editable documents (markdown) with embedded citations.
Artifact templates:
- Summary (TL;DR + key points)
- Outline (hierarchical)
- Comparison (table: viewpoint/source/evidence)
- Timeline (date/event/source)

Generate artifact:
- Input: notebook + optional query + retrieved chunks (or all sources for notebook, constrained)
- Output: a Note with citations.

## 2. Architecture & Modules

### 2.1 Core Services
- IngestService:
  - import source, store metadata, parse raw text (and page segments)
- ChunkService:
  - chunk source into chunks with location anchors and hashes
- IndexService:
  - embed chunks, upsert vectors
- RetrieveService:
  - query embedding → vector search → return topK chunks + scores
- CiteService:
  - normalize chunks into citation objects (snippet, source title, location)
- ChatService:
  - build grounded prompt, call LLMProvider, parse citations tokens, persist message + citations
- ArtifactService:
  - run template prompt, call LLMProvider, persist note + citations

### 2.2 Provider Abstractions
- LLMProvider:
  - generate(text) or generate(messages)
  - supports JSON mode optionally
- EmbeddingProvider:
  - embed(texts[]) -> vectors
- (Optional) StorageProvider for file blobs (local fs in Phase 1)

### 2.3 Data Store
- SQLite (single file) with migrations.
- Vector store:
  - Phase 1: sqlite-vec or local vector table
  - Must support: upsert by chunk_id, topK search.

## 3. Prompting Policy (Grounded)
System constraints:
- Use only retrieved chunks as evidence.
- Never cite anything else.
- If conflict: present both views + cite.
- If low evidence: explicitly say insufficient sources.

Answer format:
- Paragraph-based with citations at end:
  - "..." [^c1][^c2]
- Citation ids are stable per message; stored in `message_citations`.

## 4. Acceptance Criteria (Phase 1)
- A notebook can be created and contains sources, chats, notes.
- PDF import completes and produces chunks with page location.
- Chat answers contain citations for each paragraph.
- Clicking a citation navigates viewer to the correct location and highlights snippet.
- Artifact generation produces a saved note with citations.
- Incremental indexing: re-import unchanged source does not re-embed unchanged chunks.

## 5. Performance & Limits (MVP defaults)
- max_chunks_per_source: 2,000
- chunk_size_target: ~800 chars
- overlap: 120 chars
- retrieval_topK: 8
- context_max_chars: 16,000 (truncate by score)

## 6. Error Handling
- Source parse failure sets status=failed with error_message.
- Provider errors are surfaced with retry suggestion.
- If embedding fails, mark source as ready but chunks unindexed; UI shows "Index incomplete".

## 7. Security/Privacy (Phase 1)
- Local-first. Do not upload sources unless user configures remote LLM.
- API keys stored locally (encrypted later; plaintext ok for MVP with warning banner).
# NotebookGo 项目规范（SPEC）

本文档定义 PDF/Word 解析、向量生成与存储、向量搜索及输出展示的完整流程与实现要求，供开发与实现时遵循。

---

## 1. 文件解析

### 1.1 支持格式与工具

| 格式 | 推荐工具（开源） | 备选 | 说明 |
|------|------------------|------|------|
| **PDF** | `pdf.js` (Mozilla) / `PyMuPDF` (Python) / `Apache Tika` | 当前实现使用 `pdf-parse`，可逐步迁移至上述之一 | 提取纯文本并尽量保留段落与页码结构 |
| **Word** | `Mammoth.js` (Node) / `Apache Tika` | — | 提取 .docx 文本；Tika 可统一处理 PDF+Word |

**实现要求：**

- 使用上述开源工具从 PDF/Word 中**仅提取文本**，不做渲染。
- 提取结果需带**结构信息**（如 `DocumentLoadResult`）：
  - 全文 `content`
  - 可选 `structure.pages`：每页的 `pageNumber`、`content`、`startOffset`、`endOffset`，用于后续 chunk 的页码映射。
- 若引入 Tika，建议以独立服务或 Docker 方式部署，通过 HTTP 调用，避免与 Node 运行时强耦合。

### 1.2 分块（Chunking）

- **目标大小**：每个 chunk **800–1200 tokens**（按项目统一 token 估算方式，如 `ChunkingService.estimateTokens`）。
- **重叠**：chunk 之间保留适当重叠（如 100–200 tokens），避免句子在边界被截断。
- **分割策略**：优先按段落/句子边界分割（如 `\n\n`、句号、问号等），再按 token 上限切分；避免在单词或中文词语中间切断。
- **与页码的对应**：每个 chunk 需记录 `pageStart`、`pageEnd`（或等价区间），用于检索结果中的“页码范围”展示。

**当前实现对照：**  
当前以**字符数**（如 `chunkSize=2400`）为粒度，与 800–1200 tokens 的对应关系需通过 `estimateTokens` 做标定；规范要求**以 token 数为目标**配置 chunk 大小（例如默认 `chunkSizeTokens: 1000`、`chunkOverlapTokens: 150`），内部可继续用字符近似，但对外接口与配置建议使用 token。

---

## 2. 向量生成与存储

### 2.1 嵌入模型

- **首选**：OpenAI Embedding API（如 `text-embedding-3-small` / `text-embedding-3-large`），或与其兼容的接口（如 OpenRouter）。
- **备选**：Sentence-BERT 等开源模型（需统一输出维度，并在入库前做维度校验或映射）。

### 2.2 维度与存储

- **维度**：与所选模型一致；当前默认 **1536**（OpenAI text-embedding-3-small 等）。
- **存储**：所有 chunk 的向量存入 **PostgreSQL**，使用 **pgvector** 扩展。
- **表**：`source_chunks`。
  - 必须包含列：`embedding`，类型 **`vector(1536)`**（或与当前模型维度一致，如 3072）。
  - 若更换模型，需同步修改列定义与迁移脚本。

### 2.3 写入流程

- 解析 → 分块 → **按批调用嵌入 API**（如每批 20 条）→ 写入 `source_chunks`（含 `content`、`page_start`/`page_end`、`embedding` 等）。
- 写入前校验：`embedding.length === 1536`（或当前维度），否则丢弃或重试，并打日志。
- 单条失败不阻塞整批：可记录失败 chunk，稍后重试或标记为失败。

---

## 3. 数据库模型与 pgvector

### 3.1 表与关系

- **notebooks**：笔记本，主键 `id`。
- **sources**：文件来源，`notebook_id` → `notebooks.id`；字段至少包含 `id`、`notebook_id`、`filename`、`file_url`、`status`、`mime` 等。
- **source_chunks**：文本块与向量；
  - `source_id` → `sources.id`（ON DELETE CASCADE）；
  - `chunk_index`、`content`、`page_start`、`page_end`、**`embedding`**（`vector(1536)`）、`created_at`。
- **conversations**：会话，`notebook_id` → `notebooks.id`。
- **messages**：消息，`conversation_id` → `conversations.id`；可含 `citations`（JSONB）存储引用信息。
- **notes**：笔记，`notebook_id` → `notebooks.id`。

所有外键与级联删除需在 schema 与迁移中明确，保证关系正确。

### 3.2 pgvector 扩展与索引

- 启用：`CREATE EXTENSION IF NOT EXISTS vector;`
- **相似度度量**：检索使用**余弦相似度**；pgvector 中对应运算符为 **`<=>`**（cosine distance，即 `1 - cosine_similarity`）。
- **索引**：
  - **HNSW**（当前推荐）：适合高维、查询多、延迟敏感；使用 `vector_cosine_ops`，例如：
    - `CREATE INDEX ... ON source_chunks USING hnsw (embedding vector_cosine_ops);`
  - **IVFFlat**（可选）：适合大规模、建索引可离线、对召回率要求高的场景；需指定 `lists` 参数，例如：
    - `CREATE INDEX ... ON source_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`
- 若表数据量很大（如 > 10 万行），应在迁移或运维文档中说明索引选择与调优（lists/ef_search 等）。

---

## 4. 向量搜索

### 4.1 流程

1. 用户输入**查询文本**。
2. 使用与入库相同的嵌入模型，将查询文本转为**查询向量**（维度与 `source_chunks.embedding` 一致）。
3. 在 PostgreSQL 中执行**向量相似度搜索**：
   - 使用 **余弦距离** `embedding <=> '[query_vector]'` 排序（或 ORM 等价，如 Drizzle 的 `cosineDistance(sourceChunks.embedding, queryEmbedding)`）。
   - 限定范围：仅当前 notebook、且 `sources.status = 'READY'` 的 chunk。
4. **排序与数量**：按距离升序排序，取前 **8** 个最相关 chunk（可配置 `TOP_K`）；必要时先多取（如 24）再按来源去重/截断，保证每个来源不超过一定数量（如 4）以避免单一文档垄断结果。

### 4.2 去冗余

- 检索结果中避免**重复 chunk**（同一 `source_chunks.id` 只出现一次）。
- 若同一段内容因分块重叠出现在多个 chunk，可在应用层按 `source_id + page_start + page_end` 或内容相似度做简单去重或合并展示，具体策略可在实现中细化。

### 4.3 性能

- 优先使用已在 `source_chunks.embedding` 上建立的 HNSW/IVFFlat 索引，确保查询走索引。
- 大批量嵌入生成时使用**批量 API**（如每批 20 条），并控制并发，避免限流。
- 检索可考虑只 SELECT 必要列（id、content、page_start、page_end、source_id 及 join 的 filename），减少传输与序列化开销。

---

## 5. 输出与展示

### 5.1 检索结果内容

每个返回的 chunk 在接口与前端需包含：

- **来源文件名**：对应 `sources.filename`（或可读的 source 标题）。
- **页码范围**：`page_start`、`page_end`（若无则显示为“—”或省略）。
- **相似度分数**：将 pgvector 的**余弦距离**转换为可读的“相似度”（如 `similarity = 1 - cosine_distance`），并在接口中返回（如 `score` 或 `distance`），便于排序与展示。

### 5.2 引用（Citations）结构

建议每条引用至少包含：

- `sourceId`、`sourceTitle`（文件名）
- `pageStart`、`pageEnd`（可选）
- `snippet`（截断的原文，如前 200 字）
- **`score`** 或 **`distance`**（相似度分数或距离）

### 5.3 前端交互

- **折叠/展开**：每个引用具备“折叠/展开”能力，展开时显示该 chunk 的完整内容（或较长 snippet）。
- 列表按相似度从高到低排列，并明确展示分数（如百分比或 0–1）。

---

## 6. 性能与扩展性

- **批量嵌入**：解析与分块完成后，按批（如 20 条）调用嵌入 API，再批量 INSERT `source_chunks`，减少往返与连接开销。
- **索引**：生产环境必须为 `source_chunks.embedding` 建立 HNSW 或 IVFFlat 索引，并随数据量调整参数。
- **并行**：Worker 中可对多文档或大批 chunk 做可控并行（如按文档并行、按批并行），注意 API 限流与数据库连接池上限。
- **配置**：chunk 大小（token）、TOP_K、每源上限、嵌入批大小、索引类型等均建议通过环境变量或配置暴露，便于调优与扩展。

---

## 7. 实现检查清单

- [ ] **解析**：PDF 使用 pdf.js / PyMuPDF / Tika 之一；Word 使用 Mammoth.js 或 Tika；输出统一为带结构的文本。
- [ ] **分块**：chunk 目标 800–1200 tokens，带重叠；记录 `page_start` / `page_end`。
- [ ] **向量**：OpenAI 或兼容 API；维度 1536；写入前校验维度。
- [ ] **存储**：`source_chunks.embedding` 为 `vector(1536)`；启用 pgvector；HNSW/IVFFlat 索引使用 `vector_cosine_ops`。
- [ ] **搜索**：查询向量 + `<=>` 余弦距离排序；TOP_K=8；仅 READY 源；去重。
- [ ] **输出**：返回文件名、页码范围、相似度分数；Citations 含 score/distance；前端支持折叠/展开与分数展示。

---

## 8. 参考：当前代码位置

| 功能         | 位置 |
|--------------|------|
| PDF 解析     | `packages/shared/src/loaders/PdfLoader.ts`（pdf-parse） |
| 分块         | `packages/shared/src/chunking/ChunkingService.ts` |
| 嵌入         | `packages/shared/src/providers/embedding.ts` |
| Schema/迁移 | `packages/db/src/schema.ts`、`packages/db/migrations/` |
| Worker 流程  | `apps/worker/src/index.ts` |
| 向量检索     | `apps/web/app/api/chat/route.ts`（cosineDistance、TOP_K、citations） |
| 引用展示     | `apps/web` 中 ChatPanel / 引用相关组件 |

以上规范应作为实现与 Code Review 的基准；如有偏离，需在文档或 PR 中说明原因并更新本 SPEC。

# NotebookGo

NotebookLM-style web app: PDF upload, RAG chat with citations, and Notes. Built by adapting [KnowNote](https://github.com/MrSibe/KnowNote) to a Next.js + Postgres + pgvector stack.

## Stack

- **Web**: Next.js 14 (App Router), React, Tailwind
- **DB**: Postgres 16 + pgvector, Drizzle ORM
- **Job processing**: PostgreSQL polling worker (async document processing)
- **Storage**: S3-compatible or local filesystem

## Prerequisites

- Node 20+
- pnpm 9+
- Docker & Docker Compose (for Postgres)

## Run locally

1. **Start Postgres**

   ```bash
   docker compose -f packages/db/docker-compose.dev.yml up -d
   ```

2. **Env**

   ```bash
   cp .env.example .env   # 或新建 .env
   # 必填：OPENAI_API_KEY（或 OpenRouter 等）；若开放登录需设置：
   # NEXTAUTH_SECRET=任意长随机字符串（如 openssl rand -base64 32）
   # NEXTAUTH_URL=http://localhost:3000（开发）；上线后改为实际域名）
   ```

3. **Install and migrate**

   ```bash
   pnpm install
   pnpm db:migrate
   ```

4. **Build packages (required before dev)**

   ```bash
   pnpm --filter db build
   pnpm --filter shared build
   pnpm --filter worker build
   ```

5. **Run web app**

   ```bash
   pnpm dev:web
   ```

   Open [http://localhost:3000](http://localhost:3000).

6. **Run worker (for document processing, milestone B+)**

   ```bash
   pnpm dev:worker
   ```

## Scripts

| Script         | Description                    |
|----------------|--------------------------------|
| `pnpm dev:web` | Start Next.js dev server       |
| `pnpm dev:worker` | Start PostgreSQL worker    |
| `pnpm db:migrate` | Run Drizzle migrations    |
| `pnpm db:generate` | Generate new migration  |

## Project layout

- `apps/web` – Next.js app (three-column UI, API routes)
- `apps/worker` – PostgreSQL polling worker (parse, chunk, embed)
- `packages/db` – Drizzle schema, migrations, Postgres client
- `packages/shared` – Chunking, PDF loader, provider abstraction

## MVP flow

1. Create notebook
2. Upload PDF → source status PENDING → worker runs → READY
3. Chat with citations (RAG)
4. Save assistant answer to Notes

## Roadmap

详见 **[ROADMAP.md](./ROADMAP.md)**，摘要如下。

**下一里程碑（生成能力 + 类 NotebookLM 体验）**

- **D. 生成 Agent 与意图路由**：后台配置预设 Agent（PPT / 信息图 / 纯图），定义生图规则与角色；根据用户意图选择合适的 Agent。
- **E. 接入生成工具**：PPT（如 pptxgenjs）、信息图/结构图（如 nano banana、Mermaid）、生图（Stable Diffusion / DALL·E 等）；先打通一种再扩展。
- **F. 流程整合**：在对话/笔记中触发「生成 PPT / 信息图 / 配图」，结果可插入笔记或导出。
- **界面优化**：与开发并行做轻量 UI 优化（loading、错误态、设置入口）；在生成能力就绪后做一轮类 NotebookLM 的体验收口。

**Backlog**

- RAG 效果优化（chunk 800–1200 tokens、embedding/TOP_K）。
- 可选：PDF 解析迁移至 pdf.js / PyMuPDF / Tika。

## Deploy (Vercel + Worker)

- 生产部署说明见：[docs/DEPLOY_VERCEL.md](./docs/DEPLOY_VERCEL.md)
- 生产环境变量模板：
  - `deploy/.env.web.production.example`
  - `deploy/.env.worker.production.example`
- 一键同步变量到 Vercel（Production + Preview）：

  ```bash
  pnpm vercel:env:sync .env.production.web production,preview
  ```

## License

See repository license.

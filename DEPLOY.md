# Deploying to Vercel

## Prerequisites

- Node.js 20+
- pnpm
- PostgreSQL (e.g. Vercel Postgres, Neon, Supabase)
- Optional: OpenRouter API key for LLM answers; app works in evidence-only mode without it
- Optional: Vercel Blob store for file storage (or use local storage)

## Environment variables

Set these in your Vercel project (or in `.env` for local production builds).

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default from Vercel) |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string (e.g. from Vercel Postgres) |
| `OPENROUTER_API_KEY` | No | OpenRouter API key for LLM mode; omit to use evidence-only |
| `OPENROUTER_MODEL` | No | Model id (default: `openai/gpt-3.5-turbo`) |
| `STORAGE_PROVIDER` | No | `local` or `blob` (default: `local`) |
| `UPLOAD_DIR` | If local | Directory for uploads when `STORAGE_PROVIDER=local` (default: `./uploads`) |
| `BLOB_READ_WRITE_TOKEN` | If blob | Vercel Blob token when `STORAGE_PROVIDER=blob` |
| `DEV_USER_ID` | No | Dev-only user id header bypass |
| `DEV_USER_EMAIL` | No | Dev-only user email |

- For **Vercel Blob**: create a Blob store in the Vercel dashboard; the token is usually set as `BLOB_READ_WRITE_TOKEN`.
- For **local storage** on Vercel: serverless functions have an ephemeral filesystem; use `blob` for production or only use uploads in environments with persistent disk.

## Build and migrations

Run Prisma migrations **during** the production build so the database is up to date before the app starts.

1. **From repo root (recommended for Vercel):**

   ```bash
   pnpm --filter @notelm/db db:migrate:deploy
   pnpm build
   ```

2. **Vercel build command**

   Set the Vercel project **Build Command** to:

   ```bash
   pnpm --filter @notelm/db db:migrate:deploy && pnpm build
   ```

   Or use a single script by adding to the root `package.json`:

   ```json
   "build:prod": "pnpm --filter @notelm/db db:migrate:deploy && pnpm build"
   ```

   then set Build Command to `pnpm build:prod`.

3. **From `packages/db`:**

   ```bash
   cd packages/db && pnpm db:migrate:deploy
   ```

Then run the rest of your build (e.g. `pnpm build` from root). Ensure `DATABASE_URL` is available at build time so migrations can connect.

## API behavior without LLM

- `POST /ask` accepts `mode: "llm" | "evidence"` (default `"llm"`).
- If `mode` is `"llm"` and the LLM call fails (missing key, network, region, or config error), the API automatically falls back to **evidence** mode: returns `mode: "evidence"`, `answer: null`, and the same `citations` / `evidence` from retrieval.
- You can set `mode: "evidence"` in the request to skip the LLM entirely. No `OPENROUTER_API_KEY` is required for evidence-only usage.

## File storage

- **Local (`STORAGE_PROVIDER=local`)**: files are written to `UPLOAD_DIR`. On Vercel, this is ephemeral; use for dev or stateless demos.
- **Blob (`STORAGE_PROVIDER=blob`)**: files are uploaded to Vercel Blob; `Source.stored_uri` is set to the public Blob URL. `GET /sources/:id/file` redirects (302) to that URL. Requires `BLOB_READ_WRITE_TOKEN`.

## Checklist

- [ ] `DATABASE_URL` set and reachable at build time
- [ ] Build command runs `db:migrate:deploy` then `build`
- [ ] Optional: `OPENROUTER_API_KEY` for LLM answers
- [ ] Optional: `STORAGE_PROVIDER=blob` and `BLOB_READ_WRITE_TOKEN` for persistent file storage

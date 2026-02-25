# Vercel Production Setup

## 1) Architecture (required)

- **Vercel (`apps/web`)**: serves UI + `app/api/*`
- **External Postgres**: Neon/Supabase/RDS (Vercel cannot use your local Postgres)
- **Worker (`apps/worker`)**: deploy on Railway/Render/Fly.io (not on Vercel), polling jobs from Postgres

If `DATABASE_URL` points to `localhost`, production will fail.

## 2) Prepare env files

Use templates:

- Web: `deploy/.env.web.production.example`
- Worker: `deploy/.env.worker.production.example`

Copy and fill real values from your cloud providers.

## 3) Sync env to Vercel

This repo includes a sync script:

```bash
pnpm vercel:env:sync .env.production.web production,preview
```

Notes:

- Script reads `.vercel/project.json` for project id.
- It replaces keys with the same name on Vercel, then recreates them for targets.
- Values are stored as encrypted env vars.

## 4) Deploy web

```bash
pnpm vercel:deploy
```

## 5) Deploy worker (separate platform)

Build/start commands:

```bash
pnpm install
pnpm --filter db build
pnpm --filter shared build
pnpm --filter worker build
pnpm --filter worker start
```

Worker env must include at least:

- `DATABASE_URL`
- `OPENROUTER_API_KEY` (or `OPENAI_API_KEY`)
- model/provider settings used by web
- storage settings (`STORAGE_TYPE=s3` + S3 creds)

## 6) Verification checklist

- Vercel `env ls` shows web keys on `Production, Preview`
- `https://<your-domain>/login` loads
- login works without `Server configuration` error
- uploading source changes status from `PENDING` -> `READY`

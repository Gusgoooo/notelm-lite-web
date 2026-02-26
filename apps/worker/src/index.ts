import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';
const rootEnv = join(process.cwd(), '../../.env');
const cwdEnv = join(process.cwd(), '.env');
if (existsSync(rootEnv)) config({ path: rootEnv });
else if (existsSync(cwdEnv)) config({ path: cwdEnv });
else config();

import type { ChunkResult } from 'shared';
import {
  getStorage,
  ChunkingService,
  getLoaderForMime,
  createEmbeddings,
  getEmbeddingDimensions,
} from 'shared';
import { db, sources, sourceChunks, scriptJobs, notebooks, eq, and, sql } from 'db';
import { randomUUID } from 'crypto';
import { executePythonInSandbox } from './pythonSandbox.js';

const chunkingService = new ChunkingService();
const chunkSize = Math.max(
  600,
  Number.parseInt(process.env.CHUNK_SIZE ?? '2400', 10) || 2400
);
const chunkOverlap = Math.max(
  0,
  Number.parseInt(process.env.CHUNK_OVERLAP ?? '450', 10) || 450
);
const embeddingBatchSize = Math.max(
  1,
  Number.parseInt(process.env.EMBEDDING_BATCH_SIZE ?? '20', 10) || 20
);
const workerConcurrency = Math.max(
  1,
  Number.parseInt(process.env.WORKER_CONCURRENCY ?? '1', 10) || 1
);
const pollIntervalMs = Math.max(
  200,
  Number.parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? '1200', 10) || 1200
);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for worker runtime');
}

const embeddingProvider = (process.env.EMBEDDING_PROVIDER ?? 'auto').trim().toLowerCase();
const openrouterKeyLen = (process.env.OPENROUTER_API_KEY ?? '').trim().length;
const openaiKeyLen = (process.env.OPENAI_API_KEY ?? '').trim().length;
const storageType = (process.env.STORAGE_TYPE ?? 'filesystem').trim().toLowerCase();

console.log(
  `Worker env check: EMBEDDING_PROVIDER=${embeddingProvider || '<unset>'}, OPENROUTER_API_KEY_LEN=${openrouterKeyLen}, OPENAI_API_KEY_LEN=${openaiKeyLen}, STORAGE_TYPE=${storageType || '<unset>'}`
);

if (embeddingProvider === 'openrouter' && openrouterKeyLen === 0) {
  throw new Error('EMBEDDING_PROVIDER=openrouter but OPENROUTER_API_KEY is empty');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatWorkerError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const message = error.message || String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes('specified key does not exist') ||
    normalized.includes('no such key') ||
    normalized.includes('nosuchkey')
  ) {
    return `对象存储中未找到文件（Key 不存在）：${message}。请确认 Web 与 Worker 的 S3 配置完全一致（S3_BUCKET/S3_ENDPOINT/S3_REGION）。`;
  }
  return message;
}

function isNoSuchKeyError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('specified key does not exist') ||
    message.includes('no such key') ||
    message.includes('nosuchkey')
  );
}

function isPythonSource(filename: string, mime: string | null): boolean {
  const lowerName = filename.toLowerCase();
  const lowerMime = (mime ?? '').toLowerCase();
  return (
    lowerName.endsWith('.py') ||
    lowerMime.includes('text/x-python') ||
    lowerMime.includes('application/x-python-code')
  );
}

function toSingleChunk(content: string): ChunkResult[] {
  const text = content.trim();
  if (!text) return [];
  return [
    {
      content: text,
      index: 0,
      startOffset: 0,
      endOffset: text.length,
      tokenCount: chunkingService.estimateTokens(text),
    },
  ];
}

async function enqueueAutoScriptJobs(notebookId: string, triggerSourceId: string): Promise<void> {
  if (scriptJobsQueueDisabled) return;
  try {
    const [ownerNotebook] = await db
      .select({ userId: notebooks.userId })
      .from(notebooks)
      .where(eq(notebooks.id, notebookId))
      .limit(1);

    if (!ownerNotebook?.userId) return;

    const readySources = await db
      .select({
        id: sources.id,
        filename: sources.filename,
        mime: sources.mime,
      })
      .from(sources)
      .where(and(eq(sources.notebookId, notebookId), eq(sources.status, 'READY')));

    const scriptSources = readySources.filter((s) => isPythonSource(s.filename, s.mime));
    if (scriptSources.length === 0) return;

    const nonScriptIds = new Set(
      readySources
        .filter((s) => !isPythonSource(s.filename, s.mime))
        .map((s) => s.id)
    );

    const contextRows = await db
      .select({
        sourceId: sourceChunks.sourceId,
        sourceTitle: sources.filename,
        pageStart: sourceChunks.pageStart,
        pageEnd: sourceChunks.pageEnd,
        content: sourceChunks.content,
      })
      .from(sourceChunks)
      .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
      .where(and(eq(sources.notebookId, notebookId), eq(sources.status, 'READY')))
      .orderBy(sources.createdAt, sourceChunks.chunkIndex)
      .limit(240);

    const snippets = contextRows
      .filter((row) => nonScriptIds.has(row.sourceId))
      .map((row) => ({
        sourceId: row.sourceId,
        sourceTitle: row.sourceTitle,
        pageStart: row.pageStart ?? undefined,
        pageEnd: row.pageEnd ?? undefined,
        content: row.content.slice(0, 1200),
      }));

    for (const scriptSource of scriptSources) {
      const existing = await db.execute(sql`
        select id
        from script_jobs
        where notebook_id = ${notebookId}
          and status in ('PENDING', 'RUNNING')
          and input -> '__meta' ->> 'mode' = 'auto-notebook-script'
          and input -> '__meta' ->> 'scriptSourceId' = ${scriptSource.id}
        limit 1
      `);
      const existingRows = (existing as { rows?: Array<{ id?: unknown }> }).rows ?? [];
      if (existingRows.length > 0) continue;

      const scriptChunkRows = await db
        .select({ content: sourceChunks.content })
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceId, scriptSource.id))
        .orderBy(sourceChunks.chunkIndex);
      const scriptCode = scriptChunkRows.map((row) => row.content).join('\n').trim();
      if (!scriptCode) continue;

      const now = new Date();
      await db.insert(scriptJobs).values({
        id: `job_${randomUUID()}`,
        userId: ownerNotebook.userId,
        notebookId,
        code: scriptCode,
        input: {
          __meta: {
            mode: 'auto-notebook-script',
            scriptSourceId: scriptSource.id,
            triggerSourceId,
            createdAt: now.toISOString(),
          },
          notebookId,
          sources: snippets,
        },
        status: 'PENDING',
        timeoutMs: 12_000,
        memoryLimitMb: 256,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
      ?? (error as { code?: string })?.code;
    if (code === '42P01') {
      scriptJobsQueueDisabled = true;
      console.warn('script_jobs table not found while enqueueing auto script jobs; auto script execution disabled.');
      return;
    }
    throw error;
  }
}

async function copyChunksFromSiblingReadySource(
  targetSourceId: string,
  fileUrl: string
): Promise<boolean> {
  const [sibling] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.fileUrl, fileUrl),
        eq(sources.status, 'READY')
      )
    )
    .limit(1);

  if (!sibling || sibling.id === targetSourceId) return false;

  const existing = await db
    .select({
      chunkIndex: sourceChunks.chunkIndex,
      content: sourceChunks.content,
      pageStart: sourceChunks.pageStart,
      pageEnd: sourceChunks.pageEnd,
      embedding: sourceChunks.embedding,
    })
    .from(sourceChunks)
    .where(eq(sourceChunks.sourceId, sibling.id));

  if (existing.length === 0) return false;

  await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, targetSourceId));

  const now = new Date();
  const batchSize = 100;
  for (let i = 0; i < existing.length; i += batchSize) {
    const batch = existing.slice(i, i + batchSize).map((row) => ({
      id: `chk_${randomUUID()}`,
      sourceId: targetSourceId,
      chunkIndex: row.chunkIndex,
      content: row.content,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      embedding: row.embedding as unknown as number[],
      createdAt: now,
    }));
    await db.insert(sourceChunks).values(batch);
  }

  await db
    .update(sources)
    .set({ status: 'READY', errorMessage: null })
    .where(eq(sources.id, targetSourceId));

  return true;
}

async function claimNextSourceId(): Promise<string | null> {
  const result = await db.execute(sql`
    with candidate as (
      select id
      from sources
      where status = 'PENDING'
      order by created_at asc
      limit 1
      for update skip locked
    )
    update sources as s
    set status = 'PROCESSING', error_message = null
    from candidate
    where s.id = candidate.id
    returning s.id
  `);

  const rows = (result as { rows?: Array<{ id?: unknown }> }).rows ?? [];
  const sourceId = rows[0]?.id;
  return typeof sourceId === 'string' ? sourceId : null;
}

async function claimNextScriptJobId(): Promise<string | null> {
  if (scriptJobsQueueDisabled) return null;
  try {
    const result = await db.execute(sql`
      with candidate as (
        select id
        from script_jobs
        where status = 'PENDING'
        order by created_at asc
        limit 1
        for update skip locked
      )
      update script_jobs as j
      set status = 'RUNNING',
          error_message = null,
          started_at = now(),
          updated_at = now()
      from candidate
      where j.id = candidate.id
      returning j.id
    `);

    const rows = (result as { rows?: Array<{ id?: unknown }> }).rows ?? [];
    const jobId = rows[0]?.id;
    return typeof jobId === 'string' ? jobId : null;
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
      ?? (error as { code?: string })?.code;
    if (code === '42P01') {
      scriptJobsQueueDisabled = true;
      console.warn(
        'script_jobs table not found. Python script queue is disabled in this environment; source ingestion will continue.'
      );
      return null;
    }
    throw error;
  }
}

async function processDocument(sourceId: string): Promise<void> {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source) throw new Error(`Source ${sourceId} not found`);
  const currentStatus = String(source.status);
  if (currentStatus !== 'PENDING' && currentStatus !== 'PROCESSING') return;
  await db
    .update(sources)
    .set({ status: 'PROCESSING' as never, errorMessage: null })
    .where(eq(sources.id, sourceId));

  const storage = getStorage();
  let buffer: Buffer;
  try {
    buffer = await storage.download(source.fileUrl);
  } catch (error) {
    if (isNoSuchKeyError(error)) {
      const copied = await copyChunksFromSiblingReadySource(sourceId, source.fileUrl);
      if (copied) {
        console.log(`Recovered source ${sourceId} by copying chunks from sibling source with same file_url`);
        await enqueueAutoScriptJobs(source.notebookId, sourceId);
        return;
      }
    }
    throw error;
  }
  const loader = getLoaderForMime(source.mime ?? null);
  const parseResult = await loader.loadFromBuffer(buffer, {
    preserveStructure: true,
  });

  const chunkResults = isPythonSource(source.filename, source.mime ?? null)
    ? toSingleChunk(parseResult.content)
    : chunkingService.chunk(parseResult.content, {
        chunkSize,
        chunkOverlap,
      });
  if (chunkResults.length === 0) {
    await db
      .update(sources)
      .set({
        status: 'FAILED',
        errorMessage: 'No chunks generated',
      })
      .where(eq(sources.id, sourceId));
    return;
  }

  const texts = chunkResults.map((c: ChunkResult) => c.content);
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += embeddingBatchSize) {
    const batch = texts.slice(i, i + embeddingBatchSize);
    const vectors = await createEmbeddings(batch);
    allEmbeddings.push(...vectors);
  }

  const pages = parseResult.structure?.pages ?? [];
  function getPageRange(startOffset: number, endOffset: number): { start: number; end: number } {
    let start = 1;
    let end = 1;
    for (const p of pages) {
      if (p.startOffset <= startOffset && startOffset < p.endOffset) start = p.pageNumber;
      if (p.startOffset < endOffset && endOffset <= p.endOffset) end = p.pageNumber;
    }
    return { start, end };
  }

  const dimensions = getEmbeddingDimensions();
  const rowsToInsert: Array<{
    id: string;
    sourceId: string;
    chunkIndex: number;
    content: string;
    pageStart: number;
    pageEnd: number;
    embedding: number[];
  }> = [];
  for (let i = 0; i < chunkResults.length; i++) {
    const chunk = chunkResults[i];
    const embedding = allEmbeddings[i];
    if (!embedding || embedding.length !== dimensions) continue;
    const { start: pageStart, end: pageEnd } = getPageRange(
      chunk.startOffset,
      chunk.endOffset
    );
    const id = `chk_${randomUUID()}`;
    rowsToInsert.push({
      id,
      sourceId,
      chunkIndex: chunk.index,
      content: chunk.content,
      pageStart,
      pageEnd,
      embedding: embedding as unknown as number[],
    });
  }

  if (rowsToInsert.length > 0) {
    const insertBatchSize = 100;
    for (let i = 0; i < rowsToInsert.length; i += insertBatchSize) {
      await db.insert(sourceChunks).values(rowsToInsert.slice(i, i + insertBatchSize));
    }
  }

  if (rowsToInsert.length === 0) {
    await db
      .update(sources)
      .set({
        status: 'FAILED',
        errorMessage: `No chunks inserted (embedding dimension mismatch, expected ${dimensions})`,
      })
      .where(eq(sources.id, sourceId));
    return;
  }

  await db
    .update(sources)
    .set({ status: 'READY', errorMessage: null })
    .where(eq(sources.id, sourceId));

  await enqueueAutoScriptJobs(source.notebookId, sourceId);
}

async function runSourceIngestionJob(sourceId: string): Promise<void> {
  try {
    await processDocument(sourceId);
    console.log(`Job for source ${sourceId} completed`);
  } catch (err) {
    await db
      .update(sources)
      .set({
        status: 'FAILED',
        errorMessage: formatWorkerError(err),
      })
      .where(eq(sources.id, sourceId));
    console.error(`Job for source ${sourceId} failed:`, err);
  }
}

async function processScriptJob(jobId: string): Promise<void> {
  const [job] = await db.select().from(scriptJobs).where(eq(scriptJobs.id, jobId));
  if (!job) throw new Error(`Script job ${jobId} not found`);
  if (job.status !== 'PENDING' && job.status !== 'RUNNING') return;

  const result = await executePythonInSandbox({
    code: job.code,
    input: (job.input ?? {}) as Record<string, unknown>,
    timeoutMs: Number(job.timeoutMs ?? 10_000),
    memoryLimitMb: Number(job.memoryLimitMb ?? 256),
  });

  if (result.ok) {
    await db
      .update(scriptJobs)
      .set({
        status: 'SUCCEEDED',
        output: {
          result: result.result,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: result.durationMs,
        },
        errorMessage: null,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scriptJobs.id, jobId));
    return;
  }

  await db
    .update(scriptJobs)
    .set({
      status: 'FAILED',
      output: {
        stdout: result.stdout,
        stderr: result.stderr,
        traceback: result.traceback ?? null,
        durationMs: result.durationMs,
      },
      errorMessage: result.error,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(scriptJobs.id, jobId));
}

async function runScriptExecutionJob(jobId: string): Promise<void> {
  try {
    await processScriptJob(jobId);
    console.log(`Script job ${jobId} completed`);
  } catch (err) {
    await db
      .update(scriptJobs)
      .set({
        status: 'FAILED',
        errorMessage: formatWorkerError(err),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scriptJobs.id, jobId));
    console.error(`Script job ${jobId} failed:`, err);
  }
}

type ClaimedJob =
  | { type: 'source'; id: string }
  | { type: 'script'; id: string };

async function claimNextJob(): Promise<ClaimedJob | null> {
  const sourceId = await claimNextSourceId();
  if (sourceId) return { type: 'source', id: sourceId };
  const scriptJobId = await claimNextScriptJobId();
  if (scriptJobId) return { type: 'script', id: scriptJobId };
  return null;
}

async function runClaimedJob(job: ClaimedJob): Promise<void> {
  if (job.type === 'source') {
    await runSourceIngestionJob(job.id);
    return;
  }
  await runScriptExecutionJob(job.id);
}

let stopping = false;
let scriptJobsQueueDisabled = false;
const inFlight = new Set<Promise<void>>();

async function fillSlots() {
  while (!stopping && inFlight.size < workerConcurrency) {
    const job = await claimNextJob();
    if (!job) break;
    const jobPromise = runClaimedJob(job).finally(() => {
      inFlight.delete(jobPromise);
    });
    inFlight.add(jobPromise);
  }
}

async function runWorkerLoop() {
  console.log(
    `PostgreSQL worker started (concurrency=${workerConcurrency}, poll=${pollIntervalMs}ms), waiting for jobs...`
  );
  while (!stopping) {
    await fillSlots();
    await sleep(inFlight.size > 0 ? 200 : pollIntervalMs);
  }
  if (inFlight.size > 0) {
    await Promise.allSettled(Array.from(inFlight));
  }
  console.log('Worker stopped');
}

function requestStop(signal: string) {
  if (stopping) return;
  console.log(`${signal} received, stopping worker...`);
  stopping = true;
}

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

void runWorkerLoop().catch((err) => {
  console.error('Worker crashed:', err);
  process.exitCode = 1;
});

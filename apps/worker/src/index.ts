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
import { db, sources, sourceChunks, eq, sql } from 'db';
import { randomUUID } from 'crypto';

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
  const buffer = await storage.download(source.fileUrl);
  const loader = getLoaderForMime(source.mime ?? null);
  const parseResult = await loader.loadFromBuffer(buffer, {
    preserveStructure: true,
  });

  const chunkResults = chunkingService.chunk(parseResult.content, {
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
}

async function runJob(sourceId: string): Promise<void> {
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

let stopping = false;
const inFlight = new Set<Promise<void>>();

async function fillSlots() {
  while (!stopping && inFlight.size < workerConcurrency) {
    const sourceId = await claimNextSourceId();
    if (!sourceId) break;
    const jobPromise = runJob(sourceId).finally(() => {
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

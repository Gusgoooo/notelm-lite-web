import { NextResponse } from 'next/server';
import { and, cosineDistance, db, eq, inArray, sourceChunks, sources, sql } from 'db';
import { createEmbeddings } from 'shared';
import { getNotebookAccess } from '@/lib/notebook-access';
import { ingestWebSources, searchWebViaOpenRouter } from '@/lib/web-research';

const WEB_SOURCE_MIME = 'application/x-web-source';
const DEFAULT_ADD_LIMIT = 8;
const MAX_KEEP_WEB_SOURCES = 18;
const HARD_REMOVE_DISTANCE = 0.52;
const SOFT_REMOVE_DISTANCE = 0.34;

function normalizeTopic(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 240) : '';
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId.trim() : '';
    const topic = normalizeTopic(body?.topic);
    const addLimitRaw = Number.parseInt(String(body?.addLimit ?? ''), 10);
    const addLimit = Number.isFinite(addLimitRaw)
      ? Math.max(3, Math.min(12, addLimitRaw))
      : DEFAULT_ADD_LIMIT;

    if (!notebookId || !topic) {
      return NextResponse.json({ error: 'notebookId and topic are required' }, { status: 400 });
    }

    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json(
        { error: '该 notebook 来源为只读，请先保存为我的 notebook' },
        { status: 403 }
      );
    }

    let added = 0;
    let skipped = 0;
    try {
      const fetched = await searchWebViaOpenRouter({ topic, limit: addLimit });
      const ingest = await ingestWebSources({
        notebookId,
        topic,
        fetched,
        limit: addLimit,
      });
      added = ingest.added;
      skipped = ingest.skipped;
    } catch {
      // Source enrichment is best-effort; still continue to pruning.
    }

    const [queryEmbedding] = await createEmbeddings([topic]);
    const ranked = await db
      .select({
        sourceId: sources.id,
        distance: cosineDistance(sourceChunks.embedding, queryEmbedding),
      })
      .from(sourceChunks)
      .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
      .where(
        and(
          eq(sources.notebookId, notebookId),
          eq(sources.mime, WEB_SOURCE_MIME),
          eq(sources.status, 'READY'),
          sql`${sourceChunks.embedding} is not null`
        )
      )
      .orderBy(cosineDistance(sourceChunks.embedding, queryEmbedding));

    const seen = new Set<string>();
    const rankedSources: Array<{ sourceId: string; distance: number }> = [];
    for (const row of ranked) {
      if (seen.has(row.sourceId)) continue;
      seen.add(row.sourceId);
      rankedSources.push({
        sourceId: row.sourceId,
        distance: Number(row.distance ?? 1),
      });
    }

    const keepIds = new Set(
      rankedSources
        .filter((row, index) => index < MAX_KEEP_WEB_SOURCES && row.distance <= HARD_REMOVE_DISTANCE)
        .map((row) => row.sourceId)
    );

    const removableIds = rankedSources
      .filter((row, index) => {
        if (keepIds.has(row.sourceId)) return false;
        if (row.distance >= HARD_REMOVE_DISTANCE) return true;
        return index >= Math.max(10, MAX_KEEP_WEB_SOURCES - 4) && row.distance >= SOFT_REMOVE_DISTANCE;
      })
      .map((row) => row.sourceId);

    let removed = 0;
    if (removableIds.length > 0) {
      await db.transaction(async (tx) => {
        await tx.delete(sourceChunks).where(inArray(sourceChunks.sourceId, removableIds));
        await tx.delete(sources).where(inArray(sources.id, removableIds));
      });
      removed = removableIds.length;
    }

    return NextResponse.json({
      added,
      skipped,
      removed,
      kept: keepIds.size,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '维护来源失败' },
      { status: 500 }
    );
  }
}

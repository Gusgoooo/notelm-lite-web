import { NextResponse } from 'next/server';
import { and, db, eq, inArray, sourceChunks, sources } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

function isWebSourceMime(mime: string | null): boolean {
  const normalized = (mime ?? '').toLowerCase();
  return (
    normalized.includes('application/x-web-source') ||
    normalized.includes('application/x-websearch-source')
  );
}

function normalizeComparableUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    url.hash = '';
    return url.toString();
  } catch {
    return input.trim();
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId.trim() : '';
    if (!notebookId) {
      return NextResponse.json({ error: 'notebookId is required' }, { status: 400 });
    }

    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json({ error: '该 notebook 来源为只读，请先保存为我的 notebook' }, { status: 403 });
    }

    const list = await db
      .select({
        id: sources.id,
        fileUrl: sources.fileUrl,
        mime: sources.mime,
        createdAt: sources.createdAt,
      })
      .from(sources)
      .where(eq(sources.notebookId, notebookId));

    const webSources = list
      .filter((row) => isWebSourceMime(row.mime))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const seen = new Set<string>();
    const removeIds: string[] = [];

    for (const row of webSources) {
      const key = normalizeComparableUrl(row.fileUrl);
      if (!key) continue;
      if (seen.has(key)) {
        removeIds.push(row.id);
        continue;
      }
      seen.add(key);
    }

    if (removeIds.length > 0) {
      await db.transaction(async (tx) => {
        await tx.delete(sourceChunks).where(inArray(sourceChunks.sourceId, removeIds));
        await tx.delete(sources).where(and(eq(sources.notebookId, notebookId), inArray(sources.id, removeIds)));
      });
    }

    return NextResponse.json({
      removed: removeIds.length,
      kept: webSources.length - removeIds.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '来源清洗失败' },
      { status: 500 }
    );
  }
}

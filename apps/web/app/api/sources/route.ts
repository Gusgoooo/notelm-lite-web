import { NextResponse } from 'next/server';
import { db, sources, sourceChunks, eq, desc, inArray, sql } from 'db';
import { randomUUID } from 'crypto';
import { getNotebookAccess } from '@/lib/notebook-access';

function getSourceType(mime: string | null, filename: string): 'pdf' | 'word' | '复制文本' | 'python脚本' {
  const normalizedMime = (mime ?? '').toLowerCase();
  const lowerName = filename.toLowerCase();
  if (
    normalizedMime.includes('text/x-python') ||
    normalizedMime.includes('application/x-python-code') ||
    lowerName.endsWith('.py')
  ) {
    return 'python脚本';
  }
  if (normalizedMime.includes('text/plain')) return '复制文本';
  if (normalizedMime.includes('application/pdf') || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    normalizedMime.includes('application/msword') ||
    normalizedMime.includes(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) ||
    lowerName.endsWith('.doc') ||
    lowerName.endsWith('.docx')
  ) {
    return 'word';
  }
  return '复制文本';
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const notebookId = searchParams.get('notebookId');
  if (!notebookId) {
    return NextResponse.json(
      { error: 'notebookId query is required' },
      { status: 400 }
    );
  }
  try {
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const list = await db
      .select()
      .from(sources)
      .where(eq(sources.notebookId, notebookId))
      .orderBy(desc(sources.createdAt));
    const sourceIds = list.map((s) => s.id);
    const chunkCountMap = new Map<string, number>();
    if (sourceIds.length > 0) {
      const counts = await db
        .select({
          sourceId: sourceChunks.sourceId,
          chunkCount: sql<number>`count(*)::int`,
        })
        .from(sourceChunks)
        .where(inArray(sourceChunks.sourceId, sourceIds))
        .groupBy(sourceChunks.sourceId);
      for (const row of counts) {
        chunkCountMap.set(row.sourceId, Number(row.chunkCount) || 0);
      }
    }
    return NextResponse.json(
      list.map((row) => ({
        ...row,
        chunkCount: chunkCountMap.get(row.id) ?? 0,
        sourceType: getSourceType(row.mime ?? null, row.filename),
      }))
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to list sources' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      sourceId: bodySourceId,
      notebookId,
      filename,
      fileUrl,
      mime,
    } = body ?? {};
    if (!notebookId || !filename || !fileUrl) {
      return NextResponse.json(
        { error: 'notebookId, filename, and fileUrl are required' },
        { status: 400 }
      );
    }
    const access = await getNotebookAccess(String(notebookId));
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json({ error: '该 notebook 来源为只读，请先保存为我的 notebook' }, { status: 403 });
    }
    const sourceId = bodySourceId ?? `src_${randomUUID()}`;
    const mimeValue = mime ? String(mime) : 'application/pdf';
    await db.insert(sources).values({
      id: sourceId,
      notebookId,
      filename: String(filename),
      fileUrl: String(fileUrl),
      mime: mimeValue,
      status: 'PENDING',
    });
    const [row] = await db.select().from(sources).where(eq(sources.id, sourceId));
    return NextResponse.json({
      ...row,
      chunkCount: 0,
      sourceType: getSourceType(mimeValue, String(filename)),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to create source' },
      { status: 500 }
    );
  }
}

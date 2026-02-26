import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { and, db, eq, inArray, notebooks, sourceChunks, sources } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

function cloneTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return 'Untitled';
  return trimmed.endsWith('（副本）') ? trimmed : `${trimmed}（副本）`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await getNotebookAccess(id);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!access.userId) {
      return NextResponse.json({ error: 'Please login first' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedTitle = typeof body?.title === 'string' ? body.title.trim() : '';

    const forkNotebookId = `nb_${randomUUID()}`;
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(notebooks).values({
        id: forkNotebookId,
        userId: access.userId,
        title: requestedTitle || cloneTitle(access.notebook!.title),
        description: access.notebook!.description ?? '',
        isPublished: false,
        publishedAt: null,
        forkedFromNotebookId: access.notebook!.id,
        createdAt: now,
      });

      const originalSources = await tx
        .select()
        .from(sources)
        .where(eq(sources.notebookId, access.notebook!.id));

      if (originalSources.length === 0) return;

      const sourceIdMap = new Map<string, string>();
      const clonedSources = originalSources.map((row) => {
        const clonedId = `src_${randomUUID()}`;
        sourceIdMap.set(row.id, clonedId);
        return {
          id: clonedId,
          notebookId: forkNotebookId,
          filename: row.filename,
          fileUrl: row.fileUrl,
          mime: row.mime,
          status: row.status === 'PROCESSING' ? 'PENDING' : row.status,
          errorMessage: row.status === 'PROCESSING' ? null : row.errorMessage,
          createdAt: now,
        };
      });
      await tx.insert(sources).values(clonedSources);

      const originalSourceIds = originalSources.map((row) => row.id);
      if (originalSourceIds.length === 0) return;

      const originalChunks = await tx
        .select()
        .from(sourceChunks)
        .where(inArray(sourceChunks.sourceId, originalSourceIds));

      if (originalChunks.length === 0) return;

      await tx.insert(sourceChunks).values(
        originalChunks
          .map((row) => {
            const mappedSourceId = sourceIdMap.get(row.sourceId);
            if (!mappedSourceId) return null;
            return {
              id: `chk_${randomUUID()}`,
              sourceId: mappedSourceId,
              chunkIndex: row.chunkIndex,
              content: row.content,
              pageStart: row.pageStart,
              pageEnd: row.pageEnd,
              embedding: row.embedding,
              createdAt: now,
            };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row))
      );

      // Defensive clean up for unexpected status carry-over.
      await tx
        .update(sources)
        .set({ status: 'PENDING', errorMessage: null })
        .where(
          and(
            eq(sources.notebookId, forkNotebookId),
            eq(sources.status, 'PROCESSING')
          )
        );
    });

    const [created] = await db.select().from(notebooks).where(eq(notebooks.id, forkNotebookId));
    return NextResponse.json({ notebook: created, forkedFromNotebookId: access.notebook.id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to save notebook to my panel' }, { status: 500 });
  }
}

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { db, eq, notebooks, sources } from 'db';
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

      const clonedSources = originalSources.map((row) => {
        return {
          id: `src_${randomUUID()}`,
          notebookId: forkNotebookId,
          filename: row.filename,
          fileUrl: row.fileUrl,
          mime: row.mime,
          // Keep fork operation fast: don't duplicate all chunk rows in transaction.
          // Let worker rebuild chunks for the forked notebook from original files.
          status: 'PENDING' as const,
          errorMessage: null,
          createdAt: now,
        };
      });
      await tx.insert(sources).values(clonedSources);
    });

    const [created] = await db.select().from(notebooks).where(eq(notebooks.id, forkNotebookId));
    return NextResponse.json({ notebook: created, forkedFromNotebookId: access.notebook.id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to save notebook to my panel' }, { status: 500 });
  }
}

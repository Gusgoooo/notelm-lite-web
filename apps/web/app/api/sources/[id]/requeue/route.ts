import { NextResponse } from 'next/server';
import { db, sources, sourceChunks, eq } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sourceId } = await params;
  try {
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
    if (!source) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }
    const access = await getNotebookAccess(source.notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json({ error: '该 notebook 来源为只读，请先保存为我的 notebook' }, { status: 403 });
    }
    await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, sourceId));
    await db
      .update(sources)
      .set({ status: 'PENDING', errorMessage: null })
      .where(eq(sources.id, sourceId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to requeue' },
      { status: 500 }
    );
  }
}

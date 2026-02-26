import { NextResponse } from 'next/server';
import { db, eq, sources } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'source id is required' }, { status: 400 });
    }
    const [row] = await db.select().from(sources).where(eq(sources.id, id));
    if (!row) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }
    const access = await getNotebookAccess(row.notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json({ error: '该 notebook 来源为只读，请先保存为我的 notebook' }, { status: 403 });
    }
    await db.delete(sources).where(eq(sources.id, id));
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to delete source' },
      { status: 500 }
    );
  }
}

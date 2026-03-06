import { NextResponse } from 'next/server';
import { db, notes, eq, and } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';
import { KNOWLEDGE_DOC_NOTE_TITLE } from '@/lib/knowledge-unit';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: notebookId } = await params;
  try {
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [row] = await db
      .select()
      .from(notes)
      .where(
        and(eq(notes.notebookId, notebookId), eq(notes.title, KNOWLEDGE_DOC_NOTE_TITLE))
      )
      .limit(1);
    return NextResponse.json({
      content: row?.content ?? '',
      id: row?.id ?? null,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to load knowledge document' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: notebookId } = await params;
  try {
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await request.json();
    const content = typeof body?.content === 'string' ? body.content : '';
    const [existing] = await db
      .select()
      .from(notes)
      .where(
        and(eq(notes.notebookId, notebookId), eq(notes.title, KNOWLEDGE_DOC_NOTE_TITLE))
      )
      .limit(1);
    const now = new Date();
    if (existing) {
      await db
        .update(notes)
        .set({ content, updatedAt: now })
        .where(eq(notes.id, existing.id));
      return NextResponse.json({ id: existing.id, content });
    }
    const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await db.insert(notes).values({
      id,
      notebookId,
      title: KNOWLEDGE_DOC_NOTE_TITLE,
      content,
      createdAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ id, content });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to save knowledge document' },
      { status: 500 }
    );
  }
}

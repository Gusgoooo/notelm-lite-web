import { NextResponse } from 'next/server';
import { db, eq, notebooks, notes } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

async function getNoteWithAccess(noteId: string) {
  const [row] = await db
    .select({
      note: notes,
      notebookId: notebooks.id,
    })
    .from(notes)
    .innerJoin(notebooks, eq(notes.notebookId, notebooks.id))
    .where(eq(notes.id, noteId));

  if (!row) {
    return { note: null, access: null } as const;
  }

  const access = await getNotebookAccess(row.notebookId);
  return { note: row.note, access } as const;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { note, access } = await getNoteWithAccess(id);
    if (!note || !access?.notebook) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(note);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to get note' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { note, access } = await getNoteWithAccess(id);
    if (!note || !access?.notebook) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const updates: { title?: string; content?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (typeof body?.title === 'string') updates.title = body.title;
    if (typeof body?.content === 'string') updates.content = body.content;
    await db.update(notes).set(updates).where(eq(notes.id, id));
    const [row] = await db.select().from(notes).where(eq(notes.id, id));
    return NextResponse.json(row ?? { id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { note, access } = await getNoteWithAccess(id);
    if (!note || !access?.notebook) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.delete(notes).where(eq(notes.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 });
  }
}

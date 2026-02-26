import { NextResponse } from 'next/server';
import { and, db, eq, notes } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

type DeletedNoteInput = {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

function normalizeDeletedNotes(value: unknown, notebookId: string): DeletedNoteInput[] {
  if (!Array.isArray(value)) return [];
  const rows: DeletedNoteInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string') continue;
    if (typeof row.title !== 'string') continue;
    if (typeof row.content !== 'string') continue;
    if (typeof row.createdAt !== 'string') continue;
    if (typeof row.updatedAt !== 'string') continue;
    rows.push({
      id: row.id,
      notebookId,
      title: row.title,
      content: row.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  return rows;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId.trim() : '';
    const generatedNoteId =
      typeof body?.generatedNoteId === 'string' ? body.generatedNoteId.trim() : '';
    const deletedNotes = normalizeDeletedNotes(body?.deletedNotes, notebookId);

    if (!notebookId) {
      return NextResponse.json({ error: 'notebookId is required' }, { status: 400 });
    }
    if (!generatedNoteId) {
      return NextResponse.json({ error: 'generatedNoteId is required' }, { status: 400 });
    }
    if (deletedNotes.length === 0) {
      return NextResponse.json({ error: 'deletedNotes is required' }, { status: 400 });
    }

    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await db.transaction(async (tx) => {
      await tx.insert(notes).values(
        deletedNotes.map((row) => ({
          id: row.id,
          notebookId,
          title: row.title,
          content: row.content,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        }))
      );
      await tx
        .delete(notes)
        .where(and(eq(notes.id, generatedNoteId), eq(notes.notebookId, notebookId)));
    });

    return NextResponse.json({ ok: true, restored: deletedNotes.length });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to undo infographic conversion' },
      { status: 500 }
    );
  }
}

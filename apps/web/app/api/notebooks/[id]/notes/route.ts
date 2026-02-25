import { NextResponse } from 'next/server';
import { db, notes, eq, desc } from 'db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: notebookId } = await params;
  try {
    const list = await db
      .select()
      .from(notes)
      .where(eq(notes.notebookId, notebookId))
      .orderBy(desc(notes.updatedAt));
    return NextResponse.json(list);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to list notes' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: notebookId } = await params;
  try {
    const body = await request.json();
    const title =
      typeof body?.title === 'string' && body.title.trim()
        ? body.title.trim()
        : 'Untitled note';
    const content =
      typeof body?.content === 'string' ? body.content : '';
    const id = `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();
    await db.insert(notes).values({
      id,
      notebookId,
      title,
      content,
      createdAt: now,
      updatedAt: now,
    });
    const [row] = await db.select().from(notes).where(eq(notes.id, id));
    return NextResponse.json(row);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to create note' },
      { status: 500 }
    );
  }
}

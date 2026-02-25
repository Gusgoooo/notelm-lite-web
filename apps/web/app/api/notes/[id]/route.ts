import { NextResponse } from 'next/server';
import { db, notes, eq } from 'db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [row] = await db.select().from(notes).where(eq(notes.id, id));
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to get note' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
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
    return NextResponse.json(
      { error: 'Failed to update note' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await db.delete(notes).where(eq(notes.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to delete note' },
      { status: 500 }
    );
  }
}

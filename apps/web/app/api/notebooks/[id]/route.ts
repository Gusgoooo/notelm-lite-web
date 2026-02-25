import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db, notebooks, eq } from 'db';
import { authOptions } from '@/lib/auth';

async function ensureNotebookOwner(notebookId: string) {
  const session = await getServerSession(authOptions);
  const [row] = await db.select().from(notebooks).where(eq(notebooks.id, notebookId));
  if (!row) return { notebook: null, allowed: false };
  const userId = session?.user?.id ?? null;
  const allowed = row.userId === null ? userId === null : row.userId === userId;
  return { notebook: row, allowed };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { notebook, allowed } = await ensureNotebookOwner(id);
    if (!notebook) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(notebook);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to get notebook' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { notebook, allowed } = await ensureNotebookOwner(id);
  if (!notebook) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await request.json();
  const title =
    typeof body?.title === 'string' && body.title.trim()
      ? body.title.trim()
      : undefined;
  if (!title) {
    return NextResponse.json(
      { error: 'title is required' },
      { status: 400 }
    );
  }
  try {
    await db.update(notebooks).set({ title }).where(eq(notebooks.id, id));
    const [updated] = await db.select().from(notebooks).where(eq(notebooks.id, id));
    return NextResponse.json(updated ?? { id, title });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to update notebook' },
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
    const { notebook, allowed } = await ensureNotebookOwner(id);
    if (!notebook) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.delete(notebooks).where(eq(notebooks.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to delete notebook' },
      { status: 500 }
    );
  }
}

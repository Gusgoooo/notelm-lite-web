import { NextResponse } from 'next/server';
import { db, notebooks, eq } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const access = await getNotebookAccess(id);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({
      ...access.notebook,
      isOwner: access.isOwner,
      canEditSources: access.canEditSources,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to get notebook' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await getNotebookAccess(id);
  if (!access.notebook) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!access.isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === 'string' ? body.title.trim() : undefined;
  const description =
    typeof body?.description === 'string' ? body.description.trim().slice(0, 300) : undefined;
  const isPublished = typeof body?.isPublished === 'boolean' ? body.isPublished : undefined;

  if (title !== undefined && !title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const updates: {
    title?: string;
    description?: string;
    isPublished?: boolean;
    publishedAt?: Date | null;
  } = {};

  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (isPublished !== undefined) {
    updates.isPublished = isPublished;
    updates.publishedAt = isPublished ? access.notebook.publishedAt ?? new Date() : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  try {
    await db.update(notebooks).set(updates).where(eq(notebooks.id, id));
    const [updated] = await db.select().from(notebooks).where(eq(notebooks.id, id));
    return NextResponse.json(updated ?? { id, ...updates });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to update notebook' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const access = await getNotebookAccess(id);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!access.isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.delete(notebooks).where(eq(notebooks.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to delete notebook' }, { status: 500 });
  }
}

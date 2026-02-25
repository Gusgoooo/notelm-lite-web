import { NextResponse } from 'next/server';
import { db, eq, sources } from 'db';

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


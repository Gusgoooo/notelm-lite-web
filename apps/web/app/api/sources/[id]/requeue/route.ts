import { NextResponse } from 'next/server';
import { db, sources, eq } from 'db';

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

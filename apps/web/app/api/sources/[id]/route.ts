import { NextResponse } from 'next/server';
import { db, eq, sources } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

function buildContentDisposition(filename: string, mode: 'inline' | 'download'): string {
  const encoded = encodeURIComponent(filename);
  const type = mode === 'inline' ? 'inline' : 'attachment';
  return `${type}; filename*=UTF-8''${encoded}`;
}

export async function GET(
  request: Request,
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
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') === 'inline' ? 'inline' : 'download';
    const upstream = await fetch(row.fileUrl, { cache: 'no-store' });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Failed to fetch source file' }, { status: 502 });
    }

    const headers = new Headers();
    headers.set(
      'Content-Type',
      upstream.headers.get('content-type') || row.mime || 'application/octet-stream'
    );
    headers.set('Content-Disposition', buildContentDisposition(row.filename, mode));
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to fetch source file' },
      { status: 500 }
    );
  }
}

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

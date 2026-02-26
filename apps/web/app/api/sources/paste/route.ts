import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db, sources, eq } from 'db';
import { getStorage } from 'shared';
import { getNotebookAccess } from '@/lib/notebook-access';

function envStorageType(): string {
  const raw = (process.env.STORAGE_TYPE ?? 'filesystem').trim();
  const cleaned =
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1).trim()
      : raw;
  return cleaned.toLowerCase();
}

function buildTitleFromText(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return 'Pasted text';
  return firstLine.slice(0, 48);
}

export async function POST(request: Request) {
  try {
    const storageType = envStorageType();
    if (process.env.NODE_ENV === 'production' && storageType !== 's3') {
      return NextResponse.json(
        { error: '生产环境必须使用 S3 存储（请设置 STORAGE_TYPE=s3）。' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId : '';
    const rawText = typeof body?.text === 'string' ? body.text : '';
    const titleInput = typeof body?.title === 'string' ? body.title : '';
    const text = rawText.replace(/\r\n/g, '\n').trim();
    if (!notebookId) {
      return NextResponse.json({ error: 'notebookId is required' }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    if (text.length < 10) {
      return NextResponse.json({ error: 'text is too short' }, { status: 400 });
    }
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json({ error: '该 notebook 来源为只读，请先保存为我的 notebook' }, { status: 403 });
    }

    const sourceId = `src_${randomUUID()}`;
    const title = (titleInput.trim() || buildTitleFromText(text)).slice(0, 60);
    const filename = `${title}.txt`;
    const key = `${notebookId}/${sourceId}.txt`;

    const storage = getStorage();
    await storage.upload(key, Buffer.from(text, 'utf-8'));

    await db.insert(sources).values({
      id: sourceId,
      notebookId,
      filename,
      fileUrl: key,
      mime: 'text/plain',
      status: 'PENDING',
    });

    const [row] = await db.select().from(sources).where(eq(sources.id, sourceId));
    return NextResponse.json({
      ...row,
      chunkCount: 0,
      sourceType: '复制文本',
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to create source from pasted text' },
      { status: 500 }
    );
  }
}

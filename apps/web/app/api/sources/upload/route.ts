import { NextResponse } from 'next/server';
import { db, sources, eq } from 'db';
import { getStorage } from 'shared';
import { randomUUID } from 'crypto';
import { getNotebookAccess } from '@/lib/notebook-access';

function resolveMimeType(file: File, ext: string): string {
  const declared = (file.type || '').toLowerCase().trim();
  if (declared) return declared;
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'py') return 'text/x-python';
  if (ext === 'txt' || ext === 'md') return 'text/plain';
  return 'application/octet-stream';
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const notebookId = formData.get('notebookId');
    const file = formData.get('file') as File | null;
    if (!notebookId || typeof notebookId !== 'string') {
      return NextResponse.json(
        { error: 'notebookId is required' },
        { status: 400 }
      );
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'file is required' },
        { status: 400 }
      );
    }
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json({ error: '该 notebook 来源为只读，请先保存为我的 notebook' }, { status: 403 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name || 'document.pdf';
    const sourceId = `src_${randomUUID()}`;
    const ext = filename.split('.').pop()?.toLowerCase() || 'pdf';
    const mime = resolveMimeType(file, ext);
    const key = `${notebookId}/${sourceId}.${ext}`;
    const storage = getStorage();
    await storage.upload(key, buffer);
    await db.insert(sources).values({
      id: sourceId,
      notebookId,
      filename,
      fileUrl: key,
      mime,
      status: 'PENDING',
    });
    const [row] = await db.select().from(sources).where(eq(sources.id, sourceId));
    return NextResponse.json(row);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to upload and create source' },
      { status: 500 }
    );
  }
}

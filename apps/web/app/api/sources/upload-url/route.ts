import { NextResponse } from 'next/server';
import { getStorage } from 'shared';
import { randomUUID } from 'crypto';
import { getNotebookAccess } from '@/lib/notebook-access';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const notebookId = body?.notebookId;
    const filename = body?.filename ?? 'document.pdf';
    const mimeType = body?.mimeType ?? 'application/pdf';
    if (!notebookId || typeof notebookId !== 'string') {
      return NextResponse.json(
        { error: 'notebookId is required' },
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
    const sourceId = `src_${randomUUID()}`;
    const ext = filename.split('.').pop()?.toLowerCase() || 'pdf';
    const key = `${notebookId}/${sourceId}.${ext}`;
    const storage = getStorage();
    const uploadUrl = await storage.getUploadUrl(key);
    const fileUrl = key;
    return NextResponse.json({
      uploadUrl,
      sourceId,
      fileUrl,
      mimeType,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to get upload URL' },
      { status: 500 }
    );
  }
}

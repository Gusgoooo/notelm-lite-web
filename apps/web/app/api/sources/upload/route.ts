import { NextResponse } from 'next/server';
import { db, sources, eq } from 'db';
import { getStorage } from 'shared';
import { randomUUID } from 'crypto';

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
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name || 'document.pdf';
    const sourceId = `src_${randomUUID()}`;
    const ext = filename.split('.').pop()?.toLowerCase() || 'pdf';
    const key = `${notebookId}/${sourceId}.${ext}`;
    const storage = getStorage();
    await storage.upload(key, buffer);
    await db.insert(sources).values({
      id: sourceId,
      notebookId,
      filename,
      fileUrl: key,
      mime: file.type || 'application/pdf',
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

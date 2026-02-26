import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { db, scriptJobs, eq } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId.trim() : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    const input =
      body?.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? (body.input as Record<string, unknown>)
        : {};

    if (!notebookId) {
      return NextResponse.json({ error: 'notebookId is required' }, { status: 400 });
    }
    if (!code.trim()) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }
    if (code.length > 30_000) {
      return NextResponse.json({ error: 'code is too long (max 30000 chars)' }, { status: 400 });
    }

    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.userId) {
      return NextResponse.json({ error: 'Please login first' }, { status: 401 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const timeoutMs = Math.min(60_000, Math.max(1_000, parsePositiveInt(body?.timeoutMs, 10_000)));
    const memoryLimitMb = Math.min(1_024, Math.max(64, parsePositiveInt(body?.memoryLimitMb, 256)));
    const jobId = `job_${randomUUID()}`;
    const now = new Date();

    await db.insert(scriptJobs).values({
      id: jobId,
      userId: access.userId,
      notebookId,
      code,
      input,
      status: 'PENDING',
      timeoutMs,
      memoryLimitMb,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await db.select().from(scriptJobs).where(eq(scriptJobs.id, jobId));
    return NextResponse.json(row);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to create script job' }, { status: 500 });
  }
}

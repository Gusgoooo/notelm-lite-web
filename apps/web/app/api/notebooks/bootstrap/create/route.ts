import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db, notebooks, eq } from 'db';
import { authOptions } from '@/lib/auth';
import { saveResearchState } from '@/lib/research-state';
import { ingestWebSources, searchWebViaOpenRouter } from '@/lib/web-research';

function normalizeTopic(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 160);
}

function normalizeNotebookId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function buildNotebookTitle(topic: string): string {
  const clean = topic.replace(/\s+/g, ' ').trim();
  if (!clean) return '研究课题';
  return `${clean.slice(0, 36)} · 研究`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const topic = normalizeTopic(body?.topic);
    const requestedNotebookId = normalizeNotebookId(body?.notebookId);
    if (!topic) {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? null;
    const targetSourceCount = 15;

    const fetched = await searchWebViaOpenRouter({
      topic,
      limit: targetSourceCount,
    });

    if (request.signal.aborted) {
      return NextResponse.json({ error: 'Request aborted' }, { status: 499 });
    }

    const now = new Date();
    let notebookId = requestedNotebookId;

    if (notebookId) {
      const [existing] = await db.select().from(notebooks).where(eq(notebooks.id, notebookId)).limit(1);
      if (!existing) {
        return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
      }
      const canWrite =
        existing.userId === userId || (existing.userId == null && userId == null);
      if (!canWrite) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else {
      notebookId = `nb_${randomUUID()}`;
      await db.insert(notebooks).values({
        id: notebookId,
        userId,
        title: buildNotebookTitle(topic),
        description: '',
        isPublished: false,
        publishedAt: null,
        createdAt: now,
      });
    }

    await saveResearchState({
      notebookId,
      state: {
        topic,
        phase: 'collecting',
        directions: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    });

    if (request.signal.aborted) {
      await db.delete(notebooks).where(eq(notebooks.id, notebookId));
      return NextResponse.json({ error: 'Request aborted' }, { status: 499 });
    }

    const ingest = await ingestWebSources({
      notebookId,
      topic,
      fetched,
      limit: targetSourceCount,
    });

    if (request.signal.aborted) {
      await db.delete(notebooks).where(eq(notebooks.id, notebookId));
      return NextResponse.json({ error: 'Request aborted' }, { status: 499 });
    }

    await saveResearchState({
      notebookId,
      state: {
        topic,
        phase: 'ready',
        directions: [],
        starterQuestions: [],
        sourceStats: {
          totalBefore: 0,
          totalAfter: ingest.added,
        },
        createdAt: now.toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const [notebook] = await db.select().from(notebooks).where(eq(notebooks.id, notebookId));

    return NextResponse.json({
      notebookId,
      notebook,
      sourceStats: {
        added: ingest.added,
        skipped: ingest.skipped,
        target: targetSourceCount,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initialize notebook' },
      { status: 500 }
    );
  }
}

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db, notebooks, eq } from 'db';
import { authOptions } from '@/lib/auth';
import { saveResearchState } from '@/lib/research-state';
import { getAdaptiveWebSourceCount, ingestWebSources, searchWebViaOpenRouter } from '@/lib/web-research';

function normalizeTopic(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 160);
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
    if (!topic) {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? null;
    const targetSourceCount = getAdaptiveWebSourceCount(topic);

    const fetched = await searchWebViaOpenRouter({
      topic,
      limit: targetSourceCount,
    });

    if (request.signal.aborted) {
      return NextResponse.json({ error: 'Request aborted' }, { status: 499 });
    }

    const notebookId = `nb_${randomUUID()}`;
    const now = new Date();

    await db.insert(notebooks).values({
      id: notebookId,
      userId,
      title: buildNotebookTitle(topic),
      description: '',
      isPublished: false,
      publishedAt: null,
      createdAt: now,
    });

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
        phase: 'analyzing',
        directions: [],
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

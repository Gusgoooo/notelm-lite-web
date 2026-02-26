import { NextResponse } from 'next/server';
import { and, conversations, db, desc, eq, inArray, messages } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

export const dynamic = 'force-dynamic';

type Citation = {
  sourceId: string;
  sourceTitle: string;
  pageStart?: number;
  pageEnd?: number;
  snippet: string;
  refNumber?: number;
  score?: number;
  distance?: number;
};

function normalizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  const out: Citation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.sourceId !== 'string') continue;
    if (typeof row.sourceTitle !== 'string') continue;
    if (typeof row.snippet !== 'string') continue;
    out.push({
      sourceId: row.sourceId,
      sourceTitle: row.sourceTitle,
      snippet: row.snippet,
      pageStart: typeof row.pageStart === 'number' ? row.pageStart : undefined,
      pageEnd: typeof row.pageEnd === 'number' ? row.pageEnd : undefined,
      refNumber: typeof row.refNumber === 'number' ? row.refNumber : undefined,
      score: typeof row.score === 'number' ? row.score : undefined,
      distance: typeof row.distance === 'number' ? row.distance : undefined,
    });
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const notebookId = searchParams.get('notebookId')?.trim() ?? '';
    const pageRaw = searchParams.get('page') ?? '0';
    const pageSizeRaw = searchParams.get('pageSize') ?? '20';
    const page = Math.max(0, Number.parseInt(pageRaw, 10) || 0);
    const pageSize = Math.min(50, Math.max(10, Number.parseInt(pageSizeRaw, 10) || 20));

    if (!notebookId) {
      return NextResponse.json({ error: 'notebookId is required' }, { status: 400 });
    }
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        citations: messages.citations,
        createdAt: messages.createdAt,
        conversationId: messages.conversationId,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.notebookId, notebookId),
          inArray(messages.role, ['user', 'assistant'])
        )
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(pageSize + 1)
      .offset(page * pageSize);

    const hasMore = rows.length > pageSize;
    const sliced = hasMore ? rows.slice(0, pageSize) : rows;
    const latestConversationId = page === 0 && sliced.length > 0 ? sliced[0].conversationId : null;

    return NextResponse.json({
      page,
      pageSize,
      hasMore,
      latestConversationId,
      messages: sliced.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        citations: normalizeCitations(row.citations),
        createdAt: row.createdAt,
        conversationId: row.conversationId,
      })),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load chat history' },
      { status: 500 }
    );
  }
}

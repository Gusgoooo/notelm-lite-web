import { NextResponse } from 'next/server';
import { db, conversations, messages, sourceChunks, sources, eq, and, cosineDistance } from 'db';
import { createEmbeddings, chat } from 'shared';
import { randomUUID } from 'crypto';
import { getNotebookAccess } from '@/lib/notebook-access';

const TOP_K = 8;
const PER_SOURCE_CAP = 4;
const CANDIDATE_LIMIT = 240;
let envLogged = false;

function cleanEnv(v: string | undefined): string {
  if (!v) return '';
  const t = v.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export async function POST(request: Request) {
  try {
    if (!envLogged) {
      envLogged = true;
      const provider = cleanEnv(process.env.EMBEDDING_PROVIDER);
      const openrouterKeyLen = cleanEnv(process.env.OPENROUTER_API_KEY).length;
      const openaiKeyLen = cleanEnv(process.env.OPENAI_API_KEY).length;
      console.log(
        `Web chat env check: EMBEDDING_PROVIDER=${provider || '<unset>'}, OPENROUTER_API_KEY_LEN=${openrouterKeyLen}, OPENAI_API_KEY_LEN=${openaiKeyLen}`
      );
    }

    const body = await request.json();
    const { notebookId, conversationId: bodyConvId, userMessage } = body ?? {};
    if (!notebookId || typeof userMessage !== 'string' || !userMessage.trim()) {
      return NextResponse.json(
        { error: 'notebookId and userMessage are required' },
        { status: 400 }
      );
    }
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const notebookSources = await db
      .select({
        id: sources.id,
        status: sources.status,
        errorMessage: sources.errorMessage,
      })
      .from(sources)
      .where(eq(sources.notebookId, notebookId));
    const hasReadySource = notebookSources.some((s) => s.status === 'READY');
    if (!hasReadySource) {
      if (notebookSources.length === 0) {
        return NextResponse.json(
          { error: 'No sources found. Upload a PDF or Word document first.' },
          { status: 400 }
        );
      }
      if (notebookSources.some((s) => s.status === 'PENDING' || s.status === 'PROCESSING')) {
        return NextResponse.json(
          { error: 'Sources are still processing. Start worker and retry after status becomes READY.' },
          { status: 409 }
        );
      }
      const failed = notebookSources.find((s) => s.status === 'FAILED');
      return NextResponse.json(
        {
          error: failed?.errorMessage
            ? `Source processing failed: ${failed.errorMessage}`
            : 'No READY sources available for this notebook.',
        },
        { status: 409 }
      );
    }

    let conversationId = bodyConvId;
    const history: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];
    if (conversationId) {
      const [conv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.notebookId, notebookId)));
      if (!conv) {
        conversationId = undefined;
      } else {
        const existing = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(messages.createdAt);
        for (const m of existing) {
          if (m.role !== 'system') history.push({ role: m.role as 'user' | 'assistant', content: m.content });
        }
      }
    }
    if (!conversationId) {
      conversationId = `conv_${randomUUID()}`;
      await db.insert(conversations).values({
        id: conversationId,
        notebookId,
      });
    }
    const [queryEmbedding] = await createEmbeddings([userMessage.trim()]);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return NextResponse.json(
        { error: 'Failed to embed query' },
        { status: 500 }
      );
    }
    const chunksWithSource = await db
      .select({
        chunkId: sourceChunks.id,
        content: sourceChunks.content,
        pageStart: sourceChunks.pageStart,
        pageEnd: sourceChunks.pageEnd,
        sourceId: sourceChunks.sourceId,
        filename: sources.filename,
        distance: cosineDistance(sourceChunks.embedding, queryEmbedding),
      })
      .from(sourceChunks)
      .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
      .where(and(eq(sources.notebookId, notebookId), eq(sources.status, 'READY')))
      .orderBy(cosineDistance(sourceChunks.embedding, queryEmbedding))
      .limit(CANDIDATE_LIMIT);

    const sourceCount = new Map<string, number>();
    const selected: typeof chunksWithSource = [];
    const selectedChunkIds = new Set<string>();
    const bySource = new Map<string, Array<(typeof chunksWithSource)[number]>>();
    for (const row of chunksWithSource) {
      const list = bySource.get(row.sourceId) ?? [];
      list.push(row);
      bySource.set(row.sourceId, list);
    }

    // Prefer source diversity first: take top-1 chunk per source from global candidates.
    for (const list of Array.from(bySource.values())) {
      if (selected.length >= TOP_K) break;
      const row = list[0];
      if (!row || selectedChunkIds.has(row.chunkId)) continue;
      selected.push(row);
      selectedChunkIds.add(row.chunkId);
      sourceCount.set(row.sourceId, 1);
    }

    // Fallback: if some READY sources still absent (e.g., not in top candidate window), probe top-1 per missing source.
    if (selected.length < TOP_K) {
      const readySourceIds = notebookSources
        .filter((s) => s.status === 'READY')
        .map((s) => s.id);
      for (const sourceId of readySourceIds) {
        if (selected.length >= TOP_K) break;
        if (sourceCount.has(sourceId)) continue;
        const [row] = await db
          .select({
            chunkId: sourceChunks.id,
            content: sourceChunks.content,
            pageStart: sourceChunks.pageStart,
            pageEnd: sourceChunks.pageEnd,
            sourceId: sourceChunks.sourceId,
            filename: sources.filename,
            distance: cosineDistance(sourceChunks.embedding, queryEmbedding),
          })
          .from(sourceChunks)
          .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
          .where(and(eq(sourceChunks.sourceId, sourceId), eq(sources.status, 'READY')))
          .orderBy(cosineDistance(sourceChunks.embedding, queryEmbedding))
          .limit(1);
        if (!row || selectedChunkIds.has(row.chunkId)) continue;
        selected.push(row);
        selectedChunkIds.add(row.chunkId);
        sourceCount.set(row.sourceId, 1);
      }
    }

    // Fill remaining slots by global relevance, with per-source cap.
    for (const row of chunksWithSource) {
      if (selected.length >= TOP_K) break;
      if (selectedChunkIds.has(row.chunkId)) continue;
      const n = sourceCount.get(row.sourceId) ?? 0;
      if (n >= PER_SOURCE_CAP) continue;
      selected.push(row);
      selectedChunkIds.add(row.chunkId);
      sourceCount.set(row.sourceId, n + 1);
    }
    const contextParts = selected.map(
      (r, i) =>
        `[${i + 1}] (Source: ${r.filename}${r.pageStart != null ? `, p.${r.pageStart}${r.pageEnd != null && r.pageEnd !== r.pageStart ? `-${r.pageEnd}` : ''}` : ''})\n${r.content}`
    );
    const context = contextParts.join('\n\n');
    const systemPrompt = `You are a helpful assistant. Answer based only on the following sources. Always cite the source number in brackets (e.g. [1]) when you use information from it. If the user question cannot be answered from the sources, say so.`;
    const userPrompt = `Sources:\n${context}\n\nUser question: ${userMessage.trim()}`;
    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userPrompt },
    ];
    const { content: answer } = await chat(chatMessages);
    const citationsForClient = selected.map((r) => {
      const dist =
        typeof r.distance === 'number'
          ? r.distance
          : typeof r.distance === 'string'
            ? Number(r.distance)
            : undefined;
      const score = dist != null && !Number.isNaN(dist) ? 1 - dist : undefined;
      return {
        sourceId: r.sourceId,
        sourceTitle: r.filename,
        pageStart: r.pageStart ?? undefined,
        pageEnd: r.pageEnd ?? undefined,
        snippet: r.content.slice(0, 200) + (r.content.length > 200 ? '…' : ''),
        fullContent: r.content,
        score,
        distance: dist,
      };
    });
    const citationsForDb = citationsForClient.map(
      ({ sourceId, sourceTitle, pageStart, pageEnd, snippet, score, distance }) => ({
        sourceId,
        sourceTitle,
        pageStart,
        pageEnd,
        snippet,
        score,
        distance,
      })
    );
    const userMsgId = `msg_${randomUUID()}`;
    const assistantMsgId = `msg_${randomUUID()}`;
    await db.insert(messages).values([
      {
        id: userMsgId,
        conversationId: conversationId!,
        role: 'user',
        content: userMessage.trim(),
      },
      {
        id: assistantMsgId,
        conversationId: conversationId!,
        role: 'assistant',
        content: answer,
        citations: citationsForDb,
      },
    ]);
    return NextResponse.json({
      answer,
      citations: citationsForClient,
      conversationId,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Chat failed' },
      { status: 500 }
    );
  }
}

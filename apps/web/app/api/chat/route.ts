import { NextResponse } from 'next/server';
import {
  db,
  conversations,
  messages,
  sourceChunks,
  sources,
  scriptJobs,
  eq,
  and,
  desc,
  inArray,
  cosineDistance,
} from 'db';
import { createEmbeddings, chat } from 'shared';
import { randomUUID } from 'crypto';
import { getNotebookAccess } from '@/lib/notebook-access';

const TOP_K = 8;
const PER_SOURCE_CAP = 4;
const CANDIDATE_LIMIT = 240;
const CHAT_SCRIPT_SOURCE_LIMIT = Math.max(
  1,
  Math.min(3, Number.parseInt(process.env.CHAT_SCRIPT_SOURCE_LIMIT ?? '2', 10) || 2)
);
const CHAT_SCRIPT_WAIT_MS = Math.max(
  1500,
  Math.min(20_000, Number.parseInt(process.env.CHAT_SCRIPT_WAIT_MS ?? '7000', 10) || 7000)
);
const CHAT_SCRIPT_POLL_MS = Math.max(
  200,
  Math.min(1000, Number.parseInt(process.env.CHAT_SCRIPT_POLL_MS ?? '350', 10) || 350)
);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPythonSource(filename: string, mime: string | null): boolean {
  const lowerName = filename.toLowerCase();
  const lowerMime = (mime ?? '').toLowerCase();
  return (
    lowerName.endsWith('.py') ||
    lowerMime.includes('text/x-python') ||
    lowerMime.includes('application/x-python-code')
  );
}

function isSkillPackageSource(filename: string, mime: string | null): boolean {
  const lowerName = filename.toLowerCase();
  const lowerMime = (mime ?? '').toLowerCase();
  return (
    lowerName.endsWith('.zip') ||
    lowerMime.includes('application/zip') ||
    lowerMime.includes('application/x-zip-compressed')
  );
}

function shouldUseSkillPlanningTemplate(userMessage: string): boolean {
  const text = userMessage.toLowerCase();
  return /技能包|skill|agent|短视频|视频|创作|生成|规划|计划|方案|workflow|流程|prompt|脚本|实现/.test(text);
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
        filename: sources.filename,
        mime: sources.mime,
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
    const readyPythonSources = notebookSources.filter(
      (s) => s.status === 'READY' && isPythonSource(s.filename, s.mime ?? null)
    );
    const pythonSourceIdSet = new Set(readyPythonSources.map((s) => s.id));
    const readySkillSources = notebookSources.filter(
      (s) => s.status === 'READY' && isSkillPackageSource(s.filename, s.mime ?? null)
    );
    const skillSourceIdSet = new Set(readySkillSources.map((s) => s.id));

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
    const usableChunks = chunksWithSource.filter((row) => !pythonSourceIdSet.has(row.sourceId));

    const sourceCount = new Map<string, number>();
    const selected: typeof usableChunks = [];
    const selectedChunkIds = new Set<string>();
    const bySource = new Map<string, Array<(typeof usableChunks)[number]>>();
    for (const row of usableChunks) {
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
        .filter((s) => s.status === 'READY' && !pythonSourceIdSet.has(s.id))
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
    for (const row of usableChunks) {
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

    let realtimeScriptOutputs: Array<{
      id: string;
      output: unknown;
      finishedAt: Date | null;
    }> = [];
    if (readyPythonSources.length > 0) {
      try {
        const scriptUserId = access.userId ?? access.notebook?.userId ?? null;
        if (scriptUserId) {
          const contextSnippets = selected.slice(0, 24).map((row) => ({
            sourceId: row.sourceId,
            sourceTitle: row.filename,
            pageStart: row.pageStart ?? undefined,
            pageEnd: row.pageEnd ?? undefined,
            content: row.content.slice(0, 1200),
          }));
          const createdJobIds: string[] = [];
          for (const scriptSource of readyPythonSources.slice(0, CHAT_SCRIPT_SOURCE_LIMIT)) {
            const scriptRows = await db
              .select({ content: sourceChunks.content })
              .from(sourceChunks)
              .where(eq(sourceChunks.sourceId, scriptSource.id))
              .orderBy(sourceChunks.chunkIndex);
            const scriptCode = scriptRows.map((r) => r.content).join('\n').trim();
            if (!scriptCode) continue;

            const jobId = `job_${randomUUID()}`;
            const now = new Date();
            await db.insert(scriptJobs).values({
              id: jobId,
              userId: scriptUserId,
              notebookId,
              code: scriptCode,
              input: {
                __meta: {
                  mode: 'chat-realtime-script',
                  scriptSourceId: scriptSource.id,
                  conversationId,
                  askedAt: now.toISOString(),
                },
                notebookId,
                conversationId,
                question: userMessage.trim(),
                sources: contextSnippets,
              },
              status: 'PENDING',
              timeoutMs: 12_000,
              memoryLimitMb: 256,
              createdAt: now,
              updatedAt: now,
            });
            createdJobIds.push(jobId);
          }

          if (createdJobIds.length > 0) {
            const deadline = Date.now() + CHAT_SCRIPT_WAIT_MS;
            let rows: Array<{
              id: string;
              status: string;
              output: unknown;
              finishedAt: Date | null;
            }> = [];
            do {
              rows = await db
                .select({
                  id: scriptJobs.id,
                  status: scriptJobs.status,
                  output: scriptJobs.output,
                  finishedAt: scriptJobs.finishedAt,
                })
                .from(scriptJobs)
                .where(inArray(scriptJobs.id, createdJobIds));

              if (
                rows.length > 0 &&
                rows.every((row) => row.status === 'SUCCEEDED' || row.status === 'FAILED')
              ) {
                break;
              }
              if (Date.now() >= deadline) break;
              await sleep(CHAT_SCRIPT_POLL_MS);
            } while (Date.now() < deadline);

            realtimeScriptOutputs = rows
              .filter((row) => row.status === 'SUCCEEDED')
              .map((row) => ({
                id: row.id,
                output: row.output,
                finishedAt: row.finishedAt,
              }));
          }
        }
      } catch (error) {
        const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
          ?? (error as { code?: string })?.code;
        if (code !== '42P01') throw error;
        console.warn('script_jobs table not found in chat route, skip realtime script execution');
      }
    }

    let scriptOutputs: Array<{
      id: string;
      output: unknown;
      finishedAt: Date | null;
    }> = [];
    try {
      scriptOutputs = await db
        .select({
          id: scriptJobs.id,
          output: scriptJobs.output,
          finishedAt: scriptJobs.finishedAt,
        })
        .from(scriptJobs)
        .where(and(eq(scriptJobs.notebookId, notebookId), eq(scriptJobs.status, 'SUCCEEDED')))
        .orderBy(desc(scriptJobs.finishedAt), desc(scriptJobs.createdAt))
        .limit(3);
    } catch (error) {
      const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
        ?? (error as { code?: string })?.code;
      if (code !== '42P01') throw error;
      console.warn('script_jobs table not found in chat route, skip script insights');
    }
    const realtimeIds = new Set(realtimeScriptOutputs.map((row) => row.id));
    scriptOutputs = [...realtimeScriptOutputs, ...scriptOutputs.filter((row) => !realtimeIds.has(row.id))]
      .slice(0, 3);

    const scriptInsights = scriptOutputs.map((row, idx) => {
      const output = row.output as Record<string, unknown> | null;
      const result = output?.result ?? output ?? {};
      let rendered: string;
      try {
        rendered = JSON.stringify(result, null, 2);
      } catch {
        rendered = String(result);
      }
      const truncated = rendered.length > 4000 ? `${rendered.slice(0, 4000)}\n...` : rendered;
      return `[S${idx + 1}] script_job=${row.id}\n${truncated}`;
    });

    const context = contextParts.length > 0 ? contextParts.join('\n\n') : '(none)';
    const scriptContext = scriptInsights.join('\n\n');
    const hasSkillContext = selected.some((row) => skillSourceIdSet.has(row.sourceId));
    const useSkillPlanningTemplate =
      readySkillSources.length > 0 &&
      (hasSkillContext || shouldUseSkillPlanningTemplate(userMessage.trim()));
    const skillTemplateRule = useSkillPlanningTemplate
      ? `\nWhen the user asks for creation/planning tasks, structure your answer with these exact sections:\n1) 需求分析\n2) 实现方式决策\n3) Skill 定位\n4) 更新计划\nIn "更新计划", provide concrete next actions and avoid fake shell output.`
      : '';
    const systemPrompt = `You are a helpful assistant. Answer based only on the provided sources and script insights. Always cite source numbers like [1] when using source chunks. If script insights are used, explicitly mention "脚本分析" in your answer. If the question cannot be answered from provided context, say so.${skillTemplateRule}`;
    const userPrompt = `Sources:\n${context}\n\nScript Insights:\n${scriptContext || '(none)'}\n\nUser question: ${userMessage.trim()}`;
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

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

const BUILTIN_PAPER_STATS_SCRIPT = `
import re
from collections import Counter

def normalize_text(value):
    if not isinstance(value, str):
        return ""
    return value.replace("\\n", " ").strip()

def top_terms(texts, stopwords, limit=12):
    counter = Counter()
    for text in texts:
        words = re.findall(r"[A-Za-z][A-Za-z\\-]{2,}|[\\u4e00-\\u9fff]{2,8}", text)
        for w in words:
            lw = w.lower()
            if lw in stopwords:
                continue
            counter[lw] += 1
    return [{"term": k, "count": v} for k, v in counter.most_common(limit)]

def count_method_mentions(texts):
    patterns = {
        "定量研究": [r"定量", r"回归", r"模型", r"量化"],
        "定性研究": [r"定性", r"访谈", r"案例研究"],
        "实验研究": [r"实验", r"随机对照", r"干预"],
        "机器学习": [r"机器学习", r"深度学习", r"神经网络", r"llm", r"大模型"],
    }
    out = {}
    all_text = "\\n".join(texts)
    for key, keys in patterns.items():
        out[key] = sum(1 for p in keys if re.search(p, all_text, re.IGNORECASE))
    return out

def main(input_data):
    sources = input_data.get("sources") if isinstance(input_data, dict) else []
    texts = []
    for item in sources if isinstance(sources, list) else []:
        if isinstance(item, dict):
            texts.append(normalize_text(item.get("content")))
    texts = [t for t in texts if t]
    if not texts:
        return {"error": "no_texts"}

    stopwords = {
        "研究","分析","方法","结果","影响","基于","通过","进行","模型","数据","本文",
        "一个","以及","相关","问题","under","with","from","that","this","using","into"
    }
    terms = top_terms(texts, stopwords, limit=12)
    methods = count_method_mentions(texts)
    summary = {
        "source_count": len(texts),
        "top_terms": terms,
        "method_mentions": methods,
    }
    return summary

TOOL_OUTPUT = main(TOOL_INPUT)
`;
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

function sanitizeSkillAnswer(answer: string, allowScriptExecution: boolean): string {
  let text = answer;
  if (!allowScriptExecution) {
    text = text
      .replace(/^\s*(python3?|bash|sh|node|pnpm|npm|yarn)\b.*$/gim, '')
      .replace(/^.*脚本分析流程.*$/gim, '')
      .replace(/^.*运行.*脚本.*$/gim, '')
      .replace(/^.*执行.*命令.*$/gim, '');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function extractCitationNumbers(answer: string, max: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const re = /\[(\d{1,3})]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const n = Number.parseInt(m[1], 10);
    if (!Number.isFinite(n)) continue;
    if (n < 1 || n > max) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function shouldRunBuiltinPaperStats(question: string): boolean {
  return /知识库论文对比洞察|频繁研究|研究空白|方法争议|变量被反复验证/i.test(question);
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

    const persistAndRespond = async (
      answer: string,
      citationsForDb: Array<{
        sourceId: string;
        sourceTitle: string;
        pageStart?: number;
        pageEnd?: number;
        snippet: string;
        refNumber?: number;
        score?: number;
        distance?: number;
      }> = [],
      citationsForClient: Array<{
        sourceId: string;
        sourceTitle: string;
        pageStart?: number;
        pageEnd?: number;
        snippet: string;
        fullContent?: string;
        score?: number;
        distance?: number;
      }> = []
    ) => {
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
    };

    let skillContext = '';
    let detectedSkillName = '';
    const readySkillSourceIds = readySkillSources.map((s) => s.id);
    if (readySkillSourceIds.length > 0) {
      const skillRows = await db
        .select({
          content: sourceChunks.content,
          filename: sources.filename,
        })
        .from(sourceChunks)
        .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
        .where(inArray(sourceChunks.sourceId, readySkillSourceIds))
        .orderBy(sources.createdAt, sourceChunks.chunkIndex)
        .limit(260);
      skillContext = skillRows
        .map((row) => row.content)
        .join('\n')
        .slice(0, 80_000);
      const nameInFrontMatter = skillContext.match(/^name:\s*([a-zA-Z0-9_-]+)/m)?.[1] ?? '';
      detectedSkillName = nameInFrontMatter || (skillContext.match(/^#\s+(.+)$/m)?.[1] ?? '');
    }
    const trimmedUserMessage = userMessage.trim();
    const isViralSkill =
      readySkillSources.length > 0 &&
      /viral-video-copywriting|爆款短视频文案创作/i.test(`${detectedSkillName}\n${skillContext}`);

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
    const needBuiltinPaperStats = shouldRunBuiltinPaperStats(userMessage.trim());
    if (readyPythonSources.length > 0 || needBuiltinPaperStats) {
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
          if (needBuiltinPaperStats) {
            const jobId = `job_${randomUUID()}`;
            const now = new Date();
            await db.insert(scriptJobs).values({
              id: jobId,
              userId: scriptUserId,
              notebookId,
              code: BUILTIN_PAPER_STATS_SCRIPT,
              input: {
                __meta: {
                  mode: 'builtin-paper-stats',
                  conversationId,
                  askedAt: now.toISOString(),
                },
                notebookId,
                conversationId,
                question: userMessage.trim(),
                sources: contextSnippets,
              },
              status: 'PENDING',
              timeoutMs: 10_000,
              memoryLimitMb: 256,
              createdAt: now,
              updatedAt: now,
            });
            createdJobIds.push(jobId);
          }
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
    const useDirectViralScript =
      isViralSkill &&
      /(短视频|视频脚本|分镜|vibecoding|爆款|口播|画面|镜头|节奏|钩子)/i.test(trimmedUserMessage);
    const useSkillPlanningTemplate =
      readySkillSources.length > 0 &&
      !useDirectViralScript &&
      (hasSkillContext || shouldUseSkillPlanningTemplate(userMessage.trim()));
    const hasScriptCapability = readyPythonSources.length > 0 || needBuiltinPaperStats;
    const skillExecutionRule = hasScriptCapability
      ? `You may reference "脚本分析" only as an optional capability. If mentioning scripts, describe expected outputs in plain Chinese, never output shell commands.`
      : `No executable script capability is available in this notebook. Do not output script-running advice, terminal commands, or pseudo execution steps.`;
    const skillTemplateRule = useSkillPlanningTemplate
      ? `\nWhen the user asks for creation/planning tasks, structure your answer with these exact sections in Chinese markdown:\n## 需求分析\n## 实现方式决策\n## Skill 定位\n## 更新计划\nRequirements:\n- Keep each section concise and actionable (2-5 bullets).\n- "更新计划" must be product actions, not shell commands.\n- If assumptions are needed, list them as "待确认".\n- Avoid filler, percentages without evidence, and avoid repeating source text verbatim.\n${skillExecutionRule}`
      : '';
    const viralSkillRule = useDirectViralScript
      ? `\nViral-video-copywriting skill is active. Produce a complete, production-ready Chinese short-video script in one response. Do NOT ask users to choose options.\nOutput sections exactly:\n1) 标题\n2) 时长与受众定位\n3) 完整脚本（按秒段：开场/发展/高潮/结尾，每段含画面、字幕/旁白、音效）\n4) 视觉风格建议（配色/镜头/字幕）\n5) 音乐与音效建议\n6) 互动设计（评论区引导）\n7) 可直接拍摄的执行清单\nConstraints:\n- Content must be original, not copied from source text.\n- Include strong contrast, humor, and clear CTA.\n- No shell commands, no pseudo tool-execution steps.`
      : '';
    const systemPrompt = `You are a helpful assistant. Unless the user explicitly requests another language, always answer in Simplified Chinese. Answer based only on the provided sources and script insights. Always cite source numbers like [1] when using source chunks. If script insights are used, explicitly mention "脚本分析" in your answer. If the question cannot be answered from provided context, say so.${skillTemplateRule}${viralSkillRule}`;
    const userPrompt = `Sources:\n${context}\n\nScript Insights:\n${scriptContext || '(none)'}\n\nUser question: ${userMessage.trim()}`;
    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userPrompt },
    ];
    const { content: rawAnswer } = await chat(chatMessages);
    const answer = useSkillPlanningTemplate
      ? sanitizeSkillAnswer(rawAnswer, hasScriptCapability)
      : rawAnswer;
    const citedNumbers = extractCitationNumbers(answer, selected.length);
    const rowsForCitations =
      citedNumbers.length > 0
        ? citedNumbers
            .map((n) => ({ row: selected[n - 1], refNumber: n }))
            .filter((item) => Boolean(item.row))
        : selected.map((row, idx) => ({ row, refNumber: idx + 1 }));
    const citationsForClient = rowsForCitations.map(({ row: r, refNumber }) => {
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
        refNumber,
        score,
        distance: dist,
      };
    });
    const citationsForDb = citationsForClient.map(
      ({ sourceId, sourceTitle, pageStart, pageEnd, snippet, refNumber, score, distance }) => ({
        sourceId,
        sourceTitle,
        pageStart,
        pageEnd,
        snippet,
        refNumber,
        score,
        distance,
      })
    );
    return persistAndRespond(answer, citationsForDb, citationsForClient);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Chat failed' },
      { status: 500 }
    );
  }
}

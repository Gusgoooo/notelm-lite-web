import { NextResponse } from 'next/server';
import {
  db,
  conversations,
  messages,
  notes,
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
import {
  getDefaultKnowledgeDocScenarioState,
  normalizeKnowledgeDocScenarioState,
  resolveKnowledgeDocScenario,
  type KnowledgeDocScenario,
} from '@/lib/knowledge-doc-scenarios';
import { detectAssistantMode, detectEditApplyMode, type AssistantMode, type EditApplyMode } from '@/lib/assistant-mode';
import { getNotebookAccess } from '@/lib/notebook-access';
import {
  KNOWLEDGE_DOC_NOTE_TITLE,
  KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE,
} from '@/lib/knowledge-unit';
import { getLatestResearchState } from '@/lib/research-state';
import { buildMainChatSystemPrompt } from '@/lib/chat-system-prompt';

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
const REPORT_ACTION_MARKER = '[[ACTION:REPORT]]';

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

function userExplicitlyRequestsCode(userMessage: string): boolean {
  return /(代码|示例代码|伪代码|pseudo-?code|code\s*snippet|python|javascript|typescript|java|c\+\+|go|rust|sql|bash|shell|命令行)/i.test(
    userMessage
  );
}

function sanitizeNonCodeAnswer(answer: string): string {
  const withoutFencedCode = answer.replace(/```[\s\S]*?```/g, '\n');
  const withoutPseudoHeadings = withoutFencedCode.replace(
    /(^|\n)(?:#{1,6}\s*)?(?:伪代码|pseudo-?code|示例代码)\s*[:：]?\s*(?=\n|$)/gim,
    '\n'
  );
  return withoutPseudoHeadings.replace(/\n{3,}/g, '\n\n').trim();
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
  return /来源洞察|知识库论文对比洞察|论文对比洞察|文论对比洞察|频繁研究|研究空白|方法争议|变量被反复验证/i.test(question);
}

function hasMeaningfulKnowledgeDoc(content: string | null | undefined): boolean {
  if (!content) return false;
  return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length > 0;
}

function parseKnowledgeDocScenarioState(raw: string | null | undefined) {
  if (!raw) return getDefaultKnowledgeDocScenarioState();
  try {
    return normalizeKnowledgeDocScenarioState(JSON.parse(raw));
  } catch {
    return getDefaultKnowledgeDocScenarioState();
  }
}

function stripSectionsByHeading(content: string, headings: string[]): string {
  const headingSet = new Set(headings.map((item) => item.trim().toLowerCase()));
  const lines = content.split('\n');
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const headingMatch = line.trim().match(/^#{1,3}\s*(.+?)\s*$/);
    const headingLabel = headingMatch?.[1]?.trim().toLowerCase() ?? '';

    if (headingLabel && headingSet.has(headingLabel)) {
      index += 1;
      while (index < lines.length) {
        const next = (lines[index] ?? '').trim();
        if (/^#{1,3}\s+/.test(next)) {
          index -= 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function appendGuidanceTail(input: {
  answer: string;
  topic: string;
  userMessage: string;
  hasKnowledgeDoc: boolean;
  activeScenario: KnowledgeDocScenario | null;
}): string {
  void input.topic;
  void input.userMessage;
  void input.hasKnowledgeDoc;
  void input.activeScenario;
  return stripSectionsByHeading(input.answer.trim(), ['下一步建议', '待确认问题']);
}

type ChatPreviewPayload =
  | {
      mode: 'qa';
      responseText: string;
      sourceSupported: boolean;
    }
  | {
      mode: 'edit';
      responseText: string;
      previewContent: string;
      sourceSupported: boolean;
      applyMode: EditApplyMode;
    };

function normalizeMarkdownText(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

function buildPreviewSnippet(markdown: string, maxLines = 14): string {
  const lines = markdown
    .split('\n')
    .map((line) => line.trimEnd());
  const snippet = lines.slice(0, maxLines).join('\n').trim();
  if (!snippet) return '(预览为空)';
  return lines.length > maxLines ? `${snippet}\n...` : snippet;
}

async function buildKnowledgeDocPreview(input: {
  applyMode: EditApplyMode;
  userMessage: string;
  context: string;
  scriptContext: string;
  currentDocContent: string;
  activeScenario: KnowledgeDocScenario | null;
  sourceSupported: boolean;
}): Promise<{ answer: string; payload: ChatPreviewPayload }> {
  const modeLabel = input.applyMode === 'replace' ? '整篇替换预览' : '局部更新预览';
  const systemPrompt = `你是知识文档预览助手。你只负责输出“修改预览”，不得声称已更新文档。

规则：
1. ${
    input.applyMode === 'replace'
      ? '本轮按整篇替换方式输出完整 Markdown 草稿。'
      : '本轮按最小局部编辑方式输出可直接应用的 Markdown 草稿，优先挂靠原有章节。'
  }
2. 只基于用户请求、当前文档与已给出的来源信息。
3. 输出只允许是 Markdown 正文，不要解释，不要 JSON，不要代码块。`;

  const userPrompt =
    `【用户请求】\n${input.userMessage}\n\n` +
    `【当前知识文档】\n${input.currentDocContent || '(空)'}\n\n` +
    `【当前项目说明】\n${input.activeScenario?.label ?? '(无)'}\n${input.activeScenario?.structure ?? ''}\n\n` +
    `【来源证据】\n${input.context}\n\n` +
    `【脚本洞察】\n${input.scriptContext || '(none)'}\n\n` +
    '请直接输出可应用的 Markdown 预览稿。';

  const { content } = await chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  const suggestedMarkdown = normalizeMarkdownText(content ?? '');

  if (!suggestedMarkdown) {
    const fallbackMarkdown = normalizeMarkdownText(
      (input.currentDocContent || '').replace(/<[^>]*>/g, '\n').replace(/\n{3,}/g, '\n\n')
    );
    const fallbackAnswer =
      `已生成${modeLabel}，以下是可应用草稿：\n\n` +
      `${buildPreviewSnippet(fallbackMarkdown)}`;
    return {
      answer: fallbackAnswer,
      payload: {
        mode: 'edit',
        responseText: fallbackAnswer,
        previewContent: fallbackMarkdown,
        sourceSupported: input.sourceSupported,
        applyMode: input.applyMode,
      },
    };
  }

  const answer =
    `已生成${modeLabel}，请先确认预览后再点击「更新知识文档」应用：\n\n` +
    `${buildPreviewSnippet(suggestedMarkdown)}`;

  return {
    answer,
    payload: {
      mode: 'edit',
      responseText: answer,
      previewContent: suggestedMarkdown,
      sourceSupported: input.sourceSupported,
      applyMode: input.applyMode,
    },
  };
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
    const trimmedUserMessage = userMessage.trim();
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [latestResearchState, knowledgeDocRow, knowledgeDocScenarioRow] = await Promise.all([
      getLatestResearchState(notebookId),
      db
        .select({ content: notes.content })
        .from(notes)
        .where(and(eq(notes.notebookId, notebookId), eq(notes.title, KNOWLEDGE_DOC_NOTE_TITLE)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({ content: notes.content })
        .from(notes)
        .where(and(eq(notes.notebookId, notebookId), eq(notes.title, KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
    const knowledgeDocScenarioState = parseKnowledgeDocScenarioState(knowledgeDocScenarioRow?.content);
    const activeKnowledgeDocScenario =
      knowledgeDocScenarioState.activeScenarioId != null
        ? resolveKnowledgeDocScenario(knowledgeDocScenarioState, knowledgeDocScenarioState.activeScenarioId)
        : null;
    const onboardingTopic = latestResearchState?.state.topic?.trim() ?? '';
    const shouldGuideForKnowledgeDoc =
      Boolean(onboardingTopic) && !hasMeaningfulKnowledgeDoc(knowledgeDocRow?.content);

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
    const assistantMode = detectAssistantMode(trimmedUserMessage);
    const editApplyMode = detectEditApplyMode(trimmedUserMessage);
    console.info(
      '[assistant-mode]',
      JSON.stringify({
        userMessage: trimmedUserMessage,
        mode: assistantMode,
        show_update_button: true,
      })
    );

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
      }> = [],
      responseMeta: {
        assistantMode: AssistantMode;
        previewPayload: ChatPreviewPayload | null;
        showUpdateButton: true;
      }
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
        assistantMessageId: assistantMsgId,
        assistantMode: responseMeta.assistantMode,
        previewPayload: responseMeta.previewPayload,
        showUpdateButton: responseMeta.showUpdateButton,
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
        mime: sources.mime,
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
            mime: sources.mime,
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
      (hasSkillContext || shouldUseSkillPlanningTemplate(trimmedUserMessage));
    const hasScriptCapability = readyPythonSources.length > 0 || needBuiltinPaperStats;

    let answerBase = '';
    let previewPayload: ChatPreviewPayload | null = null;

    if (assistantMode === 'qa') {
      if (selected.length === 0) {
        answerBase = '当前来源不足以支持回答。请先补充来源后再提问。';
        previewPayload = {
          mode: 'qa',
          responseText: answerBase,
          sourceSupported: false,
        };
      } else {
        const skillExecutionRule = hasScriptCapability
          ? '可将“脚本分析”作为可选能力提及；如需提及脚本，只描述预期产出，不要输出命令行或伪执行步骤。'
          : '当前 notebook 不具备可执行脚本能力，不要输出脚本运行建议、终端命令或伪执行步骤。';
        const skillTemplateRule = useSkillPlanningTemplate
          ? `当用户提出创作/规划类问题时，回答要务实、可执行，并保持自然对话感。除非用户明确要求结构化模板，否则不要强行套固定章节。优先使用自然段，只有在提升清晰度时再使用列表。${skillExecutionRule}`
          : '';
        const viralSkillRule = useDirectViralScript
          ? '短视频脚本能力已启用。请一次性输出可直接拍摄的完整中文脚本，不要让用户做多选。输出结构固定为：1) 标题 2) 时长与受众定位 3) 完整脚本（按秒段：开场/发展/高潮/结尾，每段含画面、字幕/旁白、音效）4) 视觉风格建议（配色/镜头/字幕）5) 音乐与音效建议 6) 互动设计（评论区引导）7) 可直接拍摄的执行清单。约束：内容需原创、包含强对比与明确 CTA，且不输出命令行或伪执行步骤。'
          : '';
        const paperInsightRule = needBuiltinPaperStats
          ? '回答来源/论文对比问题时，按 4 个部分组织：1) 高频研究问题 2) 被反复验证的变量 3) 研究空白 4) 方法争议。要求精炼且有证据依据。'
          : '';
        const onboardingGuideRule = shouldGuideForKnowledgeDoc
          ? `当前 notebook 主题：${onboardingTopic}。用户还在为后续知识文档补齐信息。回答时要识别缺失上下文，并优先强调可复用、可沉淀到文档中的关键信息。`
          : '';
        const activeScenarioRule = activeKnowledgeDocScenario
          ? `当前项目指令：${activeKnowledgeDocScenario.label}\n项目说明：\n${activeKnowledgeDocScenario.structure}\n请将其视为该 notebook 的长期项目级约束：既影响知识文档组织方式，也影响问答表达风格。必要时主动引导用户补充更适合写入该项目的事实、目标、指标、约束、证据或偏好。若项目说明要求简洁、聚焦、分步或决策导向，需持续保持该风格。`
          : '';
        const systemPrompt = buildMainChatSystemPrompt([
          skillTemplateRule,
          viralSkillRule,
          paperInsightRule,
          onboardingGuideRule,
          activeScenarioRule,
        ]);
        const userPrompt = `Notebook topic: ${onboardingTopic || access.notebook.title}\n\nSources:\n${context}\n\nScript Insights:\n${scriptContext || '(none)'}\n\nUser question: ${trimmedUserMessage}`;
        const chatMessages = [
          { role: 'system' as const, content: systemPrompt },
          ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: userPrompt },
        ];
        const { content: rawAnswer } = await chat(chatMessages);
        const processedAnswer = useSkillPlanningTemplate
          ? sanitizeSkillAnswer(rawAnswer, hasScriptCapability)
          : rawAnswer;
        answerBase = userExplicitlyRequestsCode(trimmedUserMessage)
          ? processedAnswer
          : sanitizeNonCodeAnswer(processedAnswer);
        previewPayload = {
          mode: 'qa',
          responseText: answerBase,
          sourceSupported: selected.length > 0,
        };
      }
    } else {
      const preview = await buildKnowledgeDocPreview({
        applyMode: editApplyMode,
        userMessage: trimmedUserMessage,
        context,
        scriptContext,
        currentDocContent: knowledgeDocRow?.content ?? '',
        activeScenario: activeKnowledgeDocScenario,
        sourceSupported: selected.length > 0,
      });
      answerBase = preview.answer;
      previewPayload = preview.payload;
    }

    const citedNumbers = extractCitationNumbers(answerBase, selected.length);
    const rowsForCitations =
      citedNumbers.length > 0
        ? citedNumbers
            .map((n) => ({ row: selected[n - 1], refNumber: n }))
            .filter((item) => Boolean(item.row))
        : [];

    let answer = appendGuidanceTail({
      answer: answerBase,
      topic: onboardingTopic || access.notebook.title,
      userMessage: trimmedUserMessage,
      hasKnowledgeDoc: hasMeaningfulKnowledgeDoc(knowledgeDocRow?.content),
      activeScenario: activeKnowledgeDocScenario,
    });
    if (needBuiltinPaperStats && assistantMode === 'qa') {
      answer += `\n\n${REPORT_ACTION_MARKER}`;
    }

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
    return persistAndRespond(answer, citationsForDb, citationsForClient, {
      assistantMode,
      previewPayload,
      showUpdateButton: true,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Chat failed' },
      { status: 500 }
    );
  }
}

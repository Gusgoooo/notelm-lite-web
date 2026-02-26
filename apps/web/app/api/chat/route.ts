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
const SKILL_STATE_PREFIX = '__SKILL_STATE__:';
let envLogged = false;

type ChatInteraction = {
  type: 'choices';
  key: string;
  title: string;
  description?: string;
  options: Array<{ label: string; value: string; description?: string }>;
};

type InteractionReply = {
  key: string;
  value: string;
  label?: string;
};

type SkillRuntimeState = {
  active: boolean;
  skillName?: string;
  selections: Record<string, string>;
};

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

function parseInteractionReply(value: unknown): InteractionReply | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.key !== 'string' || typeof row.value !== 'string') return null;
  return {
    key: row.key.trim(),
    value: row.value.trim(),
    label: typeof row.label === 'string' ? row.label.trim() : undefined,
  };
}

function parseSkillState(content: string): SkillRuntimeState | null {
  if (!content.startsWith(SKILL_STATE_PREFIX)) return null;
  const raw = content.slice(SKILL_STATE_PREFIX.length).trim();
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const selections =
      json.selections && typeof json.selections === 'object' && !Array.isArray(json.selections)
        ? (json.selections as Record<string, unknown>)
        : {};
    const cleanedSelections: Record<string, string> = {};
    for (const [k, v] of Object.entries(selections)) {
      if (typeof v === 'string') cleanedSelections[k] = v;
    }
    return {
      active: Boolean(json.active),
      skillName: typeof json.skillName === 'string' ? json.skillName : undefined,
      selections: cleanedSelections,
    };
  } catch {
    return null;
  }
}

function buildSkillStateContent(state: SkillRuntimeState): string {
  return `${SKILL_STATE_PREFIX}${JSON.stringify(state)}`;
}

function extractDouyinUrl(text: string): string | null {
  const m = text.match(/https?:\/\/(?:www\.)?(?:douyin\.com\/video\/[A-Za-z0-9_-]+|v\.douyin\.com\/[A-Za-z0-9/_-]+)/i);
  return m?.[0] ?? null;
}

function hasManualVideoInput(text: string): boolean {
  if (!text.trim()) return false;
  if (text.length >= 180) return true;
  return /(视频标题|视频描述|视频文案|口播|字幕|背景音乐|目标受众|核心内容|传递价值|点赞|评论)/.test(text);
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
    const interactionReply = parseInteractionReply(body?.interactionReply);
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
      interaction?: ChatInteraction
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
        interaction: interaction ?? null,
      });
    };

    let skillContext = '';
    let detectedSkillName = '';
    let hasSkillScripts = false;
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
      hasSkillScripts = /(?:^|\n)### FILE:\s.*\/scripts\/.*\.py(?:\n|$)|scripts\/[a-zA-Z0-9_-]+\.py/i.test(
        skillContext
      );
    }

    const stateRows = await db
      .select({ content: messages.content })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId!), eq(messages.role, 'system')))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(30);
    let skillState: SkillRuntimeState = { active: false, selections: {} };
    for (const row of stateRows) {
      const parsed = parseSkillState(row.content);
      if (parsed) {
        skillState = parsed;
        break;
      }
    }
    if (detectedSkillName) skillState.skillName = detectedSkillName;
    if (interactionReply?.key) {
      skillState.selections[interactionReply.key] = interactionReply.value;
    }

    const saveSkillState = async () => {
      await db.insert(messages).values({
        id: `msg_${randomUUID()}`,
        conversationId: conversationId!,
        role: 'system',
        content: buildSkillStateContent(skillState),
      });
    };

    const trimmedUserMessage = userMessage.trim();
    const isViralSkill =
      readySkillSources.length > 0 &&
      /viral-video-copywriting|爆款短视频文案创作/i.test(`${detectedSkillName}\n${skillContext}`);
    if (isViralSkill && (skillState.active || shouldUseSkillPlanningTemplate(trimmedUserMessage) || Boolean(interactionReply))) {
      skillState.active = true;
      if (!skillState.selections.input_mode) {
        await saveSkillState();
        return persistAndRespond(
          `已识别到技能包 **${detectedSkillName || 'viral-video-copywriting'}**。\n\n先完成第 1 步：请选择视频信息获取方式。`,
          [],
          [],
          {
            type: 'choices',
            key: 'input_mode',
            title: '请选择视频信息获取方式',
            description: '方式A偏自动化；方式B更稳定，建议先用方式B',
            options: [
              { label: '方式B：手动提供素材（推荐）', value: 'manual' },
              { label: '方式A：抖音链接提取', value: 'auto' },
            ],
          }
        );
      }

      if (skillState.selections.input_mode === 'auto') {
        const douyinUrl = extractDouyinUrl(trimmedUserMessage);
        if (douyinUrl) {
          skillState.selections.douyin_url = douyinUrl;
        }
        if (!skillState.selections.douyin_url) {
          await saveSkillState();
          return persistAndRespond(
            `你已选择 **方式A（抖音链接提取）**。\n\n请直接粘贴抖音视频链接（` +
              `douyin.com/video/... 或 v.douyin.com/...` +
              `）。\n\n如果链接提取失败，我会自动切回方式B让你手动补充素材。`,
            [],
            [],
            {
              type: 'choices',
              key: 'input_mode',
              title: '也可以直接改为手动方式',
              options: [{ label: '切换到方式B（手动）', value: 'manual' }],
            }
          );
        }

        if (!readyPythonSources.length || !hasSkillScripts) {
          skillState.selections.input_mode = 'manual';
          await saveSkillState();
          return persistAndRespond(
            `已收到链接：${skillState.selections.douyin_url}\n\n当前环境无法直接执行抖音提取脚本（缺少可用脚本运行条件），自动切换到 **方式B（手动）**。\n\n请按下面模板粘贴素材：\n\n` +
              `- 视频标题：\n- 视频描述：\n- 视频文案/字幕：\n- 背景音乐（可选）：\n- 数据表现（可选：点赞/评论/播放）：`,
          );
        }
      }

      if (skillState.selections.input_mode === 'manual' && !hasManualVideoInput(trimmedUserMessage)) {
        await saveSkillState();
        return persistAndRespond(
          `你已选择 **方式B（手动）**。请先提供对标视频素材，我再按技能包完整五步法输出。\n\n请按模板回复：\n` +
            `- 视频标题：\n- 视频描述：\n- 视频文案/字幕：\n- 背景音乐（可选）：\n- 数据表现（可选）：\n\n` +
            `随后我会继续执行：爆款拆解 -> 需求澄清 -> 多版本原创文案。`
        );
      }

      await saveSkillState();
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
    const useViralSkillRuntime = isViralSkill && skillState.active;
    const useSkillPlanningTemplate =
      readySkillSources.length > 0 &&
      (hasSkillContext || shouldUseSkillPlanningTemplate(userMessage.trim()));
    const skillExecutionRule = readyPythonSources.length > 0
      ? `You may reference "脚本分析" only as an optional capability. If mentioning scripts, describe expected outputs in plain Chinese, never output shell commands.`
      : `No executable script capability is available in this notebook. Do not output script-running advice, terminal commands, or pseudo execution steps.`;
    const skillTemplateRule = useSkillPlanningTemplate
      ? `\nWhen the user asks for creation/planning tasks, structure your answer with these exact sections in Chinese markdown:\n## 需求分析\n## 实现方式决策\n## Skill 定位\n## 更新计划\nRequirements:\n- Keep each section concise and actionable (2-5 bullets).\n- "更新计划" must be product actions, not shell commands.\n- If assumptions are needed, list them as "待确认".\n- Avoid filler, percentages without evidence, and avoid repeating source text verbatim.\n${skillExecutionRule}`
      : '';
    const viralSkillRule = useViralSkillRuntime
      ? `\nViral-video-copywriting runtime is active.\nStrictly follow the five-step workflow in SKILL.md.\nNever output runnable shell commands.\nIf any required input is missing, ask concise follow-up questions first and stop.\nWhen enough input is present, output:\n1) 对标拆解要点\n2) 需求澄清结论\n3) 2-3版原创文案（含字数/时长对标）\n4) 原创性声明`
      : '';
    const systemPrompt = `You are a helpful assistant. Answer based only on the provided sources and script insights. Always cite source numbers like [1] when using source chunks. If script insights are used, explicitly mention "脚本分析" in your answer. If the question cannot be answered from provided context, say so.${skillTemplateRule}${viralSkillRule}`;
    const userPrompt = `Sources:\n${context}\n\nScript Insights:\n${scriptContext || '(none)'}\n\nSkill Runtime State:\n${JSON.stringify(skillState.selections)}\n\nUser question: ${userMessage.trim()}`;
    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userPrompt },
    ];
    const { content: rawAnswer } = await chat(chatMessages);
    const answer = useSkillPlanningTemplate
      ? sanitizeSkillAnswer(rawAnswer, readyPythonSources.length > 0)
      : rawAnswer;
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
    return persistAndRespond(answer, citationsForDb, citationsForClient);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Chat failed' },
      { status: 500 }
    );
  }
}

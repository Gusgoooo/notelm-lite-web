import { NextResponse } from 'next/server';
import { and, db, eq, sourceChunks, sources } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';
import { getAgentSettings } from '@/lib/agent-settings';
import { getLatestResearchState, saveResearchState, type ResearchDirection } from '@/lib/research-state';

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const lines: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const obj = part as { type?: unknown; text?: unknown };
    if (obj.type === 'text' && typeof obj.text === 'string') lines.push(obj.text);
  }
  return lines.join('\n').trim();
}

function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content.trim());
  } catch {
    const fenced = content.match(/```json\s*([\s\S]*?)```/i)?.[1];
    if (!fenced) return null;
    try {
      return JSON.parse(fenced.trim());
    } catch {
      return null;
    }
  }
}

function extractTopicKeywords(text: string): string[] {
  const cleaned = text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[，。！？、,:;；（）()【】\[\]{}"'`“”‘’/\\|<>《》]+/g, ' ')
    .trim();
  const stopwords = new Set([
    '研究',
    '问题',
    '方向',
    '议题',
    '分析',
    '探索',
    '探究',
    '影响',
    '作用',
    '关系',
    '方法',
    '策略',
    '路径',
    '机制',
    '现状',
    '趋势',
    '挑战',
    '优化',
  ]);
  const pieces = cleaned
    .split(/\s+/)
    .flatMap((part) =>
      part
        .split(/(?:关于|如何|是否|为什么|哪些|什么|对于|围绕|面向|针对|有关|在|中|的|与|和|及其|以及|及|对|跟)/)
        .map((item) => item.trim())
    )
    .filter(Boolean);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const piece of pieces) {
    const normalized = piece.replace(/\s+/g, '');
    const isAsciiToken = /^[a-z0-9][a-z0-9.+_-]*$/i.test(normalized);
    if (!normalized) continue;
    if (stopwords.has(normalized)) continue;
    if (!isAsciiToken && normalized.length < 2) continue;
    if (isAsciiToken && normalized.length < 2) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length >= 8) break;
  }

  if (unique.length > 0) return unique;
  const fallback = cleaned.replace(/\s+/g, '').slice(0, 12);
  return fallback.length >= 2 ? [fallback] : [];
}

function hasKeywordOverlap(text: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const haystack = text.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function normalizeStars(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(5, Math.round(value)));
  }
  if (typeof value === 'string') {
    const count = (value.match(/⭐/g) ?? []).length;
    if (count > 0) return Math.max(1, Math.min(5, count));
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) return Math.max(1, Math.min(5, n));
  }
  return 3;
}

function normalizeDirections(payload: unknown, topicKeywords: string[]): ResearchDirection[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = (payload as { directions?: unknown }).directions;
  if (!Array.isArray(raw)) return [];
  const primary: ResearchDirection[] = [];
  const secondary: ResearchDirection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? row.topic ?? '').trim().slice(0, 80);
    const researchQuestion = String(row.researchQuestion ?? row.question ?? '').trim().slice(0, 220);
    const coreVariables = String(row.coreVariables ?? row.variables ?? '').trim().slice(0, 120);
    const researchMethod = String(row.researchMethod ?? row.method ?? '').trim().slice(0, 120);
    const dataSourceAccess = String(row.dataSourceAccess ?? row.dataSources ?? '').trim().slice(0, 120);
    const trendHeat = String(row.trendHeat ?? row.trend ?? '').trim().slice(0, 80);
    const sourceBasis = String(row.sourceBasis ?? row.evidence ?? row.basis ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    if (!title || !researchQuestion) continue;
    const normalized: ResearchDirection = {
      id: `dir_${primary.length + secondary.length + 1}`,
      title,
      researchQuestion,
      coreVariables: coreVariables || '自变量 / 因变量需进一步界定',
      researchMethod: researchMethod || '混合方法（定量 + 定性）',
      dataSourceAccess: dataSourceAccess || '可通过公开数据库和行业报告收集',
      difficultyStars: normalizeStars(row.difficultyStars ?? row.difficulty ?? 3),
      trendHeat: trendHeat || (sourceBasis ? '有一定研究热度，值得继续跟进' : '可进一步验证研究价值'),
    };
    if (hasKeywordOverlap(`${title} ${researchQuestion}`, topicKeywords)) {
      primary.push(normalized);
    } else {
      secondary.push(normalized);
    }
  }
  return [...primary, ...secondary].slice(0, 5).map((item, index) => ({
    ...item,
    id: `dir_${index + 1}`,
  }));
}

function buildFallbackDirections(topic: string, topicKeywords: string[]): ResearchDirection[] {
  const anchor = topicKeywords[0] || topic.replace(/\s+/g, '').slice(0, 18) || '该主题';
  const templates: Array<Pick<ResearchDirection, 'title' | 'researchQuestion' | 'coreVariables' | 'researchMethod' | 'dataSourceAccess' | 'trendHeat'>> = [
    {
      title: `${anchor}现状与需求`,
      researchQuestion: `${anchor}当前最核心的需求、痛点与应用场景是什么？`,
      coreVariables: `${anchor}需求强度 / 场景差异 / 用户类型`,
      researchMethod: '案例分析 + 访谈',
      dataSourceAccess: '公开案例、行业报告、用户反馈',
      trendHeat: '适合作为入门方向，容易快速形成问题框架',
    },
    {
      title: `${anchor}关键影响因素`,
      researchQuestion: `哪些关键变量会显著影响${anchor}的结果或效果？`,
      coreVariables: `关键变量 / 结果指标 / 外部条件`,
      researchMethod: '定量分析 + 对比研究',
      dataSourceAccess: '公开数据、二手研究资料',
      trendHeat: '适合做因果关系或相关性分析',
    },
    {
      title: `${anchor}落地路径`,
      researchQuestion: `${anchor}从概念到落地的关键步骤与约束条件是什么？`,
      coreVariables: `资源投入 / 执行路径 / 风险约束`,
      researchMethod: '流程拆解 + 案例复盘',
      dataSourceAccess: '公开方案、项目案例、政策文件',
      trendHeat: '适合形成操作性较强的研究结论',
    },
    {
      title: `${anchor}效果评估`,
      researchQuestion: `如何评估${anchor}的实际效果、收益与边界？`,
      coreVariables: `效果指标 / 成本收益 / 适用边界`,
      researchMethod: '指标设计 + 对比评估',
      dataSourceAccess: '评测报告、案例数据、行业基准',
      trendHeat: '适合延展为评估框架型研究',
    },
    {
      title: `${anchor}风险与争议`,
      researchQuestion: `${anchor}当前最值得关注的风险、争议与不确定性是什么？`,
      coreVariables: `风险类型 / 争议点 / 影响范围`,
      researchMethod: '文献梳理 + 争议比较',
      dataSourceAccess: '评论文章、案例复盘、研究综述',
      trendHeat: '适合补充反证与边界条件',
    },
  ];

  return templates.slice(0, 5).map((item, index) => ({
    id: `dir_${index + 1}`,
    ...item,
    difficultyStars: 3,
  }));
}

async function generateDirections(input: {
  topic: string;
  context: string;
}): Promise<ResearchDirection[]> {
  const settings = await getAgentSettings();
  const apiKey = settings.openrouterApiKey.trim();
  const baseUrl = settings.openrouterBaseUrl.trim() || 'https://openrouter.ai/api/v1';
  const model = (settings.models.summary || process.env.OPENROUTER_CHAT_MODEL || 'openrouter/auto').trim();
  const systemPrompt = settings.researchDirectionsPrompt.trim();
  if (!apiKey) throw new Error('OpenRouter API key is not configured in admin settings');
  const topicKeywords = extractTopicKeywords(input.topic);

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content:
            `研究主题：${input.topic}\n\n` +
            `原问题关键词：${topicKeywords.join('、') || input.topic}\n\n` +
            `参考材料（来自联网检索来源摘要）：\n${input.context}\n\n` +
            `请延展 3 到 5 个“可直接开题”的研究方向，每个方向包含字段：\n` +
            `title, researchQuestion, coreVariables, researchMethod, dataSourceAccess, difficultyStars(1-5), trendHeat, sourceBasis。\n` +
            `要求：\n` +
            `0) 请优先基于来源归纳，但如果来源不够完整，也可以做谨慎延展；sourceBasis 可以简短，不必过长；\n` +
            `1) 方向必须与用户原始问题明显相关，尽量保留原问题关键词；\n` +
            `2) 研究问题尽量具体、可提问；\n` +
            `3) 方法和数据来源可给出相对宽松但合理的建议；\n` +
            `4) difficultyStars 必须为数字；\n` +
            `5) 全部使用简体中文；\n` +
            `6) 不要因为材料不完美就拒绝输出，优先给出可研究的方向。`,
        },
      ],
      stream: false,
    }),
  });
  const raw = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = raw;
  }
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload &&
      'error' in payload &&
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : `HTTP ${response.status}`;
    throw new Error(`Generate directions failed: ${message}`);
  }
  const content = extractTextFromContent(
    (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content ?? ''
  );
  const parsed = tryParseJson(content);
  const parsedDirections = normalizeDirections(parsed, topicKeywords);
  if (parsedDirections.length >= 3) {
    return parsedDirections.slice(0, 5);
  }

  const fallbackDirections = buildFallbackDirections(input.topic, topicKeywords);
  const combined = [...parsedDirections, ...fallbackDirections]
    .filter((item, index, arr) => arr.findIndex((entry) => entry.title === item.title) === index)
    .slice(0, 5)
    .map((item, index) => ({ ...item, id: `dir_${index + 1}` }));

  if (combined.length >= 3) {
    return combined;
  }
  return buildFallbackDirections(input.topic, topicKeywords).slice(0, 3);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId.trim() : '';
    const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
    if (!notebookId || !topic) {
      return NextResponse.json({ error: 'notebookId and topic are required' }, { status: 400 });
    }

    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    if (!access.canEditSources) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const stateRow = await getLatestResearchState(notebookId);
    const phaseBefore = stateRow?.state.phase ?? 'collecting';
    if (phaseBefore === 'ready' && stateRow?.state.directions.length) {
      return NextResponse.json({
        notebookId,
        directions: stateRow.state.directions,
        phase: stateRow.state.phase,
      });
    }

    const chunks = await db
      .select({
        sourceTitle: sources.filename,
        content: sourceChunks.content,
      })
      .from(sourceChunks)
      .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
      .where(and(eq(sources.notebookId, notebookId), eq(sources.status, 'READY')))
      .limit(180);
    const context = chunks
      .map((row, index) => `[来源${index + 1}] ${row.sourceTitle}\n${row.content}`)
      .join('\n\n')
      .slice(0, 72_000);

    if (!context.trim()) {
      return NextResponse.json(
        { error: '当前检索来源尚不足以生成研究议题，请先等待来源处理完成或补充全文来源' },
        { status: 409 }
      );
    }

    const directions = await generateDirections({
      topic,
      context,
    });

    const now = new Date().toISOString();
    await saveResearchState({
      notebookId,
      conversationId: stateRow?.conversationId,
      state: {
        topic,
        phase: 'select_direction',
        directions,
        createdAt: stateRow?.state.createdAt ?? now,
        updatedAt: now,
      },
    });

    return NextResponse.json({
      notebookId,
      phase: 'select_direction',
      directions,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate directions' },
      { status: 500 }
    );
  }
}

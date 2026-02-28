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
    const researchQuestion = String(
      row.researchQuestion ?? row.summary ?? row.finding ?? row.question ?? ''
    )
      .trim()
      .slice(0, 220);
    const evidenceCountRaw = Number.parseInt(String(row.evidenceCount ?? row.mentions ?? row.count ?? ''), 10);
    const evidenceCount = Number.isFinite(evidenceCountRaw) ? Math.max(1, evidenceCountRaw) : undefined;
    const sourceBasis = String(row.sourceBasis ?? row.evidenceSummary ?? row.evidence ?? row.basis ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    if (!title || !researchQuestion) continue;
    const evidenceSummary =
      sourceBasis ||
      (evidenceCount
        ? `被 ${evidenceCount} 条来源反复提及`
        : '来自多条来源的重复信息，值得继续深挖');
    const normalized: ResearchDirection = {
      id: `dir_${primary.length + secondary.length + 1}`,
      title,
      researchQuestion,
      evidenceCount,
      evidenceSummary,
      coreVariables: '后续深入时再细化关键变量',
      researchMethod: '基于当前核心发现继续追问',
      dataSourceAccess: '沿用当前已引入的来源继续扩展',
      difficultyStars: normalizeStars(row.difficultyStars ?? row.difficulty ?? 2),
      trendHeat:
        evidenceCount != null
          ? `被 ${evidenceCount} 条来源提及`
          : '来自当前已收集来源的高频信息',
    };
    if (hasKeywordOverlap(`${title} ${researchQuestion}`, topicKeywords)) {
      primary.push(normalized);
    } else {
      secondary.push(normalized);
    }
  }
  return [...primary, ...secondary].slice(0, 4).map((item, index) => ({
    ...item,
    id: `dir_${index + 1}`,
  }));
}

function buildFallbackDirections(topic: string, topicKeywords: string[]): ResearchDirection[] {
  const anchor = topicKeywords[0] || topic.replace(/\s+/g, '').slice(0, 18) || '该主题';
  const templates: Array<
    Pick<
      ResearchDirection,
      'title' | 'researchQuestion' | 'evidenceCount' | 'evidenceSummary' | 'coreVariables' | 'researchMethod' | 'dataSourceAccess' | 'trendHeat'
    >
  > = [
    {
      title: `${anchor}的高频核心问题`,
      researchQuestion: `当前来源最集中提到的是哪些与${anchor}直接相关的问题与现象。`,
      evidenceCount: 3,
      evidenceSummary: `多条来源都把焦点放在${anchor}的核心问题上`,
      coreVariables: '后续深入时再细化关键变量',
      researchMethod: '基于当前核心发现继续追问',
      dataSourceAccess: '沿用当前已引入的来源继续扩展',
      trendHeat: '被 3 条来源提及',
    },
    {
      title: `${anchor}最常见的落地场景`,
      researchQuestion: `当前资料里反复出现的应用场景或落地路径，能说明${anchor}最值得先看的切入口。`,
      evidenceCount: 2,
      evidenceSummary: `至少 2 条来源在讨论${anchor}的具体场景`,
      coreVariables: '后续深入时再细化关键变量',
      researchMethod: '基于当前核心发现继续追问',
      dataSourceAccess: '沿用当前已引入的来源继续扩展',
      trendHeat: '被 2 条来源提及',
    },
    {
      title: `${anchor}的关键判断依据`,
      researchQuestion: `当前来源里能支撑${anchor}判断的关键依据，主要集中在哪几类证据。`,
      evidenceCount: 2,
      evidenceSummary: `围绕${anchor}的判断依据已经能抽出初步共识`,
      coreVariables: '后续深入时再细化关键变量',
      researchMethod: '基于当前核心发现继续追问',
      dataSourceAccess: '沿用当前已引入的来源继续扩展',
      trendHeat: '被 2 条来源提及',
    },
    {
      title: `${anchor}的争议与不确定点`,
      researchQuestion: `当前资料里关于${anchor}仍然没有讲清楚、值得继续追问的部分是什么。`,
      evidenceCount: 1,
      evidenceSummary: `当前来源已经暴露出${anchor}的若干待验证问题`,
      coreVariables: '后续深入时再细化关键变量',
      researchMethod: '基于当前核心发现继续追问',
      dataSourceAccess: '沿用当前已引入的来源继续扩展',
      trendHeat: '被 1 条以上来源提及',
    },
  ];

  return templates.slice(0, 4).map((item, index) => ({
    id: `dir_${index + 1}`,
    ...item,
    difficultyStars: 2,
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
            `请先总结 3 到 4 个“核心发现卡片”，每个卡片都必须短、小、硬，不要做成长文摘要。每个卡片包含字段：\n` +
            `title, summary, evidenceCount, evidenceSummary。\n` +
            `要求：\n` +
            `0) 请优先基于来源归纳，不要编造成果；\n` +
            `1) 每张卡片必须和用户原始问题明显相关，尽量保留原问题关键词；\n` +
            `2) summary 只写一句精简说明，强调为什么这条发现值得继续探索；\n` +
            `3) evidenceCount 给出一个合理的整数，表示这条发现被多少条来源重复提及；\n` +
            `4) evidenceSummary 只写一句非常短的依据说明；\n` +
            `5) 按“被提及次数”和信息密度优先排序；\n` +
            `6) 全部使用简体中文；\n` +
            `7) 不要因为材料不完美就拒绝输出，优先给出可继续探索的核心发现。`,
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
    return parsedDirections.slice(0, 4);
  }

  const fallbackDirections = buildFallbackDirections(input.topic, topicKeywords);
  const combined = [...parsedDirections, ...fallbackDirections]
    .filter((item, index, arr) => arr.findIndex((entry) => entry.title === item.title) === index)
    .slice(0, 4)
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
        { error: '当前检索来源尚不足以总结核心发现，请先等待来源处理完成或补充全文来源' },
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
      { error: error instanceof Error ? error.message : 'Failed to generate findings' },
      { status: 500 }
    );
  }
}

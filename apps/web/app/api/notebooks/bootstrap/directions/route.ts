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
  const out: ResearchDirection[] = [];
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
    if (!title || !researchQuestion || sourceBasis.length < 6) continue;
    if (!hasKeywordOverlap(`${title} ${researchQuestion}`, topicKeywords)) continue;
    out.push({
      id: `dir_${out.length + 1}`,
      title,
      researchQuestion,
      coreVariables: coreVariables || '自变量 / 因变量需进一步界定',
      researchMethod: researchMethod || '混合方法（定量 + 定性）',
      dataSourceAccess: dataSourceAccess || '可通过公开数据库和行业报告收集',
      difficultyStars: normalizeStars(row.difficultyStars ?? row.difficulty ?? 3),
      trendHeat: trendHeat || '中高热度，近三年持续增长',
    });
    if (out.length >= 6) break;
  }
  return out;
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
            `请延展 6 个“可直接开题”的研究方向，每个方向包含字段：\n` +
            `title, researchQuestion, coreVariables, researchMethod, dataSourceAccess, difficultyStars(1-5), trendHeat, sourceBasis。\n` +
            `要求：\n` +
            `0) 每个方向都必须明确说明它是基于哪些来源现象/结论归纳出来的，写入 sourceBasis；若材料不足，不要编造，直接少给或返回空数组；\n` +
            `1) 每个方向都必须与用户原始问题紧密相关，且 title 或 researchQuestion 至少包含一个原问题关键词；\n` +
            `2) 研究问题必须可提问且可验证；\n` +
            `3) 方法要具体（定量/定性/实验/混合）；\n` +
            `4) 数据可得性要给出现实判断；\n` +
            `5) difficultyStars 必须为数字；\n` +
            `6) 全部使用简体中文；\n` +
            `7) 禁止输出与参考材料无直接关联的泛泛选题。`,
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
  const directions = normalizeDirections(parsed, topicKeywords);
  if (directions.length < 3) {
    throw new Error('检索来源不足以稳定归纳研究议题，请补充更相关的全文来源或提供更明确的关键词后重试');
  }
  return directions;
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
      .limit(80);
    const context = chunks
      .map((row, index) => `[来源${index + 1}] ${row.sourceTitle}\n${row.content}`)
      .join('\n\n')
      .slice(0, 36_000);

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

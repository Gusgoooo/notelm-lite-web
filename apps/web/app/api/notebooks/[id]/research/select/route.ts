import { NextResponse } from 'next/server';
import { and, cosineDistance, db, desc, eq, inArray, notebooks, sourceChunks, sources, sql } from 'db';
import { createEmbeddings } from 'shared';
import { getAgentSettings } from '@/lib/agent-settings';
import { getNotebookAccess } from '@/lib/notebook-access';
import { addAssistantMessage, getLatestResearchState, saveResearchState } from '@/lib/research-state';

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

function normalizeStarterQuestion(raw: string): string {
  const firstLine =
    raw
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? '';

  const cleaned = firstLine
    .replace(/^[\d一二三四五六七八九十]+[.)、\s-]*/, '')
    .replace(/^[•·\-*]\s*/, '')
    .replace(/^问题[:：]\s*/, '')
    .replace(/^议题[:：]\s*/, '')
    .replace(/^请(?:你)?/, '')
    .trim();

  if (!cleaned) return '';

  const questionOnly = cleaned.match(/[^。！？!?]*[？?]/)?.[0]?.trim() ?? cleaned;
  const normalized = questionOnly.replace(/[。;；]+$/g, '').trim();
  if (!normalized) return '';
  if (/[？?]$/.test(normalized)) return normalized.replace(/\?$/, '？');
  return `${normalized}？`;
}

async function generateStarterQuestions(input: {
  topic: string;
  directionTitle: string;
  directionQuestion: string;
  sourceTitles: string[];
  sourceEvidence: string;
}): Promise<string[]> {
  const anchorKeywords = extractTopicKeywords(
    `${input.topic} ${input.directionTitle} ${input.directionQuestion}`.trim()
  );
  const anchorLabel = anchorKeywords[0] || input.directionTitle.trim() || input.topic.trim() || '该选题';
  const fallback = [
    `${anchorLabel}最缺哪类证据？`,
    `${anchorLabel}还有哪些结论待验证？`,
    `${anchorLabel}下一步该补什么数据？`,
  ];
  const settings = await getAgentSettings();
  const apiKey = settings.openrouterApiKey.trim();
  const baseUrl = settings.openrouterBaseUrl.trim() || 'https://openrouter.ai/api/v1';
  const model = (settings.models.summary || process.env.OPENROUTER_CHAT_MODEL || 'openrouter/auto').trim();
  if (!apiKey) {
    return fallback;
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content:
            '你是研究顾问。你只能基于给定来源证据提出下一步研究问题，不允许脱离来源虚构。每个问题都必须是简单易懂的简短问句，并且必须保留当前选题里的关键词。只输出 JSON：{"questions":["...","...","..."]}。',
        },
        {
          role: 'user',
          content:
            `主题：${input.topic}\n` +
            `已选核心发现：${input.directionTitle}\n` +
            `发现摘要：${input.directionQuestion}\n` +
            `选题关键词：${anchorKeywords.join('、') || anchorLabel}\n` +
            `当前知识库来源标题：${input.sourceTitles.join('；')}\n\n` +
            `当前来源摘要与证据：\n${input.sourceEvidence}\n\n` +
            `请生成 3 个启发式研究问题，要求：\n` +
            `1) 必须直接基于当前来源中已有的结论、方法、变量或争议来追问；\n` +
            `2) 不重复；\n` +
            `3) 每条都必须和当前选题紧密相关，且至少包含一个选题关键词；\n` +
            `4) 每条只写一个问题本身，不要写过程、建议、解释或背景；\n` +
            `5) 使用简体中文，尽量简单易懂；\n` +
            `6) 每条控制在 8 到 22 个字，且必须是问句；\n` +
            `7) 如果来源不足以支持某个问题，不要编造，宁可少给。\n` +
            `输出 JSON。`,
        },
      ],
      stream: false,
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    return fallback;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = raw;
  }
  const content = extractTextFromContent(
    (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content ?? ''
  );
  const parsed = tryParseJson(content);
  const rawQuestions = parsed && typeof parsed === 'object' ? (parsed as { questions?: unknown }).questions : [];
  const generated = Array.isArray(rawQuestions)
    ? rawQuestions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 3)
    : [];

  const merged = [...generated, ...fallback];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of merged) {
    const key = normalizeStarterQuestion(item);
    if (!hasKeywordOverlap(key, anchorKeywords)) continue;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
    if (unique.length >= 3) break;
  }
  return unique.slice(0, 3);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: notebookId } = await params;
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    if (!access.canEditSources) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const directionId = typeof body?.directionId === 'string' ? body.directionId.trim() : '';
    if (!directionId) {
      return NextResponse.json({ error: 'directionId is required' }, { status: 400 });
    }

    const stateRow = await getLatestResearchState(notebookId);
    if (!stateRow?.state) {
      return NextResponse.json({ error: 'Research state not found' }, { status: 409 });
    }
    const selectedDirection = stateRow.state.directions.find((item) => item.id === directionId);
    if (!selectedDirection) {
      return NextResponse.json({ error: 'Selected finding not found' }, { status: 404 });
    }

    const totalBefore = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sources)
      .where(eq(sources.notebookId, notebookId))
      .then((rows) => Number(rows[0]?.count ?? 0));

    const readySources = await db
      .select({
        id: sources.id,
        title: sources.filename,
      })
      .from(sources)
      .where(and(eq(sources.notebookId, notebookId), eq(sources.status, 'READY')))
      .orderBy(desc(sources.createdAt));

    const keepSourceIds: string[] = [];
    if (readySources.length <= 12) {
      keepSourceIds.push(...readySources.map((s) => s.id));
    } else {
      const [queryEmbedding] = await createEmbeddings([
        `${selectedDirection.title}\n${selectedDirection.researchQuestion}\n${stateRow.state.topic}`,
      ]);
      const topChunks = await db
        .select({
          sourceId: sourceChunks.sourceId,
          distance: cosineDistance(sourceChunks.embedding, queryEmbedding),
        })
        .from(sourceChunks)
        .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
        .where(
          and(
            eq(sources.notebookId, notebookId),
            eq(sources.status, 'READY'),
            sql`${sourceChunks.embedding} is not null`
          )
        )
        .orderBy(cosineDistance(sourceChunks.embedding, queryEmbedding))
        .limit(240);

      const unique = new Set<string>();
      for (const row of topChunks) {
        if (unique.has(row.sourceId)) continue;
        unique.add(row.sourceId);
        keepSourceIds.push(row.sourceId);
        if (keepSourceIds.length >= 12) break;
      }
      if (keepSourceIds.length < 8) {
        for (const row of readySources) {
          if (!unique.has(row.id)) {
            unique.add(row.id);
            keepSourceIds.push(row.id);
          }
          if (keepSourceIds.length >= 8) break;
        }
      }
    }

    if (keepSourceIds.length > 0) {
      const allIds = await db
        .select({ id: sources.id })
        .from(sources)
        .where(eq(sources.notebookId, notebookId));
      const keepSet = new Set(keepSourceIds);
      const ids = allIds.map((row) => row.id).filter((id) => !keepSet.has(id));
      if (ids.length > 0) {
        await db.delete(sources).where(and(eq(sources.notebookId, notebookId), inArray(sources.id, ids)));
      }
    }

    await db
      .update(notebooks)
      .set({
        title: `${selectedDirection.title} · 研究`,
      })
      .where(eq(notebooks.id, notebookId));

    const keptSources = keepSourceIds.length
      ? await db
          .select({ title: sources.filename, id: sources.id })
          .from(sources)
          .where(and(eq(sources.notebookId, notebookId), inArray(sources.id, keepSourceIds)))
      : [];

    const keptEvidenceChunks = keepSourceIds.length
      ? await db
          .select({
            sourceId: sourceChunks.sourceId,
            sourceTitle: sources.filename,
            content: sourceChunks.content,
          })
          .from(sourceChunks)
          .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
          .where(and(eq(sources.notebookId, notebookId), inArray(sources.id, keepSourceIds)))
          .limit(24)
      : [];

    const sourceEvidence = keptEvidenceChunks
      .map((row, index) => `[来源${index + 1}] ${row.sourceTitle}\n${row.content}`)
      .join('\n\n')
      .slice(0, 16_000);

    const starterQuestions = await generateStarterQuestions({
      topic: stateRow.state.topic,
      directionTitle: selectedDirection.title,
      directionQuestion: selectedDirection.researchQuestion,
      sourceTitles: keptSources.map((s) => s.title).slice(0, 12),
      sourceEvidence,
    });

    const totalAfter = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sources)
      .where(eq(sources.notebookId, notebookId))
      .then((rows) => Number(rows[0]?.count ?? 0));

    const saved = await saveResearchState({
      notebookId,
      conversationId: stateRow.conversationId,
      state: {
        ...stateRow.state,
        phase: 'ready',
        selectedDirectionId: selectedDirection.id,
        starterQuestions,
        sourceStats: {
          totalBefore,
          totalAfter,
        },
        updatedAt: new Date().toISOString(),
      },
    });

    const intro = `已完成资料重整，当前选题为：**${selectedDirection.title}**。`;
    await addAssistantMessage({
      conversationId: saved.conversationId,
      content: intro,
    });

    return NextResponse.json({
      phase: 'ready',
      selectedDirection,
      starterQuestions,
      sourceStats: {
        totalBefore,
        totalAfter,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to select research direction' },
      { status: 500 }
    );
  }
}

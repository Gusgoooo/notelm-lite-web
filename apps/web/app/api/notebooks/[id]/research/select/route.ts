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

async function generateStarterQuestions(input: {
  topic: string;
  directionTitle: string;
  directionQuestion: string;
  sourceTitles: string[];
  sourceEvidence: string;
}): Promise<string[]> {
  const sourceLabel = input.sourceTitles.slice(0, 3);
  const fallback = [
    `请基于当前来源（如《${sourceLabel[0] || '当前来源1'}》）梳理“${input.directionTitle}”中被反复支持的核心变量，并指出还缺哪一类证据？`,
    `请对比当前来源在“${input.directionQuestion}”上的一致结论与分歧结论，哪部分最值得继续验证？`,
    `若要继续推进“${input.directionTitle}”，请根据现有来源说明下一步最该补哪类数据、样本或方法？`,
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
          content: '你是研究顾问。你只能基于给定来源证据提出下一步研究议题，不允许脱离来源虚构。只输出 JSON：{"questions":["...","...","..."]}。',
        },
        {
          role: 'user',
            content:
            `主题：${input.topic}\n` +
            `已选方向：${input.directionTitle}\n` +
            `核心问题：${input.directionQuestion}\n` +
            `当前知识库来源标题：${input.sourceTitles.join('；')}\n\n` +
            `当前来源摘要与证据：\n${input.sourceEvidence}\n\n` +
            `请生成 3 个启发式研究问题，要求：\n` +
            `1) 必须直接基于当前来源中已有的结论、方法、变量或争议来追问；\n` +
            `2) 不重复；\n` +
            `3) 面向下一步研究行动；\n` +
            `4) 使用简体中文；\n` +
            `5) 如果来源不足以支持某个问题，不要编造，宁可少给。\n` +
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
    const key = item.trim();
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
      return NextResponse.json({ error: 'Selected direction not found' }, { status: 404 });
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

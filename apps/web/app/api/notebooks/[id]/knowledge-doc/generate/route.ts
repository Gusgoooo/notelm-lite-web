import { NextResponse } from 'next/server';
import { and, db, eq, notes, sourceChunks, sources } from 'db';
import { chat } from 'shared';
import {
  getDefaultKnowledgeDocScenarioState,
  normalizeKnowledgeDocScenarioState,
  resolveKnowledgeDocScenario,
} from '@/lib/knowledge-doc-scenarios';
import {
  KNOWLEDGE_DOC_MARKDOWN_GUIDE,
  normalizeKnowledgeDocMarkdown,
} from '@/lib/knowledge-doc-markdown';
import { getNotebookAccess } from '@/lib/notebook-access';
import {
  KNOWLEDGE_DOC_NOTE_TITLE,
  KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE,
} from '@/lib/knowledge-unit';

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseScenarioState(raw: string | null | undefined) {
  if (!raw) return getDefaultKnowledgeDocScenarioState();
  try {
    return normalizeKnowledgeDocScenarioState(JSON.parse(raw));
  } catch {
    return getDefaultKnowledgeDocScenarioState();
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: notebookId } = await params;
  try {
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const rawScenarioId = typeof body?.scenarioId === 'string' ? body.scenarioId.trim() : '';
    const rawScenario = typeof body?.scenario === 'string' ? body.scenario.trim() : '';
    const rawMode = typeof body?.mode === 'string' ? body.mode.trim() : 'create';
    const mode = rawMode === 'update' ? 'update' : 'create';

    const [docRow, scenarioRow] = await Promise.all([
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

    const scenarioState = parseScenarioState(scenarioRow?.content);
    const selectedScenario = resolveKnowledgeDocScenario(
      scenarioState,
      rawScenarioId || rawScenario || scenarioState.activeScenarioId
    );

    const chunkLimit = mode === 'update' ? 72 : 56;
    const rows = await db
      .select({
        sourceTitle: sources.filename,
        content: sourceChunks.content,
      })
      .from(sourceChunks)
      .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
      .where(and(eq(sources.notebookId, notebookId), eq(sources.status, 'READY')))
      .limit(chunkLimit);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: '当前还没有可用来源，先上传文档或联网检索后再生成知识文档。' },
        { status: 409 }
      );
    }

    const currentContent = stripHtml(docRow?.content ?? '');
    const sourceContext = rows
      .map((row, index) => `[来源${index + 1}] ${row.sourceTitle}\n${row.content}`)
      .join('\n\n')
      .slice(0, 24_000);

    const systemPrompt = `你是知识文档起草助手。
你的任务是基于来源内容，按照给定结构，生成一份结构清晰、可直接继续编辑的知识文档。

输出要求：
1. 严格输出 Markdown。
2. 优先沿用指定结构，不要随意改写栏目顺序。
3. 如果信息不足，也要保留结构，并使用“待补充”占位，不要省略关键栏目。
4. 内容必须来自当前知识文档、来源和上下文，不要编造。
5. 风格要偏工作文档，便于后续继续编辑。
6. 如需表达对比、状态、指标、计划，可使用 Markdown 表格。
7. 不要输出代码块，不要输出任何额外解释。

${KNOWLEDGE_DOC_MARKDOWN_GUIDE}`;

    const userPrompt =
      `当前任务模式：${mode === 'update' ? '更新已有知识文档' : '生成新的知识文档初稿'}\n` +
      `目标场景：${selectedScenario.label}\n` +
      `必须遵循的输出结构：\n${selectedScenario.structure}\n\n` +
      `当前知识文档：\n${currentContent || '（空）'}\n\n` +
      `来源摘录：\n${sourceContext}\n\n` +
      (mode === 'update'
        ? '请在保留当前知识文档主线的前提下，按照上述结构吸收新来源内容，输出更新后的完整知识文档。'
        : '请直接按照上述结构生成一份可继续编辑的完整知识文档初稿。');

    const { content } = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    const suggestedContent = normalizeKnowledgeDocMarkdown(content ?? '');
    if (!suggestedContent) {
      return NextResponse.json({ error: '知识文档生成失败，请稍后重试。' }, { status: 500 });
    }

    return NextResponse.json({
      suggestedContent,
      scenarioId: selectedScenario.id,
      scenarioLabel: selectedScenario.label,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate knowledge document' },
      { status: 500 }
    );
  }
}

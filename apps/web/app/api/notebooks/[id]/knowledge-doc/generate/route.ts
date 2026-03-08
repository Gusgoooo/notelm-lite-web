import { NextResponse } from 'next/server';
import { and, db, eq, notes, sourceChunks, sources } from 'db';
import { chat } from 'shared';
import {
  getDefaultKnowledgeDocScenarioState,
  normalizeKnowledgeDocScenarioState,
  resolveKnowledgeDocScenario,
} from '@/lib/knowledge-doc-scenarios';
import {
  countKnowledgeDocUnits,
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

function getKnowledgeDocLengthBudget(currentContent: string, structure: string) {
  const currentUnits = countKnowledgeDocUnits(stripHtml(currentContent));
  if (currentUnits > 0) {
    return {
      baseline: currentUnits,
      min: Math.max(120, Math.round(currentUnits * 0.78)),
      max: Math.max(220, Math.round(currentUnits * 1.12)),
    };
  }

  const structureUnits = countKnowledgeDocUnits(structure);
  const baseline = Math.max(260, Math.min(620, Math.round(structureUnits * 2.1)));
  return {
    baseline,
    min: Math.max(200, Math.round(baseline * 0.74)),
    max: Math.max(340, Math.round(baseline * 1.1)),
  };
}

async function compressKnowledgeDocToBudget(
  markdown: string,
  structure: string,
  maxUnits: number
) {
  const normalized = normalizeKnowledgeDocMarkdown(markdown);
  if (!normalized) return normalized;
  if (countKnowledgeDocUnits(normalized) <= maxUnits) return normalized;

  const { content } = await chat([
    {
      role: 'system',
      content: `你是知识文档压缩整理助手。
请在不改变结构顺序的前提下，压缩已有知识文档。

要求：
1. 严格输出 Markdown。
2. 必须沿用既有结构和标题层级，不要新增结构外章节。
3. 优先删除重复、解释性套话、长句和弱相关细节。
4. 优先保留结论、关键事实、指标、负责人、风险和待补充项。
5. 输出长度必须控制在 ${maxUnits} 个字符单元以内。

${KNOWLEDGE_DOC_MARKDOWN_GUIDE}`,
    },
    {
      role: 'user',
      content:
        `【必须遵循的结构】\n${structure}\n\n` +
        `【待压缩文档】\n${normalized}\n\n` +
        `请输出压缩后的完整知识文档。`,
    },
  ]);

  return normalizeKnowledgeDocMarkdown(content ?? '') || normalized;
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

    const currentContent = docRow?.content ?? '';
    const lengthBudget = getKnowledgeDocLengthBudget(currentContent, selectedScenario.structure);
    const sourceContext = rows
      .map((row, index) => `[来源${index + 1}] ${row.sourceTitle}\n${row.content}`)
      .join('\n\n')
      .slice(0, 24_000);

    const systemPrompt = `你是知识文档起草助手。
你的任务是基于来源内容和项目说明，生成一份结构清晰、可直接继续编辑的知识文档。

输出要求：
1. 严格输出 Markdown。
2. 先从项目说明中推断最合适的知识文档结构，再严格按该结构输出完整文档。
3. 如果信息不足，也要保留必要栏目，并使用“待补充”占位，不要省略关键栏目。
4. 内容必须来自当前知识文档、来源和上下文，不要编造。
5. 风格要偏工作文档，便于后续继续编辑。
6. 如需表达对比、状态、指标、计划，可使用 Markdown 表格。
7. 不要输出代码块，不要输出任何额外解释。
8. 更新已有知识文档时，必须把当前知识文档视为当前版本下的权威版本，优先做替换、合并、删除和润色，不要只是在后面不断加字。
9. 除非用户明确要求扩写，更新模式下的总长度应尽量控制在当前版本附近，通过去重和压缩保证文档更紧凑。
10. 项目说明不只是文档结构要求，也包含回答风格、重点和引导方式；输出时要一并遵守。

${KNOWLEDGE_DOC_MARKDOWN_GUIDE}`;

    const userPrompt =
      `当前任务模式：${mode === 'update' ? '更新已有知识文档' : '生成新的知识文档初稿'}\n` +
      `目标场景：${selectedScenario.label}\n` +
      `必须遵循的项目说明：\n${selectedScenario.structure}\n\n` +
      `当前知识文档：\n${currentContent || '（空）'}\n\n` +
      `长度目标：\n${mode === 'update' ? `当前版本约 ${lengthBudget.baseline} 个字符单元，本次尽量控制在 ${lengthBudget.min}-${lengthBudget.max} 之间。` : `请尽量控制在 ${lengthBudget.min}-${lengthBudget.max} 个字符单元之间。`}\n\n` +
      `来源摘录：\n${sourceContext}\n\n` +
      (mode === 'update'
        ? '请在保留当前知识文档主线的前提下，按照上述项目说明吸收新来源内容，先确定最合适的章节结构，再输出更新后的完整知识文档。优先改写、替换、合并和删除已有内容，不要简单追加新段落。'
        : '请直接根据上述项目说明，先确定最合适的章节结构，再生成一份可继续编辑的完整知识文档初稿。');

    const { content } = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    let suggestedContent = normalizeKnowledgeDocMarkdown(content ?? '');
    if (mode === 'update' && suggestedContent) {
      suggestedContent = await compressKnowledgeDocToBudget(
        suggestedContent,
        selectedScenario.structure,
        lengthBudget.max
      );
    }
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

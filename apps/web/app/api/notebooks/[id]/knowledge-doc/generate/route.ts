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

function hasExplicitCondenseIntent(text: string): boolean {
  if (!text.trim()) return false;
  return /精简|精炼|缩短|压缩|删减|减少|简化|浓缩|更短|简洁一点|控制字数|少写|短一点/i.test(text);
}

function getKnowledgeDocLengthBudget(
  currentContent: string,
  structure: string,
  preferCondense: boolean
) {
  const currentUnits = countKnowledgeDocUnits(stripHtml(currentContent));
  if (currentUnits > 0) {
    if (preferCondense) {
      const min = Math.max(120, Math.round(currentUnits * 0.72));
      const max = Math.max(min + 40, Math.round(currentUnits * 0.96));
      return {
        baseline: currentUnits,
        min,
        max,
      };
    }
    const min = currentUnits + Math.max(18, Math.round(currentUnits * 0.03));
    const max = currentUnits + Math.max(56, Math.round(currentUnits * 0.09));
    return {
      baseline: currentUnits,
      min,
      max: Math.max(min + 24, max),
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

async function enrichKnowledgeDocToBudget(input: {
  markdown: string;
  structure: string;
  minUnits: number;
  maxUnits: number;
}): Promise<string> {
  const normalized = normalizeKnowledgeDocMarkdown(input.markdown);
  if (!normalized) return normalized;
  if (countKnowledgeDocUnits(normalized) >= input.minUnits) return normalized;

  const { content } = await chat([
    {
      role: 'system',
      content: `你是知识文档增量补全助手。
请在不改变结构顺序和标题层级的前提下，适度补充当前文档。

要求：
1. 严格输出 Markdown。
2. 必须沿用既有结构，禁止新增结构外章节。
3. 只补充高价值信息：关键事实、判断依据、执行细节、风险与待补充项。
4. 句子保持简洁，不要空话或重复。
5. 输出长度目标：${input.minUnits}-${input.maxUnits} 字符单元。

${KNOWLEDGE_DOC_MARKDOWN_GUIDE}`,
    },
    {
      role: 'user',
      content:
        `【必须遵循的结构】\n${input.structure}\n\n` +
        `【待补全文档】\n${normalized}\n\n` +
        `请输出补全后的完整知识文档。`,
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
    const rawUserIntent = typeof body?.userIntent === 'string' ? body.userIntent.trim() : '';
    const mode = rawMode === 'update' ? 'update' : 'create';
    const preferCondense = hasExplicitCondenseIntent(rawUserIntent);

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
    const lengthBudget = getKnowledgeDocLengthBudget(
      currentContent,
      selectedScenario.structure,
      preferCondense
    );
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
9. 默认采用“缓慢增量”策略：除非用户明确要求精简，更新模式下总长度应较当前版本小幅增加（建议增加 3%-9%），优先补充关键依据和可执行细节。
10. 项目说明不只是文档结构要求，也包含回答风格、重点和引导方式；输出时要一并遵守。

${KNOWLEDGE_DOC_MARKDOWN_GUIDE}`;

    const userPrompt =
      `当前任务模式：${mode === 'update' ? '更新已有知识文档' : '生成新的知识文档初稿'}\n` +
      `目标场景：${selectedScenario.label}\n` +
      `必须遵循的项目说明：\n${selectedScenario.structure}\n\n` +
      `当前知识文档：\n${currentContent || '（空）'}\n\n` +
      `长度目标：\n${
        mode === 'update'
          ? preferCondense
            ? `用户明确要求精简：当前版本约 ${lengthBudget.baseline} 个字符单元，本次控制在 ${lengthBudget.min}-${lengthBudget.max} 之间。`
            : `默认缓慢增量：当前版本约 ${lengthBudget.baseline} 个字符单元，本次尽量控制在 ${lengthBudget.min}-${lengthBudget.max} 之间。`
          : `请尽量控制在 ${lengthBudget.min}-${lengthBudget.max} 个字符单元之间。`
      }\n\n` +
      `来源摘录：\n${sourceContext}\n\n` +
      (mode === 'update'
        ? '请在保留当前知识文档主线的前提下，按照上述项目说明吸收新来源内容，先确定最合适的章节结构，再输出更新后的完整知识文档。优先改写、替换、合并和删除已有内容。若无“精简”要求，应进行小幅增量补充，而不是越改越短。'
        : '请直接根据上述项目说明，先确定最合适的章节结构，再生成一份可继续编辑的完整知识文档初稿。');

    const { content } = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    let suggestedContent = normalizeKnowledgeDocMarkdown(content ?? '');
    if (mode === 'update' && suggestedContent) {
      const currentUnits = countKnowledgeDocUnits(suggestedContent);
      if (!preferCondense && currentUnits < lengthBudget.min) {
        suggestedContent = await enrichKnowledgeDocToBudget({
          markdown: suggestedContent,
          structure: selectedScenario.structure,
          minUnits: lengthBudget.min,
          maxUnits: lengthBudget.max,
        });
      }
      if (countKnowledgeDocUnits(suggestedContent) > lengthBudget.max) {
        suggestedContent = await compressKnowledgeDocToBudget(
          suggestedContent,
          selectedScenario.structure,
          lengthBudget.max
        );
      }
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

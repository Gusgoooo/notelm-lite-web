import { NextResponse } from 'next/server';
import { and, db, eq, notes, sourceChunks, sources } from 'db';
import { chat } from 'shared';
import { getNotebookAccess } from '@/lib/notebook-access';
import { KNOWLEDGE_DOC_NOTE_TITLE } from '@/lib/knowledge-unit';

const DOC_SCENARIOS = {
  auto: {
    label: '自动选择',
    instruction:
      '请先判断这些来源更适合整理成哪种知识文档，再给出一份最适合继续工作和讨论的初稿。',
  },
  okr: {
    label: 'OKR撰写',
    instruction:
      '请将来源整理成一份可直接讨论的 OKR 初稿，突出目标、关键结果、衡量方式和当前依据。',
  },
  prd: {
    label: 'PRD撰写',
    instruction:
      '请将来源整理成一份偏产品需求文档的初稿，重点写清背景、目标用户、核心场景、功能方向和验证方式。',
  },
  prompt: {
    label: 'Prompt撰写',
    instruction:
      '请将来源整理成一份可执行的 Prompt 初稿，包含任务目标、输入信息、输出要求、约束条件和示例表达。',
  },
  analysis: {
    label: '分析报告',
    instruction:
      '请将来源整理成一份分析报告初稿，强调核心结论、关键依据、主要分歧、风险和后续建议。',
  },
  learning: {
    label: '知识学习',
    instruction:
      '请将来源整理成一份便于学习吸收的知识文档初稿，结构清晰，突出概念、脉络、重点结论和可继续追问的问题。',
  },
} as const;

type DocScenarioKey = keyof typeof DOC_SCENARIOS;

function isDocScenarioKey(value: string): value is DocScenarioKey {
  return value in DOC_SCENARIOS;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
    const rawScenario = typeof body?.scenario === 'string' ? body.scenario.trim() : 'auto';
    const scenario = isDocScenarioKey(rawScenario) ? rawScenario : 'auto';
    const rawMode = typeof body?.mode === 'string' ? body.mode.trim() : 'create';
    const mode = rawMode === 'update' ? 'update' : 'create';

    const [docRow] = await db
      .select({ content: notes.content })
      .from(notes)
      .where(and(eq(notes.notebookId, notebookId), eq(notes.title, KNOWLEDGE_DOC_NOTE_TITLE)))
      .limit(1);

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

    const scenarioConfig = DOC_SCENARIOS[scenario];
    const currentContent = stripHtml(docRow?.content ?? '');
    const sourceContext = rows
      .map((row, index) => `[来源${index + 1}] ${row.sourceTitle}\n${row.content}`)
      .join('\n\n')
      .slice(0, 24_000);

    const systemPrompt = `你是知识文档起草助手。
你的任务是基于来源内容，生成一份结构清晰、可以直接继续编辑的知识文档初稿。

输出要求：
1. 输出 Markdown，允许使用 #、##、### 标题和正文段落。
2. 不要输出代码块，不要使用表格。
3. 内容要具体，优先提炼来源里反复出现的结论、证据、争议和行动项。
4. 不要编造来源中没有的信息。
5. 文字风格偏工作文档，便于继续编辑，而不是写成聊天回复。`;

    const userPrompt =
      `当前任务模式：${mode === 'update' ? '更新已有知识文档' : '生成新的知识文档初稿'}\n` +
      `目标场景：${scenarioConfig.label}\n` +
      `场景要求：${scenarioConfig.instruction}\n\n` +
      `当前知识文档：\n${currentContent || '（空）'}\n\n` +
      `来源摘录：\n${sourceContext}\n\n` +
      (mode === 'update'
        ? '请在保留当前知识文档主线的前提下，吸收新来源内容，输出更新后的完整知识文档。'
        : '请直接生成一份可继续编辑的完整知识文档初稿。');

    const { content } = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    const suggestedContent = (content ?? '').trim();
    if (!suggestedContent) {
      return NextResponse.json({ error: '知识文档生成失败，请稍后重试。' }, { status: 500 });
    }

    return NextResponse.json({
      suggestedContent,
      scenario,
      scenarioLabel: scenarioConfig.label,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate knowledge document' },
      { status: 500 }
    );
  }
}

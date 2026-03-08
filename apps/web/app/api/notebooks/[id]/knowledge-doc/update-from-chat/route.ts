import { NextResponse } from 'next/server';
import { and, db, eq, notes } from 'db';
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
import { KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE } from '@/lib/knowledge-unit';

function parseScenarioState(raw: string | null | undefined) {
  if (!raw) return getDefaultKnowledgeDocScenarioState();
  try {
    return normalizeKnowledgeDocScenarioState(JSON.parse(raw));
  } catch {
    return getDefaultKnowledgeDocScenarioState();
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
  const baseline = Math.max(260, Math.min(520, Math.round(structureUnits * 1.8)));
  return {
    baseline,
    min: Math.max(180, Math.round(baseline * 0.72)),
    max: Math.max(320, Math.round(baseline * 1.08)),
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

/**
 * Given current doc content and recent conversation, ask LLM to produce
 * an updated knowledge document in structured Markdown.
 */
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
    const body = await request.json();
    const currentContent = typeof body?.currentContent === 'string' ? body.currentContent : '';
    const lastUserMessage = typeof body?.lastUserMessage === 'string' ? body.lastUserMessage : '';
    const lastAssistantMessage =
      typeof body?.lastAssistantMessage === 'string' ? body.lastAssistantMessage : '';
    const highlightedMaterials =
      typeof body?.highlightedMaterials === 'string' ? body.highlightedMaterials : '';
    const userEditedHint =
      typeof body?.userEditedHint === 'string' ? body.userEditedHint : '';

    const [scenarioRow] = await db
      .select({ content: notes.content })
      .from(notes)
      .where(and(eq(notes.notebookId, notebookId), eq(notes.title, KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE)))
      .limit(1);
    const scenarioState = parseScenarioState(scenarioRow?.content);
    const activeScenario = resolveKnowledgeDocScenario(scenarioState, scenarioState.activeScenarioId);

    if (!lastUserMessage.trim() && !lastAssistantMessage.trim() && !highlightedMaterials.trim()) {
      return NextResponse.json(
        { error: 'No conversation content to merge' },
        { status: 400 }
      );
    }

    const lengthBudget = getKnowledgeDocLengthBudget(currentContent, activeScenario.structure);

    const systemPrompt = `你是一个知识文档整理助手。根据用户与 AI 的对话内容，更新「当前知识文档」。
要求：
1. 将对话中的关键信息、结论、事实整合进文档，保持结构清晰（可分段、分条）。
2. 不要编造对话中未出现的内容。
3. 输出 Markdown，可使用 #、##、###、无序列表、加粗、表格等结构化格式。
4. 如果当前知识文档是 HTML，请先理解其现有结构，再用等价的 Markdown 完整输出。
5. 当前知识文档是当前版本下的权威版本。你必须把更新理解为对现有文档做增删改查，而不是简单追加内容。
6. 如果提供了“突出资料”，请将它与用户问题和助手回答一起吸收进文档，优先整理成可复用的结论、事实依据、要点列表。
7. 当前文档中已有内容视为用户撰写或修改过的，请尽量保留并在其基础上补充、替换、合并或删除，避免大段重写。
8. 优先整理成适合右侧知识文档面板直接渲染的结构化内容，例如标题、小节、要点列表。
9. 如果存在场景结构，请严格沿用该结构进行增量更新，信息不足的栏位使用“待补充”占位，不要删掉结构关键项。
10. 除非用户明确要求扩写，否则总字数应尽量控制在当前版本附近，默认通过润色、替换、压缩和去重来更新，不要越写越长。
11. 如果新信息与旧信息重复或冲突，优先合并或替换旧内容；如果某段已经过时或弱相关，应删除而不是保留。
12. 每个二级模块优先控制在 2-4 条要点或 1-2 个短段落内，句子尽量短。${
  userEditedHint
    ? `\n13. 以下内容为用户明确标注的手动编辑，请务必保留不改动：\n${userEditedHint}`
    : ''
}

${KNOWLEDGE_DOC_MARKDOWN_GUIDE}`;

    const userPrompt =
      `【当前知识文档（可能是 HTML）】\n${currentContent || '(空)'}\n\n` +
      `【当前场景】\n${activeScenario.label}\n\n` +
      `【当前场景结构】\n${activeScenario.structure}\n\n` +
      `【当前长度基线】\n当前版本约 ${lengthBudget.baseline} 个字符单元，本次更新尽量控制在 ${lengthBudget.min}-${lengthBudget.max} 之间。\n\n` +
      `【用户问题 / 用户要求】\n${lastUserMessage || '(空)'}\n\n` +
      `【助手回答】\n${lastAssistantMessage || '(空)'}\n\n` +
      `【突出资料】\n${highlightedMaterials || '(空)'}\n\n` +
      `请综合以上内容，输出更新后的完整知识文档内容（Markdown）。
操作优先级：
1. 先定位应修改的结构模块。
2. 优先改写、替换、合并已有内容。
3. 只有结构中缺少必要信息时，才新增少量内容。
4. 删除重复、过时、冲突或弱相关内容。
5. 让文档比当前版本更准、更紧凑，而不是更长。`;

    const { content: suggestedContent } = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    let trimmed = normalizeKnowledgeDocMarkdown(suggestedContent ?? '');
    if (trimmed) {
      trimmed = await compressKnowledgeDocToBudget(trimmed, activeScenario.structure, lengthBudget.max);
    }
    return NextResponse.json({
      suggestedContent: trimmed || currentContent,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to update knowledge document from chat' },
      { status: 500 }
    );
  }
}

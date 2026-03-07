import { NextResponse } from 'next/server';
import { and, db, eq, notes } from 'db';
import { chat } from 'shared';
import {
  getDefaultKnowledgeDocScenarioState,
  normalizeKnowledgeDocScenarioState,
  resolveKnowledgeDocScenario,
} from '@/lib/knowledge-doc-scenarios';
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

    const systemPrompt = `你是一个知识文档整理助手。根据用户与 AI 的对话内容，更新「当前知识文档」。
要求：
1. 将对话中的关键信息、结论、事实整合进文档，保持结构清晰（可分段、分条）。
2. 不要编造对话中未出现的内容。
3. 输出 Markdown，可使用 #、##、###、无序列表、加粗等结构化格式。
4. 如果当前知识文档是 HTML，请先理解其现有结构，再用等价的 Markdown 完整输出。
5. 如果提供了“突出资料”，请将它与用户问题和助手回答一起吸收进文档，优先整理成可复用的结论、事实依据、要点列表。
6. 当前文档中已有内容视为用户撰写或修改过的，请尽量保留并在其基础上补充或合并新信息，避免大段重写。
7. 优先整理成适合右侧知识文档面板直接渲染的结构化内容，例如标题、小节、要点列表。
8. 如果存在场景结构，请严格沿用该结构进行增量更新，信息不足的栏位使用“待补充”占位，不要删掉结构关键项。${
  userEditedHint
    ? `\n9. 以下内容为用户明确标注的手动编辑，请务必保留不改动：\n${userEditedHint}`
    : ''
}`;

    const userPrompt =
      `【当前知识文档（可能是 HTML）】\n${currentContent || '(空)'}\n\n` +
      `【当前场景】\n${activeScenario.label}\n\n` +
      `【当前场景结构】\n${activeScenario.structure}\n\n` +
      `【用户问题 / 用户要求】\n${lastUserMessage || '(空)'}\n\n` +
      `【助手回答】\n${lastAssistantMessage || '(空)'}\n\n` +
      `【突出资料】\n${highlightedMaterials || '(空)'}\n\n` +
      `请综合以上内容，输出更新后的完整知识文档内容（Markdown）：`;

    const { content: suggestedContent } = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    const trimmed = (suggestedContent ?? '').trim();
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

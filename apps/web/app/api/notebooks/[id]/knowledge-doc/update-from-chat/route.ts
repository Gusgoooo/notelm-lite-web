import { NextResponse } from 'next/server';
import { chat } from 'shared';
import { getNotebookAccess } from '@/lib/notebook-access';

/**
 * Given current doc content and recent conversation, ask LLM to produce
 * an updated knowledge document. Returns suggested content (plain text).
 * Caller can show diff and let user confirm, or apply when auto-update is on.
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
    const userEditedHint =
      typeof body?.userEditedHint === 'string' ? body.userEditedHint : '';

    if (!lastUserMessage.trim() && !lastAssistantMessage.trim()) {
      return NextResponse.json(
        { error: 'No conversation content to merge' },
        { status: 400 }
      );
    }

    const systemPrompt = `你是一个知识文档整理助手。根据用户与 AI 的对话内容，更新「当前知识文档」。
要求：
1. 将对话中的关键信息、结论、事实整合进文档，保持结构清晰（可分段、分条）。
2. 不要编造对话中未出现的内容。
3. 输出纯文本，不要使用 Markdown 标题符号（如 # ##），可用简短小标题或分段。
4. 当前文档中已有内容视为用户撰写或修改过的，请尽量保留并在其基础上补充或合并新信息，避免大段重写。${
  userEditedHint
    ? `\n5. 以下内容为用户明确标注的手动编辑，请务必保留不改动：\n${userEditedHint}`
    : ''
}`;

    const userPrompt = `【当前知识文档】\n${currentContent || '(空)'}\n\n【最近一轮对话】\n用户：${lastUserMessage}\n\n助手：${lastAssistantMessage}\n\n请输出更新后的完整知识文档内容（纯文本）：`;

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

import { NextResponse } from 'next/server';
import { chat } from 'shared';

type OutputType =
  | 'summary'
  | 'outline'
  | 'article'
  | 'email'
  | 'social'
  | 'table'
  | 'mindmap';

type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const OUTPUT_TEMPLATES: Record<
  OutputType,
  { title: string; instruction: string }
> = {
  summary: {
    title: '摘要',
    instruction:
      '产出精炼中文摘要，包含：核心结论、关键证据、可执行建议。使用 Markdown。',
  },
  outline: {
    title: '大纲',
    instruction:
      '产出结构化大纲，至少包含三级标题，适合后续扩写成长文。使用 Markdown。',
  },
  article: {
    title: '文章',
    instruction:
      '产出一篇中文长文草稿，包含标题、导语、分节正文、结尾行动建议。使用 Markdown。',
  },
  email: {
    title: '邮件',
    instruction:
      '产出一封专业中文邮件，包含主题建议、称呼、正文、行动项和礼貌收尾。',
  },
  social: {
    title: '社媒帖',
    instruction:
      '产出 3 条不同风格的中文社媒短帖，每条有标题句、要点和 CTA。',
  },
  table: {
    title: '对比表',
    instruction:
      '将信息整理成 Markdown 表格，字段清晰，可直接复制到文档中。',
  },
  mindmap: {
    title: '思维导图',
    instruction:
      '输出 Mermaid mindmap 代码块，结构层次清晰，节点名称简短。',
  },
};

function normalizeConversation(
  messages: unknown
): ConversationMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (m) =>
        m &&
        typeof m === 'object' &&
        'role' in m &&
        'content' in m &&
        ((m as { role?: string }).role === 'user' ||
          (m as { role?: string }).role === 'assistant') &&
        typeof (m as { content?: unknown }).content === 'string'
    )
    .map((m) => ({
      role: (m as { role: 'user' | 'assistant' }).role,
      content: (m as { content: string }).content.trim(),
    }))
    .filter((m) => m.content.length > 0);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId : '';
    const mode =
      body?.mode === 'selection' || body?.mode === 'conversation'
        ? body.mode
        : null;
    const outputType = (body?.outputType as OutputType) || 'summary';
    const selectedText =
      typeof body?.selectedText === 'string' ? body.selectedText.trim() : '';
    const conversation = normalizeConversation(body?.conversation);

    if (!notebookId) {
      return NextResponse.json({ error: 'notebookId is required' }, { status: 400 });
    }
    if (!mode) {
      return NextResponse.json({ error: 'mode is required' }, { status: 400 });
    }
    if (!OUTPUT_TEMPLATES[outputType]) {
      return NextResponse.json({ error: 'invalid outputType' }, { status: 400 });
    }
    if (mode === 'selection' && !selectedText) {
      return NextResponse.json(
        { error: 'selectedText is required in selection mode' },
        { status: 400 }
      );
    }
    if (mode === 'conversation' && conversation.length === 0) {
      return NextResponse.json(
        { error: 'conversation is required in conversation mode' },
        { status: 400 }
      );
    }

    const template = OUTPUT_TEMPLATES[outputType];
    const sourceContent =
      mode === 'selection'
        ? `片段内容：\n${selectedText}`
        : `会话内容：\n${conversation
            .map((m, i) => `${i + 1}. [${m.role}] ${m.content}`)
            .join('\n\n')}`;

    const systemPrompt =
      '你是一个内容生产助手。严格依据给定内容生成，不要编造未提供的信息。输出为中文。';
    const userPrompt = `任务类型：${template.title}\n要求：${template.instruction}\n\n${sourceContent}`;

    const { content } = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    return NextResponse.json({
      title: `${template.title} · ${new Date().toLocaleString('zh-CN')}`,
      outputType,
      mode,
      content: content.trim(),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Output generation failed' },
      { status: 500 }
    );
  }
}

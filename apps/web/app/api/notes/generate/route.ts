import { NextResponse } from 'next/server';
import { and, db, eq, inArray, notes } from 'db';
import { getAgentSettings } from '@/lib/agent-settings';
import { getNotebookAccess } from '@/lib/notebook-access';

type GenerateMode = 'infographic' | 'summary' | 'mindmap' | 'webpage' | 'paper_outline' | 'report';

type NoteRow = {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

const IMAGE_MODEL_FALLBACKS = [
  'google/gemini-3-pro-image-preview',
] as const;

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen: Record<string, boolean> = {};
  const list: string[] = [];
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen[normalized]) continue;
    seen[normalized] = true;
    list.push(normalized);
  }
  return list;
}

function normalizeImageModelAlias(value: string | undefined): string | undefined {
  if (!value) return value;
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.toLowerCase() === 'google/demini-3-pro-image-preview') {
    return 'google/gemini-3-pro-image-preview';
  }
  return normalized;
}

function generateNoteId(): string {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeNoteIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen: Record<string, boolean> = {};
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen[id]) continue;
    seen[id] = true;
    list.push(id);
  }
  return list;
}

function extractErrorMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object' &&
    'message' in payload.error &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message;
  }
  if (typeof payload === 'string') return payload;
  return 'Unknown error';
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const lines: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const obj = part as { type?: unknown; text?: unknown };
    if (obj.type === 'text' && typeof obj.text === 'string') {
      lines.push(obj.text);
    }
  }
  return lines.join('\n').trim();
}

function toDataUrl(base64: string, mimeType: string): string {
  const cleanBase64 = base64.replace(/\s+/g, '');
  return `data:${mimeType};base64,${cleanBase64}`;
}

function isImageUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith('data:image/') || v.startsWith('http://') || v.startsWith('https://');
}

function extractImageUrlFromText(text: string): string {
  const markdown = text.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+|data:image\/[^)]+)\)/i)?.[1];
  if (markdown && isImageUrl(markdown)) return markdown;
  const plain = text.match(/(https?:\/\/[^\s)]+)(?:\s|$)/i)?.[1];
  if (plain && isImageUrl(plain)) return plain;
  return '';
}

function extractImageDebugHint(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0] as { message?: unknown };
  if (!first?.message || typeof first.message !== 'object') return '';
  const message = first.message as { content?: unknown };
  const text = extractTextFromContent(message.content);
  if (!text) return '';
  return text.replace(/\s+/g, ' ').slice(0, 220);
}

function extractImageDataUrl(payload: unknown): { dataUrl: string; caption: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  let caption = '';
  const choices = (payload as { choices?: unknown }).choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as { message?: unknown };
    if (first?.message && typeof first.message === 'object') {
      const message = first.message as {
        content?: unknown;
        images?: Array<{
          image_url?: { url?: unknown } | unknown;
          imageUrl?: { url?: unknown } | unknown;
        }>;
      };
      caption = extractTextFromContent(message.content);

      const captionImageUrl = extractImageUrlFromText(caption);
      if (captionImageUrl) return { dataUrl: captionImageUrl, caption };

      const images = Array.isArray(message.images) ? message.images : [];
      for (const image of images) {
        const imageUrlObj =
          image && typeof image.image_url === 'object' && image.image_url
            ? (image.image_url as { url?: unknown })
            : null;
        const imageUrlAltObj =
          image && typeof image.imageUrl === 'object' && image.imageUrl
            ? (image.imageUrl as { url?: unknown })
            : null;
        const url =
          (typeof image?.image_url === 'string' && image.image_url) ||
          (imageUrlObj && typeof imageUrlObj.url === 'string' && imageUrlObj.url) ||
          (typeof image?.imageUrl === 'string' && image.imageUrl) ||
          (imageUrlAltObj && typeof imageUrlAltObj.url === 'string' && imageUrlAltObj.url) ||
          '';
        if (isImageUrl(url)) {
          return { dataUrl: url, caption };
        }
      }

      const content = Array.isArray(message.content) ? message.content : [];
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const obj = part as {
          type?: unknown;
          image_url?: unknown;
          imageUrl?: unknown;
          b64_json?: unknown;
          mime_type?: unknown;
          media_type?: unknown;
          url?: unknown;
        };
        const imageUrlValue =
          (typeof obj.image_url === 'string' && obj.image_url) ||
          (obj.image_url &&
          typeof obj.image_url === 'object' &&
          typeof (obj.image_url as { url?: unknown }).url === 'string'
            ? ((obj.image_url as { url: string }).url ?? '')
            : '') ||
          (typeof obj.imageUrl === 'string' && obj.imageUrl) ||
          (obj.imageUrl &&
          typeof obj.imageUrl === 'object' &&
          typeof (obj.imageUrl as { url?: unknown }).url === 'string'
            ? ((obj.imageUrl as { url: string }).url ?? '')
            : '') ||
          (typeof obj.url === 'string' && obj.url) ||
          '';
        if (imageUrlValue && isImageUrl(imageUrlValue)) {
          return { dataUrl: imageUrlValue, caption };
        }
        const b64 = typeof obj.b64_json === 'string' ? obj.b64_json : '';
        if (b64) {
          const mime =
            (typeof obj.mime_type === 'string' && obj.mime_type) ||
            (typeof obj.media_type === 'string' && obj.media_type) ||
            'image/png';
          return { dataUrl: toDataUrl(b64, mime), caption };
        }
      }
    }
  }

  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const row = item as {
        url?: unknown;
        b64_json?: unknown;
        mime_type?: unknown;
      };
      if (typeof row.url === 'string' && isImageUrl(row.url)) {
        return { dataUrl: row.url, caption };
      }
      if (typeof row.b64_json === 'string' && row.b64_json) {
        const mime = typeof row.mime_type === 'string' ? row.mime_type : 'image/png';
        return { dataUrl: toDataUrl(row.b64_json, mime), caption };
      }
    }
  }
  return null;
}

function buildSource(notesList: NoteRow[]): string {
  return notesList
    .map((note, idx) => `## Note ${idx + 1}: ${note.title}\n\n${note.content}`)
    .join('\n\n---\n\n');
}

type OpenRouterConfig = {
  apiKey: string;
  baseUrl: string;
};

async function requestOpenRouterImageGeneration(input: {
  config: OpenRouterConfig;
  model: string;
  prompt: string;
}): Promise<{ image: { dataUrl: string; caption: string } | null; error: string }> {
  const response = await fetch(`${input.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: 'user', content: input.prompt }],
      modalities: ['image', 'text'],
      stream: false,
      image_config: {
        aspect_ratio: '16:9',
        image_size: '2K',
      },
    }),
  });
  const raw = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = raw;
  }
  if (!response.ok) {
    return {
      image: null,
      error: `${response.status} ${extractErrorMessage(json)}`,
    };
  }
  const image = extractImageDataUrl(json);
  if (!image) {
    const hint = extractImageDebugHint(json);
    return {
      image: null,
      error: `no image returned${hint ? `; response="${hint}"` : ''}`,
    };
  }
  return { image, error: '' };
}

async function requestOpenRouterText(input: {
  config: OpenRouterConfig;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const response = await fetch(`${input.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
      stream: false,
    }),
  });
  const raw = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = raw;
  }
  if (!response.ok) {
    throw new Error(`OpenRouter error (${input.model}): ${response.status} ${extractErrorMessage(json)}`);
  }
  const parsed = json as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = extractTextFromContent(parsed.choices?.[0]?.message?.content ?? '');
  if (!content) {
    throw new Error(`OpenRouter error (${input.model}): empty response`);
  }
  return content;
}

function cleanSummaryText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanStructuredText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clipForPlanner(raw: string, maxChars: number): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars)}...`;
}

function extractHtmlBlock(content: string): string | null {
  const fenced = content.match(/```html\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const raw = content.trim();
  if (raw.startsWith('<!DOCTYPE html') || raw.startsWith('<html')) return raw;
  return null;
}

function extractMarkdownBlock(content: string): string {
  const fenced = content.match(/```markdown\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return fenced.trim();
  const generic = content.match(/```md\s*([\s\S]*?)```/i)?.[1];
  if (generic) return generic.trim();
  return content.trim();
}

async function generateSummary(source: string, config: OpenRouterConfig, model: string, rolePrompt: string) {
  const prompts = [
    `请将以下内容简化成一段清晰、精炼的中文摘要。\n要求：\n1) 保留核心结论、关键依据与必要限定；\n2) 只输出摘要正文；\n3) 不要标题，不要分点；\n4) 不需要强行限制固定字数，以信息完整且明显更简洁为准。\n\n${source}`,
  ];

  let best = '';
  for (let i = 0; i < 2; i += 1) {
    const attemptPrompt =
      prompts[i] ??
      `请将下面这段内容继续精炼成更自然的摘要，只输出一段正文：\n\n${best || source}`;
    const generated = await requestOpenRouterText({
      config,
      model,
      systemPrompt: rolePrompt,
      userPrompt: attemptPrompt,
    });
    const clean = cleanSummaryText(generated);
    best = clean;
    if (clean) return clean;
    prompts.push(`请将下面内容重写为一段更简洁、信息不丢失的摘要，只输出正文：\n\n${clean || source}`);
  }
  return cleanSummaryText(best || source);
}

async function generateMindmap(source: string, config: OpenRouterConfig, model: string, rolePrompt: string) {
  return requestOpenRouterText({
    config,
    model,
    systemPrompt: rolePrompt,
    userPrompt:
      `请把以下内容提炼为 Mermaid mindmap 代码。\n` +
      `要求：\n` +
      `1) 只输出一个 \`\`\`mermaid 代码块。\n` +
      `2) 使用 mindmap 语法。\n` +
      `3) 层级清晰、节点简短。\n\n${source}`,
  });
}

async function generateWebpage(source: string, config: OpenRouterConfig, model: string, rolePrompt: string) {
  const generated = await requestOpenRouterText({
    config,
    model,
    systemPrompt: rolePrompt,
    userPrompt:
      `请根据以下笔记内容生成一个“可交互”的互动PPT网页。\n` +
      `要求：\n` +
      `1) 输出一个完整 HTML（含内联 CSS/JS）；\n` +
      `2) 页面内包含至少两种交互（例如筛选、折叠、切换、排序、hover细节）；\n` +
      `3) 内容严格基于输入，不要虚构；\n` +
      `4) 仅输出一个 \`\`\`html 代码块。\n\n${source}`,
  });

  const html = extractHtmlBlock(generated);
  if (!html) return generated.trim();
  return `\`\`\`html\n${html}\n\`\`\``;
}

async function generateOutlineStructuredSummary(input: {
  source: string;
  config: OpenRouterConfig;
  model: string;
  rolePrompt: string;
  paperFormat: string;
}) {
  return requestOpenRouterText({
    config: input.config,
    model: input.model,
    systemPrompt: input.rolePrompt,
    userPrompt:
      `你将收到多条笔记，请先做“结构化综述”供后续大纲生成。\n` +
      `目标格式：${input.paperFormat}\n` +
      `输出要求：\n` +
      `1) 仅输出 Markdown；\n` +
      `2) 包含：核心研究问题、关键概念、变量关系、证据来源、方法选项、争议点、研究空白；\n` +
      `3) 使用短句和分层列表，保持紧凑；\n` +
      `4) 严格基于输入，不写论文正文。\n\n${input.source}`,
  });
}

async function generatePaperOutline(input: {
  source: string;
  config: OpenRouterConfig;
  model: string;
  rolePrompt: string;
  paperFormat: string;
}) {
  return requestOpenRouterText({
    config: input.config,
    model: input.model,
    systemPrompt: input.rolePrompt,
    userPrompt:
      `请根据以下资料撰写一份“可直接展开写作”的论文大纲（Markdown 格式）。\n` +
      `论文格式：${input.paperFormat}\n` +
      `要求：\n` +
      `1) 仅输出“论文大纲”，不要代写任何正文；\n` +
      `2) 包含：题目建议、摘要提纲、关键词、章节结构（至少5章）、每章段落目标；\n` +
      `3) 每个章节下给出“段落撰写规范”（写作目标、证据要求、常见错误）；\n` +
      `4) 全文使用简体中文；\n` +
      `5) 输出为标准 Markdown（包含标题、列表、表格均可）；\n` +
      `6) 仅基于输入内容，不要虚构事实。\n\n${input.source}`,
  });
}

async function generateReport(source: string, config: OpenRouterConfig, model: string, rolePrompt: string) {
  const generated = await requestOpenRouterText({
    config,
    model,
    systemPrompt: rolePrompt,
    userPrompt:
      `请根据以下内容生成一个“研究报告”网页（HTML），用于可视化展示和阅读。\n` +
      `要求：\n` +
      `1) 输出一个完整 HTML（含内联 CSS/JS）；\n` +
      `2) 报告结构至少含：摘要、关键发现、对比分析、方法与限制、行动建议；\n` +
      `3) 使用多种展示方式（信息卡、时间线、表格、折叠块等）；\n` +
      `4) 当涉及多组数据或多项指标时，必须包含图表可视化（可使用 Chart.js CDN）；\n` +
      `5) 设计风格简洁专业，适合汇报；\n` +
      `6) 严格基于输入，不编造。\n` +
      `7) 仅输出一个 \`\`\`html 代码块。\n\n${source}`,
  });

  const html = extractHtmlBlock(generated);
  if (!html) return generated.trim();
  return `\`\`\`html\n${html}\n\`\`\``;
}

async function buildInfographicBrief(input: {
  source: string;
  config: OpenRouterConfig;
  model: string;
  rolePrompt: string;
  ultraCompact?: boolean;
}): Promise<string> {
  const sourceCompact = input.source.replace(/\s+/g, ' ').trim();
  const passthroughLimit = input.ultraCompact ? 320 : 720;
  if (sourceCompact.length <= passthroughLimit) {
    return sourceCompact;
  }
  const clippedSource = clipForPlanner(input.source, input.ultraCompact ? 2400 : 4200);
  try {
    const brief = await requestOpenRouterText({
      config: input.config,
      model: input.model,
      systemPrompt: input.rolePrompt,
      userPrompt:
        `请将以下内容重组为“可直接用于信息图生图”的中文提纲。\n` +
        `输出要求：\n` +
        `1) 只输出纯文本，不要 Markdown，不要代码块；\n` +
        `2) 严格按这个结构输出：\n` +
        `标题：...\n核心结论：...\n要点1：...\n要点2：...\n要点3：...\n` +
        `若信息足够，可继续补充要点4-5、关键数据、行动建议；\n` +
        `3) 每一条都用短句，不解释，不铺陈，不写长段落；\n` +
        `4) ${input.ultraCompact ? '总长度控制在 220 字以内' : '总长度控制在 420 字以内'}；\n` +
        `5) 如果原文太长，优先压缩，不要遗漏核心结论与关键数据。\n\n${clippedSource}`,
    });
    const cleaned = cleanStructuredText(brief);
    return cleaned || clipForPlanner(sourceCompact, input.ultraCompact ? 220 : 420);
  } catch {
    return clipForPlanner(sourceCompact, input.ultraCompact ? 220 : 420);
  }
}

async function generateInfographic(input: {
  source: string;
  config: OpenRouterConfig;
  preferredModel: string;
  plannerModel: string;
  rolePrompt: string;
}): Promise<{ content: string; model: string }> {
  const models = uniqueNonEmpty(
    [input.preferredModel, ...IMAGE_MODEL_FALLBACKS].map((m) => normalizeImageModelAlias(m))
  );
  const errors: string[] = [];
  const structured = await buildInfographicBrief({
    source: input.source,
    config: input.config,
    model: input.plannerModel,
    rolePrompt: input.rolePrompt,
  });
  const ultraCompact = await buildInfographicBrief({
    source: structured || input.source,
    config: input.config,
    model: input.plannerModel,
    rolePrompt: input.rolePrompt,
    ultraCompact: true,
  });

  for (const model of models) {
    const prompts = [
      `请直接生成一张中文信息图图片，不要返回文字说明。\n` +
        `画面要求：16:9、现代扁平、信息卡片式布局、清晰留白、重点突出标题/关键数据/行动建议。\n` +
        `内容结构：\n${structured || input.source}`,
      `请直接生成一张更简洁的中文信息图图片，不要返回文字说明。\n` +
        `画面要求：16:9、中文、层级极清晰、少文字、高可读性。\n` +
        `仅保留最核心信息：\n${ultraCompact || structured || input.source}`,
    ];
    for (const prompt of prompts) {
      const result = await requestOpenRouterImageGeneration({
        config: input.config,
        model,
        prompt,
      });
      if (!result.image) {
        errors.push(`[${model}] ${result.error}`);
        continue;
      }
      const markdown =
        `![Infographic](${result.image.dataUrl})\n\n` +
        (result.image.caption ? `> ${result.image.caption}\n\n` : '') +
        `模型：\`${model}\``;
      return { content: markdown, model };
    }
  }
  throw new Error(`Image generation failed: ${errors.join(' | ')}`);
}

function buildTitle(mode: GenerateMode, selected: NoteRow[]): string {
  const base = selected.length === 1 ? selected[0].title : `Merged ${selected.length} notes`;
  if (mode === 'infographic') return `${base} · 信息图`;
  if (mode === 'summary') return `${base} · 简化摘要`;
  if (mode === 'paper_outline') return `${base} · 论文大纲`;
  if (mode === 'report') return `${base} · 报告`;
  if (mode === 'webpage') return `${base} · 互动PPT`;
  return `${base} · 思维导图`;
}

function normalizePaperFormat(input: unknown, allowed: string[]): string {
  const fallback = allowed[0] ?? '默认格式';
  if (typeof input !== 'string') return fallback;
  const value = input.trim();
  if (!value) return fallback;
  if (allowed.includes(value)) return value;
  return fallback;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId.trim() : '';
    const mode =
      body?.mode === 'infographic' ||
      body?.mode === 'summary' ||
      body?.mode === 'mindmap' ||
      body?.mode === 'webpage' ||
      body?.mode === 'paper_outline' ||
      body?.mode === 'report'
        ? (body.mode as GenerateMode)
        : null;
    const noteIds = normalizeNoteIds(body?.noteIds);
    const paperFormatInput = body?.paperFormat;

    if (!notebookId) {
      return NextResponse.json({ error: 'notebookId is required' }, { status: 400 });
    }
    if (!mode) {
      return NextResponse.json({ error: 'mode is required' }, { status: 400 });
    }
    if (noteIds.length === 0) {
      return NextResponse.json({ error: 'noteIds is required' }, { status: 400 });
    }

    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const selected = await db
      .select()
      .from(notes)
      .where(and(eq(notes.notebookId, notebookId), inArray(notes.id, noteIds)));
    if (selected.length !== noteIds.length) {
      return NextResponse.json({ error: 'Some notes were not found' }, { status: 404 });
    }
    const byId = new Map(selected.map((n) => [n.id, n]));
    const ordered = noteIds.map((id) => byId.get(id)).filter(Boolean) as NoteRow[];
    const source = buildSource(ordered);

    const settings = await getAgentSettings();
    const openrouterConfig: OpenRouterConfig = {
      apiKey: settings.openrouterApiKey.trim(),
      baseUrl: settings.openrouterBaseUrl.trim(),
    };
    if (!openrouterConfig.apiKey) {
      throw new Error('OpenRouter API key is not configured in admin settings');
    }
    const selectedPaperFormat = normalizePaperFormat(
      paperFormatInput,
      settings.paperOutlineFormats
    );

    let generatedContent = '';
    if (mode === 'summary') {
      generatedContent = await generateSummary(
        source,
        openrouterConfig,
        settings.models.summary,
        settings.prompts.summary
      );
    }
    if (mode === 'mindmap') {
      generatedContent = await generateMindmap(
        source,
        openrouterConfig,
        settings.models.mindmap,
        settings.prompts.mindmap
      );
    }
    if (mode === 'webpage') {
      generatedContent = await generateWebpage(
        source,
        openrouterConfig,
        settings.models.webpage,
        settings.prompts.webpage
      );
    }
    if (mode === 'paper_outline') {
      const outlineSource =
        ordered.length > 1
          ? await generateOutlineStructuredSummary({
              source,
              config: openrouterConfig,
              model: settings.models.paper_outline,
              rolePrompt: settings.prompts.paper_outline,
              paperFormat: selectedPaperFormat,
            })
          : source;
      const outline = await generatePaperOutline({
        source: outlineSource,
        config: openrouterConfig,
        model: settings.models.paper_outline,
        rolePrompt: settings.prompts.paper_outline,
        paperFormat: selectedPaperFormat,
      });
      generatedContent = extractMarkdownBlock(outline);
    }
    if (mode === 'report') {
      generatedContent = await generateReport(
        source,
        openrouterConfig,
        settings.models.webpage,
        settings.prompts.webpage
      );
    }
    if (mode === 'infographic') {
      const { content } = await generateInfographic({
        source,
        config: openrouterConfig,
        preferredModel: settings.models.infographic,
        plannerModel: settings.models.summary,
        rolePrompt: settings.prompts.infographic,
      });
      generatedContent = content;
    }

    const now = new Date();
    const newId = generateNoteId();
    const newTitle = buildTitle(mode, ordered);
    const newNote = {
      id: newId,
      notebookId,
      title: newTitle,
      content: generatedContent,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(notes).values(newNote);

    const [created] = await db.select().from(notes).where(eq(notes.id, newId));
    return NextResponse.json({
      note: created ?? newNote,
      mode,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to generate note content' },
      { status: 500 }
    );
  }
}

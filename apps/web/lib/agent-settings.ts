import { appSettings, db, eq } from 'db';

export type FeatureMode =
  | 'summary'
  | 'mindmap'
  | 'infographic'
  | 'webpage'
  | 'paper_outline'
  | 'report';

export type FeatureModels = Record<FeatureMode, string>;
export type FeaturePrompts = Record<FeatureMode, string>;

export type AgentSettings = {
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  models: FeatureModels;
  prompts: FeaturePrompts;
  paperOutlineFormats: string[];
};

const SETTINGS_ID = 'global';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const DEFAULT_MODELS: FeatureModels = {
  summary: process.env.OPENROUTER_CHAT_MODEL ?? process.env.CHAT_MODEL ?? 'openrouter/auto',
  mindmap: process.env.OPENROUTER_CHAT_MODEL ?? process.env.CHAT_MODEL ?? 'openrouter/auto',
  infographic:
    process.env.OPENROUTER_IMAGE_MODEL ??
    process.env.IMAGE_MODEL ??
    'google/gemini-3-pro-image-preview',
  webpage: process.env.OPENROUTER_CHAT_MODEL ?? process.env.CHAT_MODEL ?? 'openrouter/auto',
  paper_outline: process.env.OPENROUTER_CHAT_MODEL ?? process.env.CHAT_MODEL ?? 'openrouter/auto',
  report: process.env.OPENROUTER_CHAT_MODEL ?? process.env.CHAT_MODEL ?? 'openrouter/auto',
};

const DEFAULT_PROMPTS: FeaturePrompts = {
  summary:
    '你是中文信息压缩专家。严格基于用户输入，不要编造事实。输出简洁、准确、可读性高。',
  mindmap:
    '你是结构化知识整理助手。严格基于输入生成 Mermaid mindmap，层级清晰，节点短句，避免冗余说明。',
  infographic:
    '你是信息图设计助手。严格基于输入内容组织信息，优先突出核心结论、关键数据与可执行建议，保证可读性。',
  webpage:
    '你是互动PPT页面生成助手。你擅长输出单文件 HTML（内联 CSS/JS）并提供交互能力，风格清晰、可直接预览。',
  paper_outline:
    '你是论文大纲助手。严格基于输入输出结构化 Markdown 大纲，重点给出每个段落的撰写规范，不直接代写正文。',
  report:
    '你是研究报告生成助手。输出完整 HTML 报告，强调结构化信息呈现，必要时加入图表可视化。',
};

const DEFAULT_PAPER_OUTLINE_FORMATS = ['默认格式', '硕士学位论文', '本科毕业论文', '期刊'];

function toCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModelAlias(value: string): string {
  const normalized = value.trim();
  if (normalized.toLowerCase() === 'google/demini-3-pro-image-preview') {
    return 'google/gemini-3-pro-image-preview';
  }
  return normalized;
}

function mergeModels(input: unknown): FeatureModels {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    summary: normalizeModelAlias(toCleanString(raw.summary) || DEFAULT_MODELS.summary),
    mindmap: normalizeModelAlias(toCleanString(raw.mindmap) || DEFAULT_MODELS.mindmap),
    infographic: normalizeModelAlias(
      toCleanString(raw.infographic) || DEFAULT_MODELS.infographic
    ),
    webpage: normalizeModelAlias(toCleanString(raw.webpage) || DEFAULT_MODELS.webpage),
    paper_outline: normalizeModelAlias(
      toCleanString(raw.paper_outline) || DEFAULT_MODELS.paper_outline
    ),
    report: normalizeModelAlias(toCleanString(raw.report) || DEFAULT_MODELS.report),
  };
}

function mergePrompts(input: unknown): FeaturePrompts {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    summary: toCleanString(raw.summary) || DEFAULT_PROMPTS.summary,
    mindmap: toCleanString(raw.mindmap) || DEFAULT_PROMPTS.mindmap,
    infographic: toCleanString(raw.infographic) || DEFAULT_PROMPTS.infographic,
    webpage: toCleanString(raw.webpage) || DEFAULT_PROMPTS.webpage,
    paper_outline: toCleanString(raw.paper_outline) || DEFAULT_PROMPTS.paper_outline,
    report: toCleanString(raw.report) || DEFAULT_PROMPTS.report,
  };
}

function mergePaperOutlineFormats(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_PAPER_OUTLINE_FORMATS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length > 0 ? out.slice(0, 12) : [...DEFAULT_PAPER_OUTLINE_FORMATS];
}

export function getDefaultAgentSettings(): AgentSettings {
  return {
    openrouterApiKey: process.env.OPENROUTER_API_KEY?.trim() ?? '',
    openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_BASE_URL,
    models: { ...DEFAULT_MODELS },
    prompts: { ...DEFAULT_PROMPTS },
    paperOutlineFormats: [...DEFAULT_PAPER_OUTLINE_FORMATS],
  };
}

function normalizeRow(row: {
  openrouterApiKey: string | null;
  openrouterBaseUrl: string;
  models: unknown;
  prompts: unknown;
}): AgentSettings {
  const defaults = getDefaultAgentSettings();
  return {
    openrouterApiKey: toCleanString(row.openrouterApiKey) || defaults.openrouterApiKey,
    openrouterBaseUrl: toCleanString(row.openrouterBaseUrl) || defaults.openrouterBaseUrl,
    models: mergeModels(row.models),
    prompts: mergePrompts(row.prompts),
    paperOutlineFormats:
      mergePaperOutlineFormats(
        row.prompts && typeof row.prompts === 'object'
          ? (row.prompts as Record<string, unknown>).paperOutlineFormats
          : undefined
      ) || [...DEFAULT_PAPER_OUTLINE_FORMATS],
  };
}

export async function getAgentSettings(): Promise<AgentSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, SETTINGS_ID));
  if (!row) return getDefaultAgentSettings();
  return normalizeRow({
    openrouterApiKey: row.openrouterApiKey,
    openrouterBaseUrl: row.openrouterBaseUrl,
    models: row.models,
    prompts: row.prompts,
  });
}

export type AgentSettingsInput = Partial<{
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  models: Partial<FeatureModels>;
  prompts: Partial<FeaturePrompts>;
  paperOutlineFormats: string[];
}>;

export async function saveAgentSettings(input: AgentSettingsInput): Promise<AgentSettings> {
  const previous = await getAgentSettings();
  const openrouterApiKey = toCleanString(input.openrouterApiKey) || previous.openrouterApiKey;
  const openrouterBaseUrl = toCleanString(input.openrouterBaseUrl) || previous.openrouterBaseUrl;
  const models = mergeModels({ ...previous.models, ...(input.models ?? {}) });
  const prompts = mergePrompts({ ...previous.prompts, ...(input.prompts ?? {}) });
  const paperOutlineFormats = mergePaperOutlineFormats(
    Array.isArray(input.paperOutlineFormats) ? input.paperOutlineFormats : previous.paperOutlineFormats
  );
  const now = new Date();
  const storedPrompts = {
    ...prompts,
    paperOutlineFormats,
  };

  await db
    .insert(appSettings)
    .values({
      id: SETTINGS_ID,
      openrouterApiKey,
      openrouterBaseUrl,
      models,
      prompts: storedPrompts,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        openrouterApiKey,
        openrouterBaseUrl,
        models,
        prompts: storedPrompts,
        updatedAt: now,
      },
    });

  return getAgentSettings();
}

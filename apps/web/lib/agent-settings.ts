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
export type KnowledgeUnitTemplate = {
  id: string;
  label: string;
  role: string;
  description: string;
  dimensions: Array<{
    name: string;
    children: string[];
  }>;
};

export type AgentSettings = {
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  models: FeatureModels;
  prompts: FeaturePrompts;
  researchDirectionsPrompt: string;
  paperOutlineFormats: string[];
  knowledgeUnitTemplates: KnowledgeUnitTemplate[];
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
  report:
    process.env.OPENROUTER_REPORT_MODEL ??
    process.env.REPORT_MODEL ??
    'anthropic/claude-3.7-sonnet',
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
    '你是中文研究报告总编辑与信息设计师。你的任务是把给定材料重写成一份结构流畅、版式清晰、适合直接汇报的高质量 HTML 研究报告。严格基于输入，不编造事实。请优先保证：1) 逻辑顺序清楚，开头先给结论摘要；2) 章节层次明确，读者能快速扫读；3) 语言自然、克制、专业，不堆砌口号；4) 用信息卡片、对比表格、结论高亮、时间线、数据图表增强可读性；5) 样式浅色、留白充足、视觉干净；6) 对不确定内容明确标注限制与假设。',
};

const DEFAULT_PAPER_OUTLINE_FORMATS = ['默认格式', '硕士学位论文', '本科毕业论文', '期刊'];
const DEFAULT_RESEARCH_DIRECTIONS_PROMPT =
  '你是资深研究分析顾问。你只能基于用户提供的来源材料归纳核心发现，不允许脱离来源虚构。所有卡片都必须紧扣用户原始问题，并保留原问题中的关键关键词。请输出 JSON，格式为 {"directions":[...]}，不要输出 markdown，不要输出额外说明。';
const DEFAULT_KNOWLEDGE_UNIT_TEMPLATES: KnowledgeUnitTemplate[] = [
  {
    id: 'market_analyst',
    label: '市场研究顾问',
    role: '面向市场趋势、竞争格局、需求信号与用户决策链进行结构化分析。',
    description: '适合行业扫描、市场空间判断、需求变化跟踪。',
    dimensions: [
      { name: '市场机会', children: ['需求信号', '增长驱动', '进入门槛'] },
      { name: '竞争格局', children: ['主要玩家', '差异化', '替代风险'] },
    ],
  },
  {
    id: 'product_strategist',
    label: '产品策略顾问',
    role: '聚焦产品场景、用户痛点、方案路径与验证指标。',
    description: '适合产品探索、功能方向评估、场景优先级排序。',
    dimensions: [
      { name: '用户与场景', children: ['目标用户', '核心痛点', '使用场景'] },
      { name: '方案策略', children: ['方案路径', '验证指标', '风险约束'] },
    ],
  },
  {
    id: 'academic_reviewer',
    label: '学术综述顾问',
    role: '围绕研究问题、定义、方法、证据冲突与理论边界进行收敛。',
    description: '适合文献综述、学术研究设计、证据对齐。',
    dimensions: [
      { name: '研究框架', children: ['研究问题', '概念定义', '范围假设'] },
      { name: '证据结构', children: ['支持证据', '冲突证据', '研究空白'] },
    ],
  },
  {
    id: 'due_diligence',
    label: '投融资尽调顾问',
    role: '聚焦商业可行性、风险点、关键指标与验证材料。',
    description: '适合商业尽调、投资判断、项目风险盘点。',
    dimensions: [
      { name: '商业判断', children: ['收入逻辑', '成本结构', '增长约束'] },
      { name: '风险盘点', children: ['关键风险', '待验证事项', '下一步核验'] },
    ],
  },
];

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

function mergeKnowledgeUnitTemplates(input: unknown): KnowledgeUnitTemplate[] {
  if (!Array.isArray(input)) return [...DEFAULT_KNOWLEDGE_UNIT_TEMPLATES];
  const out: KnowledgeUnitTemplate[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = toCleanString(row.id) || `ku_tpl_${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const dimensions = Array.isArray(row.dimensions)
      ? (row.dimensions as Array<Record<string, unknown>>)
          .map((dim) => ({
            name: toCleanString(dim?.name),
            children: Array.isArray(dim?.children)
              ? dim.children
                  .filter((entry) => typeof entry === 'string')
                  .map((entry) => String(entry).trim())
                  .filter(Boolean)
                  .slice(0, 8)
              : [],
          }))
          .filter((dim) => dim.name)
          .slice(0, 8)
      : [];
    out.push({
      id,
      label: toCleanString(row.label) || id,
      role: toCleanString(row.role) || '基于当前主题进行结构化研究收敛。',
      description: toCleanString(row.description) || '',
      dimensions: dimensions.length > 0 ? dimensions : DEFAULT_KNOWLEDGE_UNIT_TEMPLATES[0].dimensions,
    });
  }
  return out.length > 0 ? out.slice(0, 8) : [...DEFAULT_KNOWLEDGE_UNIT_TEMPLATES];
}

export function getDefaultAgentSettings(): AgentSettings {
  return {
    openrouterApiKey: process.env.OPENROUTER_API_KEY?.trim() ?? '',
    openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_BASE_URL,
    models: { ...DEFAULT_MODELS },
    prompts: { ...DEFAULT_PROMPTS },
    researchDirectionsPrompt: DEFAULT_RESEARCH_DIRECTIONS_PROMPT,
    paperOutlineFormats: [...DEFAULT_PAPER_OUTLINE_FORMATS],
    knowledgeUnitTemplates: [...DEFAULT_KNOWLEDGE_UNIT_TEMPLATES],
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
    researchDirectionsPrompt:
      (row.prompts &&
      typeof row.prompts === 'object' &&
      typeof (row.prompts as Record<string, unknown>).researchDirectionsPrompt === 'string'
        ? toCleanString((row.prompts as Record<string, unknown>).researchDirectionsPrompt)
        : '') || DEFAULT_RESEARCH_DIRECTIONS_PROMPT,
    paperOutlineFormats:
      mergePaperOutlineFormats(
        row.prompts && typeof row.prompts === 'object'
          ? (row.prompts as Record<string, unknown>).paperOutlineFormats
          : undefined
      ) || [...DEFAULT_PAPER_OUTLINE_FORMATS],
    knowledgeUnitTemplates: mergeKnowledgeUnitTemplates(
      row.prompts && typeof row.prompts === 'object'
        ? (row.prompts as Record<string, unknown>).knowledgeUnitTemplates
        : undefined
    ),
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
  researchDirectionsPrompt: string;
  paperOutlineFormats: string[];
  knowledgeUnitTemplates: KnowledgeUnitTemplate[];
}>;

export async function saveAgentSettings(input: AgentSettingsInput): Promise<AgentSettings> {
  const previous = await getAgentSettings();
  const openrouterApiKey = toCleanString(input.openrouterApiKey) || previous.openrouterApiKey;
  const openrouterBaseUrl = toCleanString(input.openrouterBaseUrl) || previous.openrouterBaseUrl;
  const models = mergeModels({ ...previous.models, ...(input.models ?? {}) });
  const prompts = mergePrompts({ ...previous.prompts, ...(input.prompts ?? {}) });
  const researchDirectionsPrompt =
    toCleanString(input.researchDirectionsPrompt) || previous.researchDirectionsPrompt;
  const paperOutlineFormats = mergePaperOutlineFormats(
    Array.isArray(input.paperOutlineFormats) ? input.paperOutlineFormats : previous.paperOutlineFormats
  );
  const knowledgeUnitTemplates = mergeKnowledgeUnitTemplates(
    Array.isArray(input.knowledgeUnitTemplates) ? input.knowledgeUnitTemplates : previous.knowledgeUnitTemplates
  );
  const now = new Date();
  const storedPrompts = {
    ...prompts,
    researchDirectionsPrompt,
    paperOutlineFormats,
    knowledgeUnitTemplates,
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

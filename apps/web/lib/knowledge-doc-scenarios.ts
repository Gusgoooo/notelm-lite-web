export type BuiltinKnowledgeDocScenarioId =
  | 'auto'
  | 'okr'
  | 'prd'
  | 'prompt'
  | 'analysis'
  | 'learning';

export type KnowledgeDocScenarioId = BuiltinKnowledgeDocScenarioId | `custom-${string}`;

export type KnowledgeDocScenario = {
  id: KnowledgeDocScenarioId;
  presetKey: BuiltinKnowledgeDocScenarioId | 'custom';
  label: string;
  hint: string;
  structure: string;
  builtIn: boolean;
  accent: 'sky' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
};

export type KnowledgeDocScenarioState = {
  scenarios: KnowledgeDocScenario[];
  activeScenarioId: KnowledgeDocScenarioId | null;
};

export const KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE = '__KNOWLEDGE_DOC_SCENARIOS__';
export const KNOWLEDGE_DOC_SCENARIO_INSTRUCTION_PLACEHOLDER =
  '例如：“参考来源，确定科学的OKR撰写结构，并引导我一步一步回答撰写OKR所需要的内容。回答需要简洁且突出重点。”';
export const KNOWLEDGE_DOC_SCENARIO_EDITOR_HINT =
  '设置此项目的背景信息并自定义NotebookGo 的回复方式。';

export const DEFAULT_KNOWLEDGE_DOC_SCENARIOS: KnowledgeDocScenario[] = [
  {
    id: 'auto',
    presetKey: 'auto',
    label: '自动选择',
    hint: '根据来源自动归纳最适合的初稿结构',
    accent: 'sky',
    builtIn: true,
    structure:
      '参考来源，自动判断这个项目最适合怎样的知识文档结构。优先整理项目目标、核心结论、关键依据、待确认问题和下一步建议，并在对话中持续引导我补充最关键的信息。回答需要简洁、清楚、突出重点。',
  },
  {
    id: 'okr',
    presetKey: 'okr',
    label: 'OKR撰写',
    hint: '整理目标、关键结果和衡量方式',
    accent: 'emerald',
    builtIn: true,
    structure:
      '参考来源，确定科学、可执行的OKR撰写结构。优先整理周期、负责人、业务背景、目标、关键结果、衡量方式、风险和依赖，并引导我一步一步回答完成OKR所需要的内容。回答需要简洁且突出重点。',
  },
  {
    id: 'prd',
    presetKey: 'prd',
    label: 'PRD撰写',
    hint: '聚焦用户、场景、方案和验证',
    accent: 'amber',
    builtIn: true,
    structure:
      '参考来源，确定清晰的PRD撰写结构。优先整理背景、目标、目标用户、核心场景、方案设计、关键规则、成功指标、风险和待确认问题，并持续引导我补充写PRD所需要的关键信息。回答需要简洁、面向产品决策。',
  },
  {
    id: 'prompt',
    presetKey: 'prompt',
    label: 'Prompt撰写',
    hint: '沉淀任务目标、输入和输出约束',
    accent: 'violet',
    builtIn: true,
    structure:
      '参考来源，确定高质量Prompt的撰写结构。优先整理任务目标、角色设定、输入信息、输出格式、约束条件和示例，并引导我补齐写Prompt所需要的关键信息。回答需要简洁、明确、可直接复用。',
  },
  {
    id: 'analysis',
    presetKey: 'analysis',
    label: '分析报告',
    hint: '提炼结论、依据、风险和建议',
    accent: 'rose',
    builtIn: true,
    structure:
      '参考来源，确定分析报告的最佳结构。优先整理结论摘要、分析对象、关键发现、证据、风险、争议和建议动作，并在对话中持续引导我补充分析所需要的事实、判断和约束。回答需要简洁、突出重点、方便决策。',
  },
  {
    id: 'learning',
    presetKey: 'learning',
    label: '知识学习',
    hint: '生成便于学习吸收的结构化笔记',
    accent: 'slate',
    builtIn: true,
    structure:
      '参考来源，确定适合学习吸收的知识笔记结构。优先整理学习目标、核心概念、知识脉络、重点结论和后续问题，并引导我补充背景、难点和想重点掌握的内容。回答需要简洁、易理解、方便继续学习。',
  },
];

export function cloneKnowledgeDocScenario(scenario: KnowledgeDocScenario): KnowledgeDocScenario {
  return {
    ...scenario,
    structure: scenario.structure,
  };
}

export function getDefaultKnowledgeDocScenarioState(): KnowledgeDocScenarioState {
  return {
    scenarios: DEFAULT_KNOWLEDGE_DOC_SCENARIOS.map(cloneKnowledgeDocScenario),
    activeScenarioId: null,
  };
}

function toUniqueScenarioId(value: string): KnowledgeDocScenarioId {
  const trimmed = value.trim();
  if (!trimmed) {
    return `custom-${Date.now().toString(36)}` as KnowledgeDocScenarioId;
  }
  if (
    trimmed === 'auto' ||
    trimmed === 'okr' ||
    trimmed === 'prd' ||
    trimmed === 'prompt' ||
    trimmed === 'analysis' ||
    trimmed === 'learning' ||
    trimmed.startsWith('custom-')
  ) {
    return trimmed as KnowledgeDocScenarioId;
  }
  return `custom-${trimmed}` as KnowledgeDocScenarioId;
}

export function summarizeScenarioStructure(structure: string): string {
  const compact = structure.replace(/\s+/g, ' ').trim();
  if (!compact) return '自定义项目说明';
  const sentences = compact
    .split(/[。！？!?\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return (sentences[0] ?? compact).slice(0, 34);
}

function normalizeAccent(value: unknown): KnowledgeDocScenario['accent'] {
  if (value === 'sky' || value === 'emerald' || value === 'amber' || value === 'violet' || value === 'rose' || value === 'slate') {
    return value;
  }
  return 'slate';
}

function normalizeScenario(value: unknown): KnowledgeDocScenario | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<KnowledgeDocScenario>;
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 40) : '';
  const structure = typeof raw.structure === 'string' ? raw.structure.trim().slice(0, 12000) : '';
  if (!label || !structure) return null;
  const presetKey =
    raw.presetKey === 'auto' ||
    raw.presetKey === 'okr' ||
    raw.presetKey === 'prd' ||
    raw.presetKey === 'prompt' ||
    raw.presetKey === 'analysis' ||
    raw.presetKey === 'learning'
      ? raw.presetKey
      : 'custom';
  return {
    id: toUniqueScenarioId(typeof raw.id === 'string' ? raw.id : `custom-${Date.now().toString(36)}`),
    presetKey,
    label,
    hint:
      typeof raw.hint === 'string' && raw.hint.trim()
        ? raw.hint.trim().slice(0, 60)
        : summarizeScenarioStructure(structure),
    structure,
    builtIn: raw.builtIn === true && presetKey !== 'custom',
    accent: normalizeAccent(raw.accent),
  };
}

export function normalizeKnowledgeDocScenarioState(value: unknown): KnowledgeDocScenarioState {
  const base = getDefaultKnowledgeDocScenarioState();
  if (!value || typeof value !== 'object') {
    return base;
  }

  const raw = value as Partial<KnowledgeDocScenarioState>;
  const customScenarios = Array.isArray(raw.scenarios)
    ? raw.scenarios
        .map((item) => normalizeScenario(item))
        .filter((item): item is KnowledgeDocScenario => Boolean(item))
        .filter((item) => item.presetKey === 'custom')
    : [];
  const scenarios = [...base.scenarios, ...customScenarios];
  const activeScenarioId =
    typeof raw.activeScenarioId === 'string' && scenarios.some((item) => item.id === raw.activeScenarioId)
      ? (raw.activeScenarioId as KnowledgeDocScenarioId)
      : null;

  return {
    scenarios,
    activeScenarioId,
  };
}

export function resolveKnowledgeDocScenario(
  state: KnowledgeDocScenarioState | null | undefined,
  scenarioId?: string | null
): KnowledgeDocScenario {
  const normalized = state ?? getDefaultKnowledgeDocScenarioState();
  const matchId =
    (typeof scenarioId === 'string' && scenarioId.trim()) ||
    normalized.activeScenarioId ||
    'auto';
  const matched = normalized.scenarios.find((item) => item.id === matchId || item.presetKey === matchId);
  return matched ? cloneKnowledgeDocScenario(matched) : cloneKnowledgeDocScenario(normalized.scenarios[0]);
}

export function extractScenarioPromptAnchors(structure: string, limit = 3): string[] {
  const parts = structure
    .replace(/[“”"']/g, '')
    .split(/[。！？!?\n]/)
    .flatMap((sentence) => sentence.split(/[，、；;]/))
    .map((item) =>
      item
        .trim()
        .replace(/^参考来源[,，]?/, '')
        .replace(/^设置此项目的背景信息并自定义NotebookGo 的回复方式[,，]?/, '')
        .replace(/^回答需要/, '')
        .replace(/^并/, '')
        .replace(/的内容$/, '')
        .replace(/[:：]$/, '')
        .trim()
    )
    .filter(Boolean)
    .filter((item) => item.length >= 4);
  return parts.slice(0, limit);
}

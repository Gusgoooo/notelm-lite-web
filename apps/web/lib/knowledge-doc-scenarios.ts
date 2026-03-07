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

export const DEFAULT_KNOWLEDGE_DOC_SCENARIOS: KnowledgeDocScenario[] = [
  {
    id: 'auto',
    presetKey: 'auto',
    label: '自动选择',
    hint: '根据来源自动归纳最适合的初稿结构',
    accent: 'sky',
    builtIn: true,
    structure: `# 文档目标
- 这份文档要解决什么问题
- 适用对象是谁

## 核心结论
- 结论 1：
- 结论 2：
- 结论 3：

## 关键依据
- 依据 1：
- 依据 2：
- 依据 3：

## 待确认问题
- 还缺什么信息
- 哪些判断仍需验证

## 下一步建议
- 建议动作 1：
- 建议动作 2：`,
  },
  {
    id: 'okr',
    presetKey: 'okr',
    label: 'OKR撰写',
    hint: '整理目标、关键结果和衡量方式',
    accent: 'emerald',
    builtIn: true,
    structure: `# OKR草案
## 基本信息
- 周期：
- 负责人：
- 背景：

## O1：目标一
- 目标说明：
- 为什么做：
- 成功标志：

### KR1：
- 当前基线：
- 目标值：
- 衡量口径：
- 关键举措：

### KR2：
- 当前基线：
- 目标值：
- 衡量口径：
- 关键举措：

### KR3：
- 当前基线：
- 目标值：
- 衡量口径：
- 关键举措：

## 风险与依赖
- 风险：
- 外部依赖：

## 待补充信息
- 还缺哪些业务事实或资源信息：`,
  },
  {
    id: 'prd',
    presetKey: 'prd',
    label: 'PRD撰写',
    hint: '聚焦用户、场景、方案和验证',
    accent: 'amber',
    builtIn: true,
    structure: `# PRD初稿
## 1. 背景与目标
- 背景：
- 要解决的问题：
- 业务目标：

## 2. 目标用户
- 主要用户：
- 关键痛点：
- 使用环境：

## 3. 核心场景
### 场景 1
- 触发条件：
- 用户任务：
- 当前问题：

### 场景 2
- 触发条件：
- 用户任务：
- 当前问题：

## 4. 方案设计
- 功能模块：
- 核心流程：
- 关键规则：

## 5. 指标与验证
- 成功指标：
- 验证方式：

## 6. 风险与待确认
- 风险：
- 待确认问题：`,
  },
  {
    id: 'prompt',
    presetKey: 'prompt',
    label: 'Prompt撰写',
    hint: '沉淀任务目标、输入和输出约束',
    accent: 'violet',
    builtIn: true,
    structure: `# Prompt草案
## 任务目标
- 要完成什么任务：
- 最终希望达到什么效果：

## 角色设定
- 模型应扮演的角色：
- 回答风格：

## 输入信息
- 用户会提供什么信息：
- 必填字段：
- 可选字段：

## 输出要求
- 输出格式：
- 输出结构：
- 长度要求：

## 约束条件
- 必须遵守的限制：
- 不允许出现的内容：

## 示例
### 输入示例
- 

### 输出示例
- `,
  },
  {
    id: 'analysis',
    presetKey: 'analysis',
    label: '分析报告',
    hint: '提炼结论、依据、风险和建议',
    accent: 'rose',
    builtIn: true,
    structure: `# 分析报告
## 1. 结论摘要
- 核心结论 1：
- 核心结论 2：
- 核心结论 3：

## 2. 分析对象与范围
- 分析对象：
- 范围界定：
- 关键假设：

## 3. 关键发现
### 发现 1
- 现象：
- 证据：
- 影响：

### 发现 2
- 现象：
- 证据：
- 影响：

## 4. 风险与争议
- 风险：
- 不确定性：
- 争议点：

## 5. 建议动作
- 建议 1：
- 建议 2：
- 建议 3：`,
  },
  {
    id: 'learning',
    presetKey: 'learning',
    label: '知识学习',
    hint: '生成便于学习吸收的结构化笔记',
    accent: 'slate',
    builtIn: true,
    structure: `# 学习笔记
## 学习目标
- 这次要学会什么：
- 学完后能解决什么问题：

## 核心概念
### 概念 1
- 定义：
- 为什么重要：
- 示例：

### 概念 2
- 定义：
- 为什么重要：
- 示例：

## 知识脉络
- 主题之间的关系：
- 关键前提：
- 常见误区：

## 重点结论
- 结论 1：
- 结论 2：
- 结论 3：

## 继续追问的问题
- 问题 1：
- 问题 2：
- 问题 3：`,
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
  const lines = structure
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^#+\s*/, '').replace(/^[-*+]\s*/, ''));
  if (lines.length === 0) return '自定义结构';
  return lines.slice(0, 2).join(' · ').slice(0, 34);
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
  return structure
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^#{1,3}\s+/.test(line) || /^[-*+]\s+/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, '').replace(/^[-*+]\s+/, '').replace(/[:：]$/, ''))
    .filter(Boolean)
    .slice(0, limit);
}

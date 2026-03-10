import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type IntentType = 'qa' | 'doc_edit' | 'doc_replace';
export type IntentConfidence = 'high' | 'medium' | 'low';
export type IntentTargetScope = 'none' | 'section' | 'full_document';
export type IntentAnswerMode = 'source_grounded_only' | 'preview_edit' | 'preview_replace';
export type IntentConfirmUpdateMode = 'incremental_merge' | 'apply_edit' | 'apply_replace';
export type QaUpdatePolicy = 'extract_compare_minimal_merge' | 'n_a';

export type IntentRoutingResult = {
  intent_type: IntentType;
  confidence: IntentConfidence;
  target_scope: IntentTargetScope;
  answer_mode: IntentAnswerMode;
  citation_required: boolean;
  allow_no_source_answer: boolean;
  show_update_button: true;
  requires_user_confirm_to_apply: true;
  on_confirm_update_mode: IntentConfirmUpdateMode;
  qa_update_policy: QaUpdatePolicy;
  reason_codes: string[];
  notes: string;
};

type IntentRouterInput = {
  userMessage: string;
  hasActiveDoc: boolean;
  recentMessages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
};

type IntentRouterSchema = {
  required?: string[];
  properties?: Record<string, { enum?: string[] }>;
};

export const INTENT_ROUTING_FALLBACK: IntentRoutingResult = {
  intent_type: 'qa',
  confidence: 'low',
  target_scope: 'none',
  answer_mode: 'source_grounded_only',
  citation_required: true,
  allow_no_source_answer: false,
  show_update_button: true,
  requires_user_confirm_to_apply: true,
  on_confirm_update_mode: 'incremental_merge',
  qa_update_policy: 'extract_compare_minimal_merge',
  reason_codes: ['DISCUSSION_MODE'],
  notes: 'fallback due to invalid router output',
};

type IntentRouterArtifacts = {
  systemPrompt: string;
  schema: IntentRouterSchema | null;
  fewshots: string[];
};

type IntentRouterValidation = {
  isValid: boolean;
  usedFallback: boolean;
  errors: string[];
};

type IntentRouterOutput = {
  result: IntentRoutingResult;
  validation: IntentRouterValidation;
};

let artifactsPromise: Promise<IntentRouterArtifacts> | null = null;

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeFewshotLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readIntentRouterArtifacts(): Promise<IntentRouterArtifacts> {
  const cwd = process.cwd();
  const candidateDirs = [
    path.join(cwd, 'prompts', 'intent-router'),
    path.join(cwd, '..', 'prompts', 'intent-router'),
    path.join(cwd, '..', '..', 'prompts', 'intent-router'),
  ];

  const readFromCandidates = async (filename: string): Promise<string> => {
    for (const dir of candidateDirs) {
      const fullPath = path.join(dir, filename);
      try {
        return await readFile(fullPath, 'utf8');
      } catch {
        continue;
      }
    }
    return '';
  };

  const [systemPromptRaw, schemaRaw, fewshotRaw] = await Promise.all([
    readFromCandidates('system_prompt.txt'),
    readFromCandidates('intent_schema.json'),
    readFromCandidates('fewshot_examples.jsonl'),
  ]);
  return {
    systemPrompt: systemPromptRaw.trim(),
    schema: (parseJsonSafe(schemaRaw) as IntentRouterSchema | null) ?? null,
    fewshots: normalizeFewshotLines(fewshotRaw),
  };
}

export async function loadIntentRouterArtifacts(): Promise<IntentRouterArtifacts> {
  if (!artifactsPromise) {
    artifactsPromise = readIntentRouterArtifacts();
  }
  return artifactsPromise;
}

function enumFromSchema(
  schema: IntentRouterSchema | null,
  field: string,
  fallback: string[]
): string[] {
  const values = schema?.properties?.[field]?.enum;
  if (!Array.isArray(values) || values.length === 0) return fallback;
  return values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function requiredFieldsFromSchema(schema: IntentRouterSchema | null): string[] {
  if (!Array.isArray(schema?.required)) {
    return [
      'intent_type',
      'confidence',
      'target_scope',
      'answer_mode',
      'citation_required',
      'allow_no_source_answer',
      'show_update_button',
      'requires_user_confirm_to_apply',
      'on_confirm_update_mode',
      'qa_update_policy',
      'reason_codes',
      'notes',
    ];
  }
  return schema.required.filter((item): item is string => typeof item === 'string');
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function validateIntentRoutingResult(
  value: unknown,
  schema: IntentRouterSchema | null
): { valid: boolean; errors: string[]; normalized: IntentRoutingResult | null } {
  const errors: string[] = [];
  const obj = toObject(value);
  if (!obj) {
    return {
      valid: false,
      errors: ['router output is not an object'],
      normalized: null,
    };
  }

  const required = requiredFieldsFromSchema(schema);
  for (const field of required) {
    if (!(field in obj)) errors.push(`missing required field: ${field}`);
  }

  const intentTypeEnums = enumFromSchema(schema, 'intent_type', ['qa', 'doc_edit', 'doc_replace']);
  const confidenceEnums = enumFromSchema(schema, 'confidence', ['high', 'medium', 'low']);
  const targetScopeEnums = enumFromSchema(schema, 'target_scope', ['none', 'section', 'full_document']);
  const answerModeEnums = enumFromSchema(schema, 'answer_mode', ['source_grounded_only', 'preview_edit', 'preview_replace']);
  const confirmModeEnums = enumFromSchema(schema, 'on_confirm_update_mode', ['incremental_merge', 'apply_edit', 'apply_replace']);
  const qaPolicyEnums = enumFromSchema(schema, 'qa_update_policy', ['extract_compare_minimal_merge', 'n_a']);
  const reasonCodeEnums = enumFromSchema(schema, 'reason_codes', []);

  const intent_type = typeof obj.intent_type === 'string' ? obj.intent_type : '';
  const confidence = typeof obj.confidence === 'string' ? obj.confidence : '';
  const target_scope = typeof obj.target_scope === 'string' ? obj.target_scope : '';
  const answer_mode = typeof obj.answer_mode === 'string' ? obj.answer_mode : '';
  const citation_required = typeof obj.citation_required === 'boolean' ? obj.citation_required : null;
  const allow_no_source_answer = typeof obj.allow_no_source_answer === 'boolean' ? obj.allow_no_source_answer : null;
  const show_update_button = obj.show_update_button === true;
  const requires_user_confirm_to_apply = obj.requires_user_confirm_to_apply === true;
  const on_confirm_update_mode =
    typeof obj.on_confirm_update_mode === 'string' ? obj.on_confirm_update_mode : '';
  const qa_update_policy = typeof obj.qa_update_policy === 'string' ? obj.qa_update_policy : '';
  const reason_codes = Array.isArray(obj.reason_codes) ? obj.reason_codes : null;
  const notes = typeof obj.notes === 'string' ? obj.notes.trim() : '';

  if (!intentTypeEnums.includes(intent_type)) errors.push('invalid intent_type');
  if (!confidenceEnums.includes(confidence)) errors.push('invalid confidence');
  if (!targetScopeEnums.includes(target_scope)) errors.push('invalid target_scope');
  if (!answerModeEnums.includes(answer_mode)) errors.push('invalid answer_mode');
  if (citation_required == null) errors.push('invalid citation_required');
  if (allow_no_source_answer == null) errors.push('invalid allow_no_source_answer');
  if (!show_update_button) errors.push('show_update_button must be true');
  if (!requires_user_confirm_to_apply) errors.push('requires_user_confirm_to_apply must be true');
  if (!confirmModeEnums.includes(on_confirm_update_mode)) errors.push('invalid on_confirm_update_mode');
  if (!qaPolicyEnums.includes(qa_update_policy)) errors.push('invalid qa_update_policy');
  if (!reason_codes || reason_codes.length === 0) {
    errors.push('reason_codes must be a non-empty array');
  } else {
    for (const code of reason_codes) {
      if (typeof code !== 'string') {
        errors.push('reason_codes must only contain strings');
        continue;
      }
      if (reasonCodeEnums.length > 0 && !reasonCodeEnums.includes(code)) {
        errors.push(`invalid reason_code: ${code}`);
      }
    }
  }
  if (!notes) errors.push('notes is required');

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  return {
    valid: true,
    errors: [],
    normalized: {
      intent_type: intent_type as IntentType,
      confidence: confidence as IntentConfidence,
      target_scope: target_scope as IntentTargetScope,
      answer_mode: answer_mode as IntentAnswerMode,
      citation_required: citation_required as boolean,
      allow_no_source_answer: allow_no_source_answer as boolean,
      show_update_button: true,
      requires_user_confirm_to_apply: true,
      on_confirm_update_mode: on_confirm_update_mode as IntentConfirmUpdateMode,
      qa_update_policy: qa_update_policy as QaUpdatePolicy,
      reason_codes: (reason_codes as string[]).slice(0, 8),
      notes: notes.slice(0, 260),
    },
  };
}

function toRecentContext(
  recentMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> | undefined
): string {
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) return '';
  return recentMessages
    .slice(-5)
    .map((item) => `${item.role}: ${item.content.replace(/\s+/g, ' ').slice(0, 180)}`)
    .join(' | ');
}

function buildHeuristicIntent(input: IntentRouterInput): IntentRoutingResult {
  const text = input.userMessage.trim();
  const lower = text.toLowerCase();
  const recent = toRecentContext(input.recentMessages);

  const hasReplaceSignal =
    /(替换|覆盖|全部换成|全部改成|整篇重写|原来的不要了|全量替换|整份替换|重做整篇|doc_replace)/i.test(text);
  const hasEditAction =
    /(写成|改成|修改|删掉|删除|补充|重写|润色|精简|压缩|扩写|写进|写入|补到|并入|合并到|整理到文档|更新文档)/i.test(text);
  const hasObjectReference =
    /(知识文档|右侧文档|当前文档|这份文档|这段|这一段|上面的内容|该章节|该段落|文档里)/i.test(text);
  const isShortFeedback = text.length <= 16 && /(太长|太短|不清楚|简一点|详细一点|改一下|不对|重来)/i.test(text);
  const editingModeHint = /(改稿|改写|润色|文档结构|章节|段落)/i.test(recent);
  const discussionModeHint = /(为什么|如何|怎么看|是否|哪些|风险|原因|结论|证据)/i.test(text);

  if (hasReplaceSignal) {
    return {
      intent_type: 'doc_replace',
      confidence: 'high',
      target_scope: 'full_document',
      answer_mode: 'preview_replace',
      citation_required: false,
      allow_no_source_answer: true,
      show_update_button: true,
      requires_user_confirm_to_apply: true,
      on_confirm_update_mode: 'apply_replace',
      qa_update_policy: 'n_a',
      reason_codes: ['HAS_REPLACE_SIGNAL', 'OBJECT_OPERATION'],
      notes: '检测到整体替换信号，先返回整篇替换预览，点击后再应用。',
    };
  }

  if (hasEditAction && (hasObjectReference || input.hasActiveDoc || isShortFeedback || editingModeHint)) {
    return {
      intent_type: 'doc_edit',
      confidence: hasObjectReference || hasEditAction ? 'high' : 'medium',
      target_scope: 'section',
      answer_mode: 'preview_edit',
      citation_required: false,
      allow_no_source_answer: true,
      show_update_button: true,
      requires_user_confirm_to_apply: true,
      on_confirm_update_mode: 'apply_edit',
      qa_update_policy: 'n_a',
      reason_codes: ['HAS_EDIT_ACTION', 'OBJECT_OPERATION'],
      notes: '检测到文档编辑意图，先返回局部修改预览，点击后再应用。',
    };
  }

  return {
    intent_type: 'qa',
    confidence: discussionModeHint ? 'high' : 'medium',
    target_scope: 'none',
    answer_mode: 'source_grounded_only',
    citation_required: true,
    allow_no_source_answer: false,
    show_update_button: true,
    requires_user_confirm_to_apply: true,
    on_confirm_update_mode: 'incremental_merge',
    qa_update_policy: 'extract_compare_minimal_merge',
    reason_codes: ['DISCUSSION_MODE'],
    notes: lower ? '默认按来源问答处理，点击后执行抽取-比对-最小增量写入。' : 'fallback qa routing',
  };
}

export async function routeIntent(input: IntentRouterInput): Promise<IntentRouterOutput> {
  const artifacts = await loadIntentRouterArtifacts();
  if (!artifacts.systemPrompt || !artifacts.schema || artifacts.fewshots.length === 0) {
    return {
      result: INTENT_ROUTING_FALLBACK,
      validation: {
        isValid: false,
        usedFallback: true,
        errors: ['intent router artifacts missing or incomplete'],
      },
    };
  }
  const heuristicsResult = buildHeuristicIntent(input);
  const validation = validateIntentRoutingResult(heuristicsResult, artifacts.schema);
  if (!validation.valid || !validation.normalized) {
    return {
      result: INTENT_ROUTING_FALLBACK,
      validation: {
        isValid: false,
        usedFallback: true,
        errors: validation.errors.length > 0 ? validation.errors : ['invalid heuristic router output'],
      },
    };
  }
  return {
    result: validation.normalized,
    validation: {
      isValid: true,
      usedFallback: false,
      errors: [],
    },
  };
}

export function parseIntentRoutingResultFromJson(
  raw: string,
  schema: IntentRouterSchema | null
): IntentRouterOutput {
  const parsed = parseJsonSafe(raw);
  const validation = validateIntentRoutingResult(parsed, schema);
  if (!validation.valid || !validation.normalized) {
    return {
      result: INTENT_ROUTING_FALLBACK,
      validation: {
        isValid: false,
        usedFallback: true,
        errors: validation.errors.length > 0 ? validation.errors : ['invalid router JSON'],
      },
    };
  }
  return {
    result: validation.normalized,
    validation: {
      isValid: true,
      usedFallback: false,
      errors: [],
    },
  };
}

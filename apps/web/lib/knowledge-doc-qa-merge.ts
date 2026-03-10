import { chat } from 'shared';
import { markdownToKnowledgeDocHtml, normalizeKnowledgeDocMarkdown } from './knowledge-doc-markdown';

export type QaKnowledgeCategory = 'new_concept' | 'new_fact' | 'minor_refinement' | 'duplicate';

export type QaMergeCitation = {
  sourceTitle: string;
  snippet: string;
  pageStart?: number;
  pageEnd?: number;
  refNumber?: number;
};

type QaCandidate = {
  category: QaKnowledgeCategory;
  text: string;
  target_section: string;
  action: 'insert' | 'refine' | 'skip';
};

type QaMergeModelOutput = {
  source_sufficient: boolean;
  has_effective_new_info: boolean;
  updated_markdown: string;
  change_type: 'new_concept' | 'new_fact' | 'minor_refinement' | 'none';
  changed_sections: string[];
  summary: string;
  candidates: QaCandidate[];
};

export type QaMergeResult = {
  updated: boolean;
  suggestedContent: string | null;
  changeType: 'new_concept' | 'new_fact' | 'minor_refinement' | 'none';
  changedSections: string[];
  summary: string;
  blockedReason?: 'INSUFFICIENT_SOURCES' | 'NO_EFFECTIVE_NEW_INFO' | 'INVALID_MERGE_PAYLOAD';
  candidateStats: Record<QaKnowledgeCategory, number>;
};

type MergeQaAnswerInput = {
  answerPayload: {
    question: string;
    answer: string;
  };
  currentDocContent: string;
  citations?: QaMergeCitation[];
};

type MergeQaAnswerDeps = {
  chatFn?: typeof chat;
};

const DEFAULT_CANDIDATE_STATS: Record<QaKnowledgeCategory, number> = {
  new_concept: 0,
  new_fact: 0,
  minor_refinement: 0,
  duplicate: 0,
};

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSourceSufficient(citations: QaMergeCitation[] | undefined): boolean {
  if (!Array.isArray(citations) || citations.length === 0) return false;
  return citations.some((item) => typeof item.snippet === 'string' && item.snippet.trim().length > 0);
}

function buildCitationContext(citations: QaMergeCitation[] | undefined): string {
  if (!Array.isArray(citations) || citations.length === 0) return '(无)';
  return citations
    .slice(0, 12)
    .map((item, index) => {
      const ref = item.refNumber ?? index + 1;
      const page =
        item.pageStart != null
          ? ` p.${item.pageStart}${item.pageEnd != null && item.pageEnd !== item.pageStart ? `-${item.pageEnd}` : ''}`
          : '';
      return `[${ref}] ${item.sourceTitle}${page}: ${item.snippet}`;
    })
    .join('\n');
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeCandidates(value: unknown): QaCandidate[] {
  if (!Array.isArray(value)) return [];
  const out: QaCandidate[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const category = row.category;
    const text = row.text;
    const targetSection = row.target_section;
    const action = row.action;
    if (
      (category === 'new_concept' ||
        category === 'new_fact' ||
        category === 'minor_refinement' ||
        category === 'duplicate') &&
      typeof text === 'string' &&
      text.trim() &&
      typeof targetSection === 'string' &&
      targetSection.trim() &&
      (action === 'insert' || action === 'refine' || action === 'skip')
    ) {
      out.push({
        category,
        text: text.trim(),
        target_section: targetSection.trim(),
        action,
      });
    }
  }
  return out;
}

function normalizeModelOutput(value: unknown): QaMergeModelOutput | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const source_sufficient = row.source_sufficient === true;
  const has_effective_new_info = row.has_effective_new_info === true;
  const updated_markdown = typeof row.updated_markdown === 'string' ? row.updated_markdown : '';
  const change_type =
    row.change_type === 'new_concept' ||
    row.change_type === 'new_fact' ||
    row.change_type === 'minor_refinement' ||
    row.change_type === 'none'
      ? row.change_type
      : 'none';
  const changed_sections = Array.isArray(row.changed_sections)
    ? row.changed_sections.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8)
    : [];
  const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
  const candidates = normalizeCandidates(row.candidates);
  return {
    source_sufficient,
    has_effective_new_info,
    updated_markdown,
    change_type,
    changed_sections,
    summary,
    candidates,
  };
}

function summarizeCandidates(candidates: QaCandidate[]): Record<QaKnowledgeCategory, number> {
  const stats = { ...DEFAULT_CANDIDATE_STATS };
  for (const candidate of candidates) {
    stats[candidate.category] += 1;
  }
  return stats;
}

function buildFallbackMergePrompt(input: {
  currentDocContent: string;
  question: string;
  answer: string;
  citations?: QaMergeCitation[];
  sourceSufficient: boolean;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const systemPrompt = `你是“知识文档增量写入助手”。
任务：把一次 QA 回答中的新增信息，以最小改动方式并入当前知识文档。

规则：
1. 输出必须是完整 Markdown，不要输出 JSON，不要额外解释。
2. 严禁整段复制回答；仅抽取可复用知识点，做最小增量修改。
3. 优先挂靠原有章节，非必要不重写无关内容。
4. 若无有效新增，原样返回当前文档。
5. ${
    input.sourceSufficient
      ? '有来源证据时可正常增量写入。'
      : '当前无来源证据时也允许写入，但要更保守，只写明确且高置信新增点。'
  }`;

  const userPrompt =
    `【当前知识文档】\n${input.currentDocContent || '(空)'}\n\n` +
    `【用户问题】\n${input.question || '(空)'}\n\n` +
    `【本轮回答】\n${input.answer || '(空)'}\n\n` +
    `【来源证据】\n${buildCitationContext(input.citations)}\n\n` +
    '请输出更新后的完整 Markdown。';

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

async function runFallbackIncrementalMerge(input: {
  runChat: typeof chat;
  currentDocContent: string;
  normalizedCurrent: string;
  question: string;
  answer: string;
  citations?: QaMergeCitation[];
  sourceSufficient: boolean;
}): Promise<{
  updated: boolean;
  suggestedContent: string | null;
}> {
  const { content } = await input.runChat(
    buildFallbackMergePrompt({
      currentDocContent: input.currentDocContent,
      question: input.question,
      answer: input.answer,
      citations: input.citations,
      sourceSufficient: input.sourceSufficient,
    })
  );
  const normalizedSuggested = normalizeKnowledgeDocMarkdown(content ?? '');
  if (!normalizedSuggested) {
    return {
      updated: false,
      suggestedContent: null,
    };
  }
  const suggestedHtml = markdownToKnowledgeDocHtml(normalizedSuggested);
  if (!stripHtml(suggestedHtml)) {
    return {
      updated: false,
      suggestedContent: null,
    };
  }
  if (normalizedSuggested === input.normalizedCurrent) {
    return {
      updated: false,
      suggestedContent: null,
    };
  }
  return {
    updated: true,
    suggestedContent: normalizedSuggested,
  };
}

export async function mergeQaAnswerIntoKnowledgeDoc(
  input: MergeQaAnswerInput,
  deps: MergeQaAnswerDeps = {}
): Promise<QaMergeResult> {
  const currentDoc = input.currentDocContent || '';
  const normalizedCurrent = normalizeKnowledgeDocMarkdown(stripHtml(currentDoc));
  const sourceOk = isSourceSufficient(input.citations);

  const runChat = deps.chatFn ?? chat;
  const systemPrompt = `你是“知识文档最小增量写入助手”。
你的任务：把一次 QA 回答中的有效新增信息，以最小改动方式并入当前知识文档。

严格规则：
1. 禁止把整段 QA 回答原样写入文档。
2. 必须先抽取候选知识项，再与当前文档比对，分类为：
   - new_concept
   - new_fact
   - minor_refinement
   - duplicate
3. 只允许写入 new_concept / new_fact / minor_refinement；duplicate 必须跳过。
4. 若可挂靠现有章节，优先挂靠原位置，不新开大段。
5. 默认最小编辑：优先新增一句、一个 bullet、一个定义补充或一个引用补强。
6. 非必要不重写整段、非必要不改无关章节、非必要不改整体结构。
7. 来源不足时也允许写入，但必须更保守：仅接受能直接从“本轮回答”抽取得到的明确新增点，且必须采用最小增量更新。
8. 如果无有效新增，禁止写入。
9. 输出必须是严格 JSON，不要输出额外解释。
10. summary 必须是面向普通用户的简洁中文，不要输出实现细节、算法名、模块名或伪代码相关描述。

JSON 结构：
{
  "source_sufficient": true|false,
  "has_effective_new_info": true|false,
  "updated_markdown": "完整更新后的 Markdown；若不更新则返回原文档",
  "change_type": "new_concept|new_fact|minor_refinement|none",
  "changed_sections": ["章节A", "章节B"],
  "summary": "一句话更新说明",
  "candidates": [
    {
      "category": "new_concept|new_fact|minor_refinement|duplicate",
      "text": "候选知识项文本",
      "target_section": "建议挂靠章节",
      "action": "insert|refine|skip"
    }
  ]
}`;

  const userPrompt =
    `【当前知识文档】\n${currentDoc || '(空)'}\n\n` +
    `【用户问题】\n${input.answerPayload.question || '(空)'}\n\n` +
    `【本轮回答】\n${input.answerPayload.answer || '(空)'}\n\n` +
    `【可用来源证据】\n${buildCitationContext(input.citations)}\n` +
    `【来源充分性】\n${sourceOk ? '有引用来源，可正常增量合并。' : '当前无可用引用来源，请采用更保守的最小增量策略。'}\n\n` +
    '请按 JSON 结构输出。';

  const { content } = await runChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  const parsed = parseJsonObject(content ?? '');
  const normalized = normalizeModelOutput(parsed);
  if (!normalized) {
    const fallback = await runFallbackIncrementalMerge({
      runChat,
      currentDocContent: currentDoc,
      normalizedCurrent,
      question: input.answerPayload.question,
      answer: input.answerPayload.answer,
      citations: input.citations,
      sourceSufficient: sourceOk,
    });
    if (fallback.updated && fallback.suggestedContent) {
      return {
        updated: true,
        suggestedContent: fallback.suggestedContent,
        changeType: 'minor_refinement',
        changedSections: ['增量补充'],
        summary: '已将本轮回答中的新增信息增量写入知识文档。',
        candidateStats: { ...DEFAULT_CANDIDATE_STATS, minor_refinement: 1 },
      };
    }
    return {
      updated: false,
      suggestedContent: null,
      changeType: 'none',
      changedSections: [],
      summary: '增量合并结果无效，未写入知识文档。',
      blockedReason: 'INVALID_MERGE_PAYLOAD',
      candidateStats: { ...DEFAULT_CANDIDATE_STATS },
    };
  }

  const candidateStats = summarizeCandidates(normalized.candidates);
  if (!normalized.has_effective_new_info) {
    return {
      updated: false,
      suggestedContent: null,
      changeType: 'none',
      changedSections: normalized.changed_sections,
      summary: normalized.summary || '本轮没有有效新增信息，未写入知识文档。',
      blockedReason: 'NO_EFFECTIVE_NEW_INFO',
      candidateStats,
    };
  }

  const normalizedSuggested = normalizeKnowledgeDocMarkdown(normalized.updated_markdown);
  if (!normalizedSuggested || normalizedSuggested === normalizedCurrent) {
    return {
      updated: false,
      suggestedContent: null,
      changeType: 'none',
      changedSections: normalized.changed_sections,
      summary: normalized.summary || '本轮没有形成可应用改动，未写入知识文档。',
      blockedReason: 'NO_EFFECTIVE_NEW_INFO',
      candidateStats,
    };
  }
  const suggestedHtml = markdownToKnowledgeDocHtml(normalizedSuggested);
  if (!stripHtml(suggestedHtml)) {
    const fallback = await runFallbackIncrementalMerge({
      runChat,
      currentDocContent: currentDoc,
      normalizedCurrent,
      question: input.answerPayload.question,
      answer: input.answerPayload.answer,
      citations: input.citations,
      sourceSufficient: sourceOk,
    });
    if (fallback.updated && fallback.suggestedContent) {
      return {
        updated: true,
        suggestedContent: fallback.suggestedContent,
        changeType: normalized.change_type === 'none' ? 'minor_refinement' : normalized.change_type,
        changedSections: normalized.changed_sections.length > 0 ? normalized.changed_sections : ['增量补充'],
        summary: '已将本轮回答中的新增信息增量写入知识文档。',
        candidateStats:
          Object.values(candidateStats).some((value) => value > 0)
            ? candidateStats
            : { ...DEFAULT_CANDIDATE_STATS, minor_refinement: 1 },
      };
    }
    return {
      updated: false,
      suggestedContent: null,
      changeType: 'none',
      changedSections: normalized.changed_sections,
      summary: '本轮生成内容格式异常，未写入知识文档。',
      blockedReason: 'INVALID_MERGE_PAYLOAD',
      candidateStats,
    };
  }

  return {
    updated: true,
    suggestedContent: normalizedSuggested,
    changeType: normalized.change_type,
    changedSections: normalized.changed_sections,
    summary: normalized.summary || '已按最小增量策略写入知识文档。',
    candidateStats,
  };
}

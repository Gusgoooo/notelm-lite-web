export const KNOWLEDGE_UNIT_NOTE_TITLE = '__SYSTEM_KU_STATE__';
export const KNOWLEDGE_UNIT_TEMP_NOTE_PREFIX = '__SYSTEM_KU_TMP__';

export type KnowledgeUnitTrigger =
  | 'ON_ANSWER_GENERATED'
  | 'ON_NOTE_SAVED'
  | 'ON_SOURCE_ADDED';

export type KnowledgeUnitCitation = {
  citation_id: string;
  type: 'INTERNAL_DOCUMENT' | 'EXTERNAL_WEB' | 'INTERNAL_REPORT' | 'NOTE_REFERENCE';
  title: string;
  publisher: string | null;
  date: string | null;
  url: string | null;
  doc_pointer: {
    doc_id: string | null;
    chunk_id: string | null;
    page: number | null;
  };
  credibility: number;
};

export type KnowledgeUnitEvidence = {
  citation_id: string;
  snippet: string;
  relevance: number;
  type: KnowledgeUnitCitation['type'];
  doc_pointer: {
    doc_id: string | null;
    chunk_id: string | null;
    page: number | null;
  };
};

export type KnowledgeUnitAssertion = {
  assertion_id: string;
  statement: string;
  status: 'CONFIRMED' | 'TENTATIVE' | 'HYPOTHESIS' | 'CONFLICTED' | 'DEPRECATED';
  confidence: number;
  tags: string[];
  variables: string[];
  created_at: string;
  updated_at: string;
  locked_by_user: boolean;
  evidence_for: KnowledgeUnitEvidence[];
  evidence_against: KnowledgeUnitEvidence[];
  notes: string[];
  change_log: Array<{
    at: string;
    type: string;
    reason: string;
  }>;
};

export type KnowledgeUnitVariable = {
  key: string;
  name: string;
  definition: string;
  unit: string;
  value: string | number | null;
  range: [number | null, number | null] | null;
  sources: string[];
};

export type KnowledgeUnitMetric = {
  key: string;
  name: string;
  definition: string;
  unit: string;
  formula: string | null;
  sources: string[];
};

export type KnowledgeUnit = {
  id: string;
  session_id: string;
  title: string;
  stability_score: number;
  updated_at: string;
  problem_frame: {
    research_questions: string[];
    scope_assumptions: string[];
    out_of_scope: string[];
    glossary: Array<{ term: string; definition: string }>;
  };
  assertions: KnowledgeUnitAssertion[];
  variables: KnowledgeUnitVariable[];
  metrics: KnowledgeUnitMetric[];
  open_issues: {
    conflicts: Array<{
      conflict_id: string;
      topic: string;
      assertions_involved: string[];
      note: string;
    }>;
    unknowns: Array<{
      unknown_id: string;
      question: string;
      priority: 'LOW' | 'MEDIUM' | 'HIGH';
    }>;
    next_questions: string[];
  };
  citations: KnowledgeUnitCitation[];
  update_summary: {
    last_turn: {
      trigger: KnowledgeUnitTrigger | null;
      added_assertions: number;
      updated_assertions: number;
      added_conflicts: number;
      added_citations: number;
      added_unknowns: number;
      updated_assertion_ids: string[];
    };
  };
  timeline: Array<{
    id: string;
    at: string;
    trigger: KnowledgeUnitTrigger;
    summary: string;
    diff: KnowledgeUnitDiffSummary;
  }>;
};

export type KnowledgeUnitDiffSummary = {
  added_assertions: string[];
  updated_assertions: string[];
  added_citations: string[];
  added_conflicts: string[];
  added_unknowns: string[];
};

export type KnowledgeUnitTriggerInput = {
  trigger: KnowledgeUnitTrigger;
  titleHint?: string;
  user_question?: string;
  assistant_answer?: string;
  saved_notes?: Array<{ title: string; content: string }>;
  citations?: Array<{
    sourceId: string;
    sourceTitle: string;
    pageStart?: number;
    pageEnd?: number;
    snippet: string;
    refNumber?: number;
    score?: number;
    distance?: number;
  }>;
  source_snapshot?: Array<{
    sourceId: string;
    title: string;
    url?: string | null;
    snippet?: string | null;
    page?: number | null;
  }>;
};

export const KNOWLEDGE_UNIT_UPDATER_PROMPT = `You are "Knowledge Unit Updater".
Goal: Maintain and update a session-level structured Knowledge Unit (KU) as a reusable, auditable knowledge object.
Key principles:
- KU must converge: more clarity, less noise. Do NOT append verbose summaries.
- Every core assertion must be traceable to citations. If no citation, mark as HYPOTHESIS with low confidence (<=0.4).
- If new info supports existing assertion: add evidence_for, increase confidence by rule.
- If new info conflicts: add evidence_against, set status CONFLICTED, create/append conflict in open_issues.conflicts.
- Do NOT rewrite locked assertions' statement.
- Output MUST be valid JSON matching the provided KU schema, plus an update_summary for UI.

Inputs:
1) current_ku_json
2) new_turn_context: { user_question, assistant_answer, saved_notes[], citations[] }
Return:
- updated_ku_json
- diff_summary: { added_assertions[], updated_assertions[], added_citations[], added_conflicts[], added_unknowns[] }`;

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text: string): string[] {
  return stripMarkdown(text)
    .split(/(?<=[。！？!?;；])\s+|(?<=\.)\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 10);
}

function ensureQuestion(text: string): string {
  const cleaned = stripMarkdown(text).replace(/[。；;，,]+$/g, '').trim();
  if (!cleaned) return '';
  return /[？?]$/.test(cleaned) ? cleaned : `${cleaned}？`;
}

function toTokens(text: string): string[] {
  const ascii = stripMarkdown(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const compact = ascii.map((token) => token.trim()).filter((token) => token.length >= 2);
  return Array.from(new Set(compact)).slice(0, 24);
}

function similarity(a: string, b: string): number {
  const ta = toTokens(a);
  const tb = toTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const bSet = new Set(tb);
  const overlap = ta.filter((token) => bSet.has(token)).length;
  return overlap / Math.max(ta.length, tb.length);
}

function detectConflict(a: string, b: string): boolean {
  const negRe = /(不|没有|并非|未|难以|下降|减少|无明显|不存在)/;
  return negRe.test(a) !== negRe.test(b);
}

function summarizeDiff(diff: KnowledgeUnitDiffSummary): string {
  return `新增结论${diff.added_assertions.length}条 / 更新结论${diff.updated_assertions.length}条 / 新增争议${diff.added_conflicts.length}条 / 新增来源${diff.added_citations.length}条`;
}

export function createDefaultKnowledgeUnit(sessionId: string, titleHint?: string): KnowledgeUnit {
  const now = nowIso();
  return {
    id: `ku_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    session_id: sessionId,
    title: titleHint?.trim() || '未命名研究对象',
    stability_score: 18,
    updated_at: now,
    problem_frame: {
      research_questions: [],
      scope_assumptions: [],
      out_of_scope: [],
      glossary: [],
    },
    assertions: [],
    variables: [],
    metrics: [],
    open_issues: {
      conflicts: [],
      unknowns: [],
      next_questions: [],
    },
    citations: [],
    update_summary: {
      last_turn: {
        trigger: null,
        added_assertions: 0,
        updated_assertions: 0,
        added_conflicts: 0,
        added_citations: 0,
        added_unknowns: 0,
        updated_assertion_ids: [],
      },
    },
    timeline: [],
  };
}

export function parseKnowledgeUnit(raw: string | null | undefined, sessionId: string, titleHint?: string): KnowledgeUnit {
  if (!raw) return createDefaultKnowledgeUnit(sessionId, titleHint);
  try {
    const parsed = JSON.parse(raw) as Partial<KnowledgeUnit>;
    const base = createDefaultKnowledgeUnit(sessionId, titleHint);
    return {
      ...base,
      ...parsed,
      problem_frame: {
        ...base.problem_frame,
        ...(parsed.problem_frame ?? {}),
      },
      open_issues: {
        ...base.open_issues,
        ...(parsed.open_issues ?? {}),
      },
      update_summary: {
        ...base.update_summary,
        ...(parsed.update_summary ?? {}),
        last_turn: {
          ...base.update_summary.last_turn,
          ...(parsed.update_summary?.last_turn ?? {}),
        },
      },
      assertions: Array.isArray(parsed.assertions) ? parsed.assertions : [],
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
      variables: Array.isArray(parsed.variables) ? parsed.variables : [],
      metrics: Array.isArray(parsed.metrics) ? parsed.metrics : [],
      timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
    };
  } catch {
    return createDefaultKnowledgeUnit(sessionId, titleHint);
  }
}

function normalizeCitations(
  input: KnowledgeUnitTriggerInput,
  existing: KnowledgeUnitCitation[]
): { citations: KnowledgeUnitCitation[]; added: string[]; evidence: KnowledgeUnitEvidence[] } {
  const next = [...existing];
  const added: string[] = [];
  const evidence: KnowledgeUnitEvidence[] = [];
  const byKey = new Map<string, KnowledgeUnitCitation>();
  for (const citation of next) {
    byKey.set(
      `${citation.doc_pointer.doc_id ?? ''}:${citation.doc_pointer.chunk_id ?? ''}:${citation.url ?? ''}:${citation.title}`,
      citation
    );
  }

  const addOne = (
    key: string,
    payload: Omit<KnowledgeUnitCitation, 'citation_id'>,
    snippet: string,
    relevance: number
  ) => {
    let citation = byKey.get(key);
    if (!citation) {
      citation = {
        citation_id: createId('c'),
        ...payload,
      };
      byKey.set(key, citation);
      next.push(citation);
      added.push(citation.title);
    }
    evidence.push({
      citation_id: citation.citation_id,
      snippet: snippet.slice(0, 240),
      relevance: clamp(relevance, 0.4, 0.96),
      type: citation.type,
      doc_pointer: citation.doc_pointer,
    });
  };

  for (const item of input.citations ?? []) {
    const score = typeof item.score === 'number' ? item.score : 0.72;
    const distance = typeof item.distance === 'number' ? item.distance : 0.2;
    const relevance = clamp(score > 0 ? score : 1 - distance, 0.45, 0.95);
    const page = item.pageStart ?? item.pageEnd ?? null;
    const key = `${item.sourceId}:${item.sourceId}:${item.sourceTitle}`;
    addOne(
      key,
      {
        type: item.sourceId.startsWith('src_') ? 'INTERNAL_DOCUMENT' : 'INTERNAL_REPORT',
        title: item.sourceTitle,
        publisher: null,
        date: null,
        url: null,
        doc_pointer: {
          doc_id: item.sourceId,
          chunk_id: item.sourceId,
          page,
        },
        credibility: 0.86,
      },
      item.snippet,
      relevance
    );
  }

  for (const item of input.source_snapshot ?? []) {
    const key = `${item.sourceId}:${item.sourceId}:${item.url ?? ''}`;
    let publisher: string | null = null;
    if (item.url) {
      try {
        publisher = new URL(item.url).hostname.replace(/^www\./, '');
      } catch {
        publisher = null;
      }
    }
    addOne(
      key,
      {
        type: item.url ? 'EXTERNAL_WEB' : 'INTERNAL_DOCUMENT',
        title: item.title,
        publisher,
        date: null,
        url: item.url ?? null,
        doc_pointer: {
          doc_id: item.url ? null : item.sourceId,
          chunk_id: item.url ? null : item.sourceId,
          page: item.page ?? null,
        },
        credibility: item.url ? 0.74 : 0.82,
      },
      item.snippet ?? item.title,
      0.7
    );
  }

  return { citations: next, added, evidence };
}

function deriveQuestions(input: KnowledgeUnitTriggerInput): string[] {
  const out: string[] = [];
  if (input.user_question) out.push(ensureQuestion(input.user_question));
  for (const saved of input.saved_notes ?? []) {
    if (saved.title.includes('？') || saved.title.includes('?')) {
      out.push(ensureQuestion(saved.title));
    }
  }
  return Array.from(new Set(out.filter(Boolean))).slice(0, 3);
}

function extractCandidateAssertions(input: KnowledgeUnitTriggerInput): string[] {
  const out: string[] = [];
  if (input.assistant_answer) {
    out.push(...splitSentences(input.assistant_answer));
  }
  for (const note of input.saved_notes ?? []) {
    out.push(...splitSentences(note.content));
  }
  const unique = Array.from(new Set(out));
  return unique
    .filter((line) => !/[?？]$/.test(line))
    .slice(0, 4);
}

function deriveVariablesFromAssertions(assertions: string[]): Array<Pick<KnowledgeUnitVariable, 'key' | 'name'>> {
  const tokens = new Map<string, string>();
  for (const statement of assertions) {
    for (const token of toTokens(statement)) {
      if (token.length < 3) continue;
      if (tokens.size >= 6) break;
      tokens.set(token, token);
    }
  }
  return Array.from(tokens.values()).slice(0, 6).map((token) => ({
    key: token.replace(/\s+/g, '_'),
    name: token,
  }));
}

function recalcStability(ku: KnowledgeUnit): number {
  if (ku.assertions.length === 0) return clamp(10 + ku.citations.length * 3, 0, 100);
  const weighted =
    ku.assertions.reduce((sum, item) => {
      const statusWeight =
        item.status === 'CONFIRMED'
          ? 1
          : item.status === 'TENTATIVE'
          ? 0.78
          : item.status === 'CONFLICTED'
          ? 0.45
          : item.status === 'HYPOTHESIS'
          ? 0.25
          : 0.2;
      return sum + item.confidence * 100 * statusWeight;
    }, 0) / ku.assertions.length;
  return clamp(Math.round(weighted), 0, 100);
}

export function applyKnowledgeUnitUpdate(current: KnowledgeUnit, input: KnowledgeUnitTriggerInput): {
  next: KnowledgeUnit;
  diff: KnowledgeUnitDiffSummary;
} {
  const now = nowIso();
  const next = structuredClone(current) as KnowledgeUnit;
  const diff: KnowledgeUnitDiffSummary = {
    added_assertions: [],
    updated_assertions: [],
    added_citations: [],
    added_conflicts: [],
    added_unknowns: [],
  };

  const citationUpdate = normalizeCitations(input, next.citations);
  next.citations = citationUpdate.citations;
  diff.added_citations.push(...citationUpdate.added);

  const researchQuestions = deriveQuestions(input);
  for (const question of researchQuestions) {
    if (!next.problem_frame.research_questions.includes(question) && next.problem_frame.research_questions.length < 3) {
      next.problem_frame.research_questions.push(question);
    }
  }

  if (input.trigger === 'ON_SOURCE_ADDED') {
    const sourceTitles = (input.source_snapshot ?? []).map((item) => item.title).filter(Boolean);
    if (sourceTitles.length > 0) {
      const question = ensureQuestion(`这些新来源会补强哪些已有结论：${sourceTitles.slice(0, 2).join('、')}`);
      if (question && !next.open_issues.next_questions.includes(question)) {
        next.open_issues.next_questions.unshift(question);
        next.open_issues.next_questions = next.open_issues.next_questions.slice(0, 5);
      }
    }
  }

  const candidates = extractCandidateAssertions(input);
  const variableSeeds = deriveVariablesFromAssertions(candidates);

  for (const seed of variableSeeds) {
    if (next.variables.some((item) => item.key === seed.key)) continue;
    next.variables.push({
      key: seed.key,
      name: seed.name,
      definition: '待补充定义',
      unit: '',
      value: null,
      range: null,
      sources: citationUpdate.evidence.slice(0, 2).map((item) => item.citation_id),
    });
  }

  for (const statement of candidates) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < next.assertions.length; index += 1) {
      const score = similarity(statement, next.assertions[index].statement);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const hasEvidence = citationUpdate.evidence.length > 0;
    const sharedEvidence = citationUpdate.evidence.slice(0, 3);
    const credibility =
      sharedEvidence.length > 0
        ? sharedEvidence.reduce((sum, item) => {
            const citation = next.citations.find((entry) => entry.citation_id === item.citation_id);
            return sum + (citation?.credibility ?? 0.75) * item.relevance;
          }, 0) / sharedEvidence.length
        : 0;

    if (bestIndex >= 0 && bestScore >= 0.82) {
      const target = next.assertions[bestIndex];
      const isConflict = detectConflict(statement, target.statement);
      if (!target.locked_by_user && bestScore < 0.95 && target.statement.length < statement.length) {
        target.statement = target.statement;
      }
      if (isConflict) {
        const down = clamp(credibility * 0.12, 0.02, 0.14);
        target.confidence = clamp(target.confidence - down, 0.05, 0.95);
        target.status = 'CONFLICTED';
        target.evidence_against.push(...sharedEvidence);
        const conflictId = createId('cf');
        next.open_issues.conflicts.unshift({
          conflict_id: conflictId,
          topic: target.statement.slice(0, 24),
          assertions_involved: [target.assertion_id],
          note: `本轮新增与该结论方向相反的证据：${statement.slice(0, 40)}`,
        });
        diff.added_conflicts.push(target.statement);
        target.change_log.unshift({
          at: now,
          type: 'CONFLICT_ADDED',
          reason: '新增一条冲突证据，已降置信度并标记为冲突',
        });
      } else {
        const up = clamp(credibility * 0.08, 0.01, 0.1);
        target.confidence = clamp(target.confidence + up, 0.05, 0.95);
        if (target.status !== 'CONFIRMED' && target.confidence >= 0.85) target.status = 'CONFIRMED';
        else if (target.status === 'HYPOTHESIS' && target.confidence > 0.4) target.status = 'TENTATIVE';
        target.evidence_for.push(...sharedEvidence);
        target.change_log.unshift({
          at: now,
          type: 'CONFIDENCE_UP',
          reason: '本轮增加了支持证据，系统已上调置信度',
        });
      }
      target.updated_at = now;
      diff.updated_assertions.push(target.statement);
      continue;
    }

    if (bestIndex >= 0 && bestScore >= 0.65) {
      const target = next.assertions[bestIndex];
      target.change_log.unshift({
        at: now,
        type: 'RELATED_EVIDENCE_LINKED',
        reason: '发现可能相关的信息，已保留关联但未直接改写结论',
      });
      target.updated_at = now;
      diff.updated_assertions.push(target.statement);
      continue;
    }

    if (!hasEvidence && input.trigger === 'ON_NOTE_SAVED') {
      const unknown = ensureQuestion(`这条笔记结论还缺少可引用来源：${statement.slice(0, 26)}`);
      if (unknown) {
        next.open_issues.unknowns.unshift({
          unknown_id: createId('u'),
          question: unknown,
          priority: 'HIGH',
        });
        diff.added_unknowns.push(unknown);
      }
      continue;
    }

    const baseConfidence = hasEvidence ? 0.62 : 0.35;
    const newAssertion: KnowledgeUnitAssertion = {
      assertion_id: createId('a'),
      statement,
      status: hasEvidence ? 'TENTATIVE' : 'HYPOTHESIS',
      confidence: hasEvidence ? baseConfidence : Math.min(0.4, baseConfidence),
      tags: toTokens(statement).slice(0, 3),
      variables: variableSeeds.slice(0, 2).map((item) => item.key),
      created_at: now,
      updated_at: now,
      locked_by_user: false,
      evidence_for: hasEvidence ? sharedEvidence : [],
      evidence_against: [],
      notes: [],
      change_log: [
        {
          at: now,
          type: 'CREATED',
          reason: hasEvidence ? '本轮新增了一条带来源支持的候选结论' : '本轮新增无来源推测，已降级为 Hypothesis',
        },
      ],
    };
    next.assertions.unshift(newAssertion);
    diff.added_assertions.push(newAssertion.statement);
  }

  if (next.problem_frame.scope_assumptions.length === 0 && next.citations.length > 0) {
    next.problem_frame.scope_assumptions.push('当前知识单元仅基于本会话已引用来源持续收敛更新');
  }
  if (next.problem_frame.out_of_scope.length === 0) {
    next.problem_frame.out_of_scope.push('未经引用支持的泛化判断');
  }

  if (next.open_issues.next_questions.length === 0) {
    const firstAssertion = next.assertions[0]?.statement;
    if (firstAssertion) {
      next.open_issues.next_questions.push(
        ensureQuestion(`请补充支持“${firstAssertion.slice(0, 20)}”的更多数据或案例`)
      );
    }
  }

  next.update_summary.last_turn = {
    trigger: input.trigger,
    added_assertions: diff.added_assertions.length,
    updated_assertions: diff.updated_assertions.length,
    added_conflicts: diff.added_conflicts.length,
    added_citations: diff.added_citations.length,
    added_unknowns: diff.added_unknowns.length,
    updated_assertion_ids: next.assertions
      .filter((item) => diff.added_assertions.includes(item.statement) || diff.updated_assertions.includes(item.statement))
      .map((item) => item.assertion_id),
  };
  next.stability_score = recalcStability(next);
  next.updated_at = now;
  next.timeline.unshift({
    id: createId('t'),
    at: now,
    trigger: input.trigger,
    summary: summarizeDiff(diff),
    diff,
  });
  next.timeline = next.timeline.slice(0, 20);
  return { next, diff };
}

export function serializeKnowledgeUnit(ku: KnowledgeUnit): string {
  return JSON.stringify(ku, null, 2);
}

export function exportKnowledgeUnitMarkdown(ku: KnowledgeUnit): string {
  const lines: string[] = [];
  lines.push(`# ${ku.title}`);
  lines.push('');
  lines.push(`- Stability: ${ku.stability_score}`);
  lines.push(`- Updated: ${ku.updated_at}`);
  lines.push('');
  if (ku.problem_frame.research_questions.length > 0) {
    lines.push('## Research Questions');
    lines.push(...ku.problem_frame.research_questions.map((item) => `- ${item}`));
    lines.push('');
  }
  if (ku.assertions.length > 0) {
    lines.push('## Core Assertions');
    for (const assertion of ku.assertions) {
      lines.push(`### ${assertion.statement}`);
      lines.push(`- Status: ${assertion.status}`);
      lines.push(`- Confidence: ${Math.round(assertion.confidence * 100)}%`);
      if (assertion.evidence_for.length > 0) {
        lines.push('- Supporting Evidence:');
        for (const evidence of assertion.evidence_for.slice(0, 3)) {
          const citation = ku.citations.find((item) => item.citation_id === evidence.citation_id);
          const pointer = evidence.doc_pointer.page != null ? ` p.${evidence.doc_pointer.page}` : '';
          lines.push(`  - [${citation?.title ?? evidence.citation_id}]${pointer} ${evidence.snippet}`);
        }
      }
      if (assertion.evidence_against.length > 0) {
        lines.push('- Counter Evidence:');
        for (const evidence of assertion.evidence_against.slice(0, 2)) {
          const citation = ku.citations.find((item) => item.citation_id === evidence.citation_id);
          lines.push(`  - [${citation?.title ?? evidence.citation_id}] ${evidence.snippet}`);
        }
      }
      lines.push('');
    }
  }
  if (ku.open_issues.next_questions.length > 0) {
    lines.push('## Next Questions');
    lines.push(...ku.open_issues.next_questions.map((item) => `- ${item}`));
    lines.push('');
  }
  if (ku.citations.length > 0) {
    lines.push('## Citations');
    for (const citation of ku.citations) {
      const pointer = citation.doc_pointer.page != null ? ` p.${citation.doc_pointer.page}` : '';
      lines.push(`- [${citation.title}]${pointer}`);
    }
  }
  return lines.join('\n').trim();
}

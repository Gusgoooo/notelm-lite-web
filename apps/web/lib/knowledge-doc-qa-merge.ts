import { normalizeKnowledgeDocMarkdown } from './knowledge-doc-markdown';

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
  targetSection: string;
  format: 'bullet' | 'table';
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
  sourceSupported?: boolean;
};

const DEFAULT_CANDIDATE_STATS: Record<QaKnowledgeCategory, number> = {
  new_concept: 0,
  new_fact: 0,
  minor_refinement: 0,
  duplicate: 0,
};

const CONCEPT_PATTERN = /(是指|指的是|定义为|可定义为|称为|即|本质是|核心概念|概念)/;
const FACT_PATTERN = /(显示|表明|发现|数据|证据|结果|实验|研究|统计|提升|降低|增长|下降|%|\d)/;
const COMPARE_PATTERN = /(对比|比较|竞品|差异|优劣|优缺点|区别|vs|versus)/i;
const NOISE_PATTERN = /^(好的|明白|可以|总结如下|结论如下|我认为|建议|另外|此外)$/;

function inferCompareSection(text: string): string | null {
  if (!COMPARE_PATTERN.test(text)) return null;
  if (/notion/i.test(text)) return '与 Notion 对比';
  if (/notebooklm/i.test(text)) return '与 NotebookLM 对比';
  if (/chatgpt/i.test(text)) return '与 ChatGPT 对比';
  if (/claude/i.test(text)) return '与 Claude 对比';
  if (/obsidian/i.test(text)) return '与 Obsidian 对比';
  if (/confluence/i.test(text)) return '与 Confluence 对比';
  if (/飞书|语雀|石墨|腾讯文档/.test(text)) return '与协作文档产品对比';
  return '竞品对比';
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<h1[^>]*>/gi, '# ')
    .replace(/<h2[^>]*>/gi, '## ')
    .replace(/<h3[^>]*>/gi, '### ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n?/g, '\n');
}

function htmlToMarkdownLike(raw: string): string {
  if (!raw || !raw.includes('<')) return raw;
  const toPlain = (htmlChunk: string): string =>
    decodeHtmlEntities(htmlChunk.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();

  let text = raw.replace(/<br\s*\/?>/gi, '\n');
  const replaceTag = (tag: string, prefix = '') => {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    text = text.replace(re, (_m, inner: string) => {
      const clean = toPlain(inner);
      if (!clean) return '\n';
      return `\n${prefix}${clean}\n`;
    });
  };

  replaceTag('h1', '# ');
  replaceTag('h2', '## ');
  replaceTag('h3', '### ');
  replaceTag('li', '- ');
  replaceTag('p');

  return decodeHtmlEntities(
    text
      .replace(/<\/div>/gi, '\n')
      .replace(/<div\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(#(?:\s+#)+)\s+(.+)$/);
      if (!match) return line;
      const count = match[1].match(/#/g)?.length ?? 1;
      return `${'#'.repeat(Math.min(6, Math.max(1, count)))} ${match[2].trim()}`;
    })
    .join('\n')
    .trim();
}

function repairSeparatedHeadingSyntax(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      const noisy = line.match(/^(\s*#{1,6})\s+(?:#\s+)+(.+)$/);
      if (noisy) {
        return `${noisy[1].trim()} ${noisy[2].trim()}`;
      }
      const match = line.match(/^\s*(#(?:\s+#)+)\s+(.+)$/);
      if (!match) return line;
      const count = match[1].match(/#/g)?.length ?? 1;
      return `${'#'.repeat(Math.min(6, Math.max(1, count)))} ${match[2].trim()}`;
    })
    .join('\n');
}

function cleanupNoisyHeadingTail(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*#{1,6})\s+#\s+(.+)$/g, '$1 $2')
        .replace(/^(\s*#{1,6})\s+(?:#\s+)+/g, '$1 ')
        .trimEnd()
    )
    .join('\n');
}

function normalizeForCompare(raw: string): string {
  return stripHtml(raw)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\[(\d{1,3})]/g, ' ')
    .replace(/[#>*`~_|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '');
}

function cleanSentence(raw: string): string {
  return raw
    .replace(/\[(\d{1,3})]/g, '')
    .replace(/^\s*[-*+]\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('|')) return false;
  if (isMarkdownTableSeparatorLine(trimmed)) return true;
  return /^\|?.+\|.+\|?$/.test(trimmed);
}

function normalizeTableBlock(block: string): string {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function splitAnswerIntoTableBlocks(answerText: string): { tables: string[]; plainText: string } {
  const sourceLines = stripHtml(answerText).split('\n').map((line) => line.trimEnd());
  const tables: string[] = [];
  const plainLines: string[] = [];

  let index = 0;
  while (index < sourceLines.length) {
    const line = sourceLines[index]?.trim() ?? '';
    const nextLine = sourceLines[index + 1]?.trim() ?? '';
    if (isMarkdownTableLine(line) && isMarkdownTableSeparatorLine(nextLine)) {
      const blockLines: string[] = [line, nextLine];
      let cursor = index + 2;
      while (cursor < sourceLines.length && isMarkdownTableLine(sourceLines[cursor] ?? '')) {
        blockLines.push((sourceLines[cursor] ?? '').trim());
        cursor += 1;
      }
      const block = normalizeTableBlock(blockLines.join('\n'));
      if (block) {
        tables.push(block);
      }
      index = cursor;
      continue;
    }
    if (line) {
      plainLines.push(line);
    }
    index += 1;
  }

  return {
    tables,
    plainText: plainLines.join('\n'),
  };
}

function extractCandidates(answerText: string, currentDocContent: string): QaCandidate[] {
  const currentNorm = normalizeForCompare(currentDocContent);
  const { tables, plainText } = splitAnswerIntoTableBlocks(answerText);
  const pieces = plainText
    .split(/[\n。！？!?；;]+/g)
    .map((item) => cleanSentence(item))
    .filter(Boolean);

  const dedupe = new Set<string>();
  const out: QaCandidate[] = [];

  for (const tableBlock of tables) {
    const normalized = normalizeForCompare(tableBlock);
    if (!normalized || normalized.length < 6) continue;
    if (dedupe.has(normalized)) continue;
    dedupe.add(normalized);
    const compareSection = inferCompareSection(tableBlock);
    if (currentNorm.includes(normalized)) {
      out.push({
        category: 'duplicate',
        text: tableBlock,
        targetSection: compareSection ?? '关键事实',
        format: 'table',
      });
      continue;
    }
    out.push({
      category: 'new_fact',
      text: tableBlock,
      targetSection: compareSection ?? '关键事实',
      format: 'table',
    });
  }

  for (const piece of pieces) {
    if (piece.length < 6 || piece.length > 260) continue;
    if (NOISE_PATTERN.test(piece)) continue;
    const compareSection = inferCompareSection(piece);
    const normalized = normalizeForCompare(piece);
    if (!normalized || normalized.length < 6) continue;
    if (dedupe.has(normalized)) continue;
    dedupe.add(normalized);

    const duplicate = currentNorm.includes(normalized);
    if (duplicate) {
      out.push({
        category: 'duplicate',
        text: piece,
        targetSection: compareSection ?? '增量补充',
        format: 'bullet',
      });
      continue;
    }

    if (compareSection) {
      out.push({
        category: 'new_fact',
        text: piece,
        targetSection: compareSection,
        format: 'bullet',
      });
      continue;
    }

    if (CONCEPT_PATTERN.test(piece)) {
      out.push({
        category: 'new_concept',
        text: piece,
        targetSection: '核心概念',
        format: 'bullet',
      });
      continue;
    }

    if (FACT_PATTERN.test(piece)) {
      out.push({
        category: 'new_fact',
        text: piece,
        targetSection: '关键事实',
        format: 'bullet',
      });
      continue;
    }

    out.push({
      category: 'minor_refinement',
      text: piece,
      targetSection: '增量补充',
      format: 'bullet',
    });
  }

  return out.slice(0, 14);
}

function pickSection(baseMarkdown: string, candidate: QaCandidate): string {
  const headings = baseMarkdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());

  if (headings.length === 0) return candidate.targetSection;

  if (candidate.targetSection && candidate.targetSection.trim()) {
    const target = candidate.targetSection.trim();
    const targetNorm = normalizeForCompare(target);
    const explicitMatch = headings.find((heading) => normalizeForCompare(heading) === targetNorm);
    if (explicitMatch) return explicitMatch;
    if (/(对比|竞品|notion|notebooklm|chatgpt|claude|obsidian|confluence)/i.test(target)) {
      const compareHeading = headings.find((heading) =>
        /(对比|竞品|notion|notebooklm|chatgpt|claude|obsidian|confluence)/i.test(heading)
      );
      return compareHeading ?? target;
    }
  }

  const conceptHeading = headings.find((h) => /(概念|定义|术语)/.test(h));
  const factHeading = headings.find((h) => /(事实|结论|证据|数据)/.test(h));
  const refineHeading = headings.find((h) => /(建议|行动|策略|方案|补充)/.test(h));

  if (candidate.category === 'new_concept' && conceptHeading) return conceptHeading;
  if (candidate.category === 'new_fact' && factHeading) return factHeading;
  if (candidate.category === 'minor_refinement' && refineHeading) return refineHeading;
  return headings[0];
}

function insertCandidatesIntoSection(
  markdown: string,
  section: string,
  candidates: QaCandidate[]
): { markdown: string; insertedCount: number } {
  const cleanCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      text: candidate.text.trim(),
    }))
    .filter((candidate) => Boolean(candidate.text));
  if (cleanCandidates.length === 0) {
    return { markdown, insertedCount: 0 };
  }

  const lines = markdown.split('\n');
  const headingIndex = lines.findIndex((line) => line.trim().toLowerCase() === `## ${section}`.toLowerCase());

  if (headingIndex < 0) {
    const appendix: string[] = [`## ${section}`];
    for (const candidate of cleanCandidates) {
      if (candidate.format === 'table') {
        appendix.push('');
        appendix.push(candidate.text);
      } else {
        appendix.push(candidate.text.startsWith('- ') ? candidate.text : `- ${candidate.text}`);
      }
    }
    const next = `${markdown.trim()}\n\n${appendix.join('\n')}`.replace(/\n{3,}/g, '\n\n').trim();
    return {
      markdown: next,
      insertedCount: cleanCandidates.length,
    };
  }

  let insertAt = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i].trim())) {
      insertAt = i;
      break;
    }
  }

  const existingSectionText = lines.slice(headingIndex + 1, insertAt).join('\n');
  let existingNorm = normalizeForCompare(existingSectionText);
  const stagedLines: string[] = [];
  let insertedCount = 0;

  for (const candidate of cleanCandidates) {
    const normalized = normalizeForCompare(candidate.text);
    if (!normalized || existingNorm.includes(normalized)) continue;
    if (candidate.format === 'table') {
      if (stagedLines.length > 0 && stagedLines[stagedLines.length - 1] !== '') {
        stagedLines.push('');
      }
      stagedLines.push(candidate.text);
      stagedLines.push('');
    } else {
      stagedLines.push(candidate.text.startsWith('- ') ? candidate.text : `- ${candidate.text}`);
    }
    existingNorm += normalized;
    insertedCount += 1;
  }

  if (insertedCount === 0) {
    return { markdown, insertedCount: 0 };
  }

  const next = [...lines.slice(0, insertAt), ...stagedLines, ...lines.slice(insertAt)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown: next, insertedCount };
}

function summarizeCandidates(candidates: QaCandidate[]): Record<QaKnowledgeCategory, number> {
  const stats = { ...DEFAULT_CANDIDATE_STATS };
  for (const candidate of candidates) {
    stats[candidate.category] += 1;
  }
  return stats;
}

function ensureBaseMarkdown(content: string): string {
  const markdownLike = htmlToMarkdownLike(content);
  const normalized = normalizeKnowledgeDocMarkdown(repairSeparatedHeadingSyntax(markdownLike));
  if (!normalized) {
    return '# 知识文档\n\n## 核心要点\n- 待补充';
  }
  const repaired = normalizeKnowledgeDocMarkdown(repairSeparatedHeadingSyntax(normalized));
  const cleaned = cleanupNoisyHeadingTail(
    normalizeKnowledgeDocMarkdown(cleanupNoisyHeadingTail(repaired))
  );
  if (!/^##\s+/m.test(cleaned)) {
    const firstLine =
      cleaned
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean)
        ?.replace(/^[-*+]\s*/, '') ?? '待补充';
    return `# 知识文档\n\n## 核心要点\n- ${firstLine}`;
  }
  return cleaned;
}

export function mergeAnswerIntoKnowledgeDoc(
  answerText: string,
  currentDocContent: string,
  sourceSupported: boolean
): QaMergeResult {
  if (!sourceSupported) {
    return {
      updated: false,
      suggestedContent: null,
      changeType: 'none',
      changedSections: [],
      summary: '本轮来源支持不足，未写入知识文档。',
      blockedReason: 'INSUFFICIENT_SOURCES',
      candidateStats: { ...DEFAULT_CANDIDATE_STATS },
    };
  }

  const baseMarkdown = ensureBaseMarkdown(currentDocContent);
  const candidates = extractCandidates(answerText, baseMarkdown);
  const candidateStats = summarizeCandidates(candidates);
  const effective = candidates.filter((item) => item.category !== 'duplicate');
  if (effective.length === 0) {
    return {
      updated: false,
      suggestedContent: null,
      changeType: 'none',
      changedSections: [],
      summary: '本轮没有可写入的新增信息，知识文档保持不变。',
      blockedReason: 'NO_EFFECTIVE_NEW_INFO',
      candidateStats,
    };
  }

  const grouped = new Map<string, QaCandidate[]>();
  for (const candidate of effective) {
    const section = pickSection(baseMarkdown, candidate);
    const rows = grouped.get(section) ?? [];
    rows.push(candidate);
    grouped.set(section, rows);
  }

  let merged = baseMarkdown;
  const changedSections: string[] = [];
  let insertedCount = 0;
  grouped.forEach((rows, section) => {
    const tableRows = rows.filter((row) => row.format === 'table').slice(0, 2);
    const bulletRows = rows.filter((row) => row.format !== 'table').slice(0, 4);
    const selectedRows = [...tableRows, ...bulletRows];
    const applyResult = insertCandidatesIntoSection(merged, section, selectedRows);
    if (applyResult.markdown !== merged) {
      changedSections.push(section);
      merged = applyResult.markdown;
      insertedCount += applyResult.insertedCount;
    }
  });

  const normalizedMerged = cleanupNoisyHeadingTail(
    normalizeKnowledgeDocMarkdown(cleanupNoisyHeadingTail(merged))
  );
  if (!normalizedMerged || normalizeForCompare(normalizedMerged) === normalizeForCompare(baseMarkdown)) {
    return {
      updated: false,
      suggestedContent: null,
      changeType: 'none',
      changedSections: [],
      summary: '本轮没有可应用的最小增量改动。',
      blockedReason: 'NO_EFFECTIVE_NEW_INFO',
      candidateStats,
    };
  }

  const hasConcept = effective.some((item) => item.category === 'new_concept');
  const hasFact = effective.some((item) => item.category === 'new_fact');
  const changeType: QaMergeResult['changeType'] = hasConcept
    ? 'new_concept'
    : hasFact
      ? 'new_fact'
      : 'minor_refinement';

  return {
    updated: true,
    suggestedContent: normalizedMerged,
    changeType,
    changedSections,
    summary: `已按增量方式补充 ${Math.max(insertedCount, 1)} 条信息。`,
    candidateStats,
  };
}

function isSourceSufficient(citations: QaMergeCitation[] | undefined): boolean {
  if (!Array.isArray(citations) || citations.length === 0) return false;
  return citations.some((item) => typeof item.snippet === 'string' && item.snippet.trim().length > 0);
}

export async function mergeQaAnswerIntoKnowledgeDoc(input: MergeQaAnswerInput): Promise<QaMergeResult> {
  return mergeAnswerIntoKnowledgeDoc(
    input.answerPayload.answer || '',
    input.currentDocContent || '',
    typeof input.sourceSupported === 'boolean' ? input.sourceSupported : isSourceSufficient(input.citations)
  );
}

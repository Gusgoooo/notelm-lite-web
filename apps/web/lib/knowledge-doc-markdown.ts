import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

export const KNOWLEDGE_DOC_MARKDOWN_GUIDE = `知识文档 Markdown 规范：
1. 全文最多保留一个一级标题（#）；每个一级标题下必须先有二级标题（##）再进入正文，不允许出现“# 标题”后直接正文。
2. 段落、列表、表格、引用之间保留空行，不要把不同模块粘在一段里。
3. 列表统一优先使用 "-"，每条只表达一个要点，避免过深嵌套。
4. 需要表达对比、状态、计划、指标时，可以使用 Markdown 表格；表头要明确，单元格尽量短句化。
5. 信息不足时保留原结构，并明确写“待补充”，不要删掉关键栏目。
6. 输出面向继续编辑的工作文档，不写寒暄、总结感想、额外说明或代码块。
7. 来源依据应放到对应小节内，优先整理成要点或简短表格，不要堆砌长段原文。
8. 更新已有知识文档时，默认优先改写、合并、删除和替换现有内容，不要在末尾不断追加新段落。`;

const MARKDOWN_FENCE_PATTERN = /```(?:markdown|md)?\s*([\s\S]*?)```/i;

function unwrapMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(MARKDOWN_FENCE_PATTERN)?.[1];
  return (fenced ?? trimmed).trim();
}

function normalizeMarkdownLine(line: string): string {
  const trimmedEnd = line.replace(/\s+$/g, '');

  if (/^\s*\|/.test(trimmedEnd) || /^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+$/.test(trimmedEnd)) {
    return trimmedEnd;
  }

  const normalized = trimmedEnd
    .replace(/^(\s*#{1,6})(\S)/, '$1 $2')
    .replace(/^(\s*>)(\S)/, '$1 $2')
    .replace(/^(\s*[-*+])(\S)/, '$1 $2')
    .replace(/^(\s*\d+\.)(\S)/, '$1 $2');

  if (!/^\s*#{1,6}\s+/.test(normalized)) {
    return normalized;
  }

  return normalized
    .replace(/^(\s*#{1,6})\s+(?:#\s+)+(.+)$/, '$1 $2')
    .replace(/^(\s*#{1,6})\s+#\s+(.+)$/, '$1 $2');
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('|')) return false;
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) return true;
  return /^\|?.+\|.+\|?$/.test(trimmed);
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function stripListPrefixForTableLine(line: string): string {
  const normalizedLine = line.replace(/｜/g, '|');
  const match = normalizedLine.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/);
  if (!match) return normalizedLine;
  const candidate = match[2]?.trim() ?? '';
  const pipeCount = candidate.match(/\|/g)?.length ?? 0;
  if (pipeCount < 2) return normalizedLine;
  if (!/^\|?.+\|.+\|?$/.test(candidate)) return normalizedLine;
  return `${match[1] ?? ''}${candidate}`;
}

function countMarkdownTableColumns(line: string): number {
  const normalized = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = normalized
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  return Math.max(2, cells.length);
}

function createMarkdownTableSeparator(columnCount: number): string {
  return `| ${Array.from({ length: Math.max(2, columnCount) }, () => '---').join(' | ')} |`;
}

function normalizeTableBlocks(lines: string[]): string[] {
  const sanitized = lines.map((line) => stripListPrefixForTableLine(line));
  const output: string[] = [];

  let index = 0;
  while (index < sanitized.length) {
    const line = sanitized[index] ?? '';
    if (!isMarkdownTableLine(line)) {
      output.push(line);
      index += 1;
      continue;
    }

    const block: string[] = [line.trim()];
    let cursor = index + 1;
    let blankGap = 0;
    while (cursor < sanitized.length) {
      const candidate = sanitized[cursor] ?? '';
      const trimmed = candidate.trim();
      if (!trimmed) {
        blankGap += 1;
        if (blankGap > 1) break;
        cursor += 1;
        continue;
      }
      if (!isMarkdownTableLine(trimmed)) break;
      block.push(trimmed);
      blankGap = 0;
      cursor += 1;
    }

    if (block.length >= 2 && !isMarkdownTableSeparatorLine(block[1] ?? '')) {
      const columnCount = countMarkdownTableColumns(block[0] ?? '');
      block.splice(1, 0, createMarkdownTableSeparator(columnCount));
    }

    output.push(...block.filter(Boolean));
    index = cursor;
  }

  return output;
}

function getHeadingLevel(line: string): number | null {
  const match = line.match(/^\s*(#{1,6})\s+/);
  return match ? match[1]!.length : null;
}

function normalizeHeadingLevel(line: string, level: number): string {
  return line.replace(/^(\s*)#{1,6}(\s+)/, `$1${'#'.repeat(Math.max(1, Math.min(6, level)))}$2`);
}

function getHeadingText(line: string): string {
  const match = line.match(/^\s*#{1,6}\s+(.+)$/);
  return (match?.[1] ?? '').trim();
}

function normalizeHeadingLabel(text: string): string {
  return text
    .replace(/^[#\s]+/, '')
    .replace(/[：:。！？.!?；;、，,]\s*$/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function isLikelySectionLabel(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed) || /^>\s?/.test(trimmed)) return false;
  if (trimmed.length > 24) return false;
  if (/[。！？.!?]/.test(trimmed)) return false;
  return true;
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
    .trim();
}

function enforceProgressiveHeadingStructure(lines: string[]): string[] {
  const normalized = [...lines];
  let previousHeadingLevel: number | null = null;
  let seenH1 = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index] ?? '';
    const level = getHeadingLevel(current);
    if (level == null) continue;
    let nextLevel = level;
    if (level === 1) {
      if (seenH1) {
        nextLevel = 2;
      }
      seenH1 = true;
    } else if (!seenH1) {
      nextLevel = 1;
      seenH1 = true;
    }
    if (previousHeadingLevel != null && nextLevel > previousHeadingLevel + 1) {
      nextLevel = previousHeadingLevel + 1;
    }
    if (nextLevel !== level) {
      normalized[index] = normalizeHeadingLevel(current, nextLevel);
    }
    previousHeadingLevel = nextLevel;
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const line = normalized[index] ?? '';
    if (getHeadingLevel(line) !== 1) continue;
    const h1Label = normalizeHeadingLabel(getHeadingText(line));

    for (let cursor = index + 1; cursor < normalized.length; cursor += 1) {
      const candidate = normalized[cursor] ?? '';
      if (getHeadingLevel(candidate) === 1) break;
      if (!candidate.trim()) continue;
      const candidateHeadingLevel = getHeadingLevel(candidate);
      if (candidateHeadingLevel == null) {
        if (isMarkdownTableLine(candidate)) {
          normalized.splice(cursor, 0, '## 核心要点', '');
        } else if (isLikelySectionLabel(candidate)) {
          const label = candidate.trim();
          const normalizedLabel = normalizeHeadingLabel(label);
          if (normalizedLabel === h1Label) {
            normalized[cursor] = '## 核心要点';
          } else {
            normalized[cursor] = `## ${label}`;
          }
        } else {
          normalized.splice(cursor, 0, '## 核心要点', '');
        }
      } else if (candidateHeadingLevel === 2) {
        const h2Label = normalizeHeadingLabel(getHeadingText(candidate));
        if (h2Label && h2Label === h1Label) {
          normalized[cursor] = candidate.replace(/^(\s*)##\s+.*$/, '$1## 核心要点');
        }
      } else if (candidateHeadingLevel > 2) {
        normalized[cursor] = normalizeHeadingLevel(candidate, 2);
      }
      break;
    }
  }

  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index] ?? '';
    if (!current.trim() || getHeadingLevel(current) != null) continue;
    let prevIndex = index - 1;
    while (prevIndex >= 0 && !(normalized[prevIndex] ?? '').trim()) {
      prevIndex -= 1;
    }
    if (prevIndex < 0) continue;
    const previous = normalized[prevIndex] ?? '';
    if (getHeadingLevel(previous) == null) continue;
    const headingLabel = normalizeHeadingLabel(getHeadingText(previous));
    const paragraphLabel = normalizeHeadingLabel(current);
    if (headingLabel && paragraphLabel && headingLabel === paragraphLabel) {
      normalized.splice(index, 1);
      index -= 1;
    }
  }

  return normalized;
}

export function normalizeKnowledgeDocMarkdown(raw: string): string {
  const unwrapped = unwrapMarkdownFence(raw);
  if (!unwrapped) return '';

  const normalizedLines = unwrapped
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .split('\n')
    .map((line) => normalizeMarkdownLine(line));
  const normalizedTableLines = normalizeTableBlocks(normalizedLines);
  const progressiveLines = enforceProgressiveHeadingStructure(normalizedTableLines);

  const spacedLines: string[] = [];

  for (let index = 0; index < progressiveLines.length; index += 1) {
    const line = progressiveLines[index] ?? '';
    const previous = progressiveLines[index - 1] ?? '';
    const next = progressiveLines[index + 1] ?? '';
    const currentIsTable = isMarkdownTableLine(line);
    const previousIsTable = isMarkdownTableLine(previous);
    const nextIsTable = isMarkdownTableLine(next);

    if (currentIsTable && previous.trim() && !previousIsTable && spacedLines.at(-1) !== '') {
      spacedLines.push('');
    }

    spacedLines.push(line);

    if (currentIsTable && next.trim() && !nextIsTable) {
      spacedLines.push('');
    }
  }

  return spacedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function ensureKnowledgeDocMarkdown(raw: string): string {
  return normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(raw));
}

export function stripKnowledgeDocMarkdown(raw: string): string {
  return normalizeKnowledgeDocMarkdown(raw)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\(([^)]+)\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countKnowledgeDocUnits(raw: string): number {
  return stripKnowledgeDocMarkdown(raw).replace(/\s+/g, '').length;
}

export function markdownToKnowledgeDocHtml(raw: string): string {
  const normalized = normalizeKnowledgeDocMarkdown(raw);
  if (!normalized) return '<p></p>';

  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(normalized);

  const html = String(file).trim();
  return html || '<p></p>';
}

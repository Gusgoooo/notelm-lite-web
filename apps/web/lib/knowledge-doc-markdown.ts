import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

export const KNOWLEDGE_DOC_MARKDOWN_GUIDE = `知识文档 Markdown 规范：
1. 全文最多保留一个一级标题（#），正文层级统一使用 ## 和 ###。
2. 段落、列表、表格、引用之间保留空行，不要把不同模块粘在一段里。
3. 列表统一优先使用 "-"，每条只表达一个要点，避免过深嵌套。
4. 需要表达对比、状态、计划、指标时，可以使用 Markdown 表格；表头要明确，单元格尽量短句化。
5. 信息不足时保留原结构，并明确写“待补充”，不要删掉关键栏目。
6. 输出面向继续编辑的工作文档，不写寒暄、总结感想、额外说明或代码块。
7. 来源依据应放到对应小节内，优先整理成要点或简短表格，不要堆砌长段原文。`;

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

  return trimmedEnd
    .replace(/^(\s*#{1,6})(\S)/, '$1 $2')
    .replace(/^(\s*>)(\S)/, '$1 $2')
    .replace(/^(\s*[-*+])(\S)/, '$1 $2')
    .replace(/^(\s*\d+\.)(\S)/, '$1 $2');
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('|')) return false;
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) return true;
  return /^\|?.+\|.+\|?$/.test(trimmed);
}

export function normalizeKnowledgeDocMarkdown(raw: string): string {
  const unwrapped = unwrapMarkdownFence(raw);
  if (!unwrapped) return '';

  const normalizedLines = unwrapped
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .split('\n')
    .map((line) => normalizeMarkdownLine(line));

  const spacedLines: string[] = [];

  for (let index = 0; index < normalizedLines.length; index += 1) {
    const line = normalizedLines[index] ?? '';
    const previous = normalizedLines[index - 1] ?? '';
    const next = normalizedLines[index + 1] ?? '';
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

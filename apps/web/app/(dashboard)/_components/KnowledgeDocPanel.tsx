'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import DiffMatchPatch from 'diff-match-patch';
import { KnowledgeDocCreateButton } from './KnowledgeDocCreateButton';

type KnowledgeDocPanelProps = {
  notebookId: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

type DraftScenarioKey = 'auto' | 'okr' | 'prd' | 'prompt' | 'analysis' | 'learning';
type CreationMode = 'infographic' | 'summary' | 'mindmap' | 'report' | 'webpage';
type SheetMode = 'draft' | 'create' | null;
type HistoryMode = 'append' | 'merge-edit' | 'skip';

type KnowledgeDocCitation = {
  sourceTitle: string;
  pageStart?: number;
  pageEnd?: number;
  snippet: string;
};

type KnowledgeDocHistoryEntry = {
  id: string;
  content: string;
  summary: string;
  savedAt: string;
};

type SaveDocOptions = {
  historyMode?: HistoryMode;
  summary?: string;
};

const HISTORY_STORAGE_LIMIT = 30;

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      {collapsed ? <path d="m15 6-6 6 6 6" /> : <path d="m9 6 6 6-6 6" />}
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function CreationIcon({ mode }: { mode: CreationMode }) {
  if (mode === 'summary') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 7h14M5 12h10M5 17h8" />
      </svg>
    );
  }
  if (mode === 'infographic') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 18h14" />
        <path d="M7 18v-6" />
        <path d="M12 18V9" />
        <path d="M17 18V5" />
      </svg>
    );
  }
  if (mode === 'mindmap') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="2.5" />
        <circle cx="6" cy="7" r="1.5" />
        <circle cx="18" cy="7" r="1.5" />
        <circle cx="6" cy="17" r="1.5" />
        <circle cx="18" cy="17" r="1.5" />
        <path d="M10 10 7 8M14 10l3-2M10 14l-3 2M14 14l3 2" />
      </svg>
    );
  }
  if (mode === 'report') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 4h7l4 4v12H7z" />
        <path d="M14 4v4h4" />
        <path d="M9 13h6M9 17h6M9 9h2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function DraftIcon({ scenario }: { scenario: DraftScenarioKey }) {
  if (scenario === 'auto') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3v4M12 17v4M4.2 6.2l2.8 2.8M17 15l2.8 2.8M3 12h4M17 12h4M4.2 17.8 7 15M17 9l2.8-2.8" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    );
  }
  if (scenario === 'okr') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 12h14" />
        <path d="M5 7h8" />
        <path d="M5 17h10" />
        <circle cx="18" cy="7" r="2" />
      </svg>
    );
  }
  if (scenario === 'prd') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 4h10l3 3v13H7z" />
        <path d="M17 4v3h3" />
        <path d="M10 12h7M10 16h7M10 8h2" />
      </svg>
    );
  }
  if (scenario === 'prompt') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 8h8M8 12h6M8 16h4" />
        <rect x="4" y="4" width="16" height="16" rx="3" />
      </svg>
    );
  }
  if (scenario === 'analysis') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 18h14" />
        <path d="M7 18v-4" />
        <path d="M12 18V8" />
        <path d="M17 18V5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 5h12v14H6z" />
      <path d="M9 9h6M9 13h6M9 17h4" />
    </svg>
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInlineMarkdown(value: string): string {
  const codeSegments: string[] = [];
  const withPlaceholders = value.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSegments.push(code);
    return `@@CODE_${codeSegments.length - 1}@@`;
  });

  let html = escapeHtml(withPlaceholders);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  html = html.replace(/@@CODE_(\d+)@@/g, (_match, index: string) => {
    const code = codeSegments[Number(index)] ?? '';
    return `<code>${escapeHtml(code)}</code>`;
  });
  return html;
}

function markdownToHtml(raw: string): string {
  const normalized = raw.replace(/\r/g, '\n').trim();
  if (!normalized) return '<p></p>';

  const lines = normalized.split('\n');
  const html: string[] = [];
  let paragraphLines: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];
  let quoteLines: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    html.push(`<p>${paragraphLines.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = null;
      listItems = [];
      return;
    }
    html.push(
      `<${listType}>${listItems
        .map((item) => `<li>${renderInlineMarkdown(item)}</li>`)
        .join('')}</${listType}>`
    );
    listType = null;
    listItems = [];
  };

  const flushQuotes = () => {
    if (quoteLines.length === 0) return;
    html.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join('')}</blockquote>`);
    quoteLines = [];
  };

  const flushCodeBlock = () => {
    if (codeLines.length === 0) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (inCodeBlock) {
      if (trimmed.startsWith('```')) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuotes();
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();
      flushQuotes();
      inCodeBlock = true;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuotes();
      const level = Math.min(3, headingMatch[1].length);
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s*(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      flushQuotes();
      if (listType === 'ol') flushList();
      listType = 'ul';
      listItems.push(unorderedMatch[1].trim());
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      flushQuotes();
      if (listType === 'ul') flushList();
      listType = 'ol';
      listItems.push(orderedMatch[1].trim());
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1].trim());
      continue;
    }

    flushList();
    flushQuotes();
    paragraphLines.push(trimmed);
  }

  if (inCodeBlock) flushCodeBlock();
  flushParagraph();
  flushList();
  flushQuotes();

  return html.join('') || '<p></p>';
}

function stripHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? div.innerText ?? '').replace(/\s+/g, ' ').trim();
}

function buildHighlightedMaterials(citations: KnowledgeDocCitation[] | undefined): string {
  if (!Array.isArray(citations) || citations.length === 0) return '';
  return citations
    .map(
      (citation) =>
        `- ${citation.sourceTitle}${
          citation.pageStart != null
            ? `（p.${citation.pageStart}${
                citation.pageEnd != null && citation.pageEnd !== citation.pageStart ? `-${citation.pageEnd}` : ''
              }）`
            : ''
        }：${citation.snippet}`
    )
    .join('\n');
}

function hasMeaningfulHtml(html: string): boolean {
  return stripHtml(html).length > 0;
}

function normalizeHistoryEntries(value: unknown): KnowledgeDocHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is KnowledgeDocHistoryEntry =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as KnowledgeDocHistoryEntry).id === 'string' &&
            typeof (item as KnowledgeDocHistoryEntry).content === 'string' &&
            typeof (item as KnowledgeDocHistoryEntry).summary === 'string' &&
            typeof (item as KnowledgeDocHistoryEntry).savedAt === 'string'
        )
    )
    .slice(0, HISTORY_STORAGE_LIMIT);
}

function extractHistoryFocus(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => /^#{1,3}\s+/.test(line));
  if (heading) {
    return heading.replace(/^#{1,3}\s+/, '').slice(0, 24);
  }
  const bullet = lines.find((line) => /^[-*+]\s+/.test(line));
  if (bullet) {
    return bullet.replace(/^[-*+]\s+/, '').slice(0, 24);
  }
  return lines[0]?.slice(0, 24) ?? '';
}

function buildHistorySummary(previousHtml: string, nextHtml: string): string {
  const previousMarkdown = htmlToMarkdownLike(previousHtml).trim();
  const nextMarkdown = htmlToMarkdownLike(nextHtml).trim();
  if (!previousMarkdown && nextMarkdown) {
    const focus = extractHistoryFocus(nextMarkdown);
    return focus ? `创建初稿：${focus}` : '创建知识文档初稿';
  }
  if (previousMarkdown && !nextMarkdown) {
    return '清空了知识文档内容';
  }
  const previousFocus = extractHistoryFocus(previousMarkdown);
  const nextFocus = extractHistoryFocus(nextMarkdown);
  if (nextFocus && nextFocus !== previousFocus) {
    return `更新「${nextFocus}」部分`;
  }
  const nextLines = nextMarkdown.split('\n').map((line) => line.trim()).filter(Boolean);
  const addedLine = nextLines.find((line) => !previousMarkdown.includes(line));
  if (addedLine) {
    return `补充：${addedLine.replace(/^[-*+]\s+/, '').slice(0, 24)}`;
  }
  return '编辑了知识文档';
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function appendHistoryEntry(
  entries: KnowledgeDocHistoryEntry[],
  previousHtml: string,
  nextHtml: string,
  options: SaveDocOptions = {}
): KnowledgeDocHistoryEntry[] {
  if (options.historyMode === 'skip') return entries;
  const previousText = stripHtml(previousHtml);
  const nextText = stripHtml(nextHtml);
  if (previousText === nextText) return entries;

  const summary = (options.summary ?? buildHistorySummary(previousHtml, nextHtml)).trim() || '编辑了知识文档';
  const nextEntry: KnowledgeDocHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    content: nextHtml,
    summary,
    savedAt: new Date().toISOString(),
  };

  if (entries[0]?.content === nextHtml) {
    return [{ ...entries[0], summary: nextEntry.summary, savedAt: nextEntry.savedAt }, ...entries.slice(1)];
  }

  if (options.historyMode === 'merge-edit' && entries[0]) {
    const latest = entries[0];
    const latestAt = Date.parse(latest.savedAt);
    if (Number.isFinite(latestAt) && Date.now() - latestAt < 120000 && latest.summary.startsWith('编辑')) {
      return [{ ...latest, content: nextHtml, summary: nextEntry.summary, savedAt: nextEntry.savedAt }, ...entries.slice(1)];
    }
  }

  return [nextEntry, ...entries].slice(0, HISTORY_STORAGE_LIMIT);
}

function htmlToMarkdownLike(html: string): string {
  if (typeof document === 'undefined') {
    return stripHtml(html);
  }

  const container = document.createElement('div');
  container.innerHTML = html;
  const inlineNodeToMarkdown = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? '';
    }
    if (!(node instanceof HTMLElement)) return '';
    const text = Array.from(node.childNodes).map((child) => inlineNodeToMarkdown(child)).join('');
    if (node.tagName === 'BR') return '\n';
    if (node.tagName === 'STRONG' || node.tagName === 'B') return `**${text.trim()}**`;
    if (node.tagName === 'EM' || node.tagName === 'I') return `*${text.trim()}*`;
    if (node.tagName === 'CODE') return `\`${text.trim()}\``;
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      return href ? `[${text.trim()}](${href})` : text;
    }
    return text;
  };

  const blockNodeToMarkdown = (node: ChildNode): string[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').trim();
      return text ? [text] : [];
    }
    if (!(node instanceof HTMLElement)) return [];

    const text = Array.from(node.childNodes)
      .map((child) => inlineNodeToMarkdown(child))
      .join('')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .trim();

    if (node.tagName === 'H1') return text ? [`# ${text}`] : [];
    if (node.tagName === 'H2') return text ? [`## ${text}`] : [];
    if (node.tagName === 'H3') return text ? [`### ${text}`] : [];
    if (node.tagName === 'P') return text ? [text] : [];
    if (node.tagName === 'UL') {
      return Array.from(node.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'LI')
        .map((child) => `- ${Array.from(child.childNodes).map((item) => inlineNodeToMarkdown(item)).join('').trim()}`)
        .filter(Boolean);
    }
    if (node.tagName === 'OL') {
      return Array.from(node.children)
        .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'LI')
        .map(
          (child, index) =>
            `${index + 1}. ${Array.from(child.childNodes).map((item) => inlineNodeToMarkdown(item)).join('').trim()}`
        )
        .filter(Boolean);
    }
    if (node.tagName === 'BLOCKQUOTE') {
      return Array.from(node.childNodes)
        .flatMap((child) => blockNodeToMarkdown(child))
        .map((line) => `> ${line}`);
    }
    if (node.tagName === 'PRE') {
      const code = node.textContent?.trim() ?? '';
      return code ? [`\`\`\`\n${code}\n\`\`\``] : [];
    }

    return Array.from(node.childNodes).flatMap((child) => blockNodeToMarkdown(child));
  };

  return Array.from(container.childNodes)
    .flatMap((child) => blockNodeToMarkdown(child))
    .filter(Boolean)
    .join('\n\n');
}

function DiffView({
  oldText,
  newText,
  className,
}: {
  oldText: string;
  newText: string;
  className?: string;
}) {
  const dmp = new DiffMatchPatch();
  const diff = dmp.diff_main(oldText || '', newText || '');
  dmp.diff_cleanupSemantic(diff);

  return (
    <div className={className}>
      {diff.map((part, i) => {
        const [op, text] = part;
        if (!text) return null;
        if (op === 0) {
          return <span key={i}>{text}</span>;
        }
        if (op === -1) {
          return (
            <span key={i} className="bg-red-200 text-red-900 line-through dark:bg-red-900/50 dark:text-red-100">
              {text}
            </span>
          );
        }
        return (
          <span key={i} className="bg-green-200 text-green-900 dark:bg-green-900/50 dark:text-green-100">
            {text}
          </span>
        );
      })}
    </div>
  );
}

export function KnowledgeDocPanel({
  notebookId,
  collapsed = false,
  onToggleCollapse,
}: KnowledgeDocPanelProps) {
  const [docId, setDocId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<{ previous: string; suggested: string } | null>(null);
  const [updatingFromChat, setUpdatingFromChat] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [docHistory, setDocHistory] = useState<KnowledgeDocHistoryEntry[]>([]);
  const [draftScenarioLoading, setDraftScenarioLoading] = useState<DraftScenarioKey | null>(null);
  const [creationGenerating, setCreationGenerating] = useState<CreationMode | null>(null);
  const [externalBusy, setExternalBusy] = useState(false);
  const [externalBusyLabel, setExternalBusyLabel] = useState('正在更新知识文档…');

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialContentRef = useRef<string | null>(null);
  const docHistoryRef = useRef<KnowledgeDocHistoryEntry[]>([]);

  const draftScenarios = useMemo(
    () => [
      {
        key: 'auto' as const,
        label: '自动选择',
        hint: '根据来源自动归纳最适合的初稿结构',
        className: 'bg-sky-50 text-sky-700 hover:bg-sky-100',
      },
      {
        key: 'okr' as const,
        label: 'OKR撰写',
        hint: '整理目标、关键结果和衡量方式',
        className: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
      },
      {
        key: 'prd' as const,
        label: 'PRD撰写',
        hint: '聚焦用户、场景、方案和验证',
        className: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
      },
      {
        key: 'prompt' as const,
        label: 'Prompt撰写',
        hint: '沉淀任务目标、输入和输出约束',
        className: 'bg-violet-50 text-violet-700 hover:bg-violet-100',
      },
      {
        key: 'analysis' as const,
        label: '分析报告',
        hint: '提炼结论、依据、风险和建议',
        className: 'bg-rose-50 text-rose-700 hover:bg-rose-100',
      },
      {
        key: 'learning' as const,
        label: '知识学习',
        hint: '生成便于学习吸收的结构化笔记',
        className: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
      },
    ],
    []
  );

  const creationActions = useMemo(
    () => [
      {
        mode: 'summary' as const,
        label: '简化成摘要',
        hint: '提炼关键信息',
        className: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
      },
      {
        mode: 'infographic' as const,
        label: '信息图',
        hint: '适合快速展示',
        className: 'bg-sky-50 text-sky-700 hover:bg-sky-100',
      },
      {
        mode: 'mindmap' as const,
        label: '思维导图',
        hint: '梳理结构关系',
        className: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
      },
      {
        mode: 'report' as const,
        label: '生成报告',
        hint: '整理成长文内容',
        className: 'bg-rose-50 text-rose-700 hover:bg-rose-100',
      },
      {
        mode: 'webpage' as const,
        label: '互动PPT',
        hint: '输出可演示页面',
        className: 'bg-violet-50 text-violet-700 hover:bg-violet-100',
      },
    ],
    []
  );

  const emitDocStatus = useCallback((nextId: string | null, html: string) => {
    window.dispatchEvent(
      new CustomEvent('knowledge-doc-saved', {
        detail: {
          exists: Boolean(nextId),
          hasContent: hasMeaningfulHtml(html),
        },
      })
    );
  }, []);

  const fetchDoc = useCallback(async () => {
    if (!notebookId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDocId(null);
        setContent('');
        emitDocStatus(null, '');
        return;
      }
      const rawContent = typeof data?.content === 'string' ? data.content : '';
      const nextContent = rawContent.includes('<') ? rawContent : markdownToHtml(rawContent);
      const nextId = typeof data?.id === 'string' ? data.id : null;
      const storedHistory = normalizeHistoryEntries(data?.history);
      setDocId(nextId);
      setContent(nextContent || '<p></p>');
      initialContentRef.current = nextContent || '<p></p>';
      setDocHistory(
        storedHistory.length > 0
          ? storedHistory
          : hasMeaningfulHtml(nextContent || '<p></p>')
            ? appendHistoryEntry([], '', nextContent || '<p></p>', {
                summary: '当前版本',
                historyMode: 'append',
              })
            : []
      );
      emitDocStatus(nextId, nextContent || '<p></p>');
    } finally {
      setLoading(false);
    }
  }, [emitDocStatus, notebookId]);

  useEffect(() => {
    void fetchDoc();
  }, [fetchDoc]);

  const saveDoc = useCallback(
    async (html: string, options: SaveDocOptions = {}) => {
      if (!notebookId || saving) return null;
      const previous = initialContentRef.current ?? '';
      const nextHistory = appendHistoryEntry(docHistoryRef.current, previous, html, options);
      setSaving(true);
      try {
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: html, history: nextHistory }),
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        const next = typeof data?.content === 'string' ? data.content : html;
        const nextId = typeof data?.id === 'string' ? data.id : docId;
        setDocHistory(normalizeHistoryEntries(data?.history).length > 0 ? normalizeHistoryEntries(data?.history) : nextHistory);
        initialContentRef.current = next;
        setDocId(nextId ?? null);
        setContent(next);
        emitDocStatus(nextId ?? null, next);
        return { id: nextId ?? null, content: next };
      } finally {
        setSaving(false);
      }
    },
    [docId, emitDocStatus, notebookId, saving]
  );

  const ensureDocExists = useCallback(async () => {
    if (docId) return docId;
    const currentHtml = content || '<p></p>';
    const saved = await saveDoc(currentHtml);
    return saved?.id ?? null;
  }, [content, docId, saveDoc]);

  const editor = useEditor({
    extensions: [StarterKit],
    content,
    editable: !!notebookId && !pendingDiff,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        void saveDoc(html, { historyMode: 'merge-edit' });
      }, 800);
    },
    editorProps: {
      attributes: {
        class: 'knowledge-doc-editor min-h-[240px] px-4 py-3 text-gray-900 focus:outline-none dark:text-gray-100',
      },
    },
  });

  useEffect(() => {
    if (!editor || loading) return;
    const current = editor.getHTML();
    const target = content || '<p></p>';
    if (target !== current && (initialContentRef.current === target || !initialContentRef.current)) {
      editor.commands.setContent(target, false);
    }
  }, [content, editor, loading]);

  useEffect(() => {
    docHistoryRef.current = docHistory;
  }, [docHistory]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const currentHtml = editor?.getHTML() ?? content ?? '<p></p>';
  const docHasContent = hasMeaningfulHtml(currentHtml);
  const panelBusy = updatingFromChat || externalBusy || draftScenarioLoading != null || creationGenerating != null;

  const applyGeneratedText = useCallback(
    async (nextText: string, options: SaveDocOptions = {}) => {
      const newHtml = markdownToHtml(nextText);
      editor?.commands.setContent(newHtml || '<p></p>', false);
      await saveDoc(newHtml || '<p></p>', options);
    },
    [editor, saveDoc]
  );

  const runDraftGeneration = useCallback(
    async (scenario: DraftScenarioKey, mode: 'create' | 'update') => {
      if (!notebookId || draftScenarioLoading) return;
      setSheetMode(null);
      setDraftScenarioLoading(scenario);
      setExternalBusy(true);
      setExternalBusyLabel(mode === 'update' ? '正在根据最新来源更新知识文档…' : '正在生成知识文档初稿…');
      try {
        await ensureDocExists();
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenario, mode }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || typeof data?.suggestedContent !== 'string') {
          throw new Error(data?.error ?? '知识文档生成失败');
        }
        const scenarioLabel = draftScenarios.find((item) => item.key === scenario)?.label ?? '当前场景';
        await applyGeneratedText(data.suggestedContent, {
          historyMode: 'append',
          summary: mode === 'update' ? `更新${scenarioLabel}初稿` : `生成${scenarioLabel}初稿`,
        });
        setSheetMode(null);
      } catch (error) {
        alert(error instanceof Error ? error.message : '知识文档生成失败');
      } finally {
        setDraftScenarioLoading(null);
        setExternalBusy(false);
      }
    },
    [applyGeneratedText, draftScenarioLoading, draftScenarios, ensureDocExists, notebookId]
  );

  const runCreationGenerate = useCallback(
    async (mode: CreationMode) => {
      if (!notebookId || creationGenerating) return;
      const baseContent = stripHtml(editor?.getHTML() ?? content ?? '');
      if (!baseContent) {
        alert('请先生成或填写知识文档内容');
        return;
      }
      setSheetMode(null);
      setCreationGenerating(mode);
      let tempNoteId: string | null = null;
      try {
        const createRes = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `创作_${mode}_${Date.now()}`,
            content: baseContent,
          }),
        });
        const createData = await createRes.json().catch(() => ({}));
        if (!createRes.ok || !createData?.id) {
          throw new Error(createData?.error ?? '创建素材失败');
        }
        tempNoteId = String(createData.id);
        const genRes = await fetch('/api/notes/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notebookId, noteIds: [tempNoteId], mode }),
        });
        const genData = await genRes.json().catch(() => ({}));
        if (!genRes.ok) throw new Error(genData?.error ?? '生成失败');
        setSheetMode(null);
        window.dispatchEvent(new CustomEvent('notes-updated'));
      } catch (error) {
        alert(error instanceof Error ? error.message : '生成失败');
      } finally {
        if (tempNoteId) {
          await fetch(`/api/notes/${encodeURIComponent(tempNoteId)}`, { method: 'DELETE' }).catch(() => null);
        }
        setCreationGenerating(null);
      }
    },
    [content, creationGenerating, editor, notebookId]
  );

  const openDraftSheet = useCallback(async () => {
    await ensureDocExists();
    setSheetMode('draft');
  }, [ensureDocExists]);

  const requestPreviewDownload = useCallback(() => {
    const markdown = htmlToMarkdownLike(editor?.getHTML() ?? content ?? '');
    const blob = new Blob([markdown || stripHtml(content)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'knowledge-doc.md';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [content, editor]);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ suggestedContent: string; autoApply?: boolean }>).detail;
      const suggested = typeof detail?.suggestedContent === 'string' ? detail.suggestedContent : '';
      if (!suggested) return;
      const previous = editor ? stripHtml(editor.getHTML()) : '';
      if (detail?.autoApply || autoUpdate) {
        setUpdatingFromChat(true);
        const newHtml = markdownToHtml(suggested);
        editor?.commands.setContent(newHtml || '<p></p>', false);
        void saveDoc(newHtml || '<p></p>', {
          historyMode: 'append',
          summary: '根据对话自动更新知识文档',
        });
        setPendingDiff(null);
        setUpdatingFromChat(false);
      } else {
        setPendingDiff({ previous, suggested });
      }
    };
    window.addEventListener('knowledge-doc-update-from-chat', onUpdate as EventListener);
    return () => window.removeEventListener('knowledge-doc-update-from-chat', onUpdate as EventListener);
  }, [autoUpdate, editor, saveDoc]);

  useEffect(() => {
    if (!autoUpdate || !notebookId || !editor) return;
    const onAnswer = async (event: Event) => {
      const detail = (event as CustomEvent<{
        user_question?: string;
        assistant_answer?: string;
        citations?: KnowledgeDocCitation[];
      }>).detail;
      const userQ = typeof detail?.user_question === 'string' ? detail.user_question : '';
      const assistantA = typeof detail?.assistant_answer === 'string' ? detail.assistant_answer : '';
      const highlightedMaterials = buildHighlightedMaterials(detail?.citations);
      if (!userQ.trim() && !assistantA.trim()) return;
      setUpdatingFromChat(true);
      try {
        const currentContent = editor.getHTML();
        const res = await fetch(
          `/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc/update-from-chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentContent,
              lastUserMessage: userQ,
              lastAssistantMessage: assistantA,
              highlightedMaterials,
            }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.suggestedContent) {
          setUpdatingFromChat(false);
          return;
        }
        const newHtml = markdownToHtml(String(data.suggestedContent));
        editor.commands.setContent(newHtml || '<p></p>', false);
        void saveDoc(newHtml || '<p></p>', {
          historyMode: 'append',
          summary: '根据最新对话自动更新知识文档',
        });
      } finally {
        setUpdatingFromChat(false);
      }
    };
    window.addEventListener('knowledge-unit-trigger', onAnswer as EventListener);
    return () => window.removeEventListener('knowledge-unit-trigger', onAnswer as EventListener);
  }, [autoUpdate, editor, notebookId, saveDoc]);

  useEffect(() => {
    const onCreateRequest = () => {
      void openDraftSheet();
    };

    const onGenerateRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ scenario?: DraftScenarioKey; mode?: 'create' | 'update' }>).detail;
      void runDraftGeneration(detail?.scenario ?? 'auto', detail?.mode ?? (docHasContent ? 'update' : 'create'));
    };

    const onOpenCreationDrawer = () => {
      setSheetMode('create');
    };

    const onPendingState = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean; label?: string }>).detail;
      setExternalBusy(Boolean(detail?.active));
      if (typeof detail?.label === 'string' && detail.label.trim()) {
        setExternalBusyLabel(detail.label.trim());
      }
    };

    window.addEventListener('knowledge-doc-create-request', onCreateRequest);
    window.addEventListener('knowledge-doc-generate-request', onGenerateRequest as EventListener);
    window.addEventListener('knowledge-doc-open-create-drawer', onOpenCreationDrawer);
    window.addEventListener('knowledge-doc-pending-state', onPendingState as EventListener);

    return () => {
      window.removeEventListener('knowledge-doc-create-request', onCreateRequest);
      window.removeEventListener('knowledge-doc-generate-request', onGenerateRequest as EventListener);
      window.removeEventListener('knowledge-doc-open-create-drawer', onOpenCreationDrawer);
      window.removeEventListener('knowledge-doc-pending-state', onPendingState as EventListener);
    };
  }, [docHasContent, openDraftSheet, runDraftGeneration]);

  const confirmPending = useCallback(() => {
    if (!pendingDiff || !editor) return;
    const newHtml = markdownToHtml(pendingDiff.suggested);
    editor.commands.setContent(newHtml || '<p></p>', false);
    void saveDoc(newHtml || '<p></p>', {
      historyMode: 'append',
      summary: '采纳了更新建议',
    });
    setPendingDiff(null);
  }, [editor, pendingDiff, saveDoc]);

  const rejectPending = useCallback(() => {
    setPendingDiff(null);
  }, []);

  const restoreHistoryEntry = useCallback(
    async (entry: KnowledgeDocHistoryEntry) => {
      if (!editor) return;
      const nextHtml = entry.content || '<p></p>';
      editor.commands.setContent(nextHtml, false);
      await saveDoc(nextHtml, {
        historyMode: 'append',
        summary: `回退到 ${formatHistoryTime(entry.savedAt)} 的版本`,
      });
      setHistoryOpen(false);
    },
    [editor, saveDoc]
  );

  if (!notebookId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 items-center justify-between px-3">
          {!collapsed ? (
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              知识文档
            </h2>
          ) : null}
          {onToggleCollapse ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              aria-label={collapsed ? '展开知识文档' : '收起知识文档'}
              title={collapsed ? '展开知识文档' : '收起知识文档'}
            >
              <CollapseIcon collapsed={collapsed} />
            </button>
          ) : null}
        </div>
        {collapsed ? null : (
          <div className="flex flex-1 items-center justify-center p-4 text-sm text-gray-400 dark:text-gray-500">
            请先选择 notebook
          </div>
        )}
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center px-2 py-3">
        <div className="flex h-8 w-full items-center justify-center">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="展开知识文档"
            title="展开知识文档"
          >
            <CollapseIcon collapsed />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="absolute inset-x-0 top-16 z-0 flex justify-center pointer-events-none">
        <div className="knowledge-doc-flow h-40 w-[82%] rounded-full bg-gradient-to-r from-sky-100/0 via-sky-100/55 to-violet-100/0 blur-3xl" />
      </div>

      <div className="relative z-10 flex h-12 shrink-0 items-center justify-between gap-2 px-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          知识文档
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[12px] bg-black/[0.04] px-3 text-xs font-medium text-gray-700 transition hover:bg-black/[0.07] dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15"
          >
            <HistoryIcon />
            历史
          </button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-[12px] bg-black/[0.04] px-2.5 text-xs text-gray-700 transition hover:bg-black/[0.07] dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15">
            <span className="font-medium text-gray-600 dark:text-gray-300">自动更新</span>
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={(e) => setAutoUpdate(e.target.checked)}
              className="h-4 w-4 rounded border border-gray-300 accent-gray-900 dark:border-gray-600"
            />
          </label>
          {onToggleCollapse ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              aria-label="收起知识文档"
              title="收起知识文档"
            >
              <CollapseIcon collapsed={false} />
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="relative z-10 flex flex-1 items-center justify-center p-4 text-xs text-gray-500 dark:text-gray-400">
          加载中…
        </div>
      ) : pendingDiff ? (
        <div className="relative z-10 flex flex-1 min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
            <span className="text-xs text-gray-600 dark:text-gray-400">AI 建议修改（红=旧，绿=新）</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={rejectPending}
                className="rounded-[12px] border border-gray-300 px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-300"
              >
                放弃
              </button>
              <button
                type="button"
                onClick={confirmPending}
                className="rounded-[12px] bg-gray-900 px-2 py-1 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900"
              >
                确认修改
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
            <DiffView oldText={pendingDiff.previous} newText={pendingDiff.suggested} className="min-h-[120px]" />
          </div>
        </div>
      ) : docHasContent ? (
        <div className="relative z-10 min-h-0 flex-1 overflow-auto px-2 pb-5">
          <div className="min-h-full rounded-[8px] bg-white/55 dark:bg-gray-900/60">
            <EditorContent editor={editor} />
          </div>
          {saving ? <p className="px-3 pb-2 pt-2 text-[10px] text-gray-400 dark:text-gray-500">保存中…</p> : null}
        </div>
      ) : (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="max-w-[260px] space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f6fb] text-gray-700">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 4h10l3 3v13H7z" />
                <path d="M17 4v3h3" />
                <path d="M10 12h7M10 16h7M10 8h2" />
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {docId ? '知识文档已创建' : '当前还没有知识文档'}
              </p>
              <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                {docId
                  ? '选择一个场景，让系统基于现有来源生成第一版初稿。'
                  : '可以先创建一个空白知识文档，再根据来源生成初稿。'}
              </p>
            </div>
            {docId ? (
              <button
                type="button"
                onClick={() => void openDraftSheet()}
                className="inline-flex h-10 items-center rounded-[12px] bg-[#f5f6fb] px-4 text-sm font-medium text-gray-700 transition hover:bg-[#eceef8]"
              >
                选择场景生成初稿
              </button>
            ) : (
              <KnowledgeDocCreateButton onClick={() => void openDraftSheet()} />
            )}
          </div>
        </div>
      )}

      {updatingFromChat && !panelBusy ? (
        <p className="relative z-10 px-3 py-1 text-xs text-blue-600 dark:text-blue-400">正在根据对话更新文档…</p>
      ) : null}

      {docHasContent ? (
        <div className="relative z-10 flex shrink-0 items-center justify-center gap-2 px-3 pb-3 pt-0">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex h-10 items-center rounded-[12px] bg-gray-100 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-200"
          >
            预览
          </button>
          <button
            type="button"
            onClick={() => setSheetMode('create')}
            className="inline-flex h-10 items-center gap-2 rounded-[12px] bg-black px-4 text-sm font-medium text-white shadow-sm transition hover:bg-black/92 dark:bg-white dark:text-black dark:hover:bg-white/92"
          >
            去创作
            <ArrowRightIcon />
          </button>
        </div>
      ) : null}

      {panelBusy ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/76 backdrop-blur-[2px] dark:bg-gray-950/72">
          <div className="relative overflow-hidden rounded-[22px] border border-white/70 bg-white/90 px-5 py-4 text-center shadow-lg dark:border-gray-800 dark:bg-gray-900/90">
            <div className="knowledge-doc-busy absolute inset-0" />
            <div className="relative z-10 space-y-2">
              <div className="mx-auto h-9 w-9 rounded-full border-2 border-gray-200 border-t-gray-700 animate-spin dark:border-gray-700 dark:border-t-gray-100" />
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{externalBusyLabel}</p>
            </div>
          </div>
        </div>
      ) : null}

      {sheetMode ? (
        <div
          className="app-modal-backdrop absolute inset-x-0 bottom-0 top-[72px] z-30 flex items-end"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSheetMode(null);
            }
          }}
        >
          <div className="knowledge-doc-sheet-enter max-h-full w-full overflow-auto rounded-t-[28px] bg-white px-4 pb-4 pt-4 shadow-[0_-20px_40px_rgba(15,23,42,0.15)] dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3 px-1">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {sheetMode === 'draft' ? '选择知识文档场景' : '基于知识文档去创作'}
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {sheetMode === 'draft'
                    ? '先生成一版可继续编辑的知识文档初稿。'
                    : '从当前知识文档快速生成结构化内容。'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSheetMode(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="关闭抽屉"
                title="关闭"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m18 6-12 12M6 6l12 12" />
                </svg>
              </button>
            </div>

            {sheetMode === 'draft' ? (
              <div className="grid grid-cols-2 gap-3 px-1 py-5">
                {draftScenarios.map(({ key, label, hint, className }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void runDraftGeneration(key, docHasContent ? 'update' : 'create')}
                    disabled={draftScenarioLoading != null}
                    className={`flex min-h-[82px] flex-col items-start justify-between rounded-[18px] px-4 py-3 text-left transition disabled:opacity-50 ${className}`}
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <DraftIcon scenario={key} />
                      {draftScenarioLoading === key ? '生成中…' : label}
                    </span>
                    <span className="text-xs text-black/55 dark:text-white/60">{hint}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 px-1 py-5">
                {creationActions.map(({ mode, label, hint, className }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => void runCreationGenerate(mode)}
                    disabled={creationGenerating != null}
                    className={`flex min-h-[82px] flex-col items-start justify-between rounded-[18px] px-4 py-3 text-left transition disabled:opacity-50 ${className}`}
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <CreationIcon mode={mode} />
                      {creationGenerating === mode ? '生成中…' : label}
                    </span>
                    <span className="text-xs text-black/55 dark:text-white/60">{hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {previewOpen ? (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] bg-white shadow-xl dark:bg-gray-900">
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">知识文档预览</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">完整查看当前渲染后的文档内容。</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={requestPreviewDownload}
                  className="inline-flex h-8 items-center rounded-[12px] bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
                >
                  下载
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="inline-flex h-8 items-center rounded-[12px] bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-[#f7f7f8] p-5 dark:bg-gray-950">
              <div
                className="knowledge-doc-editor mx-auto min-h-[60vh] max-w-3xl rounded-[20px] bg-white px-8 py-8 shadow-sm dark:bg-gray-900"
                dangerouslySetInnerHTML={{ __html: currentHtml }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div
          className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setHistoryOpen(false);
            }
          }}
        >
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] bg-white shadow-xl dark:bg-gray-900">
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">知识文档历史</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">查看最近修改，并可一键回退到任一版本。</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="inline-flex h-8 items-center rounded-[12px] bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
              {docHistory.length > 0 ? (
                <div className="space-y-3">
                  {docHistory.map((entry) => {
                    const isCurrent = entry.content === currentHtml;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => void restoreHistoryEntry(entry)}
                        className="flex w-full items-start justify-between gap-4 rounded-[18px] bg-[#f6f6f7] px-4 py-3 text-left transition hover:bg-[#eeeeef] dark:bg-gray-800 dark:hover:bg-gray-700"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{entry.summary}</p>
                            {isCurrent ? (
                              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-gray-500 shadow-sm dark:bg-gray-900 dark:text-gray-300">
                                当前版本
                              </span>
                            ) : null}
                          </div>
                          <p className="line-clamp-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                            {extractHistoryFocus(htmlToMarkdownLike(entry.content)) || '查看当时的文档内容并回退到该版本。'}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-gray-500 dark:text-gray-400">{formatHistoryTime(entry.savedAt)}</p>
                          <p className="mt-2 text-xs font-medium text-gray-700 dark:text-gray-200">点击回退</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-[220px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                  暂时还没有可回退的版本。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

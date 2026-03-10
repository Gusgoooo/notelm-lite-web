'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import DiffMatchPatch from 'diff-match-patch';
import {
  getDefaultKnowledgeDocScenarioState,
  KNOWLEDGE_DOC_SCENARIO_EDITOR_HINT,
  KNOWLEDGE_DOC_SCENARIO_INSTRUCTION_PLACEHOLDER,
  normalizeKnowledgeDocScenarioState,
  summarizeScenarioStructure,
  type KnowledgeDocScenario,
  type KnowledgeDocScenarioId,
  type KnowledgeDocScenarioState,
} from '@/lib/knowledge-doc-scenarios';
import { markdownToKnowledgeDocHtml, normalizeKnowledgeDocMarkdown } from '@/lib/knowledge-doc-markdown';
import { KnowledgeDocCreateButton } from './KnowledgeDocCreateButton';

type KnowledgeDocPanelProps = {
  notebookId: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

type CreationMode = 'infographic' | 'summary' | 'mindmap' | 'report' | 'webpage';
type SheetMode = 'draft' | 'create' | null;
type HistoryMode = 'append' | 'merge-edit' | 'skip';
type ScenarioEditorMode = 'create' | 'clone' | 'edit';

type KnowledgeDocHistoryEntry = {
  id: string;
  content: string;
  summary: string;
  savedAt: string;
};

type ArtifactNoticeState = 'running' | 'success' | 'error';

type SaveDocOptions = {
  historyMode?: HistoryMode;
  summary?: string;
};

type DraftDialogState =
  | {
      kind: 'loading' | 'error';
      title: string;
      description: string;
    }
  | null;

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

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function AddScenarioIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function StructureSwitchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h10" />
      <path d="M18 6h2" />
      <path d="M10 12h10" />
      <path d="M4 12h2" />
      <path d="M4 18h12" />
      <path d="M20 18h0.01" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="7" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

function getScenarioCardClass(scenario: KnowledgeDocScenario): string {
  if (!scenario.builtIn) {
    return 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50';
  }
  if (scenario.accent === 'sky') return 'bg-sky-50 text-sky-700 hover:bg-sky-100';
  if (scenario.accent === 'emerald') return 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
  if (scenario.accent === 'amber') return 'bg-amber-50 text-amber-700 hover:bg-amber-100';
  if (scenario.accent === 'violet') return 'bg-violet-50 text-violet-700 hover:bg-violet-100';
  if (scenario.accent === 'rose') return 'bg-rose-50 text-rose-700 hover:bg-rose-100';
  return 'bg-slate-100 text-slate-700 hover:bg-slate-200';
}

function stripHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? div.innerText ?? '').replace(/\s+/g, ' ').trim();
}

function hasMeaningfulHtml(html: string): boolean {
  return stripHtml(html).length > 0;
}

function toSafeDocHtmlFromSuggestedMarkdown(suggestedMarkdown: string, currentHtml: string): string | null {
  const nextHtml = markdownToKnowledgeDocHtml(suggestedMarkdown);
  if (!hasMeaningfulHtml(nextHtml) && suggestedMarkdown.trim() && hasMeaningfulHtml(currentHtml)) {
    return null;
  }
  return nextHtml || '<p></p>';
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
  const previousMarkdown = normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(previousHtml));
  const nextMarkdown = normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(nextHtml));
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

function emitArtifactNotice(detail: {
  id: string;
  state: ArtifactNoticeState;
  title: string;
  description: string;
}) {
  window.dispatchEvent(new CustomEvent('artifact-notice', { detail }));
}

function appendHistoryEntry(
  entries: KnowledgeDocHistoryEntry[],
  previousHtml: string,
  nextHtml: string,
  options: SaveDocOptions = {}
): KnowledgeDocHistoryEntry[] {
  if (options.historyMode === 'skip') return entries;
  const previousMarkdown = normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(previousHtml));
  const nextMarkdown = normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(nextHtml));
  if (previousMarkdown === nextMarkdown) return entries;

  const summary = (options.summary ?? buildHistorySummary(previousHtml, nextHtml)).trim() || '编辑了知识文档';
  const nextEntry: KnowledgeDocHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    content: nextMarkdown,
    summary,
    savedAt: new Date().toISOString(),
  };

  if (entries[0]?.content === nextMarkdown) {
    return [{ ...entries[0], summary: nextEntry.summary, savedAt: nextEntry.savedAt }, ...entries.slice(1)];
  }

  if (options.historyMode === 'merge-edit' && entries[0]) {
    const latest = entries[0];
    const latestAt = Date.parse(latest.savedAt);
    if (Number.isFinite(latestAt) && Date.now() - latestAt < 120000 && latest.summary.startsWith('编辑')) {
      return [{ ...latest, content: nextMarkdown, summary: nextEntry.summary, savedAt: nextEntry.savedAt }, ...entries.slice(1)];
    }
  }

  return [nextEntry, ...entries].slice(0, HISTORY_STORAGE_LIMIT);
}

function creationModeLabel(mode: CreationMode): string {
  if (mode === 'summary') return '摘要';
  if (mode === 'infographic') return '信息图';
  if (mode === 'mindmap') return '思维导图';
  if (mode === 'report') return '报告';
  return '互动PPT';
}

function htmlToMarkdownLike(html: string): string {
  if (typeof document === 'undefined') {
    return stripHtml(html);
  }

  const container = document.createElement('div');
  container.innerHTML = html;

  const toTableCellMarkdown = (value: string): string =>
    value
      .replace(/\s*\n\s*/g, '<br />')
      .replace(/\|/g, '\\|')
      .trim();

  const tableToMarkdown = (table: HTMLTableElement): string[] => {
    const rawRows = Array.from(table.querySelectorAll('tr'))
      .map((row) =>
        Array.from(row.children)
          .filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement)
          .map((cell) =>
            toTableCellMarkdown(
              Array.from(cell.childNodes)
                .map((child) => inlineNodeToMarkdown(child))
                .join('')
            )
          )
      )
      .filter((row) => row.length > 0);

    if (rawRows.length === 0) return [];

    const columnCount = Math.max(...rawRows.map((row) => row.length), 1);
    const rows = rawRows.map((row) => Array.from({ length: columnCount }, (_item, index) => row[index] ?? ''));
    const hasHeader = Boolean(table.querySelector('thead th, tr th'));
    const header = hasHeader ? rows[0] : rows[0].map((cell, index) => cell || `列${index + 1}`);
    const body = hasHeader ? rows.slice(1) : rows;
    const separator = Array.from({ length: columnCount }, () => '---');
    const lines = [`| ${header.join(' | ')} |`, `| ${separator.join(' | ')} |`];

    for (const row of body) {
      lines.push(`| ${row.join(' | ')} |`);
    }

    return lines;
  };

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

    if (node.tagName === 'TABLE') return tableToMarkdown(node as HTMLTableElement);
    if (node.tagName === 'HR') return ['---'];

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
  const [pendingDiff, setPendingDiff] = useState<{ previous: string; suggested: string } | null>(null);
  const [updatingFromChat, setUpdatingFromChat] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [docHistory, setDocHistory] = useState<KnowledgeDocHistoryEntry[]>([]);
  const [scenarioState, setScenarioState] = useState<KnowledgeDocScenarioState>(getDefaultKnowledgeDocScenarioState);
  const [draftScenarioLoading, setDraftScenarioLoading] = useState<KnowledgeDocScenarioId | null>(null);
  const [draftDialog, setDraftDialog] = useState<DraftDialogState>(null);
  const [creationGenerating, setCreationGenerating] = useState<CreationMode | null>(null);
  const [externalBusy, setExternalBusy] = useState(false);
  const [externalBusyLabel, setExternalBusyLabel] = useState('正在更新知识文档…');
  const [scenarioEditorOpen, setScenarioEditorOpen] = useState(false);
  const [scenarioEditorMode, setScenarioEditorMode] = useState<ScenarioEditorMode>('create');
  const [scenarioEditorSourceId, setScenarioEditorSourceId] = useState<KnowledgeDocScenarioId | null>(null);
  const [scenarioTitleDraft, setScenarioTitleDraft] = useState('');
  const [scenarioStructureDraft, setScenarioStructureDraft] = useState('');
  const [scenarioEditorSaving, setScenarioEditorSaving] = useState(false);
  const [structureSwitchOpen, setStructureSwitchOpen] = useState(false);
  const [structureScenarioId, setStructureScenarioId] = useState<KnowledgeDocScenarioId | ''>('');
  const [structureDraft, setStructureDraft] = useState('');
  const [structureSaving, setStructureSaving] = useState(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialContentRef = useRef<string | null>(null);
  const docHistoryRef = useRef<KnowledgeDocHistoryEntry[]>([]);

  const draftScenarios = useMemo(() => scenarioState.scenarios, [scenarioState.scenarios]);
  const activeScenario = useMemo(
    () => draftScenarios.find((item) => item.id === scenarioState.activeScenarioId) ?? null,
    [draftScenarios, scenarioState.activeScenarioId]
  );
  const selectedStructureScenario = useMemo(
    () => draftScenarios.find((item) => item.id === structureScenarioId) ?? null,
    [draftScenarios, structureScenarioId]
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
      const nextMarkdown = normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(rawContent));
      const nextContent = markdownToKnowledgeDocHtml(nextMarkdown || '');
      const nextId = typeof data?.id === 'string' ? data.id : null;
      const storedHistory = normalizeHistoryEntries(data?.history).map((entry) => ({
        ...entry,
        content: normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(entry.content)),
      }));
      const nextScenarioState = normalizeKnowledgeDocScenarioState(data?.scenarioState);
      setDocId(nextId);
      setContent(nextContent || '<p></p>');
      initialContentRef.current = nextContent || '<p></p>';
      setScenarioState(nextScenarioState);
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
      emitDocStatus(nextId, nextMarkdown);
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
      const nextMarkdown = normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(html));
      setSaving(true);
      try {
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: nextMarkdown, history: nextHistory }),
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        const nextMarkdownFromApi = normalizeKnowledgeDocMarkdown(
          htmlToMarkdownLike(typeof data?.content === 'string' ? data.content : nextMarkdown)
        );
        const next = markdownToKnowledgeDocHtml(nextMarkdownFromApi || '');
        const nextId = typeof data?.id === 'string' ? data.id : docId;
        const nextScenarioState = normalizeKnowledgeDocScenarioState(data?.scenarioState);
        const storedHistory = normalizeHistoryEntries(data?.history).map((entry) => ({
          ...entry,
          content: normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(entry.content)),
        }));
        setDocHistory(storedHistory.length > 0 ? storedHistory : nextHistory);
        initialContentRef.current = next;
        setDocId(nextId ?? null);
        setContent(next);
        setScenarioState(nextScenarioState);
        emitDocStatus(nextId ?? null, nextMarkdownFromApi);
        return { id: nextId ?? null, content: next };
      } finally {
        setSaving(false);
      }
    },
    [docId, emitDocStatus, notebookId, saving]
  );

  const saveScenarioState = useCallback(
    async (nextScenarioState: KnowledgeDocScenarioState) => {
      if (!notebookId) return;
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioState: nextScenarioState }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? '保存知识文档结构失败');
      }
      const data = await res.json().catch(() => ({}));
      setScenarioState(normalizeKnowledgeDocScenarioState(data?.scenarioState));
    },
    [notebookId]
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
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
        class: 'knowledge-doc-editor min-h-[240px] px-4 py-3 focus:outline-none',
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
  const currentMarkdown = normalizeKnowledgeDocMarkdown(htmlToMarkdownLike(currentHtml));
  const docHasContent = hasMeaningfulHtml(currentHtml);
  const panelBusy = updatingFromChat || externalBusy;

  const openStructureSwitch = useCallback(() => {
    const scenario = activeScenario ?? draftScenarios[0];
    if (!scenario) return;
    setStructureScenarioId(scenario.id);
    setStructureDraft(scenario.structure);
    setStructureSwitchOpen(true);
  }, [activeScenario, draftScenarios]);

  const closeStructureSwitch = useCallback((force = false) => {
    if (structureSaving && !force) return;
    setStructureSwitchOpen(false);
    setStructureScenarioId('');
    setStructureDraft('');
  }, [structureSaving]);

  const openScenarioEditor = useCallback(
    (mode: ScenarioEditorMode, scenario?: KnowledgeDocScenario | null) => {
      if (mode === 'create') {
        setScenarioEditorMode('create');
        setScenarioEditorSourceId(null);
        setScenarioTitleDraft('');
        setScenarioStructureDraft('');
      } else if (scenario) {
        setScenarioEditorMode(mode);
        setScenarioEditorSourceId(scenario.id);
        setScenarioTitleDraft(mode === 'clone' ? `${scenario.label} 自定义版` : scenario.label);
        setScenarioStructureDraft(scenario.structure);
      }
      setScenarioEditorOpen(true);
    },
    []
  );

  const closeScenarioEditor = useCallback((force = false) => {
    if (scenarioEditorSaving && !force) return;
    setScenarioEditorOpen(false);
    setScenarioEditorSourceId(null);
    setScenarioTitleDraft('');
    setScenarioStructureDraft('');
  }, [scenarioEditorSaving]);

  const handleSaveScenario = useCallback(async () => {
    const nextTitle = scenarioTitleDraft.trim().slice(0, 40);
    const nextStructure = scenarioStructureDraft.trim().slice(0, 12000);
    if (!nextTitle || !nextStructure) return;

    const nextScenario: KnowledgeDocScenario = {
      id:
        scenarioEditorMode === 'edit' && scenarioEditorSourceId
          ? scenarioEditorSourceId
          : (`custom-${Date.now().toString(36)}` as KnowledgeDocScenarioId),
      presetKey: 'custom',
      label: nextTitle,
      hint: summarizeScenarioStructure(nextStructure),
      structure: nextStructure,
      builtIn: false,
      accent: 'slate',
    };

    const nextScenarioState: KnowledgeDocScenarioState =
      scenarioEditorMode === 'edit' && scenarioEditorSourceId
        ? {
            ...scenarioState,
            scenarios: scenarioState.scenarios.map((item) =>
              item.id === scenarioEditorSourceId ? nextScenario : item
            ),
            activeScenarioId:
              scenarioState.activeScenarioId === scenarioEditorSourceId
                ? nextScenario.id
                : scenarioState.activeScenarioId,
          }
        : {
            ...scenarioState,
            scenarios: [...scenarioState.scenarios, nextScenario],
            activeScenarioId: scenarioState.activeScenarioId,
          };

      setScenarioEditorSaving(true);
    try {
      setScenarioState(nextScenarioState);
      await saveScenarioState(nextScenarioState);
      closeScenarioEditor(true);
    } catch (error) {
      setScenarioState(scenarioState);
      alert(error instanceof Error ? error.message : '保存场景失败');
    } finally {
      setScenarioEditorSaving(false);
    }
  }, [
    closeScenarioEditor,
    saveScenarioState,
    scenarioEditorMode,
    scenarioEditorSourceId,
    scenarioState,
    scenarioStructureDraft,
    scenarioTitleDraft,
  ]);

  const handleChangeStructureScenario = useCallback(
    (nextScenarioId: string) => {
      const scenario = draftScenarios.find((item) => item.id === nextScenarioId);
      if (!scenario) return;
      setStructureScenarioId(scenario.id);
      setStructureDraft(scenario.structure);
    },
    [draftScenarios]
  );

  const applyGeneratedText = useCallback(
    async (nextText: string, options: SaveDocOptions = {}) => {
      const currentHtml = editor?.getHTML() ?? content ?? '<p></p>';
      const newHtml = toSafeDocHtmlFromSuggestedMarkdown(nextText, currentHtml);
      if (!newHtml) {
        throw new Error('生成内容格式异常，已保留当前知识文档。');
      }
      editor?.commands.setContent(newHtml || '<p></p>', false);
      await saveDoc(newHtml || '<p></p>', options);
    },
    [content, editor, saveDoc]
  );

  const runDraftGeneration = useCallback(
    async (
      scenarioId: KnowledgeDocScenarioId,
      mode: 'create' | 'update',
      options?: {
        scenarioConfig?: KnowledgeDocScenario;
        scenarioStateOverride?: KnowledgeDocScenarioState;
      }
    ) => {
      if (!notebookId || draftScenarioLoading) return;
      const baseScenarioState = options?.scenarioStateOverride ?? scenarioState;
      const scenarioConfig =
        options?.scenarioConfig ?? baseScenarioState.scenarios.find((item) => item.id === scenarioId);
      if (!scenarioConfig) return;
      setSheetMode(null);
      setDraftScenarioLoading(scenarioId);
      setDraftDialog({
        kind: 'loading',
        title: mode === 'update' ? `正在更新${scenarioConfig.label}` : `正在生成${scenarioConfig.label}`,
        description: '系统正在按所选结构整理内容，完成后会直接更新到右侧知识文档。',
      });
      const scenarioLabel = scenarioConfig.label;
      const previousScenarioState = baseScenarioState;
      try {
        const nextScenarioState: KnowledgeDocScenarioState = {
          ...baseScenarioState,
          activeScenarioId: scenarioConfig.id,
        };
        setScenarioState(nextScenarioState);
        await saveScenarioState(nextScenarioState);
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenarioId: scenarioConfig.id, mode }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || typeof data?.suggestedContent !== 'string') {
          throw new Error(data?.error ?? '知识文档生成失败');
        }
        await applyGeneratedText(data.suggestedContent, {
          historyMode: 'append',
          summary: mode === 'update' ? `更新${scenarioLabel}初稿` : `生成${scenarioLabel}初稿`,
        });
        setSheetMode(null);
        setDraftDialog(null);
      } catch (error) {
        setScenarioState(previousScenarioState);
        setDraftDialog({
          kind: 'error',
          title: `${scenarioLabel}生成失败`,
          description: error instanceof Error ? error.message : '知识文档生成失败',
        });
      } finally {
        setDraftScenarioLoading(null);
      }
    },
    [applyGeneratedText, draftScenarioLoading, notebookId, saveScenarioState, scenarioState]
  );

  const handleApplyStructure = useCallback(
    async (saveAsCustom: boolean) => {
      if (!notebookId || structureSaving) return;
      const selectedScenario =
        draftScenarios.find((item) => item.id === structureScenarioId) ?? activeScenario ?? draftScenarios[0];
      if (!selectedScenario) return;
      const nextStructure = structureDraft.trim().slice(0, 12000);
      if (!nextStructure) return;

      const previousScenarioState = scenarioState;
      const changed = nextStructure !== selectedScenario.structure;
      let nextScenarioState: KnowledgeDocScenarioState = scenarioState;
      let nextScenario = selectedScenario;
      setStructureSaving(true);
      try {
        if (saveAsCustom || (selectedScenario.builtIn && changed)) {
          const customScenario: KnowledgeDocScenario = {
            id: `custom-${Date.now().toString(36)}` as KnowledgeDocScenarioId,
            presetKey: 'custom',
            label: `${selectedScenario.label} 自定义`.slice(0, 40),
            hint: summarizeScenarioStructure(nextStructure),
            structure: nextStructure,
            builtIn: false,
            accent: selectedScenario.accent,
          };
          nextScenarioState = {
            ...scenarioState,
            scenarios: [...scenarioState.scenarios, customScenario],
            activeScenarioId: customScenario.id,
          };
          nextScenario = customScenario;
        } else if (!selectedScenario.builtIn && changed) {
          const updatedScenario: KnowledgeDocScenario = {
            ...selectedScenario,
            structure: nextStructure,
            hint: summarizeScenarioStructure(nextStructure),
          };
          nextScenarioState = {
            ...scenarioState,
            scenarios: scenarioState.scenarios.map((item) =>
              item.id === selectedScenario.id ? updatedScenario : item
            ),
            activeScenarioId: updatedScenario.id,
          };
          nextScenario = updatedScenario;
        } else {
          nextScenarioState = {
            ...scenarioState,
            activeScenarioId: selectedScenario.id,
          };
        }

        setScenarioState(nextScenarioState);
        await saveScenarioState(nextScenarioState);
        closeStructureSwitch(true);
        await runDraftGeneration(nextScenario.id, docHasContent ? 'update' : 'create', {
          scenarioConfig: nextScenario,
          scenarioStateOverride: nextScenarioState,
        });
      } catch (error) {
        setScenarioState(previousScenarioState);
        alert(error instanceof Error ? error.message : '应用文档结构失败');
      } finally {
        setStructureSaving(false);
      }
    },
    [
      activeScenario,
      closeStructureSwitch,
      docHasContent,
      draftScenarios,
      notebookId,
      runDraftGeneration,
      saveScenarioState,
      scenarioState,
      structureDraft,
      structureSaving,
      structureScenarioId,
    ]
  );

  const runCreationGenerate = useCallback(
    async (mode: CreationMode) => {
      if (!notebookId || creationGenerating) return;
      const baseContent = stripHtml(editor?.getHTML() ?? content ?? '');
      if (!baseContent) {
        alert('请先生成或填写知识文档内容');
        return;
      }
      const noticeId = `artifact-${Date.now()}-${mode}`;
      const modeLabel = creationModeLabel(mode);
      setSheetMode(null);
      setCreationGenerating(mode);
      emitArtifactNotice({
        id: noticeId,
        state: 'running',
        title: `正在生成${modeLabel}`,
        description: '生成结果会进入作品列表，可稍后查看。',
      });
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
        const createdNoteId = typeof genData?.note?.id === 'string' ? genData.note.id : null;
        if (createdNoteId) {
          await fetch(`/api/notes/${encodeURIComponent(createdNoteId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: `作品 · ${modeLabel}` }),
          }).catch(() => null);
        }
        setSheetMode(null);
        emitArtifactNotice({
          id: noticeId,
          state: 'success',
          title: `${modeLabel}已完成`,
          description: '可在顶部作品列表中查看、预览和下载。',
        });
        window.dispatchEvent(new CustomEvent('notes-updated'));
        window.dispatchEvent(
          new CustomEvent('artifact-output-created', {
            detail: {
              noteId: createdNoteId,
            },
          })
        );
      } catch (error) {
        emitArtifactNotice({
          id: noticeId,
          state: 'error',
          title: `${modeLabel}生成失败`,
          description: error instanceof Error ? error.message : '生成失败',
        });
      } finally {
        if (tempNoteId) {
          await fetch(`/api/notes/${encodeURIComponent(tempNoteId)}`, { method: 'DELETE' }).catch(() => null);
        }
        setCreationGenerating(null);
      }
    },
    [content, creationGenerating, editor, notebookId]
  );

  const openDraftSheet = useCallback(() => {
    if (draftScenarioLoading || creationGenerating) return;
    setSheetMode('draft');
  }, [creationGenerating, draftScenarioLoading]);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ suggestedContent: string; autoApply?: boolean }>).detail;
      const suggested = typeof detail?.suggestedContent === 'string' ? detail.suggestedContent : '';
      if (!suggested) return;
      const previous = editor ? stripHtml(editor.getHTML()) : '';
      if (detail?.autoApply) {
        setUpdatingFromChat(true);
        const currentHtml = editor?.getHTML() ?? content ?? '<p></p>';
        const newHtml = toSafeDocHtmlFromSuggestedMarkdown(suggested, currentHtml);
        if (!newHtml) {
          setUpdatingFromChat(false);
          return;
        }
        editor?.commands.setContent(newHtml || '<p></p>', false);
        void saveDoc(newHtml || '<p></p>', {
          historyMode: 'append',
          summary: '根据本轮回答更新知识文档',
        });
        setPendingDiff(null);
        setUpdatingFromChat(false);
      } else {
        setPendingDiff({ previous, suggested });
      }
    };
    window.addEventListener('knowledge-doc-update-from-chat', onUpdate as EventListener);
    return () => window.removeEventListener('knowledge-doc-update-from-chat', onUpdate as EventListener);
  }, [content, editor, saveDoc]);

  useEffect(() => {
    const onCreateRequest = () => {
      void openDraftSheet();
    };

    const onGenerateRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ scenarioId?: string; scenario?: string; mode?: 'create' | 'update' }>).detail;
      void runDraftGeneration(
        (detail?.scenarioId ?? detail?.scenario ?? 'auto') as KnowledgeDocScenarioId,
        detail?.mode ?? (docHasContent ? 'update' : 'create')
      );
    };

    const onOpenCreationDrawer = () => {
      if (draftScenarioLoading || creationGenerating) return;
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
  }, [creationGenerating, docHasContent, draftScenarioLoading, openDraftSheet, runDraftGeneration]);

  const confirmPending = useCallback(() => {
    if (!pendingDiff || !editor) return;
    const currentEditorHtml = editor.getHTML();
    const newHtml = toSafeDocHtmlFromSuggestedMarkdown(pendingDiff.suggested, currentEditorHtml);
    if (!newHtml) {
      alert('本次建议内容格式异常，未应用到知识文档。');
      setPendingDiff(null);
      return;
    }
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
      const nextHtml = markdownToKnowledgeDocHtml(
        normalizeKnowledgeDocMarkdown(entry.content || '')
      );
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
      <div className="relative z-10 flex h-12 shrink-0 items-center justify-between gap-2 px-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          知识文档
        </h2>
        <div className="flex items-center gap-2">
          <div className="group relative">
            <button
              type="button"
              onClick={openStructureSwitch}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] bg-gray-100 text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              aria-label="切换知识结构"
              title="切换知识结构"
            >
              <StructureSwitchIcon />
            </button>
            <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[10px] bg-black px-2 py-1 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100 dark:bg-white dark:text-black">
              切换文档结构
            </span>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[12px] bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <HistoryIcon />
            历史
          </button>
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
          <div className="rounded-[14px] border border-gray-200 bg-[#f8f7f1] p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-900">
            <div className="min-h-full rounded-[10px] bg-[#f8f7f1] dark:bg-gray-900">
              <EditorContent editor={editor} />
            </div>
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
            onClick={() => window.dispatchEvent(new CustomEvent('workspace-open-works-list'))}
            className="inline-flex h-10 items-center rounded-[12px] bg-gray-100 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-200"
          >
            作品列表
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

      {draftDialog ? (
        <div className="absolute inset-x-0 bottom-0 top-12 z-20 flex items-center justify-center bg-white/82 px-4 dark:bg-gray-950/82">
          <div className="relative w-full max-w-[320px] overflow-hidden rounded-[22px] border border-gray-200 bg-white px-5 py-4 text-center shadow-lg dark:border-gray-800 dark:bg-gray-900">
            {draftDialog.kind === 'loading' ? <div className="knowledge-doc-busy absolute inset-0" /> : null}
            <div className="relative z-10 space-y-3">
              {draftDialog.kind === 'loading' ? (
                <div className="mx-auto h-9 w-9 rounded-full border-2 border-gray-200 border-t-gray-700 animate-spin dark:border-gray-700 dark:border-t-gray-100" />
              ) : (
                <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                    <circle cx="12" cy="12" r="9" />
                  </svg>
                </div>
              )}
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{draftDialog.title}</p>
                <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{draftDialog.description}</p>
              </div>
              {draftDialog.kind === 'error' ? (
                <button
                  type="button"
                  onClick={() => setDraftDialog(null)}
                  className="inline-flex h-8 items-center rounded-[12px] bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  关闭
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {panelBusy ? (
        <div className="absolute inset-x-0 bottom-0 top-12 z-20 flex items-center justify-center bg-white/82 px-4 dark:bg-gray-950/82">
          <div className="relative overflow-hidden rounded-[22px] border border-gray-200 bg-white px-5 py-4 text-center shadow-lg dark:border-gray-800 dark:bg-gray-900">
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
          className="app-modal-backdrop absolute inset-x-0 bottom-0 top-12 z-30 flex items-end"
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
                    ? '先选择一个项目说明，系统会根据它确定知识文档结构并调整对话方式。'
                    : '从当前知识文档快速生成结构化内容。'}
                </p>
                {sheetMode === 'draft' && activeScenario ? (
                  <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                    当前生效项目：{activeScenario.label}
                  </p>
                ) : null}
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
                {draftScenarios.map((scenario) => {
                  const isActive = scenarioState.activeScenarioId === scenario.id;
                  const isLoading = draftScenarioLoading === scenario.id;
                  return (
                    <div
                      key={scenario.id}
                      className={`group relative h-[98px] rounded-[18px] transition ${draftScenarioLoading != null ? 'opacity-50' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openScenarioEditor(scenario.builtIn ? 'clone' : 'edit', scenario);
                        }}
                        className={`absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/10 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 ${
                          scenario.builtIn ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
                        }`}
                        aria-label={scenario.builtIn ? '另存为新场景' : '编辑场景'}
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => void runDraftGeneration(scenario.id, docHasContent ? 'update' : 'create')}
                        disabled={draftScenarioLoading != null}
                        className={`flex h-[98px] w-full items-center rounded-[18px] px-4 py-3 text-left transition ${getScenarioCardClass(scenario)} ${
                          isActive ? 'ring-1 ring-black/15 dark:ring-white/20' : ''
                        }`}
                      >
                        <span className="pr-8 text-sm font-semibold">{isLoading ? '生成中…' : scenario.label}</span>
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => openScenarioEditor('create')}
                  className="col-span-2 flex h-[98px] flex-col items-start justify-center rounded-[18px] border border-dashed border-gray-300 bg-white px-4 py-3 text-left transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                >
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                      <AddScenarioIcon />
                      新增自定义结构
                    </span>
                    <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                      自定义项目说明和回复方式，保存后会作为一个新的场景卡片。
                    </p>
                  </div>
                </button>
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

      {structureSwitchOpen ? (
        <div
          className="app-modal-backdrop fixed inset-0 z-[61] flex items-center justify-center p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeStructureSwitch();
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-[24px] bg-white p-5 shadow-xl dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">自定义文档格式</h3>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  切换文档类型并修改项目说明。保存后会按最新设置重新生成当前知识文档。
                </p>
              </div>
              <button
                type="button"
                onClick={() => closeStructureSwitch()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="关闭文档结构编辑"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m18 6-12 12M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">文档类型</label>
                <select
                  value={structureScenarioId}
                  onChange={(event) => handleChangeStructureScenario(event.target.value)}
                  className="h-10 w-full rounded-[14px] border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                >
                  {draftScenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.label}
                    </option>
                  ))}
                </select>
                {selectedStructureScenario ? (
                  <p className="text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                    当前类型说明：{selectedStructureScenario.hint}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">项目说明</label>
                <p className="text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                  {KNOWLEDGE_DOC_SCENARIO_EDITOR_HINT}
                </p>
                <textarea
                  value={structureDraft}
                  onChange={(event) => setStructureDraft(event.target.value)}
                  className="min-h-[280px] w-full rounded-[18px] border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-900 outline-none transition focus:border-gray-300 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  placeholder={KNOWLEDGE_DOC_SCENARIO_INSTRUCTION_PLACEHOLDER}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => closeStructureSwitch()}
                className="inline-flex h-9 items-center rounded-[12px] border border-gray-300 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleApplyStructure(true)}
                disabled={!structureDraft.trim() || structureSaving}
                className="inline-flex h-9 items-center rounded-[12px] border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {structureSaving ? '处理中…' : '保存为自定义结构'}
              </button>
              <button
                type="button"
                onClick={() => void handleApplyStructure(false)}
                disabled={!structureDraft.trim() || structureSaving}
                className="inline-flex h-9 items-center rounded-[12px] bg-black px-3 text-xs font-medium text-white transition hover:bg-black/92 disabled:opacity-60"
              >
                {structureSaving ? '处理中…' : '保存并应用'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {scenarioEditorOpen ? (
        <div
          className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeScenarioEditor();
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-[24px] bg-white p-5 shadow-xl dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {scenarioEditorMode === 'edit' ? '编辑自定义项目' : '配置项目说明'}
                </h3>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {scenarioEditorMode === 'clone'
                    ? '基于当前预置项目调整标题和项目说明，保存后会生成一个新的自定义场景。'
                    : scenarioEditorMode === 'edit'
                      ? '修改这个自定义场景的标题和项目说明。'
                      : '新增一个自定义场景，系统会按你定义的项目说明生成知识文档，并调整对话方式。'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => closeScenarioEditor()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="关闭场景编辑"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m18 6-12 12M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">场景标题</label>
                <input
                  value={scenarioTitleDraft}
                  onChange={(event) => setScenarioTitleDraft(event.target.value)}
                  maxLength={40}
                  className="h-10 w-full rounded-[14px] border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  placeholder="例如：团队 OKR / 活动复盘框架"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">项目说明</label>
                <p className="text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                  {KNOWLEDGE_DOC_SCENARIO_EDITOR_HINT}
                </p>
                <textarea
                  value={scenarioStructureDraft}
                  onChange={(event) => setScenarioStructureDraft(event.target.value)}
                  className="min-h-[320px] w-full rounded-[18px] border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-900 outline-none transition focus:border-gray-300 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                  placeholder={KNOWLEDGE_DOC_SCENARIO_INSTRUCTION_PLACEHOLDER}
                />
                <p className="text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                  这里直接输入自然语言即可。它会同时影响知识文档的组织方式，以及 NotebookGo 在对话中的追问和回答风格。
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => closeScenarioEditor()}
                className="inline-flex h-9 items-center rounded-[12px] border border-gray-300 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSaveScenario()}
                disabled={!scenarioTitleDraft.trim() || !scenarioStructureDraft.trim() || scenarioEditorSaving}
                className="inline-flex h-9 items-center rounded-[12px] bg-black px-3 text-xs font-medium text-white transition hover:bg-black/92 disabled:opacity-60"
              >
                {scenarioEditorSaving
                  ? '保存中…'
                  : scenarioEditorMode === 'clone'
                    ? '保存为新场景'
                    : scenarioEditorMode === 'edit'
                      ? '保存场景'
                      : '保存新场景'}
              </button>
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
                    const isCurrent = entry.content === currentMarkdown;
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
                            {extractHistoryFocus(normalizeKnowledgeDocMarkdown(entry.content)) || '查看当时的文档内容并回退到该版本。'}
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

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ShinyText from '@/components/ShinyText';
import {
  KNOWLEDGE_UNIT_TEMP_NOTE_PREFIX,
  exportKnowledgeUnitMarkdown,
  type KnowledgeUnit,
  type KnowledgeUnitTriggerInput,
} from '@/lib/knowledge-unit';

type Note = {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  updatedAt: string;
  createdAt: string;
};

type GenerateMode = 'infographic' | 'summary' | 'mindmap' | 'webpage' | 'paper_outline' | 'report';

type PendingGeneratedNote = {
  id: string;
  mode: GenerateMode;
  title: string;
  progress: number;
  createdAt: string;
};

type KnowledgeUnitTemplateOption = {
  id: string;
  label: string;
  role: string;
  description: string;
  dimensions: Array<{ name: string; children: string[] }>;
};

type EditableDimension = {
  id: string;
  name: string;
  childrenText: string;
};

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 10v7M14 10v7" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M21 15v6h-6" />
      <path d="M4 4l6 6M20 4l-6 6M4 20l6-6M20 20l-6-6" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m21 16-5-5-4 4-2-2-4 4" />
    </svg>
  );
}

function SummaryIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 10h16M4 14h10M4 18h7" />
    </svg>
  );
}

function MindmapIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="2" />
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M10.5 10.5 7.5 7.5M13.5 10.5 16.5 7.5M10.5 13.5 7.5 16.5M13.5 13.5 16.5 16.5" />
    </svg>
  );
}

function WebpageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8h18" />
      <path d="M8 12h8M8 16h5" />
    </svg>
  );
}

function OutlineIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 5h10M7 9h10M7 13h6M5 5h.01M5 9h.01M5 13h.01M7 17h10M5 17h.01" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16v16H4z" />
      <path d="M8 14v3M12 10v7M16 12v5" />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 6v6l4 2" />
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function MarkdownPreview({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div
      className={`prose prose-sm max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1 prose-li:my-0.5 ${
        compact ? 'prose-p:text-xs prose-li:text-xs prose-headings:text-xs' : ''
      }`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border border-gray-200">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-gray-200 px-2 py-1 text-left font-semibold text-gray-700">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border-b border-gray-100 px-2 py-1 align-top">{children}</td>,
          code: ({ children }) => <code className="rounded bg-gray-100 px-1 py-0.5 text-[12px]">{children}</code>,
          pre: ({ children }) => (
            <pre className="my-2 overflow-auto rounded-md bg-gray-100 p-2 text-xs">{children}</pre>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function getImageFromContent(content: string): string | null {
  const markdownImage = content.match(/!\[[^\]]*]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/i);
  if (markdownImage && markdownImage[1]) return markdownImage[1];
  const rawDataUrl = content.match(/(data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+)/i);
  if (rawDataUrl?.[1]) return rawDataUrl[1];
  const rawHttpUrl = content.match(/(https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?)/i);
  if (rawHttpUrl?.[1]) return rawHttpUrl[1];
  return rawDataUrl?.[1] ?? null;
}

function getMermaidFromContent(content: string): string | null {
  const match = content.match(/```mermaid\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? null;
}

function getHtmlFromContent(content: string): string | null {
  const match = content.match(/```html\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? null;
}

function MindmapThumbnail({ code }: { code: string }) {
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let canceled = false;
    async function render() {
      try {
        setFailed(false);
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
        });
        const renderId = `mindmap_thumb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const result = await mermaid.render(renderId, code);
        if (!canceled) setSvg(result.svg);
      } catch {
        if (!canceled) {
          setSvg('');
          setFailed(true);
        }
      }
    }
    void render();
    return () => {
      canceled = true;
    };
  }, [code]);

  if (failed) {
    return <p className="text-xs text-gray-600 dark:text-gray-300 p-2">思维导图预览失败</p>;
  }
  if (!svg) {
    return <p className="text-xs text-gray-500 dark:text-gray-400 p-2">思维导图预览中…</p>;
  }
  return (
    <div
      className="w-full h-full overflow-hidden [&_svg]:w-full [&_svg]:h-full [&_svg]:max-w-none"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function toPreviewText(content: string): string {
  return content
    .replace(/!\[[^\]]*]\((?:data:image\/[^)]+|https?:\/\/[^)]+)\)/gi, '[Infographic]')
    .replace(/```mermaid[\s\S]*?```/gi, '[Mindmap]')
    .replace(/```html[\s\S]*?```/gi, '[Interactive Webpage]')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatTime(value: string): string {
  try {
    return new Date(value).toLocaleString('zh-CN');
  } catch {
    return value;
  }
}

function toEditableDimensions(knowledgeUnit: KnowledgeUnit | null): EditableDimension[] {
  return (knowledgeUnit?.custom_dimensions ?? []).map((dimension) => ({
    id: dimension.id,
    name: dimension.name,
    childrenText: dimension.children.map((child) => child.name).join(', '),
  }));
}

function getDisplayTitle(note: Note): string {
  const t = note.title?.trim() ?? '';
  if (!t) return '';
  if (/^from chat\b/i.test(t)) return '';
  return t;
}

function isPaperOutlineNote(note: Note): boolean {
  return /论文大纲/.test(note.title);
}

function isReportNote(note: Note): boolean {
  return /报告/.test(note.title);
}

function getCardTypeLabel(input: {
  hasImage: boolean;
  hasMindmap: boolean;
  hasInteractivePpt: boolean;
  hasReport: boolean;
  hasPaperOutline: boolean;
}): string {
  if (input.hasReport) return '报告';
  if (input.hasPaperOutline) return '论文大纲';
  if (input.hasInteractivePpt) return '互动PPT';
  if (input.hasMindmap) return '思维导图';
  if (input.hasImage) return '信息图';
  return '笔记';
}

function pendingModeTitle(mode: GenerateMode): string {
  if (mode === 'infographic') return '信息图';
  if (mode === 'summary') return '摘要';
  if (mode === 'mindmap') return '思维导图';
  if (mode === 'paper_outline') return '论文大纲';
  if (mode === 'report') return '报告';
  return '互动PPT';
}

function formatElapsedSeconds(createdAt: string, nowMs: number): string {
  const started = new Date(createdAt).getTime();
  if (!Number.isFinite(started)) return '0s';
  return `${Math.max(0, Math.floor((nowMs - started) / 1000))}s`;
}

export function NotesPanel({ notebookId }: { notebookId: string | null }) {
  const [activePane, setActivePane] = useState<'notes' | 'knowledge_unit'>('notes');
  const [notes, setNotes] = useState<Note[]>([]);
  const [pendingGenerations, setPendingGenerations] = useState<PendingGeneratedNote[]>([]);
  const [pendingClock, setPendingClock] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDraft, setExpandedDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingMode, setGeneratingMode] = useState<GenerateMode | null>(null);
  const [error, setError] = useState('');
  const [mermaidSvg, setMermaidSvg] = useState('');
  const [mermaidLoading, setMermaidLoading] = useState(false);
  const [mermaidError, setMermaidError] = useState('');
  const [expandedView, setExpandedView] = useState<'preview' | 'source'>('preview');
  const [outlineFormats, setOutlineFormats] = useState<string[]>([
    '默认格式',
    '硕士学位论文',
    '本科毕业论文',
    '期刊',
  ]);
  const [selectedOutlineFormat, setSelectedOutlineFormat] = useState('默认格式');
  const [paperOutlinePickerOpen, setPaperOutlinePickerOpen] = useState(false);
  const [knowledgeUnit, setKnowledgeUnit] = useState<KnowledgeUnit | null>(null);
  const [kuLoading, setKuLoading] = useState(true);
  const [kuError, setKuError] = useState('');
  const [kuUpdating, setKuUpdating] = useState(false);
  const [kuProgress, setKuProgress] = useState(0);
  const [kuTimelineOpen, setKuTimelineOpen] = useState(false);
  const [kuChangedAssertionIds, setKuChangedAssertionIds] = useState<string[]>([]);
  const [kuArtifactRunning, setKuArtifactRunning] = useState<GenerateMode | null>(null);
  const [kuTemplates, setKuTemplates] = useState<KnowledgeUnitTemplateOption[]>([]);
  const [kuConfigOpen, setKuConfigOpen] = useState(false);
  const [kuConfigSaving, setKuConfigSaving] = useState(false);
  const [kuSelectedTemplateId, setKuSelectedTemplateId] = useState<string>('');
  const [kuDimensionDraft, setKuDimensionDraft] = useState<EditableDimension[]>([]);
  const [kuSections, setKuSections] = useState({
    problem: true,
    assertions: true,
    variables: true,
    openIssues: true,
    citations: true,
  });

  const addPendingGeneration = useCallback((mode: GenerateMode, id?: string, title?: string) => {
    const pendingId = id ?? `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setPendingGenerations((prev) => {
      if (prev.some((item) => item.id === pendingId)) return prev;
      return [
        {
          id: pendingId,
          mode,
          title: title?.trim() || `正在生成${pendingModeTitle(mode)}`,
          progress: 8,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ];
    });
    return pendingId;
  }, []);

  const updatePendingGeneration = useCallback((id: string, updater: (item: PendingGeneratedNote) => PendingGeneratedNote) => {
    setPendingGenerations((prev) => prev.map((item) => (item.id === id ? updater(item) : item)));
  }, []);

  const removePendingGeneration = useCallback((id: string) => {
    setPendingGenerations((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const fetchNotes = useCallback(async () => {
    if (!notebookId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/notes`);
      const data = await res.json().catch(() => []);
      setNotes(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [notebookId]);

  const fetchKnowledgeUnit = useCallback(async () => {
    if (!notebookId) return;
    setKuLoading(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-unit`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKuError(data?.error ?? '加载知识单元失败');
        return;
      }
      setKuError('');
      const nextKu = (data?.ku as KnowledgeUnit) ?? null;
      setKnowledgeUnit(nextKu);
      setKuTemplates(
        Array.isArray(data?.templates) ? (data.templates as KnowledgeUnitTemplateOption[]) : []
      );
      setKuSelectedTemplateId(nextKu?.template_id ?? '');
      setKuDimensionDraft(toEditableDimensions(nextKu));
    } finally {
      setKuLoading(false);
    }
  }, [notebookId]);

  const runKnowledgeUnitUpdate = useCallback(
    async (payload: KnowledgeUnitTriggerInput) => {
      if (!notebookId) return;
      setKuUpdating(true);
      setKuProgress(8);
      try {
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-unit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status !== 403) {
            setKuError(data?.error ?? '知识单元更新失败');
          }
          return;
        }
        setKuProgress(100);
        setKuError('');
        const nextKu = (data?.ku as KnowledgeUnit) ?? null;
        setKnowledgeUnit(nextKu);
        setKuTemplates(
          Array.isArray(data?.templates) ? (data.templates as KnowledgeUnitTemplateOption[]) : []
        );
        setKuSelectedTemplateId(nextKu?.template_id ?? '');
        setKuDimensionDraft(toEditableDimensions(nextKu));
        const changedIds =
          Array.isArray(data?.ku?.update_summary?.last_turn?.updated_assertion_ids)
            ? data.ku.update_summary.last_turn.updated_assertion_ids.filter((item: unknown) => typeof item === 'string')
            : [];
        setKuChangedAssertionIds(changedIds);
      } catch (e) {
        setKuError(e instanceof Error ? e.message : '知识单元更新失败');
      } finally {
        window.setTimeout(() => {
          setKuUpdating(false);
          setKuProgress(0);
        }, 220);
      }
    },
    [notebookId]
  );

  const patchKnowledgeUnit = useCallback(
    async (body: Record<string, unknown>) => {
      if (!notebookId) return;
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-unit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? '更新知识单元失败');
      }
      const nextKu = (data?.ku as KnowledgeUnit) ?? null;
      setKnowledgeUnit(nextKu);
      setKuTemplates(
        Array.isArray(data?.templates) ? (data.templates as KnowledgeUnitTemplateOption[]) : []
      );
      setKuSelectedTemplateId(nextKu?.template_id ?? '');
      setKuDimensionDraft(toEditableDimensions(nextKu));
    },
    [notebookId]
  );

  const openKuConfig = useCallback(() => {
    setKuSelectedTemplateId(knowledgeUnit?.template_id ?? '');
    setKuDimensionDraft(toEditableDimensions(knowledgeUnit));
    setKuConfigOpen(true);
  }, [knowledgeUnit]);

  const saveKuConfig = useCallback(async () => {
    if (!knowledgeUnit || kuConfigSaving) return;
    setKuConfigSaving(true);
    try {
      const selectedTemplate = kuTemplates.find((item) => item.id === kuSelectedTemplateId) ?? null;
      const existingDimensionMap = new Map(
        (knowledgeUnit.custom_dimensions ?? []).map((dimension) => [
          dimension.name,
          new Map(dimension.children.map((child) => [child.name, child.items])),
        ])
      );
      const dimensions = kuDimensionDraft
        .map((dimension) => ({
          id: dimension.id,
          name: dimension.name.trim().slice(0, 24),
          children: dimension.childrenText
            .split(/[,\n]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 8)
            .map((name, index) => ({
              id: `${dimension.id}_child_${index + 1}`,
              name,
              items:
                existingDimensionMap.get(dimension.name.trim().slice(0, 24))?.get(name)?.slice(0, 6) ?? [],
            })),
        }))
        .filter((dimension) => dimension.name)
        .slice(0, 8);
      await patchKnowledgeUnit({
        templateId: selectedTemplate?.id ?? '',
        templateLabel: selectedTemplate?.label ?? '',
        dimensions,
      });
      setKuConfigOpen(false);
    } catch (error) {
      setKuError(error instanceof Error ? error.message : '保存知识单元配置失败');
    } finally {
      setKuConfigSaving(false);
    }
  }, [knowledgeUnit, kuConfigSaving, kuTemplates, kuSelectedTemplateId, kuDimensionDraft, patchKnowledgeUnit]);

  useEffect(() => {
    void fetchNotes();
    void fetchKnowledgeUnit();
  }, [fetchKnowledgeUnit, fetchNotes]);

  useEffect(() => {
    let canceled = false;
    const fetchOutlineFormats = async () => {
      try {
        const res = await fetch('/api/notes/outline-formats', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const formats = Array.isArray(data?.formats)
          ? data.formats
              .filter((item: unknown) => typeof item === 'string')
              .map((item: string) => item.trim())
              .filter(Boolean)
          : [];
        if (!canceled && formats.length > 0) {
          setOutlineFormats(formats);
          setSelectedOutlineFormat((prev) => (formats.includes(prev) ? prev : formats[0]));
        }
      } catch {
        // ignore
      }
    };
    void fetchOutlineFormats();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onUpdate = () => {
      void fetchNotes();
    };
    const onPendingAdd = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; mode?: GenerateMode; title?: string }>).detail;
      if (!detail?.mode) return;
      addPendingGeneration(detail.mode, detail.id, detail.title);
    };
    const onPendingRemove = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (!detail?.id) return;
      removePendingGeneration(detail.id);
    };
    const onKnowledgeUnitTrigger = (event: Event) => {
      const detail = (event as CustomEvent<KnowledgeUnitTriggerInput>).detail;
      if (!detail?.trigger) return;
      void runKnowledgeUnitUpdate(detail);
    };
    const onSourcesUpdated = async () => {
      if (!notebookId) return;
      try {
        const res = await fetch(`/api/sources?notebookId=${encodeURIComponent(notebookId)}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => []);
        const snapshot = Array.isArray(data)
          ? data
              .filter((item) => item && typeof item === 'object')
              .slice(0, 6)
              .map((item) => {
                const row = item as {
                  id?: unknown;
                  filename?: unknown;
                  fileUrl?: unknown;
                  preview?: unknown;
                };
                return {
                  sourceId: typeof row.id === 'string' ? row.id : '',
                  title: typeof row.filename === 'string' ? row.filename : '来源',
                  url: typeof row.fileUrl === 'string' ? row.fileUrl : null,
                  snippet: typeof row.preview === 'string' ? row.preview : null,
                  page: null,
                };
              })
              .filter((item) => item.sourceId)
          : [];
        void runKnowledgeUnitUpdate({
          trigger: 'ON_SOURCE_ADDED',
          source_snapshot: snapshot,
        });
      } catch {
        // ignore
      }
    };
    window.addEventListener('notes-updated', onUpdate);
    window.addEventListener('notes-pending-add', onPendingAdd as EventListener);
    window.addEventListener('notes-pending-remove', onPendingRemove as EventListener);
    window.addEventListener('knowledge-unit-trigger', onKnowledgeUnitTrigger as EventListener);
    window.addEventListener('sources-updated', onSourcesUpdated);
    return () => {
      window.removeEventListener('notes-updated', onUpdate);
      window.removeEventListener('notes-pending-add', onPendingAdd as EventListener);
      window.removeEventListener('notes-pending-remove', onPendingRemove as EventListener);
      window.removeEventListener('knowledge-unit-trigger', onKnowledgeUnitTrigger as EventListener);
      window.removeEventListener('sources-updated', onSourcesUpdated);
    };
  }, [
    addPendingGeneration,
    fetchNotes,
    notebookId,
    removePendingGeneration,
    runKnowledgeUnitUpdate,
  ]);

  useEffect(() => {
    setSelectedIds([]);
    setExpandedId(null);
    setExpandedDraft('');
    setExpandedView('preview');
    setError('');
    setMermaidSvg('');
    setMermaidError('');
    setPendingGenerations([]);
    setKnowledgeUnit(null);
    setKuError('');
    setKuUpdating(false);
    setKuProgress(0);
    setKuChangedAssertionIds([]);
  }, [notebookId]);

  const expandedNote = useMemo(
    () => notes.find((note) => note.id === expandedId) ?? null,
    [notes, expandedId]
  );
  const expandedImage = useMemo(
    () => (expandedNote ? getImageFromContent(expandedNote.content) : null),
    [expandedNote]
  );
  const expandedMermaid = useMemo(
    () => getMermaidFromContent(expandedDraft),
    [expandedDraft]
  );
  const expandedHtml = useMemo(
    () => getHtmlFromContent(expandedDraft),
    [expandedDraft]
  );
  const expandedIsReport = useMemo(
    () => (expandedNote ? isReportNote(expandedNote) : false),
    [expandedNote]
  );

  useEffect(() => {
    if (!expandedNote) return;
    setExpandedDraft(expandedNote.content);
    setExpandedView('preview');
  }, [expandedNote]);

  useEffect(() => {
    let canceled = false;
    async function renderMermaid() {
      if (!expandedMermaid) {
        setMermaidSvg('');
        setMermaidError('');
        return;
      }
      setMermaidLoading(true);
      setMermaidError('');
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
        });
        const renderId = `mindmap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const result = await mermaid.render(renderId, expandedMermaid);
        if (!canceled) setMermaidSvg(result.svg);
      } catch (e) {
        if (!canceled) {
          setMermaidSvg('');
          setMermaidError(e instanceof Error ? e.message : 'Mermaid 渲染失败');
        }
      } finally {
        if (!canceled) setMermaidLoading(false);
      }
    }
    void renderMermaid();
    return () => {
      canceled = true;
    };
  }, [expandedMermaid]);

  useEffect(() => {
    if (pendingGenerations.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setPendingGenerations((prev) =>
        prev.map((item) => {
          if (item.progress >= 92) return item;
          const delta = Math.max(2, Math.round((100 - item.progress) / 14));
          return {
            ...item,
            progress: Math.min(92, item.progress + delta),
          };
        })
      );
    }, 480);
    return () => window.clearInterval(timer);
  }, [generating, pendingGenerations.length]);

  useEffect(() => {
    if (pendingGenerations.length === 0) return;
    const timer = window.setInterval(() => {
      setPendingClock(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pendingGenerations.length]);

  useEffect(() => {
    if (!kuUpdating) return;
    const timer = window.setInterval(() => {
      setKuProgress((prev) => (prev >= 92 ? prev : Math.min(92, prev + Math.max(3, Math.round((100 - prev) / 10)))));
    }, 260);
    return () => window.clearInterval(timer);
  }, [kuUpdating]);

  useEffect(() => {
    if (kuChangedAssertionIds.length === 0) return;
    const timer = window.setTimeout(() => setKuChangedAssertionIds([]), 3000);
    return () => window.clearTimeout(timer);
  }, [kuChangedAssertionIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const clearSelection = () => setSelectedIds([]);

  const deleteNote = async (id: string) => {
    const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    if (!res.ok) return;
    setSelectedIds((prev) => prev.filter((x) => x !== id));
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDraft('');
    }
    await fetchNotes();
    window.dispatchEvent(new CustomEvent('notes-updated'));
  };

  const generateFromSelection = async (mode: GenerateMode, paperFormatOverride?: string) => {
    if (!notebookId || selectedIds.length === 0 || generating) return;
    const noteIds = [...selectedIds];
    const selectedNotes = noteIds
      .map((id) => notes.find((note) => note.id === id))
      .filter(Boolean) as Note[];
    const leadTitle = selectedNotes[0]
      ? getDisplayTitle(selectedNotes[0]) || selectedNotes[0].title
      : pendingModeTitle(mode);
    const pendingTitle =
      selectedNotes.length <= 1 ? leadTitle : `${leadTitle} 等${selectedNotes.length}条`;
    const pendingId = addPendingGeneration(mode, undefined, pendingTitle);
    setSelectedIds([]);
    setGenerating(true);
    setGeneratingMode(mode);
    setError('');
    try {
      const res = await fetch('/api/notes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId,
          noteIds,
          mode,
          paperFormat: mode === 'paper_outline' ? (paperFormatOverride ?? selectedOutlineFormat) : undefined,
        }),
      });
      updatePendingGeneration(pendingId, (item) => ({ ...item, progress: Math.max(item.progress, 52) }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? '转换失败');
        removePendingGeneration(pendingId);
        return;
      }
      updatePendingGeneration(pendingId, (item) => ({ ...item, progress: 100 }));
      await fetchNotes();
      await new Promise((resolve) => setTimeout(resolve, 260));
      if (typeof data?.note?.id === 'string') {
        setExpandedId(data.note.id);
      }
      removePendingGeneration(pendingId);
      window.dispatchEvent(new CustomEvent('notes-updated'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '转换失败');
      removePendingGeneration(pendingId);
    } finally {
      setGenerating(false);
      setGeneratingMode(null);
    }
  };

  const generateFromKnowledgeUnit = async (mode: Extract<GenerateMode, 'infographic' | 'report' | 'summary'>) => {
    if (!notebookId || !knowledgeUnit || kuArtifactRunning) return;
    setKuArtifactRunning(mode);
    setError('');
    let tempNoteId: string | null = null;
    try {
      const createRes = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${KNOWLEDGE_UNIT_TEMP_NOTE_PREFIX}_${mode}`,
          content: exportKnowledgeUnitMarkdown(knowledgeUnit),
        }),
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createData?.id) {
        throw new Error(createData?.error ?? '创建知识单元素材失败');
      }
      tempNoteId = String(createData.id);

      const pendingId = addPendingGeneration(mode, undefined, `知识单元${modeLabel(mode)}`);
      const res = await fetch('/api/notes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId,
          noteIds: [tempNoteId],
          mode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        removePendingGeneration(pendingId);
        throw new Error(data?.error ?? `生成${modeLabel(mode)}失败`);
      }
      updatePendingGeneration(pendingId, (item) => ({ ...item, progress: 100 }));
      await fetchNotes();
      await new Promise((resolve) => setTimeout(resolve, 220));
      if (typeof data?.note?.id === 'string') {
        setExpandedId(data.note.id);
      }
      removePendingGeneration(pendingId);
      window.dispatchEvent(new CustomEvent('notes-updated'));
    } catch (e) {
      setError(e instanceof Error ? e.message : `生成${modeLabel(mode)}失败`);
    } finally {
      if (tempNoteId) {
        await fetch(`/api/notes/${encodeURIComponent(tempNoteId)}`, { method: 'DELETE' }).catch(() => null);
      }
      setKuArtifactRunning(null);
    }
  };

  const modeLabel = (mode: GenerateMode) => {
    if (mode === 'infographic') return '信息图';
    if (mode === 'summary') return '摘要';
    if (mode === 'mindmap') return '思维导图';
    if (mode === 'paper_outline') return '论文大纲';
    if (mode === 'report') return '报告';
    return '互动PPT';
  };

  if (!notebookId) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="h-14 px-3 border-b border-gray-200 dark:border-gray-800 flex items-center">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            我的笔记
          </h2>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
          Select a notebook to view notes.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div className="h-14 px-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-full border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setActivePane('notes')}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              activePane === 'notes' ? 'bg-gray-900 text-white' : 'text-gray-600'
            }`}
          >
            笔记
          </button>
          <button
            type="button"
            onClick={() => setActivePane('knowledge_unit')}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              activePane === 'knowledge_unit' ? 'bg-gray-900 text-white' : 'text-gray-600'
            }`}
          >
            知识单元
          </button>
        </div>
        {activePane === 'knowledge_unit' ? (
          <button
            type="button"
            onClick={() => setKuTimelineOpen(true)}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600"
          >
            <TimelineIcon />
            时间线
          </button>
        ) : (
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">我的笔记</h2>
        )}
      </div>

      {error && (
        <div className="px-3 pt-2 space-y-2">
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-2 pb-44">
        {activePane === 'notes' ? (
        loading ? (
          <div className="p-2">
            <ShinyText text="Loading notes..." className="text-xs text-gray-500 dark:text-gray-400" />
          </div>
        ) : notes.length === 0 && pendingGenerations.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 p-2">
            还没有笔记，可在聊天区点击“保存到笔记”。
          </p>
        ) : (
          <ul className="space-y-2">
            {pendingGenerations.map((pending) => (
              <li
                key={pending.id}
                className="h-[126px] rounded border border-gray-200 bg-white/60 p-2 pb-2 dark:border-gray-800 dark:bg-gray-900/40"
              >
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={false} readOnly className="rounded border-gray-300 opacity-40 dark:border-gray-700" />
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{pendingModeTitle(pending.mode)}</p>
                </div>
                <div className="mt-2 flex h-[58px] flex-col justify-center gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className="min-w-0 truncate text-xs font-medium text-gray-700 dark:text-gray-200"
                      title={pending.title}
                    >
                      {pending.title}
                    </p>
                    <span className="shrink-0 text-[11px] text-blue-600 dark:text-blue-400">
                      运行中 {formatElapsedSeconds(pending.createdAt, pendingClock)}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${pending.progress}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">进度 {pending.progress}%</p>
                </div>
                <p className="pt-0 text-[11px] leading-none text-gray-500 dark:text-gray-400">
                  {formatTime(pending.createdAt)}
                </p>
              </li>
            ))}
            {notes.map((note) => {
              const selected = selectedIds.includes(note.id);
              const displayTitle = getDisplayTitle(note);
              const image = getImageFromContent(note.content);
              const cardMermaid = getMermaidFromContent(note.content);
              const cardHtml = getHtmlFromContent(note.content);
              const isOutlineCard = isPaperOutlineNote(note);
              const isReportCard = Boolean(cardHtml) && isReportNote(note);
              const isTextOnlyCard = !image && !cardMermaid && !cardHtml;
              const cardHeightClass = cardMermaid || isReportCard
                ? 'h-52'
                : isTextOnlyCard || cardHtml
                  ? 'h-[126px]'
                  : 'h-52';
              const previewText = toPreviewText(note.content);
              return (
                <li
                  key={note.id}
                  className={`${cardHeightClass} group rounded border p-2 pb-2 transition overflow-hidden flex flex-col ${
                    selected
                      ? 'border-blue-500 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelect(note.id)}
                        className="rounded border-gray-300 dark:border-gray-700"
                        aria-label={`选择笔记 ${displayTitle || note.id}`}
                      />
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {getCardTypeLabel({
                          hasImage: Boolean(image),
                          hasMindmap: Boolean(cardMermaid),
                          hasInteractivePpt: Boolean(cardHtml),
                          hasReport: isReportCard,
                          hasPaperOutline: isOutlineCard,
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-200 ease-out">
                      <button
                        type="button"
                        onClick={() => setExpandedId(note.id)}
                        className="text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"
                        title="展开"
                        aria-label="展开"
                      >
                        <ExpandIcon />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteNote(note.id);
                        }}
                        className="text-gray-500 hover:text-red-600"
                        title="删除"
                        aria-label="删除"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleSelect(note.id)}
                    className="w-full text-left mt-1 flex-1 min-h-0 flex flex-col"
                  >
                    <div className="mt-1 flex-1 min-h-0 rounded overflow-hidden">
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image}
                          alt={note.title}
                          className="w-full h-full object-cover"
                        />
                      ) : cardMermaid ? (
                        <MindmapThumbnail code={cardMermaid} />
                      ) : cardHtml ? (
                        <div className="flex h-full w-full flex-col items-center justify-center rounded-lg bg-gray-50 px-4 text-center">
                          <div className="mb-2 rounded-full bg-gray-100 p-2 text-gray-500">
                            {isReportCard ? <ReportIcon /> : <WebpageIcon />}
                          </div>
                          <p className="text-xs font-medium text-gray-700">
                            {isReportCard ? '报告已生成' : '互动网页已生成'}
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-gray-500">
                            {isReportCard ? '展开后可查看完整的结构化报告页面。' : '展开后可预览完整的互动网页内容。'}
                          </p>
                        </div>
                      ) : (
                        <div
                          className="max-h-[68px] overflow-hidden text-xs text-gray-700"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          <MarkdownPreview content={previewText || '(empty)'} compact />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0 pt-0 pb-0 leading-none">
                      {formatTime(note.updatedAt)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )
        ) : kuLoading ? (
          <div className="p-2">
            <ShinyText text="Loading knowledge unit..." className="text-xs text-gray-500" />
          </div>
        ) : !knowledgeUnit ? (
          <p className="p-2 text-xs text-gray-500">知识单元尚未初始化，本轮问答或收藏笔记后会自动生成。</p>
        ) : (
          <div className="space-y-3">
            {kuError ? <p className="text-xs text-red-600">{kuError}</p> : null}
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    value={knowledgeUnit.title}
                    onChange={(event) =>
                      setKnowledgeUnit((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                    }
                    onBlur={() => void patchKnowledgeUnit({ title: knowledgeUnit.title })}
                    className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm font-semibold"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    <span>稳定度 {knowledgeUnit.stability_score}</span>
                    {knowledgeUnit.template_label ? <span>模板：{knowledgeUnit.template_label}</span> : null}
                    <span>本轮更新：新增{knowledgeUnit.update_summary.last_turn.added_assertions} / 更新{knowledgeUnit.update_summary.last_turn.updated_assertions} / 冲突{knowledgeUnit.update_summary.last_turn.added_conflicts}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={openKuConfig}
                    className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600"
                  >
                    配置
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(knowledgeUnit, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `${knowledgeUnit.title || 'knowledge-unit'}.json`;
                      link.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600"
                  >
                    导出
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const text = knowledgeUnit.citations
                        .map((item) => `${item.title}${item.doc_pointer.page != null ? ` p.${item.doc_pointer.page}` : ''}`)
                        .join('\n');
                      await navigator.clipboard.writeText(text || '暂无引用');
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600"
                  >
                    <CopyIcon />
                    复制引用
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void generateFromKnowledgeUnit('report')}
                  disabled={Boolean(kuArtifactRunning)}
                  className="inline-flex h-7 items-center rounded-full border border-gray-300 bg-gray-50 px-3 text-[11px] text-gray-700 disabled:opacity-50"
                >
                  {kuArtifactRunning === 'report' ? '生成中…' : '生成报告'}
                </button>
                <button
                  type="button"
                  onClick={() => void generateFromKnowledgeUnit('infographic')}
                  disabled={Boolean(kuArtifactRunning)}
                  className="inline-flex h-7 items-center rounded-full border border-gray-300 bg-gray-50 px-3 text-[11px] text-gray-700 disabled:opacity-50"
                >
                  {kuArtifactRunning === 'infographic' ? '生成中…' : '生成信息图'}
                </button>
                <button
                  type="button"
                  onClick={() => void generateFromKnowledgeUnit('summary')}
                  disabled={Boolean(kuArtifactRunning)}
                  className="inline-flex h-7 items-center rounded-full border border-gray-300 bg-gray-50 px-3 text-[11px] text-gray-700 disabled:opacity-50"
                >
                  {kuArtifactRunning === 'summary' ? '生成中…' : '生成摘要'}
                </button>
              </div>
              {kuUpdating ? (
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${kuProgress}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-blue-600">知识单元更新中 {kuProgress}%</p>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setKuSections((prev) => ({ ...prev, problem: !prev.problem }))}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-gray-700"
              >
                <span>B. Problem Frame</span>
                <span>{kuSections.problem ? '收起' : '展开'}</span>
              </button>
              {kuSections.problem ? (
                <div className="border-t border-gray-100 px-3 py-3 text-xs text-gray-600 space-y-3">
                  <div>
                    <p className="font-medium text-gray-700">研究问题</p>
                    <ul className="mt-1 list-disc pl-4">
                      {knowledgeUnit.problem_frame.research_questions.length > 0 ? knowledgeUnit.problem_frame.research_questions.map((item) => <li key={item}>{item}</li>) : <li>暂无</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-gray-700">范围 / 假设</p>
                    <ul className="mt-1 list-disc pl-4">
                      {knowledgeUnit.problem_frame.scope_assumptions.length > 0 ? knowledgeUnit.problem_frame.scope_assumptions.map((item) => <li key={item}>{item}</li>) : <li>暂无</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-gray-700">不在范围</p>
                    <ul className="mt-1 list-disc pl-4">
                      {knowledgeUnit.problem_frame.out_of_scope.length > 0 ? knowledgeUnit.problem_frame.out_of_scope.map((item) => <li key={item}>{item}</li>) : <li>暂无</li>}
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setKuSections((prev) => ({ ...prev, assertions: !prev.assertions }))}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-gray-700"
              >
                <span>C. Core Assertions</span>
                <span>{kuSections.assertions ? '收起' : '展开'}</span>
              </button>
              {kuSections.assertions ? (
                <div className="border-t border-gray-100 px-2 py-2 space-y-2">
                  {knowledgeUnit.assertions.length > 0 ? knowledgeUnit.assertions.map((assertion) => (
                    <details
                      key={assertion.assertion_id}
                      className={`rounded-md border p-2 ${kuChangedAssertionIds.includes(assertion.assertion_id) ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200 bg-white'}`}
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-gray-800">{assertion.statement}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                              <span>{Math.round(assertion.confidence * 100)}%</span>
                              <span>{assertion.status}</span>
                              <span>{assertion.evidence_for.length + assertion.evidence_against.length} 条证据</span>
                              <span>{formatTime(assertion.updated_at)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              void patchKnowledgeUnit({
                                assertionId: assertion.assertion_id,
                                locked: !assertion.locked_by_user,
                              });
                            }}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${assertion.locked_by_user ? 'border-amber-300 text-amber-700 bg-amber-50' : 'border-gray-200 text-gray-500'}`}
                          >
                            <LockIcon />
                            {assertion.locked_by_user ? '已锁定' : '锁定'}
                          </button>
                        </div>
                      </summary>
                      <div className="mt-2 space-y-2 border-t border-gray-100 pt-2 text-[11px] text-gray-600">
                        <div>
                          <p className="font-medium text-gray-700">Supporting evidence</p>
                          <ul className="mt-1 space-y-1">
                            {assertion.evidence_for.length > 0 ? assertion.evidence_for.map((item) => {
                              const citation = knowledgeUnit.citations.find((entry) => entry.citation_id === item.citation_id);
                              return (
                                <li key={`${assertion.assertion_id}-${item.citation_id}`} className="rounded bg-gray-50 px-2 py-1">
                                  [{citation?.title ?? item.citation_id}]
                                  {item.doc_pointer.page != null ? ` p.${item.doc_pointer.page}` : ''} {item.snippet}
                                </li>
                              );
                            }) : <li>暂无</li>}
                          </ul>
                        </div>
                        <div>
                          <p className="font-medium text-gray-700">Counter evidence</p>
                          <ul className="mt-1 space-y-1">
                            {assertion.evidence_against.length > 0 ? assertion.evidence_against.map((item) => {
                              const citation = knowledgeUnit.citations.find((entry) => entry.citation_id === item.citation_id);
                              return (
                                <li key={`${assertion.assertion_id}-against-${item.citation_id}`} className="rounded bg-red-50 px-2 py-1 text-red-700">
                                  [{citation?.title ?? item.citation_id}] {item.snippet}
                                </li>
                              );
                            }) : <li>暂无</li>}
                          </ul>
                        </div>
                      </div>
                    </details>
                  )) : <p className="px-1 py-2 text-xs text-gray-500">暂无核心结论。</p>}
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setKuSections((prev) => ({ ...prev, variables: !prev.variables }))}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-gray-700"
              >
                <span>D. Key Variables</span>
                <span>{kuSections.variables ? '收起' : '展开'}</span>
              </button>
              {kuSections.variables ? (
                <div className="border-t border-gray-100 px-3 py-3 text-xs text-gray-600 space-y-3">
                  <div>
                    <p className="font-medium text-gray-700">Variables</p>
                    <ul className="mt-1 space-y-1">
                      {knowledgeUnit.variables.length > 0 ? knowledgeUnit.variables.map((item) => (
                        <li key={item.key} className="rounded bg-gray-50 px-2 py-1">
                          <span className="font-medium text-gray-700">{item.name}</span> · {item.definition || '待补充定义'}
                          {item.unit ? ` · ${item.unit}` : ''}
                        </li>
                      )) : <li>暂无</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-gray-700">Metrics</p>
                    <ul className="mt-1 space-y-1">
                      {knowledgeUnit.metrics.length > 0 ? knowledgeUnit.metrics.map((item) => (
                        <li key={item.key} className="rounded bg-gray-50 px-2 py-1">
                          <span className="font-medium text-gray-700">{item.name}</span> · {item.definition}
                        </li>
                      )) : <li>暂无</li>}
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setKuSections((prev) => ({ ...prev, openIssues: !prev.openIssues }))}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-gray-700"
              >
                <span>E. Open Issues</span>
                <span>{kuSections.openIssues ? '收起' : '展开'}</span>
              </button>
              {kuSections.openIssues ? (
                <div className="border-t border-gray-100 px-3 py-3 text-xs text-gray-600 space-y-3">
                  <div>
                    <p className="font-medium text-gray-700">Conflicts</p>
                    <ul className="mt-1 list-disc pl-4">
                      {knowledgeUnit.open_issues.conflicts.length > 0 ? knowledgeUnit.open_issues.conflicts.map((item) => <li key={item.conflict_id}>{item.topic}：{item.note}</li>) : <li>暂无</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-gray-700">Unknowns</p>
                    <ul className="mt-1 list-disc pl-4">
                      {knowledgeUnit.open_issues.unknowns.length > 0 ? knowledgeUnit.open_issues.unknowns.map((item) => <li key={item.unknown_id}>{item.question}</li>) : <li>暂无</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-gray-700">Next Questions</p>
                    <div className="mt-1 flex flex-col items-start gap-1">
                      {knowledgeUnit.open_issues.next_questions.length > 0 ? knowledgeUnit.open_issues.next_questions.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { message: item } }))}
                          className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[11px] text-gray-700"
                        >
                          {item}
                        </button>
                      )) : <p>暂无</p>}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setKuSections((prev) => ({ ...prev, citations: !prev.citations }))}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-gray-700"
              >
                <span>F. Citations</span>
                <span>{kuSections.citations ? '收起' : '展开'}</span>
              </button>
              {kuSections.citations ? (
                <div className="border-t border-gray-100 px-3 py-3 text-xs text-gray-600 space-y-1">
                  {knowledgeUnit.citations.length > 0 ? knowledgeUnit.citations.map((item) => (
                    <div key={item.citation_id} className="rounded bg-gray-50 px-2 py-1">
                      <span className="font-medium text-gray-700">{item.title}</span>
                      {item.doc_pointer.page != null ? ` · p.${item.doc_pointer.page}` : ''}
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer" className="ml-1 text-blue-600 underline">
                          打开
                        </a>
                      ) : null}
                    </div>
                  )) : <p>暂无来源。</p>}
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-gray-700">
                <span>G. Custom Dimensions</span>
                <span>{knowledgeUnit.custom_dimensions.length} 个维度</span>
              </div>
              <div className="border-t border-gray-100 px-3 py-3 text-xs text-gray-600 space-y-3">
                {knowledgeUnit.custom_dimensions.length > 0 ? (
                  knowledgeUnit.custom_dimensions.map((dimension) => (
                    <div key={dimension.id} className="rounded-md border border-gray-200 bg-gray-50 p-2">
                      <p className="font-medium text-gray-800">{dimension.name}</p>
                      <div className="mt-2 space-y-2">
                        {dimension.children.map((child) => (
                          <div key={child.id}>
                            <p className="text-[11px] font-medium text-gray-600">{child.name}</p>
                            <ul className="mt-1 list-disc pl-4 text-[11px] text-gray-600">
                              {child.items.length > 0 ? child.items.map((item) => <li key={item}>{item}</li>) : <li>暂无</li>}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p>暂无自定义维度。</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className={`absolute inset-x-3 bottom-3 z-20 transition-all duration-200 ease-out ${
          activePane === 'notes' && selectedIds.length > 0
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
      >
        <div className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2 bg-white/90 dark:bg-gray-900/90 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600 dark:text-gray-300">已选中 {selectedIds.length} 条</p>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              取消选择
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => void generateFromSelection('infographic')}
              disabled={generating}
              className="h-11 px-3 rounded bg-sky-500/20 text-sky-700 dark:bg-sky-400/20 dark:text-sky-300 disabled:opacity-50 text-sm font-medium inline-flex items-center gap-2"
            >
              <ImageIcon />
              {generating && generatingMode === 'infographic' ? '正在生成信息图…' : '转换成信息图'}
            </button>
            <button
              type="button"
              onClick={() => void generateFromSelection('summary')}
              disabled={generating}
              className="h-11 px-3 rounded bg-emerald-500/20 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-300 disabled:opacity-50 text-sm font-medium inline-flex items-center gap-2"
            >
              <SummaryIcon />
              {generating && generatingMode === 'summary' ? '正在简化摘要…' : '简化成摘要'}
            </button>
            <button
              type="button"
              onClick={() => void generateFromSelection('mindmap')}
              disabled={generating}
              className="h-11 px-3 rounded bg-amber-500/20 text-amber-700 dark:bg-amber-400/20 dark:text-amber-300 disabled:opacity-50 text-sm font-medium inline-flex items-center gap-2"
            >
              <MindmapIcon />
              {generating && generatingMode === 'mindmap' ? '正在生成思维导图…' : '转换成思维导图'}
            </button>
            <button
              type="button"
              onClick={() => void generateFromSelection('webpage')}
              disabled={generating}
              className="h-11 px-3 rounded bg-fuchsia-500/20 text-fuchsia-700 dark:bg-fuchsia-400/20 dark:text-fuchsia-300 disabled:opacity-50 text-sm font-medium inline-flex items-center gap-2"
            >
              <WebpageIcon />
              {generating && generatingMode === 'webpage' ? '正在生成互动PPT…' : '生成互动PPT'}
            </button>
            <button
              type="button"
              onClick={() => setPaperOutlinePickerOpen(true)}
              disabled={generating}
              className="min-h-12 px-3 py-2 rounded bg-indigo-500/20 text-indigo-700 dark:bg-indigo-400/20 dark:text-indigo-300 disabled:opacity-50 inline-flex flex-col items-start justify-center"
            >
              <span className="text-sm font-medium inline-flex items-center gap-2">
                <OutlineIcon />
                {generating && generatingMode === 'paper_outline' ? '正在撰写论文大纲…' : '撰写论文大纲'}
              </span>
              <span className="pl-7 text-[11px] leading-4 opacity-80">包含段落撰写规范</span>
            </button>
            <button
              type="button"
              onClick={() => void generateFromSelection('report')}
              disabled={generating}
              className="min-h-12 px-3 py-2 rounded bg-cyan-500/20 text-cyan-700 dark:bg-cyan-400/20 dark:text-cyan-300 disabled:opacity-50 inline-flex flex-col items-start justify-center"
            >
              <span className="text-sm font-medium inline-flex items-center gap-2">
                <ReportIcon />
                {generating && generatingMode === 'report' ? '正在生成报告…' : '生成报告'}
              </span>
              <span className="pl-7 text-[11px] leading-4 opacity-80">HTML 报告 + 图表展示</span>
            </button>
          </div>
          {generating && generatingMode && (
            <p className="text-xs text-gray-500 dark:text-gray-400">正在生成{modeLabel(generatingMode)}，请稍候…</p>
          )}
        </div>
      </div>

      {kuTimelineOpen && knowledgeUnit && (
        <div className="fixed inset-0 z-[68] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">知识单元更新历史</p>
                <p className="text-xs text-gray-500">用户可见的本轮增量记录</p>
              </div>
              <button
                type="button"
                onClick={() => setKuTimelineOpen(false)}
                className="rounded-md bg-gray-100 px-3 py-1 text-xs text-gray-700"
              >
                关闭
              </button>
            </div>
            <div className="max-h-[65vh] overflow-auto p-4 space-y-3">
              {knowledgeUnit.timeline.length > 0 ? knowledgeUnit.timeline.map((item) => (
                <div key={item.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-gray-800">{item.summary}</p>
                    <span className="text-[11px] text-gray-500">{formatTime(item.at)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">{item.trigger}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                    <div>新增结论：{item.diff.added_assertions.length}</div>
                    <div>更新结论：{item.diff.updated_assertions.length}</div>
                    <div>新增冲突：{item.diff.added_conflicts.length}</div>
                    <div>新增未知：{item.diff.added_unknowns.length}</div>
                  </div>
                </div>
              )) : <p className="text-xs text-gray-500">暂无更新时间线。</p>}
            </div>
          </div>
        </div>
      )}

      {kuConfigOpen && knowledgeUnit ? (
        <div className="fixed inset-0 z-[69] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">配置知识单元</p>
                <p className="text-xs text-gray-500">可切换模板，并自定义维度与子维度。后续对话会持续写入这些维度。</p>
              </div>
              <button
                type="button"
                onClick={() => setKuConfigOpen(false)}
                className="rounded-md bg-gray-100 px-3 py-1 text-xs text-gray-700"
              >
                关闭
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs font-medium text-gray-700">选择模板</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {kuTemplates.map((template) => {
                    const active = kuSelectedTemplateId === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => {
                          setKuSelectedTemplateId(template.id);
                          setKuDimensionDraft(
                            template.dimensions.map((dimension, index) => ({
                              id: `draft_${template.id}_${index + 1}`,
                              name: dimension.name,
                              childrenText: dimension.children.join(', '),
                            }))
                          );
                        }}
                        className={`rounded-lg border px-3 py-2 text-left ${
                          active ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <p className="text-xs font-medium text-gray-800">{template.label}</p>
                        <p className="mt-1 text-[11px] text-gray-500">{template.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-700">维度配置</p>
                  <button
                    type="button"
                    onClick={() =>
                      setKuDimensionDraft((prev) => [
                        ...prev,
                        { id: `draft_${Date.now()}`, name: '', childrenText: '' },
                      ])
                    }
                    className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600"
                  >
                    新增维度
                  </button>
                </div>
                <div className="max-h-[45vh] space-y-2 overflow-auto pr-1">
                  {kuDimensionDraft.map((dimension) => (
                    <div key={dimension.id} className="rounded-lg border border-gray-200 p-3">
                      <div className="grid gap-2 sm:grid-cols-[1fr_1.2fr_auto] sm:items-start">
                        <input
                          value={dimension.name}
                          onChange={(event) =>
                            setKuDimensionDraft((prev) =>
                              prev.map((item) =>
                                item.id === dimension.id ? { ...item, name: event.target.value } : item
                              )
                            )
                          }
                          placeholder="维度名"
                          className="rounded border border-gray-200 px-2 py-1 text-xs"
                        />
                        <textarea
                          value={dimension.childrenText}
                          onChange={(event) =>
                            setKuDimensionDraft((prev) =>
                              prev.map((item) =>
                                item.id === dimension.id ? { ...item, childrenText: event.target.value } : item
                              )
                            )
                          }
                          rows={2}
                          placeholder="子维度，逗号分隔"
                          className="rounded border border-gray-200 px-2 py-1 text-xs resize-y"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setKuDimensionDraft((prev) => prev.filter((item) => item.id !== dimension.id))
                          }
                          className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-500"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setKuConfigOpen(false)}
                className="h-8 rounded-md border border-gray-300 px-3 text-xs text-gray-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void saveKuConfig()}
                disabled={kuConfigSaving}
                className="h-8 rounded-md bg-gray-900 px-3 text-xs text-white disabled:opacity-60"
              >
                {kuConfigSaving ? '保存中…' : '保存配置'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paperOutlinePickerOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">选择论文格式</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                选择后将开始生成专业论文大纲，并附带段落撰写规范。
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {outlineFormats.map((format) => {
                const active = selectedOutlineFormat === format;
                return (
                  <button
                    key={format}
                    type="button"
                    onClick={() => setSelectedOutlineFormat(format)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                      active
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-300'
                        : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
                    }`}
                  >
                    <span>{format}</span>
                    {active ? <span className="text-xs">已选择</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPaperOutlinePickerOpen(false)}
                className="h-8 rounded-md border border-gray-300 px-3 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setPaperOutlinePickerOpen(false);
                  void generateFromSelection('paper_outline', selectedOutlineFormat);
                }}
                className="h-8 rounded-md bg-black px-3 text-xs font-medium text-white"
              >
                开始生成
              </button>
            </div>
          </div>
        </div>
      )}

      {expandedNote && (
        <div className="fixed inset-0 z-50 bg-black/45 p-4 flex items-center justify-center">
          <div className="w-full max-w-6xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                {getDisplayTitle(expandedNote) ? (
                  <h3 className="text-sm font-semibold truncate">{getDisplayTitle(expandedNote)}</h3>
                ) : (
                  <h3 className="text-sm font-semibold truncate">笔记详情</h3>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatTime(expandedNote.updatedAt)}
                </p>
              </div>
              <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedView('preview')}
                  className={`px-3 py-1.5 text-xs ${
                    expandedView === 'preview'
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  预览
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedView('source')}
                  className={`px-3 py-1.5 text-xs border-l border-gray-300 dark:border-gray-700 ${
                    expandedView === 'source'
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-white text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  源代码
                </button>
              </div>
              <button
                type="button"
                onClick={() => setExpandedId(null)}
                className="text-xs px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700"
              >
                关闭
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
              {expandedView === 'preview' ? (
                <>
                  {expandedImage && (
                    <div className="rounded border border-gray-200 dark:border-gray-800 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={expandedImage} alt={expandedNote.title} className="w-full h-auto" />
                    </div>
                  )}

                  {expandedMermaid && (
                    <div className="rounded border border-gray-200 dark:border-gray-800 p-3 bg-white dark:bg-gray-900">
                      {mermaidLoading && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">思维导图渲染中…</p>
                      )}
                      {mermaidError && (
                        <p className="text-xs text-red-600 dark:text-red-400">{mermaidError}</p>
                      )}
                      {!mermaidLoading && !mermaidError && mermaidSvg && (
                        <div dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
                      )}
                    </div>
                  )}

                  {expandedHtml && (
                    <div className="rounded border border-gray-200 dark:border-gray-800 p-2 bg-white dark:bg-gray-900 space-y-2">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {expandedIsReport ? '报告预览' : '互动PPT预览'}
                      </p>
                      <iframe
                        title="interactive-ppt-preview"
                        srcDoc={expandedHtml}
                        sandbox="allow-scripts"
                        className="w-full h-[60vh] rounded border border-gray-200 dark:border-gray-700 bg-white"
                      />
                    </div>
                  )}

                  {!expandedImage && !expandedMermaid && !expandedHtml && (
                    <div className="w-full min-h-[55vh] text-sm whitespace-pre-wrap rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                      <MarkdownPreview content={expandedDraft} />
                    </div>
                  )}
                </>
              ) : (
                <pre className="w-full min-h-[55vh] text-sm font-mono whitespace-pre-wrap rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                  {expandedDraft}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ShinyText from '@/components/ShinyText';

type Note = {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  updatedAt: string;
  createdAt: string;
};

type GenerateMode = 'infographic' | 'summary' | 'mindmap' | 'webpage' | 'paper_outline' | 'report';

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

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
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

function LoadingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
    </svg>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1 prose-li:my-0.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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

export function NotesPanel({ notebookId }: { notebookId: string | null }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDraft, setExpandedDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingMode, setGeneratingMode] = useState<GenerateMode | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
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

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

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
    window.addEventListener('notes-updated', onUpdate);
    return () => window.removeEventListener('notes-updated', onUpdate);
  }, [fetchNotes]);

  useEffect(() => {
    setSelectedIds([]);
    setExpandedId(null);
    setExpandedDraft('');
    setExpandedView('preview');
    setError('');
    setMermaidSvg('');
    setMermaidError('');
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
  const expandedIsPaperOutline = useMemo(
    () => (expandedNote ? isPaperOutlineNote(expandedNote) : false),
    [expandedNote]
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
    if (!generating) {
      setGenerationProgress(0);
      return;
    }
    const timer = window.setInterval(() => {
      setGenerationProgress((prev) => {
        if (prev >= 92) return 92;
        const delta = Math.max(2, Math.round((100 - prev) / 14));
        return Math.min(92, prev + delta);
      });
    }, 480);
    return () => window.clearInterval(timer);
  }, [generating]);

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
    setGenerating(true);
    setGeneratingMode(mode);
    setGenerationProgress(8);
    setError('');
    try {
      const res = await fetch('/api/notes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId,
          noteIds: selectedIds,
          mode,
          paperFormat: mode === 'paper_outline' ? (paperFormatOverride ?? selectedOutlineFormat) : undefined,
        }),
      });
      setGenerationProgress(52);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? '转换失败');
        return;
      }
      await fetchNotes();
      setGenerationProgress(100);
      await new Promise((resolve) => setTimeout(resolve, 260));
      if (typeof data?.note?.id === 'string') {
        setSelectedIds([data.note.id]);
        setExpandedId(data.note.id);
      } else {
        setSelectedIds([]);
      }
      window.dispatchEvent(new CustomEvent('notes-updated'));
    } catch (e) {
      setError(e instanceof Error ? e.message : '转换失败');
    } finally {
      setGenerating(false);
      setGeneratingMode(null);
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

  const modeDescription = (mode: GenerateMode) => {
    if (mode === 'paper_outline') return '包含段落撰写规范，生成可直接展开写作的结构。';
    if (mode === 'report') return '将内容组织为图文并茂的 HTML 报告，并优先加入图表展示。';
    if (mode === 'infographic') return '正在归纳关键信息并生成信息图。';
    if (mode === 'mindmap') return '正在抽取层级结构并生成思维导图。';
    if (mode === 'summary') return '正在压缩信息并简化为短摘要。';
    return '正在生成可交互的网页内容。';
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
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          我的笔记
        </h2>
        <button
          type="button"
          onClick={() => void fetchNotes()}
          className="h-7 w-7 inline-flex items-center justify-center rounded text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
      </div>

      {error && (
        <div className="px-3 pt-2 space-y-2">
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-2 pb-44">
        {loading ? (
          <div className="p-2">
            <ShinyText text="Loading notes..." className="text-xs text-gray-500 dark:text-gray-400" />
          </div>
        ) : notes.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 p-2">
            还没有笔记，可在聊天区点击“保存到笔记”。
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => {
              const selected = selectedIds.includes(note.id);
              const displayTitle = getDisplayTitle(note);
              const image = getImageFromContent(note.content);
              const cardMermaid = getMermaidFromContent(note.content);
              const cardHtml = getHtmlFromContent(note.content);
              const isOutlineCard = isPaperOutlineNote(note);
              const isReportCard = Boolean(cardHtml) && isReportNote(note);
              const isTextOnlyCard = !image && !cardMermaid && !cardHtml;
              const cardHeightClass = cardMermaid ? 'h-52' : isTextOnlyCard || cardHtml ? 'h-[126px]' : 'h-52';
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
                        <p className="text-xs text-gray-500 dark:text-gray-400 h-full w-full flex items-center justify-center text-center px-0">
                          {isReportCard ? '报告（可在展开后预览）' : '互动PPT（可在展开后预览）'}
                        </p>
                      ) : (
                        <p
                          className="text-xs text-gray-600 dark:text-gray-300 p-0 leading-5 break-words"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            maxHeight: '60px',
                            overflow: 'hidden',
                          }}
                        >
                          {previewText || '(empty)'}
                        </p>
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
        )}
      </div>

      <div
        className={`absolute inset-x-3 bottom-3 z-20 transition-all duration-200 ease-out ${
          selectedIds.length > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
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

      {generating && generatingMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
              <LoadingIcon />
              <p className="text-sm font-semibold">正在生成{modeLabel(generatingMode)}</p>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{modeDescription(generatingMode)}</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${generationProgress}%` }}
              />
            </div>
            <div className="mt-2 flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400 [animation-delay:300ms]" />
              <span className="ml-1">进度 {generationProgress}%</span>
            </div>
          </div>
        </div>
      )}

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
                      {expandedIsPaperOutline ? (
                        <MarkdownPreview content={expandedDraft} />
                      ) : (
                        <pre className="whitespace-pre-wrap">{expandedDraft}</pre>
                      )}
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

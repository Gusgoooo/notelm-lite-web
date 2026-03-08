'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AnimatedList } from '@/components/ui/animated-list';
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button';
import { shouldIgnoreEnterForIme } from '@/lib/ime';
import { ChatPanel } from './ChatPanel';
import { KnowledgeDocPanel } from './KnowledgeDocPanel';
import { SourcesPanel } from './SourcesPanel';

type ArtifactNotice = {
  id: string;
  state: 'running' | 'success' | 'error';
  title: string;
  description: string;
};

type WorkNote = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type PendingWork = {
  id: string;
  title: string;
  description: string;
};

function parsePendingWorkNotice(notice: ArtifactNotice): PendingWork | null {
  if (notice.state !== 'running') return null;
  const titleMatch = notice.title.match(/^正在生成(.+)$/);
  if (!titleMatch || !/作品列表/.test(notice.description)) return null;
  return {
    id: `pending:${notice.id}`,
    title: titleMatch[1]?.trim() || '作品',
    description: notice.description,
  };
}

function getFinishedPendingWorkTitle(notice: ArtifactNotice): string | null {
  if (notice.state === 'success') {
    const match = notice.title.match(/^(.+?)已完成$/);
    return match?.[1]?.trim() || null;
  }
  if (notice.state === 'error') {
    const match = notice.title.match(/^(.+?)生成失败$/);
    return match?.[1]?.trim() || null;
  }
  return null;
}

function extractWorkImage(content: string): string | null {
  const markdownImage = content.match(/!\[[^\]]*]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/i);
  if (markdownImage?.[1]) return markdownImage[1];
  const rawDataUrl = content.match(/(data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+)/i);
  if (rawDataUrl?.[1]) return rawDataUrl[1];
  return null;
}

function extractWorkHtml(content: string): string | null {
  return content.match(/```html\s*([\s\S]*?)```/i)?.[1]?.trim() ?? null;
}

function extractWorkMermaid(content: string): string | null {
  return content.match(/```mermaid\s*([\s\S]*?)```/i)?.[1]?.trim() ?? null;
}

function inferWorkKind(note: WorkNote): '信息图' | '摘要' | '思维导图' | '互动PPT' | '论文大纲' | '报告' | null {
  const title = note.title.trim();
  if (/^创作_infographic/i.test(title)) return '信息图';
  if (/^创作_summary/i.test(title)) return '摘要';
  if (/^创作_mindmap/i.test(title)) return '思维导图';
  if (/^创作_webpage/i.test(title)) return '互动PPT';
  if (/^创作_report/i.test(title)) return '报告';
  if (/信息图/.test(title) || Boolean(extractWorkImage(note.content))) return '信息图';
  if (/思维导图/.test(title) || /```mermaid/i.test(note.content)) return '思维导图';
  if (/互动PPT/.test(title)) return '互动PPT';
  if (/论文大纲/.test(title)) return '论文大纲';
  if (/报告/.test(title)) return '报告';
  if (/摘要/.test(title) || /简化摘要/.test(title)) return '摘要';
  return null;
}

function isCreationWork(note: WorkNote): boolean {
  const kind = inferWorkKind(note);
  if (!kind) return false;
  return note.title.startsWith('作品 ·') || /^创作_[^ ]+/i.test(note.title);
}

function formatWorkTitle(note: WorkNote): string {
  if (note.title.startsWith('作品 ·')) return note.title;
  const kind = inferWorkKind(note);
  if (kind && /^创作_[^ ]+/i.test(note.title)) {
    return `作品 · ${kind}`;
  }
  return note.title;
}

function formatWorkUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function buildWorkFilename(note: WorkNote, extension: string): string {
  const normalized = formatWorkTitle(note)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 48)
    .trim();
  return `${normalized || '作品'}.${extension}`;
}

function SpinnerIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </svg>
  );
}

function MermaidPreview({ code }: { code: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'neutral',
        });
        const id = `work-mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: nextSvg } = await mermaid.render(id, code);
        if (cancelled) return;
        setSvg(nextSvg);
        setError('');
      } catch (renderError) {
        if (cancelled) return;
        setSvg('');
        setError(renderError instanceof Error ? renderError.message : '思维导图渲染失败');
      }
    };

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  if (!svg) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-2">
          <SpinnerIcon />
          正在渲染思维导图…
        </span>
      </div>
    );
  }

  return <div className="mermaid-preview [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

type WorkspaceShellProps = {
  notebookId: string;
  initialTitle: string;
  initialDescription: string;
  isOwner: boolean;
  isPublished: boolean;
};

export function WorkspaceShell({
  notebookId,
  initialTitle,
  initialDescription,
  isOwner,
  isPublished,
}: WorkspaceShellProps) {
  const router = useRouter();
  const [notesWidth, setNotesWidth] = useState<number | null>(null);
  const [docCollapsed, setDocCollapsed] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [savingFork, setSavingFork] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishSaving, setPublishSaving] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishSuccess, setPublishSuccess] = useState('');
  const [headerTitle, setHeaderTitle] = useState(initialTitle);
  const [editingHeaderTitle, setEditingHeaderTitle] = useState(false);
  const [headerTitleDraft, setHeaderTitleDraft] = useState(initialTitle);
  const [savingHeaderTitle, setSavingHeaderTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(initialTitle);
  const [descriptionInput, setDescriptionInput] = useState(initialDescription);
  const [publishedFlag, setPublishedFlag] = useState(isPublished);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [bootstrapHint, setBootstrapHint] = useState('');
  const [bootstrapError, setBootstrapError] = useState('');
  const [artifactNotices, setArtifactNotices] = useState<ArtifactNotice[]>([]);
  const [pendingWorks, setPendingWorks] = useState<PendingWork[]>([]);
  const [worksOpen, setWorksOpen] = useState(false);
  const [worksLoading, setWorksLoading] = useState(false);
  const [worksError, setWorksError] = useState('');
  const [works, setWorks] = useState<WorkNote[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);

  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const titleComposingRef = useRef(false);
  const titleCompositionEndedAtRef = useRef(0);
  const hasManualResizeRef = useRef(false);
  const bootstrapControllerRef = useRef<AbortController | null>(null);
  const bootstrapStartedRef = useRef<string | null>(null);
  const noticeTimersRef = useRef<Record<string, number>>({});

  const LEFT_PANEL_WIDTH = 340;
  const COLLAPSED_DOC_WIDTH = 48;
  const PANEL_GAP = 12;
  const MIN_CENTER_WIDTH = 320;
  const MIN_RIGHT_WIDTH = 320;

  const getBalancedNotesWidth = (totalWidth: number): number | null => {
    const available = totalWidth - LEFT_PANEL_WIDTH - PANEL_GAP - PANEL_GAP;
    if (available <= 0) return null;
    const target = Math.floor(available / 2);
    const maxRightWidth = Math.max(MIN_RIGHT_WIDTH, available - MIN_CENTER_WIDTH);
    return Math.min(maxRightWidth, Math.max(MIN_RIGHT_WIDTH, target));
  };

  const clampNotesWidth = (totalWidth: number, desired: number): number => {
    const available = totalWidth - LEFT_PANEL_WIDTH - PANEL_GAP - PANEL_GAP;
    const maxRightWidth = Math.max(MIN_RIGHT_WIDTH, available - MIN_CENTER_WIDTH);
    return Math.min(maxRightWidth, Math.max(MIN_RIGHT_WIDTH, desired));
  };

  useEffect(() => {
    if (!resizing) return;

    const onMouseMove = (event: MouseEvent) => {
      const start = resizeStartRef.current;
      const totalWidth = workspaceBodyRef.current?.clientWidth ?? 0;
      if (!start || totalWidth <= 0) return;
      const delta = event.clientX - start.startX;
      const nextWidth = clampNotesWidth(totalWidth, start.startWidth - delta);
      setNotesWidth(nextWidth);
    };

    const onMouseUp = () => {
      setResizing(false);
      resizeStartRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizing]);

  useEffect(() => {
    const element = workspaceBodyRef.current;
    if (!element) return;

    const syncWidths = () => {
      const totalWidth = element.clientWidth;
      if (totalWidth <= 0) return;
      if (!hasManualResizeRef.current) {
        const balanced = getBalancedNotesWidth(totalWidth);
        if (balanced != null) setNotesWidth(balanced);
        return;
      }
      setNotesWidth((current) => {
        if (current == null) return getBalancedNotesWidth(totalWidth);
        return clampNotesWidth(totalWidth, current);
      });
    };

    syncWidths();

    const observer = new ResizeObserver(() => {
      syncWidths();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [notebookId]);

  useLayoutEffect(() => {
    let nextDocCollapsed = false;
    try {
      const collapseKey = `notebook-doc-collapse-once:${notebookId}`;
      const collapseOnce = window.sessionStorage.getItem(collapseKey);
      if (collapseOnce === '1') {
        nextDocCollapsed = true;
        window.sessionStorage.removeItem(collapseKey);
      }
      const entryMode = window.sessionStorage.getItem(`notebook-entry:${notebookId}`);
      if (!nextDocCollapsed) {
        nextDocCollapsed = entryMode === 'bootstrap' || entryMode === 'blank';
      }
    } catch {
      nextDocCollapsed = false;
    }
    setDocCollapsed(nextDocCollapsed);
  }, [notebookId]);

  useEffect(() => {
    // Keep local UI state in sync when switching notebooks (e.g. fork/save-as-mine).
    setHeaderTitle(initialTitle);
    setHeaderTitleDraft(initialTitle);
    setTitleInput(initialTitle);
    setDescriptionInput(initialDescription);
    setPublishedFlag(isPublished);
    setEditingHeaderTitle(false);
    setPublishOpen(false);
    setPublishError('');
    setPublishSuccess('');
    setBootstrapOpen(false);
    setBootstrapHint('');
    setBootstrapError('');
    setArtifactNotices([]);
    setPendingWorks([]);
    setWorksOpen(false);
    setWorksLoading(false);
    setWorksError('');
    setWorks([]);
    setSelectedWorkId(null);
    bootstrapControllerRef.current?.abort();
    bootstrapControllerRef.current = null;
    bootstrapStartedRef.current = null;
  }, [notebookId, initialTitle, initialDescription, isPublished]);

  useEffect(() => {
    const onNotebookTitleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string }>).detail;
      const nextTitle = typeof detail?.title === 'string' ? detail.title.trim() : '';
      if (!nextTitle) return;
      setHeaderTitle(nextTitle);
      setHeaderTitleDraft(nextTitle);
      setTitleInput(nextTitle);
    };

    window.addEventListener('notebook-title-updated', onNotebookTitleUpdated as EventListener);
    return () =>
      window.removeEventListener('notebook-title-updated', onNotebookTitleUpdated as EventListener);
  }, []);

  useEffect(() => {
    const onExpandDoc = () => {
      setDocCollapsed(false);
    };
    window.addEventListener('knowledge-doc-expand', onExpandDoc);
    return () => window.removeEventListener('knowledge-doc-expand', onExpandDoc);
  }, []);

  const readOnlySources = useMemo(() => !isOwner, [isOwner]);
  const selectedWork = useMemo(
    () => works.find((item) => item.id === selectedWorkId) ?? null,
    [selectedWorkId, works]
  );
  const selectedPendingWork = useMemo(
    () => pendingWorks.find((item) => item.id === selectedWorkId) ?? null,
    [pendingWorks, selectedWorkId]
  );
  const pendingPreviewActive = Boolean(selectedWorkId?.startsWith('pending:'));
  const selectedWorkImage = useMemo(
    () => (selectedWork ? extractWorkImage(selectedWork.content) : null),
    [selectedWork]
  );
  const selectedWorkHtml = useMemo(
    () => (selectedWork ? extractWorkHtml(selectedWork.content) : null),
    [selectedWork]
  );
  const selectedWorkMermaid = useMemo(
    () => (selectedWork ? extractWorkMermaid(selectedWork.content) : null),
    [selectedWork]
  );

  useEffect(() => {
    if (!docCollapsed) return;
    const onWidenDoc = () => {
      const totalWidth = workspaceBodyRef.current?.clientWidth ?? 0;
      if (totalWidth <= 0) return;
      const balanced = getBalancedNotesWidth(totalWidth);
      if (balanced != null) {
        setNotesWidth((current) => current ?? balanced);
      }
    };
    onWidenDoc();
  }, [docCollapsed]);

  const clearNoticeTimer = useCallback((id: string) => {
    const timer = noticeTimersRef.current[id];
    if (timer != null) {
      window.clearTimeout(timer);
      delete noticeTimersRef.current[id];
    }
  }, []);

  const dismissArtifactNotice = useCallback((id: string) => {
    clearNoticeTimer(id);
    setArtifactNotices((prev) => prev.filter((item) => item.id !== id));
  }, [clearNoticeTimer]);

  const queueArtifactNotice = useCallback((notice: ArtifactNotice) => {
    clearNoticeTimer(notice.id);
    setArtifactNotices((prev) => {
      const next = [notice, ...prev.filter((item) => item.id !== notice.id)];
      return next.slice(0, 4);
    });
    noticeTimersRef.current[notice.id] = window.setTimeout(() => {
      dismissArtifactNotice(notice.id);
    }, 10_000);
  }, [clearNoticeTimer, dismissArtifactNotice]);

  const fetchWorks = useCallback(async (preferredId?: string | null) => {
    if (!notebookId) return;
    setWorksLoading(true);
    setWorksError('');
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/notes`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '加载作品列表失败');
      }
      const nextWorks = (Array.isArray(data) ? data : [])
        .filter(
          (item): item is WorkNote =>
            Boolean(
              item &&
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                typeof item.title === 'string' &&
                typeof item.content === 'string' &&
                typeof item.createdAt === 'string' &&
                typeof item.updatedAt === 'string'
            )
        )
        .filter((item) => isCreationWork(item));
      setWorks(nextWorks);
      setSelectedWorkId((current) => {
        if (preferredId && nextWorks.some((item) => item.id === preferredId)) return preferredId;
        if (current?.startsWith('pending:')) return current;
        if (current && nextWorks.some((item) => item.id === current)) return current;
        return nextWorks[0]?.id ?? null;
      });
    } catch (error) {
      setWorks([]);
      setSelectedWorkId(null);
      setWorksError(error instanceof Error ? error.message : '加载作品列表失败');
    } finally {
      setWorksLoading(false);
    }
  }, [notebookId]);

  const downloadWork = (note: WorkNote) => {
    const image = extractWorkImage(note.content);
    if (image) {
      const extension = image.match(/^data:image\/([a-zA-Z0-9+.-]+)/)?.[1]?.replace('jpeg', 'jpg') ?? 'png';
      const anchor = document.createElement('a');
      anchor.href = image;
      anchor.download = buildWorkFilename(note, extension);
      anchor.rel = 'noreferrer';
      anchor.click();
      return;
    }

    const html = extractWorkHtml(note.content);
    if (html) {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = buildWorkFilename(note, 'html');
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }

    const blob = new Blob([note.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildWorkFilename(note, 'md');
    anchor.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    return () => {
      Object.values(noticeTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      noticeTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    Object.values(noticeTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    noticeTimersRef.current = {};
  }, [notebookId]);

  useEffect(() => {
    const onArtifactNotice = (event: Event) => {
      const detail = (event as CustomEvent<ArtifactNotice>).detail;
      if (!detail?.id || !detail?.title) return;
      const pendingWork = parsePendingWorkNotice(detail);
      if (pendingWork) {
        setPendingWorks((prev) => [pendingWork, ...prev.filter((item) => item.id !== pendingWork.id)].slice(0, 6));
      } else {
        const finishedTitle = getFinishedPendingWorkTitle(detail);
        if (finishedTitle && detail.state === 'error') {
          setPendingWorks((prev) => prev.filter((item) => item.title !== finishedTitle));
        }
      }
      queueArtifactNotice(detail);
    };

    const onArtifactOutputCreated = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId?: string }>).detail;
      setPendingWorks((prev) => prev.slice(1));
      if (worksOpen) {
        void fetchWorks(typeof detail?.noteId === 'string' ? detail.noteId : null);
      }
    };

    const onNotesUpdated = () => {
      if (worksOpen) {
        void fetchWorks();
      }
    };

    window.addEventListener('artifact-notice', onArtifactNotice as EventListener);
    window.addEventListener('artifact-output-created', onArtifactOutputCreated as EventListener);
    window.addEventListener('notes-updated', onNotesUpdated);
    return () => {
      window.removeEventListener('artifact-notice', onArtifactNotice as EventListener);
      window.removeEventListener('artifact-output-created', onArtifactOutputCreated as EventListener);
      window.removeEventListener('notes-updated', onNotesUpdated);
    };
  }, [fetchWorks, queueArtifactNotice, worksOpen]);

  useEffect(() => {
    if (!worksOpen) return;
    void fetchWorks();
  }, [fetchWorks, worksOpen]);

  useEffect(() => {
    if (!worksOpen) return;
    if (pendingWorks.length > 0) {
      if (!selectedWorkId) {
        setSelectedWorkId(pendingWorks[0].id);
      }
      return;
    }
    if (selectedWorkId) return;
    if (works.length > 0) {
      setSelectedWorkId(works[0].id);
    }
  }, [pendingWorks, selectedWorkId, works, worksOpen]);

  useEffect(() => {
    if (!worksOpen) return;
    if (!selectedWorkId?.startsWith('pending:')) return;
    if (pendingWorks.some((item) => item.id === selectedWorkId)) return;
    setSelectedWorkId(works[0]?.id ?? null);
  }, [pendingWorks, selectedWorkId, works, worksOpen]);

  const closeBootstrapModal = (abort = false) => {
    if (abort) {
      bootstrapControllerRef.current?.abort();
      bootstrapControllerRef.current = null;
    }
    setBootstrapOpen(false);
    setBootstrapHint('');
    setBootstrapError('');
  };

  useEffect(() => {
    if (!notebookId) return;
    if (bootstrapStartedRef.current === notebookId) return;

    let shouldStart = false;
    let topic = '';
    try {
      shouldStart = window.sessionStorage.getItem(`notebook-bootstrap-start:${notebookId}`) === 'pending';
      topic = window.sessionStorage.getItem(`notebook-bootstrap-topic:${notebookId}`)?.trim() ?? '';
      if (shouldStart) {
        window.sessionStorage.removeItem(`notebook-bootstrap-start:${notebookId}`);
      }
    } catch {
      shouldStart = false;
      topic = '';
    }

    if (!shouldStart || !topic) return;

    bootstrapStartedRef.current = notebookId;
    setBootstrapOpen(true);
    setBootstrapHint('正在联网检索首批来源，完成后会直接进入可问答状态。');
    setBootstrapError('');

    const controller = new AbortController();
    bootstrapControllerRef.current = controller;

    void fetch('/api/notebooks/bootstrap/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebookId, topic }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error ?? '初始化来源失败');
        }
        setBootstrapHint('来源已就绪，正在进入 Notebook…');
        window.dispatchEvent(new CustomEvent('sources-updated'));
        window.dispatchEvent(
          new CustomEvent('bootstrap-research-ready', {
            detail: { topic },
          })
        );
        window.setTimeout(() => {
          closeBootstrapModal(false);
        }, 520);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        setBootstrapError(error instanceof Error ? error.message : '初始化来源失败');
      })
      .finally(() => {
        bootstrapControllerRef.current = null;
      });
  }, [notebookId]);

  const handleSaveAsMine = async () => {
    if (savingFork) return;
    setSavingFork(true);
    setPublishError('');
    setPublishSuccess('');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${headerTitle}（副本）` }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.notebook?.id) {
        setPublishError(data?.error ?? '保存失败');
        return;
      }
      router.push(`/?notebookId=${encodeURIComponent(data.notebook.id)}`);
      router.refresh();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setPublishError('保存超时，请稍后重试');
      } else {
        setPublishError('保存失败，请稍后重试');
      }
    } finally {
      setSavingFork(false);
    }
  };

  const saveHeaderTitle = async () => {
    if (!isOwner || savingHeaderTitle) return;
    const nextTitle = headerTitleDraft.trim();
    if (!nextTitle) {
      setHeaderTitleDraft(headerTitle);
      setEditingHeaderTitle(false);
      return;
    }
    if (nextTitle === headerTitle) {
      setEditingHeaderTitle(false);
      return;
    }

    setSavingHeaderTitle(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nextTitle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPublishError(data?.error ?? '修改标题失败');
        setHeaderTitleDraft(headerTitle);
        return;
      }
      const committedTitle = typeof data?.title === 'string' ? data.title : nextTitle;
      setHeaderTitle(committedTitle);
      setHeaderTitleDraft(committedTitle);
      setTitleInput(committedTitle);
    } finally {
      setSavingHeaderTitle(false);
      setEditingHeaderTitle(false);
    }
  };

  const handlePublish = async () => {
    const nextTitle = titleInput.trim();
    if (!nextTitle) {
      setPublishError('请填写 notebook 名称');
      return;
    }

    setPublishSaving(true);
    setPublishError('');
    setPublishSuccess('');
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: nextTitle,
          description: descriptionInput.trim(),
          isPublished: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPublishError(data?.error ?? '分享失败');
        return;
      }
      setHeaderTitle(nextTitle);
      setHeaderTitleDraft(nextTitle);
      setTitleInput(nextTitle);
      setPublishedFlag(true);
      setPublishOpen(false);
      setPublishSuccess('已分享到知识库市场');
      router.refresh();
    } finally {
      setPublishSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#f1f1f1] px-3 pb-3 pt-2">
      <div className="shrink-0 bg-[#f1f1f1] px-0 py-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-7 items-center rounded-[12px] bg-gray-100 px-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            >
              <svg viewBox="0 0 24 24" className="mr-1 h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
              返回
            </Link>
            {editingHeaderTitle ? (
              <input
                value={headerTitleDraft}
                onChange={(event) => setHeaderTitleDraft(event.target.value)}
                onCompositionStart={() => {
                  titleComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  titleComposingRef.current = false;
                  titleCompositionEndedAtRef.current = Date.now();
                }}
                onBlur={() => void saveHeaderTitle()}
                onKeyDown={(event) => {
                  const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
                  if (
                    shouldIgnoreEnterForIme({
                      nativeEvent,
                      composing: titleComposingRef.current,
                      lastCompositionEndAt: titleCompositionEndedAtRef.current,
                    })
                  ) {
                    return;
                  }
                  if (event.key === 'Enter') void saveHeaderTitle();
                  if (event.key === 'Escape') {
                    setHeaderTitleDraft(headerTitle);
                    setEditingHeaderTitle(false);
                  }
                }}
                autoFocus
                className="h-8 w-72 rounded-[12px] border border-gray-300 bg-white px-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
            ) : (
              <p
                className={`truncate text-sm font-medium text-gray-600 dark:text-gray-300 ${isOwner ? 'cursor-text' : ''}`}
                onDoubleClick={() => {
                  if (!isOwner) return;
                  setHeaderTitleDraft(headerTitle);
                  setEditingHeaderTitle(true);
                }}
                title={isOwner ? '双击修改标题' : undefined}
              >
                {savingHeaderTitle ? '保存中…' : headerTitle}
              </p>
            )}
            {publishedFlag && (
              <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-300">
                已发布
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (pendingWorks.length > 0) {
                  setSelectedWorkId(pendingWorks[0].id);
                }
                setWorksOpen(true);
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-[12px] bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 5h10l2 2v12H5V5h2Z" />
                <path d="M9 10h6M9 14h6" />
              </svg>
              作品列表
            </button>
            {!isOwner && (
              <button
                type="button"
                onClick={() => void handleSaveAsMine()}
                disabled={savingFork}
                className="inline-flex h-7 items-center rounded-[12px] bg-black px-3 text-xs font-medium text-white disabled:opacity-60"
              >
                {savingFork ? '保存中…' : '保存为我的 notebook'}
              </button>
            )}
            {isOwner && (
              <InteractiveHoverButton
                className="scale-[0.8] origin-center tracking-[2px]"
                onClick={() => setPublishOpen(true)}
              >
                分享
              </InteractiveHoverButton>
            )}
          </div>
        </div>
      </div>

      {(publishError || publishSuccess) && (
        <div className="shrink-0 px-0 py-2">
          {publishError ? <p className="text-xs text-red-600 dark:text-red-400">{publishError}</p> : null}
          {publishSuccess ? <p className="text-xs text-green-600 dark:text-green-400">{publishSuccess}</p> : null}
        </div>
      )}

      <div ref={workspaceBodyRef} className="flex min-h-0 flex-1 overflow-hidden pt-2">
        <aside
          className="h-full shrink-0 overflow-hidden rounded-[20px] bg-white dark:bg-gray-950/50"
          style={{ width: LEFT_PANEL_WIDTH, marginRight: PANEL_GAP }}
        >
          <SourcesPanel
            notebookId={notebookId}
            readOnly={readOnlySources}
            onSaveAsMine={readOnlySources ? () => void handleSaveAsMine() : undefined}
            savingAsMine={savingFork}
          />
        </aside>

        <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] bg-white dark:bg-gray-950/40">
          <ChatPanel notebookId={notebookId} />
        </main>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整知识库问答和知识文档宽度"
          className={`relative shrink-0 transition-colors ${resizing ? 'bg-blue-500/20' : 'bg-transparent'} ${docCollapsed ? 'cursor-default' : 'cursor-col-resize hover:bg-black/5'}`}
          style={{ width: PANEL_GAP }}
          onMouseDown={(event) => {
            if (docCollapsed) return;
            const currentWidth = notesWidth;
            if (currentWidth == null) return;
            event.preventDefault();
            hasManualResizeRef.current = true;
            resizeStartRef.current = { startX: event.clientX, startWidth: currentWidth };
            setResizing(true);
          }}
        />

        <aside
          className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-[20px] bg-white dark:bg-gray-950/50"
          style={{ width: docCollapsed ? COLLAPSED_DOC_WIDTH : notesWidth ?? undefined }}
        >
          <KnowledgeDocPanel
            notebookId={notebookId}
            collapsed={docCollapsed}
            onToggleCollapse={() => setDocCollapsed((prev) => !prev)}
          />
        </aside>
      </div>

      {artifactNotices.length > 0 ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[70] w-[340px] max-w-[calc(100vw-2rem)]">
          <AnimatedList delay={120} className="items-stretch gap-3">
            {artifactNotices.map((notice) => (
              <div
                key={notice.id}
                className="pointer-events-auto overflow-hidden rounded-[18px] border border-black/10 bg-white shadow-[0_20px_40px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-gray-900"
              >
                {notice.state === 'running' ? (
                  <div className="app-slow-loading-bar relative h-[3px] w-full overflow-hidden bg-black/8 dark:bg-white/10" />
                ) : null}
                <div className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
                      notice.state === 'success'
                        ? 'bg-emerald-500'
                        : notice.state === 'error'
                          ? 'bg-red-500'
                          : 'bg-black'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{notice.title}</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{notice.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissArtifactNotice(notice.id)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[12px] text-gray-400 transition hover:bg-black/[0.05] hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
                    aria-label="关闭提醒"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m18 6-12 12M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </AnimatedList>
        </div>
      ) : null}

      {publishOpen && (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">分享 notebook</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                分享后会出现在知识库市场，其他用户可查看并保存为自己的 notebook。
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-600 dark:text-gray-300">名称</label>
                <input
                  value={titleInput}
                  onChange={(event) => setTitleInput(event.target.value)}
                  className="h-9 w-full rounded-[12px] border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800"
                  maxLength={80}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600 dark:text-gray-300">简介</label>
                <textarea
                  value={descriptionInput}
                  onChange={(event) => setDescriptionInput(event.target.value)}
                  className="min-h-24 w-full rounded-[12px] border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
                  maxLength={300}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                className="h-8 rounded-[12px] border border-gray-300 px-3 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handlePublish()}
                disabled={publishSaving}
                className="h-8 rounded-[12px] bg-black px-3 text-xs font-medium text-white disabled:opacity-60"
              >
                {publishSaving ? '分享中…' : '确认分享'}
              </button>
            </div>
          </div>
        </div>
      )}

      {worksOpen && (
        <div
          className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setWorksOpen(false);
            }
          }}
        >
          <div className="flex h-[min(80vh,760px)] w-full max-w-6xl overflow-hidden rounded-[24px] bg-white shadow-xl dark:bg-gray-900">
            <div className="flex w-[280px] shrink-0 flex-col border-r border-black/6 bg-[#f7f7f7] dark:border-white/10 dark:bg-gray-950">
              <div className="px-5 py-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">作品列表</h3>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
                {worksLoading ? (
                  <div className="flex min-h-[180px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                    加载中…
                  </div>
                ) : worksError ? (
                  <div className="flex min-h-[180px] items-center justify-center px-4 text-center text-sm text-red-600 dark:text-red-400">
                    {worksError}
                  </div>
                ) : works.length > 0 || pendingWorks.length > 0 ? (
                  <div className="space-y-2">
                    {pendingWorks.map((work) => {
                      const active = work.id === selectedWorkId;
                      return (
                        <button
                          key={work.id}
                          type="button"
                          onClick={() => setSelectedWorkId(work.id)}
                          className={`w-full rounded-[16px] px-4 py-3 text-left transition ${
                            active
                              ? 'bg-white shadow-sm ring-1 ring-black/8 dark:bg-gray-900 dark:ring-white/10'
                              : 'bg-transparent hover:bg-white/70 dark:hover:bg-gray-900/80'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                              {work.title}
                            </p>
                            <SpinnerIcon className="h-3.5 w-3.5 text-gray-500" />
                          </div>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">正在生成中…</p>
                        </button>
                      );
                    })}
                    {works.map((work) => {
                      const active = work.id === selectedWorkId;
                      const kind = inferWorkKind(work);
                      return (
                        <button
                          key={work.id}
                          type="button"
                          onClick={() => setSelectedWorkId(work.id)}
                          className={`w-full rounded-[16px] px-4 py-3 text-left transition ${
                            active
                              ? 'bg-white shadow-sm ring-1 ring-black/8 dark:bg-gray-900 dark:ring-white/10'
                              : 'bg-transparent hover:bg-white/70 dark:hover:bg-gray-900/80'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                              {formatWorkTitle(work)}
                            </p>
                            {kind ? (
                              <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-gray-300">
                                {kind}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {formatWorkUpdatedAt(work.updatedAt)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-[180px] items-center justify-center px-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    暂时还没有作品产出。
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-black/6 px-5 py-4 dark:border-white/10">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {pendingPreviewActive
                      ? selectedPendingWork?.title ?? '作品'
                      : selectedWork
                        ? formatWorkTitle(selectedWork)
                        : '作品预览'}
                  </h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {pendingPreviewActive
                      ? '正在生成中'
                      : selectedWork
                        ? `更新于 ${formatWorkUpdatedAt(selectedWork.updatedAt)}`
                        : '选择左侧作品查看详情。'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedWork && !selectedPendingWork ? (
                    <button
                      type="button"
                      onClick={() => downloadWork(selectedWork)}
                      className="inline-flex h-8 items-center rounded-[12px] bg-black px-3 text-xs font-medium text-white transition hover:bg-black/90"
                    >
                      下载
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setWorksOpen(false)}
                    className="inline-flex h-8 items-center rounded-[12px] bg-gray-100 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    关闭
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-[#f4f4f5] p-5 dark:bg-gray-950">
                {pendingPreviewActive ? (
                  <div className="flex min-h-full items-center justify-center rounded-[20px] border border-dashed border-black/8 bg-white/60 p-8 dark:border-white/10 dark:bg-gray-900/40">
                    <div className="text-center">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/[0.04] text-gray-700 dark:bg-white/10 dark:text-gray-100">
                        <SpinnerIcon className="h-6 w-6" />
                      </div>
                      <p className="mt-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                        {(selectedPendingWork?.title ?? '作品')} 正在生成中
                      </p>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        结果返回后会直接显示在这里。
                      </p>
                    </div>
                  </div>
                ) : selectedWork ? (
                  selectedWorkHtml ? (
                    <div className="h-full min-h-[480px] overflow-hidden rounded-[20px] bg-white shadow-sm dark:bg-gray-900">
                      <iframe
                        title={formatWorkTitle(selectedWork)}
                        srcDoc={selectedWorkHtml}
                        className="h-full w-full bg-white"
                      />
                    </div>
                  ) : selectedWorkMermaid ? (
                    <div className="flex min-h-full items-start justify-center rounded-[20px] bg-white p-5 shadow-sm dark:bg-gray-900">
                      <div className="w-full overflow-auto">
                        <MermaidPreview code={selectedWorkMermaid} />
                      </div>
                    </div>
                  ) : selectedWorkImage ? (
                    <div className="flex min-h-full items-start justify-center rounded-[20px] bg-white p-5 shadow-sm dark:bg-gray-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedWorkImage}
                        alt={formatWorkTitle(selectedWork)}
                        className="max-h-full w-full rounded-[16px] object-contain"
                      />
                    </div>
                  ) : (
                    <div className="mx-auto max-w-4xl rounded-[20px] bg-white px-8 py-8 shadow-sm dark:bg-gray-900">
                      <article className="knowledge-doc-editor">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedWork.content}</ReactMarkdown>
                      </article>
                    </div>
                  )
                ) : (
                  <div className="flex min-h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                    从左侧选择一个作品开始预览。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {bootstrapOpen && (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-[24px] border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">正在联网检索来源</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{bootstrapHint}</p>
              </div>
              <button
                type="button"
                onClick={() => closeBootstrapModal(true)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="关闭进程"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
              <div className="app-slow-loading-bar relative h-full w-full overflow-hidden" />
            </div>
            {bootstrapError ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{bootstrapError}</p> : null}
            <div className="mt-4 flex items-center justify-end">
              <button
                type="button"
                onClick={() => closeBootstrapModal(true)}
                className="inline-flex h-8 items-center rounded-[12px] border border-gray-300 px-3 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

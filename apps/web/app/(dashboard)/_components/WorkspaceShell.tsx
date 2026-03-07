'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button';
import { ChatPanel } from './ChatPanel';
import { KnowledgeDocPanel } from './KnowledgeDocPanel';
import { SourcesPanel } from './SourcesPanel';

type WorkspaceShellProps = {
  notebookId: string;
  initialTitle: string;
  initialDescription: string;
  isOwner: boolean;
  isPublished: boolean;
};

function CreationIcon({ mode }: { mode: 'summary' | 'infographic' | 'mindmap' | 'report' | 'webpage' }) {
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
  const [creationOpen, setCreationOpen] = useState(false);
  const [creationDocContent, setCreationDocContent] = useState('');
  const [creationLoading, setCreationLoading] = useState(false);
  const [creationGenerating, setCreationGenerating] = useState<string | null>(null);

  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const hasManualResizeRef = useRef(false);

  const LEFT_PANEL_WIDTH = 320;
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
    setDocCollapsed(false);
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
    const onOpenCreation = () => setCreationOpen(true);
    window.addEventListener('open-creation-panel', onOpenCreation);
    return () => window.removeEventListener('open-creation-panel', onOpenCreation);
  }, []);

  useEffect(() => {
    if (!creationOpen || !notebookId) return;
    setCreationLoading(true);
    fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => setCreationDocContent(typeof data?.content === 'string' ? data.content : ''))
      .catch(() => setCreationDocContent(''))
      .finally(() => setCreationLoading(false));
  }, [creationOpen, notebookId]);

  const runCreationGenerate = async (mode: 'infographic' | 'summary' | 'mindmap' | 'report' | 'webpage') => {
    if (!notebookId || creationGenerating) return;
    setCreationGenerating(mode);
    let tempNoteId: string | null = null;
    try {
      const createRes = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `创作_${mode}_${Date.now()}`,
          content: creationDocContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '（空文档）',
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
      setCreationOpen(false);
      window.dispatchEvent(new CustomEvent('notes-updated'));
    } catch (e) {
      alert(e instanceof Error ? e.message : '生成失败');
    } finally {
      if (tempNoteId) {
        await fetch(`/api/notes/${encodeURIComponent(tempNoteId)}`, { method: 'DELETE' }).catch(() => null);
      }
      setCreationGenerating(null);
    }
  };

  const readOnlySources = useMemo(() => !isOwner, [isOwner]);
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
      <div className="shrink-0 bg-[#f1f1f1] px-0 py-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-7 items-center rounded-md bg-gray-100 px-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
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
                onBlur={() => void saveHeaderTitle()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveHeaderTitle();
                  if (event.key === 'Escape') {
                    setHeaderTitleDraft(headerTitle);
                    setEditingHeaderTitle(false);
                  }
                }}
                autoFocus
                className="h-8 w-72 rounded border border-gray-300 bg-white px-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
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
            {!isOwner && (
              <button
                type="button"
                onClick={() => void handleSaveAsMine()}
                disabled={savingFork}
                className="inline-flex h-7 items-center rounded-md bg-black px-3 text-xs font-medium text-white disabled:opacity-60"
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

      {publishOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
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
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-800"
                  maxLength={80}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-600 dark:text-gray-300">简介</label>
                <textarea
                  value={descriptionInput}
                  onChange={(event) => setDescriptionInput(event.target.value)}
                  className="min-h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
                  maxLength={300}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                className="h-8 rounded-md border border-gray-300 px-3 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handlePublish()}
                disabled={publishSaving}
                className="h-8 rounded-md bg-black px-3 text-xs font-medium text-white disabled:opacity-60"
              >
                {publishSaving ? '分享中…' : '确认分享'}
              </button>
            </div>
          </div>
        </div>
      )}

      {creationOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/20"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setCreationOpen(false);
            }
          }}
        >
          <div className="absolute inset-x-0 bottom-0 flex justify-center px-3 pb-3 pt-16">
            <div className="w-full max-w-3xl overflow-hidden rounded-[28px] bg-white shadow-[0_-24px_60px_rgba(15,23,42,0.16)] dark:bg-gray-900">
              <div className="flex items-center justify-between px-5 pb-2 pt-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">基于知识文档去创作</h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">从当前知识文档快速生成结构化内容。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreationOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  aria-label="关闭创作抽屉"
                  title="关闭"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m18 6-12 12M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {creationLoading ? (
                <p className="px-5 py-5 text-center text-xs text-gray-500">加载文档中…</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 px-5 py-5 md:grid-cols-3">
                  {creationActions.map(({ mode, label, hint, className }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => void runCreationGenerate(mode)}
                      disabled={!!creationGenerating}
                      className={`flex min-h-[78px] flex-col items-start justify-between rounded-2xl px-4 py-3 text-left transition disabled:opacity-50 ${className}`}
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
        </div>
      )}
    </div>
  );
}

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

export function WorkspaceShell({
  notebookId,
  initialTitle,
  initialDescription,
  isOwner,
  isPublished,
}: WorkspaceShellProps) {
  const router = useRouter();
  const [notesWidth, setNotesWidth] = useState<number | null>(null);
  const [docCollapsed, setDocCollapsed] = useState(true);
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
  const [bootstrapStep, setBootstrapStep] = useState<0 | 1 | 2 | 3>(0);
  const [bootstrapHint, setBootstrapHint] = useState('');
  const [bootstrapProgress, setBootstrapProgress] = useState(0);
  const [bootstrapElapsed, setBootstrapElapsed] = useState(0);
  const [bootstrapError, setBootstrapError] = useState('');

  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const hasManualResizeRef = useRef(false);
  const bootstrapControllerRef = useRef<AbortController | null>(null);
  const bootstrapStartedRef = useRef<string | null>(null);

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
    setDocCollapsed(true);
    setBootstrapOpen(false);
    setBootstrapStep(0);
    setBootstrapHint('');
    setBootstrapProgress(0);
    setBootstrapElapsed(0);
    setBootstrapError('');
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

  useEffect(() => {
    if (!bootstrapOpen) {
      setBootstrapElapsed(0);
      return;
    }
    const start = Date.now();
    const timer = window.setInterval(() => {
      setBootstrapElapsed(Math.floor((Date.now() - start) / 1000));
    }, 200);
    return () => window.clearInterval(timer);
  }, [bootstrapOpen]);

  useEffect(() => {
    if (!bootstrapOpen) {
      setBootstrapProgress(0);
      return;
    }
    const target = bootstrapStep === 1 ? 24 : bootstrapStep === 2 ? 86 : bootstrapStep === 3 ? 100 : 0;
    const timer = window.setInterval(() => {
      setBootstrapProgress((prev) => {
        if (prev >= target) return prev;
        const delta = Math.max(1, Math.round((target - prev) / 9));
        return Math.min(target, prev + delta);
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [bootstrapOpen, bootstrapStep]);

  const closeBootstrapModal = (abort = false) => {
    if (abort) {
      bootstrapControllerRef.current?.abort();
      bootstrapControllerRef.current = null;
    }
    setBootstrapOpen(false);
    setBootstrapStep(0);
    setBootstrapHint('');
    setBootstrapProgress(0);
    setBootstrapElapsed(0);
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
    setBootstrapStep(1);
    setBootstrapHint('正在准备首批来源，稍后会直接进入可问答状态。');
    setBootstrapError('');

    const controller = new AbortController();
    const advanceTimer = window.setTimeout(() => {
      setBootstrapStep(2);
      setBootstrapHint('正在联网检索并导入 15 篇来源…');
    }, 260);
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
        setBootstrapStep(3);
        setBootstrapHint('来源已就绪，可以开始对话了。');
        setBootstrapProgress(100);
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
        window.clearTimeout(advanceTimer);
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
                onBlur={() => void saveHeaderTitle()}
                onKeyDown={(event) => {
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

      {bootstrapOpen && (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-[24px] border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">正在准备研究 Notebook</h3>
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
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="relative h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-500 transition-all duration-500"
                style={{ width: `${bootstrapProgress}%` }}
              >
                <span className="absolute inset-0 animate-pulse bg-white/20" />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
              <span>进行中 {bootstrapElapsed}s</span>
              <span>进度 {bootstrapProgress}%</span>
            </div>
            <div className="mt-4 space-y-2">
              {['准备 notebook', '联网检索首批来源', '完成'].map((label, idx) => {
                const stepNumber = (idx + 1) as 1 | 2 | 3;
                const done = bootstrapStep > stepNumber;
                const running = bootstrapStep === stepNumber;
                return (
                  <div
                    key={label}
                    className={`flex items-center gap-2 rounded-[14px] border px-3 py-2 text-xs ${
                      done
                        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-300'
                        : running
                          ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300'
                          : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        done ? 'bg-green-600' : running ? 'bg-blue-600 animate-pulse' : 'bg-gray-400'
                      }`}
                    />
                    <span>{label}</span>
                  </div>
                );
              })}
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

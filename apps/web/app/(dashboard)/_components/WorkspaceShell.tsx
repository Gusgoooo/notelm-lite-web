'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button';
import { ChatPanel } from './ChatPanel';
import { NotesPanel } from './NotesPanel';
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
  const [notesWidth, setNotesWidth] = useState(360);
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

  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!resizing) return;

    const onMouseMove = (event: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const delta = event.clientX - start.startX;
      const nextWidth = Math.min(680, Math.max(300, start.startWidth - delta));
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
  }, [notebookId, initialTitle, initialDescription, isPublished]);

  const readOnlySources = useMemo(() => !isOwner, [isOwner]);

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
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="border-b bg-white/80 px-3 py-1 backdrop-blur-sm dark:bg-gray-950/70">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              <svg viewBox="0 0 24 24" className="mr-1 h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" />
              </svg>
              返回首页
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
        <div className="border-b px-3 py-2">
          {publishError ? <p className="text-xs text-red-600 dark:text-red-400">{publishError}</p> : null}
          {publishSuccess ? <p className="text-xs text-green-600 dark:text-green-400">{publishSuccess}</p> : null}
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside className="w-80 shrink-0 border-r bg-white/50 dark:bg-gray-950/30">
          <SourcesPanel
            notebookId={notebookId}
            readOnly={readOnlySources}
            onSaveAsMine={readOnlySources ? () => void handleSaveAsMine() : undefined}
            savingAsMine={savingFork}
          />
        </aside>

        <main className="min-w-0 flex-1 min-h-0 flex flex-col border-r bg-gray-50/80 dark:bg-gray-950/20">
          <ChatPanel notebookId={notebookId} />
        </main>

        <aside
          className="relative shrink-0 min-h-0 flex flex-col border-l border-gray-200 bg-white/50 dark:border-gray-800 dark:bg-gray-950/30"
          style={{ width: notesWidth }}
        >
          <div
            className={`absolute left-0 top-0 h-full w-2 cursor-col-resize ${resizing ? 'bg-blue-500/20' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault();
              resizeStartRef.current = { startX: event.clientX, startWidth: notesWidth };
              setResizing(true);
            }}
          />
          <NotesPanel notebookId={notebookId} />
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
    </div>
  );
}

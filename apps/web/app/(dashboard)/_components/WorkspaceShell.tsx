'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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

  const readOnlySources = useMemo(() => !isOwner, [isOwner]);

  const handleSaveAsMine = async () => {
    if (savingFork) return;
    setSavingFork(true);
    setPublishError('');
    setPublishSuccess('');
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${initialTitle}（副本）` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.notebook?.id) {
        setPublishError(data?.error ?? '保存失败');
        return;
      }
      router.push(`/?notebookId=${encodeURIComponent(data.notebook.id)}`);
      router.refresh();
    } finally {
      setSavingFork(false);
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
        setPublishError(data?.error ?? '发布失败');
        return;
      }
      setPublishedFlag(true);
      setPublishOpen(false);
      setPublishSuccess('已发布到知识库市场');
      router.refresh();
    } finally {
      setPublishSaving(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="h-10 border-b bg-white/80 px-3 backdrop-blur-sm dark:bg-gray-950/70">
        <div className="flex h-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              Back to panel
            </Link>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{initialTitle}</p>
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
              <button
                type="button"
                onClick={() => setPublishOpen(true)}
                className="inline-flex h-7 items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                {publishedFlag ? '更新发布信息' : '发布'}
              </button>
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

        <main className="min-w-0 flex-1 min-h-0 flex flex-col border-r bg-white/30 dark:bg-gray-950/20">
          <ChatPanel notebookId={notebookId} />
        </main>

        <aside className="relative shrink-0 p-2 pl-0" style={{ width: notesWidth }}>
          <div
            className={`absolute left-0 top-0 h-full w-2 cursor-col-resize ${resizing ? 'bg-blue-500/20' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault();
              resizeStartRef.current = { startX: event.clientX, startWidth: notesWidth };
              setResizing(true);
            }}
          />
          <div className="h-full overflow-hidden rounded-[12px] border border-gray-200 bg-white/70 shadow-sm dark:border-gray-800 dark:bg-gray-950/40">
            <NotesPanel notebookId={notebookId} />
          </div>
        </aside>
      </div>

      {publishOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">发布 notebook</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                发布后会出现在知识库市场，其他用户可查看并保存为自己的 notebook。
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
                {publishSaving ? '发布中…' : '确认发布'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

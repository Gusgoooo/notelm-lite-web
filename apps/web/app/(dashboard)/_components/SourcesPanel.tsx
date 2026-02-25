'use client';

import { useCallback, useEffect, useState } from 'react';

type Source = {
  id: string;
  notebookId: string;
  filename: string;
  fileUrl: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | string;
  errorMessage: string | null;
  chunkCount?: number;
  sourceType?: 'pdf' | 'word' | '复制文本' | string;
  createdAt: string;
};

const allowedMimes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 10v7M14 10v7" />
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

export function SourcesPanel({ notebookId }: { notebookId: string }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasteStatus, setPasteStatus] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSources = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/sources?notebookId=${encodeURIComponent(notebookId)}`);
      const data = await res.json().catch(() => []);
      setSources(Array.isArray(data) ? data : []);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [notebookId]);

  useEffect(() => {
    void fetchSources(true);
  }, [fetchSources]);

  useEffect(() => {
    const timer = setInterval(() => {
      const hasInflight = sources.some((s) => s.status === 'PENDING' || s.status === 'PROCESSING');
      if (hasInflight) void fetchSources(false);
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchSources, sources]);

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploading) return;
    if (!allowedMimes.includes(file.type)) {
      alert('请选择 PDF 或 Word 文件（.pdf / .docx / .doc）');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set('notebookId', notebookId);
      form.set('file', file);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      const res = await fetch('/api/sources/upload', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error ?? '上传失败');
      }
      await fetchSources(false);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        alert('上传超时（60秒），请检查对象存储配置后重试');
      } else {
        alert('上传请求失败，请稍后重试');
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const requeue = async (sourceId: string) => {
    await fetch(`/api/sources/${sourceId}/requeue`, { method: 'POST' });
    await fetchSources(false);
  };

  const deleteSource = async (sourceId: string) => {
    if (deletingId) return;
    setDeletingId(sourceId);
    try {
      const res = await fetch(`/api/sources/${sourceId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error ?? '删除来源失败');
        return;
      }
      await fetchSources(false);
    } finally {
      setDeletingId(null);
    }
  };

  const createFromPaste = async (textOverride?: string) => {
    const content = (textOverride ?? pasteText).trim();
    if (!content || pasting) return;
    setPasting(true);
    setPasteStatus('正在处理粘贴文本，已提交到队列…');
    try {
      const res = await fetch('/api/sources/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId,
          text: content,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setPasteStatus(err.error ?? '粘贴文本创建失败');
        return;
      }
      setPasteText('');
      setPasteStatus('已接收粘贴文本，正在处理中…');
      await fetchSources(false);
    } finally {
      setPasting(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 px-3 border-b border-gray-200 dark:border-gray-800 flex items-center">
        <div className="w-full flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Sources
          </h2>
          <button
            type="button"
            onClick={() => fetchSources(false)}
            className="h-7 w-7 inline-flex items-center justify-center rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        <label className="block text-center text-xs px-2 py-1.5 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 cursor-pointer">
          <input
            type="file"
            accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/msword,.doc"
            className="hidden"
            onChange={uploadFile}
            disabled={uploading}
          />
          {uploading ? '上传中…' : '上传 PDF / Word'}
        </label>
        <div className="space-y-1">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text').trim();
              if (!pasted) return;
              setPasteText(pasted);
              void createFromPaste(pasted);
            }}
            placeholder="粘贴文本后将自动生成来源卡片"
            className="w-full min-h-20 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs p-2 resize-y"
            disabled={pasting}
          />
          {pasteStatus ? (
            <p
              className={`text-[11px] ${
                pasting ? 'text-blue-600' : pasteStatus.includes('失败') ? 'text-red-600' : 'text-gray-500'
              }`}
            >
              {pasteStatus}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        {loading ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 p-2">Loading…</p>
        ) : sources.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 p-2">
            还没有来源文件，先上传一个。
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sources.map((s) => (
              <li
                key={s.id}
                className="group rounded border border-gray-200 dark:border-gray-800 p-2 bg-white/60 dark:bg-gray-900/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium truncate" title={s.filename}>
                    {s.filename}
                  </p>
                  <button
                    type="button"
                    onClick={() => void deleteSource(s.id)}
                    disabled={deletingId === s.id}
                    className="opacity-0 group-hover:opacity-100 transition text-gray-500 hover:text-red-600 disabled:opacity-60"
                    aria-label="删除来源"
                    title="删除来源"
                  >
                    <TrashIcon />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 uppercase">
                    {s.sourceType ?? 'unknown'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700">
                    {s.chunkCount ?? 0} chunks
                  </span>
                </div>
                <p
                  className={`text-[11px] mt-1 ${
                    s.status === 'READY'
                      ? 'text-green-600'
                      : s.status === 'FAILED'
                        ? 'text-red-600'
                        : s.status === 'PROCESSING'
                          ? 'text-blue-600'
                          : 'text-gray-500'
                  }`}
                >
                  {s.status}
                  {s.errorMessage ? ` — ${s.errorMessage}` : ''}
                </p>
                {(s.status === 'FAILED' || s.status === 'PENDING') && (
                  <button
                    type="button"
                    onClick={() => requeue(s.id)}
                    className="mt-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Re-queue
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

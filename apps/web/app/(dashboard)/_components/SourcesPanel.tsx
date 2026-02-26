'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import ShinyText from '@/components/ShinyText';

type Source = {
  id: string;
  notebookId: string;
  filename: string;
  fileUrl: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | string;
  errorMessage: string | null;
  chunkCount?: number;
  sourceType?: 'pdf' | 'word' | '复制文本' | 'python脚本' | string;
  createdAt: string;
};

const allowedMimes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/x-python',
  'text/x-python-script',
  'application/x-python-code',
  'text/plain',
];

function getExt(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  return filename.slice(idx + 1).toLowerCase();
}

function isPythonFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase().trim();
  const ext = getExt(file.name || '');
  return (
    ext === 'py' ||
    mime === 'text/x-python' ||
    mime === 'text/x-python-script' ||
    mime === 'application/x-python-code'
  );
}

function getSourceStatusMeta(status: string) {
  if (status === 'READY') return { label: '已完成', colorClass: 'text-green-600', dotClass: 'bg-green-600' };
  if (status === 'FAILED') return { label: '失败', colorClass: 'text-red-600', dotClass: 'bg-red-600' };
  if (status === 'PROCESSING') return { label: '处理中', colorClass: 'text-blue-600', dotClass: 'bg-blue-600' };
  if (status === 'PENDING') return { label: '待处理', colorClass: 'text-gray-500', dotClass: 'bg-gray-400' };
  return { label: status, colorClass: 'text-gray-500', dotClass: 'bg-gray-400' };
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 10v7M14 10v7" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function SourcesPanel({
  notebookId,
  readOnly = false,
  onSaveAsMine,
  savingAsMine = false,
}: {
  notebookId: string;
  readOnly?: boolean;
  onSaveAsMine?: () => void;
  savingAsMine?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    if (readOnly) return;
    const file = e.target.files?.[0];
    if (!file || uploading) return;
    const ext = getExt(file.name || '');
    const isKnownType =
      allowedMimes.includes((file.type || '').toLowerCase().trim()) ||
      ['pdf', 'docx', 'doc', 'py'].includes(ext);
    if (!isKnownType) {
      alert('请选择 PDF / Word / Python 脚本（.pdf / .docx / .doc / .py）');
      return;
    }
    if (isPythonFile(file)) {
      const ok = window.confirm(
        '检测到 Python 脚本。启用后会自动影响当前 Notebook 的整体问答结果（沙箱执行）。是否继续上传？'
      );
      if (!ok) {
        e.target.value = '';
        return;
      }
    }
    if (!file.size) {
      alert('文件为空，请重新选择');
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
    if (readOnly) return;
    await fetch(`/api/sources/${sourceId}/requeue`, { method: 'POST' });
    await fetchSources(false);
  };

  const deleteSource = async (sourceId: string) => {
    if (readOnly) return;
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
    if (readOnly) return;
    const content = (textOverride ?? pasteText).trim();
    if (!content || pasting) return;
    setPasting(true);
    setPasteStatus('正在处理粘贴文本，已提交到队列…');
    try {
      const res = await fetch('/api/sources/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId, text: content }),
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
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          知识库
        </h2>
        <Button variant="ghost" size="icon" onClick={() => void fetchSources(false)} aria-label="Refresh">
          <RefreshIcon />
        </Button>
      </div>

      <div className="space-y-2 p-3">
        {readOnly && (
          <div className="rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <div className="flex items-center justify-between gap-2">
              <span>当前为共享知识库，保存为我的 notebook 后可修改 sources。</span>
              {onSaveAsMine && (
                <button
                  type="button"
                  onClick={onSaveAsMine}
                  disabled={savingAsMine}
                  className="shrink-0 rounded bg-black px-2 py-1 text-[10px] text-white disabled:opacity-60"
                >
                  {savingAsMine ? '保存中…' : '保存为我的'}
                </button>
              )}
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/msword,.doc,text/x-python,.py"
          className="hidden"
          onChange={uploadFile}
          disabled={uploading || readOnly}
        />
        {!readOnly && (
          <>
            <Button
              className="w-full bg-black text-xs text-white hover:bg-black/90"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? '上传中…' : '上传 PDF / Word / Python'}
            </Button>
            <div className="space-y-1">
              <Textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text').trim();
                  if (!pasted) return;
                  setPasteText(pasted);
                  void createFromPaste(pasted);
                }}
                placeholder="粘贴文本后将自动生成来源卡片"
                className="min-h-20 text-xs"
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
          </>
        )}
      </div>

      <ScrollArea className="flex-1 p-2">
        {loading ? (
          <div className="p-2">
            <ShinyText text="Loading..." className="text-xs text-gray-500 dark:text-gray-400" />
          </div>
        ) : sources.length === 0 ? (
          <p className="p-2 text-xs text-gray-500 dark:text-gray-400">
            {readOnly ? '该共享 notebook 暂无可用来源。' : '还没有来源文件，先上传一个。'}
          </p>
        ) : (
          <ul className="space-y-2">
            {sources.map((s) => (
              <li key={s.id}>
                <Card className="group border-gray-200/80 bg-white/70 p-2 dark:border-gray-800 dark:bg-gray-900/60">
                  {(() => {
                    const statusMeta = getSourceStatusMeta(s.status);
                    return (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${statusMeta.dotClass}`} />
                            <p className="truncate text-xs font-medium" title={s.filename}>
                              {s.filename}
                            </p>
                          </div>
                          {!readOnly && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 transition group-hover:opacity-100"
                              onClick={() => void deleteSource(s.id)}
                              disabled={deletingId === s.id}
                              aria-label="删除来源"
                            >
                              <TrashIcon />
                            </Button>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <Badge variant="secondary" className="uppercase">
                            {s.sourceType ?? 'unknown'}
                          </Badge>
                          <Badge variant="outline">{s.chunkCount ?? 0} chunks</Badge>
                        </div>
                        <p className={`mt-1 text-[11px] ${statusMeta.colorClass}`}>
                          {statusMeta.label}
                          {s.errorMessage ? ` — ${s.errorMessage}` : ''}
                        </p>
                      </>
                    );
                  })()}
                  {!readOnly && (s.status === 'FAILED' || s.status === 'PENDING') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-6 px-0 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      onClick={() => void requeue(s.id)}
                    >
                      重新处理
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

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
  mime?: string | null;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | string;
  errorMessage: string | null;
  chunkCount?: number;
  sourceType?: 'pdf' | 'word' | '复制文本' | 'python脚本' | 'skills技能包' | '联网检索' | string;
  createdAt: string;
};

type PendingUpload = {
  id: string;
  filename: string;
  progress: number;
  createdAt: string;
};

type ResearchState = {
  phase: 'collecting' | 'analyzing' | 'select_direction' | 'refining' | 'ready';
  sourceStats?: {
    totalBefore: number;
    totalAfter: number;
  };
};

const MAX_WEB_SOURCES = 20;
const LARGE_FILE_DIRECT_UPLOAD_THRESHOLD = 4.5 * 1024 * 1024;
const allowedMimes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/x-python',
  'text/x-python-script',
  'application/x-python-code',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
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
  if (status === 'READY') return { label: '已完成', colorClass: 'text-green-600', dotClass: 'bg-gray-400' };
  if (status === 'FAILED') return { label: '失败', colorClass: 'text-red-600', dotClass: 'bg-gray-400' };
  if (status === 'PROCESSING') return { label: '处理中', colorClass: 'text-blue-600', dotClass: 'bg-gray-400' };
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

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h2v5h-2z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function formatTime(value: string): string {
  try {
    return new Date(value).toLocaleString('zh-CN');
  } catch {
    return value;
  }
}

function extractHostname(urlValue: string): string {
  try {
    return new URL(urlValue).hostname;
  } catch {
    return '';
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
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
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasteStatus, setPasteStatus] = useState('');
  const [webTopic, setWebTopic] = useState('');
  const [webSearching, setWebSearching] = useState(false);
  const [webSearchStatus, setWebSearchStatus] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [researchState, setResearchState] = useState<ResearchState | null>(null);
  const [hydratingSourceId, setHydratingSourceId] = useState<string | null>(null);
  const [hydrateStatus, setHydrateStatus] = useState('');

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

  const fetchResearchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/research/state`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResearchState(null);
        return;
      }
      setResearchState((data?.state as ResearchState | null) ?? null);
    } catch {
      setResearchState(null);
    }
  }, [notebookId]);

  useEffect(() => {
    void fetchSources(true);
    void fetchResearchState();
  }, [fetchSources, fetchResearchState]);

  useEffect(() => {
    const timer = setInterval(() => {
      const hasInflight = sources.some((s) => s.status === 'PENDING' || s.status === 'PROCESSING');
      if (hasInflight) void fetchSources(false);
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchSources, sources]);

  useEffect(() => {
    const onSourcesUpdated = () => {
      void fetchSources(false);
      void fetchResearchState();
    };
    window.addEventListener('sources-updated', onSourcesUpdated);
    return () => window.removeEventListener('sources-updated', onSourcesUpdated);
  }, [fetchSources, fetchResearchState]);

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;
    const file = e.target.files?.[0];
    if (!file || uploading) return;
    const ext = getExt(file.name || '');
    const isKnownType =
      allowedMimes.includes((file.type || '').toLowerCase().trim()) ||
      ['pdf', 'docx', 'doc', 'py', 'zip'].includes(ext);
    if (!isKnownType) {
      alert('请选择 PDF / Word / Python 脚本 / Skills ZIP（.pdf / .docx / .doc / .py / .zip）');
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
    const tempUploadId = `upload_${Date.now()}`;
    setPendingUpload({
      id: tempUploadId,
      filename: file.name,
      progress: 0,
      createdAt: new Date().toISOString(),
    });
    try {
      const uploadWithProgress = (
        input: {
          url: string;
          method: 'PUT' | 'POST';
          body: Document | XMLHttpRequestBodyInit;
          headers?: Record<string, string>;
        }
      ): Promise<{ status: number; responseText: string }> =>
        new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(input.method, input.url);
          if (input.headers) {
            for (const [key, value] of Object.entries(input.headers)) {
              xhr.setRequestHeader(key, value);
            }
          }
          xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return;
            const ratio = Math.max(0, Math.min(1, event.loaded / event.total));
            setPendingUpload((prev) =>
              prev
                ? {
                    ...prev,
                    progress: Math.max(prev.progress, Math.round(ratio * 100)),
                  }
                : prev
            );
          };
          xhr.onload = () => resolve({ status: xhr.status, responseText: xhr.responseText ?? '' });
          xhr.onerror = () => reject(new Error('上传请求失败'));
          xhr.ontimeout = () => reject(new Error('上传超时（60秒），请检查对象存储配置后重试'));
          xhr.timeout = 60_000;
          xhr.send(input.body);
        });

      const uploadViaServer = async () => {
        const form = new FormData();
        form.set('notebookId', notebookId);
        form.set('file', file);
        const res = await uploadWithProgress({
          url: '/api/sources/upload',
          method: 'POST',
          body: form,
        });
        if (res.status < 200 || res.status >= 300) {
          let err: unknown = {};
          try {
            err = JSON.parse(res.responseText);
          } catch {
            err = {};
          }
          const message =
            err && typeof err === 'object' && 'error' in err && typeof err.error === 'string'
              ? err.error
              : `服务端上传失败（${res.status}）`;
          throw new Error(String(message));
        }
      };

      const uploadViaDirect = async (meta: {
        uploadUrl: string;
        sourceId: string;
        fileUrl: string;
        mimeType?: string;
      }) => {
        const headers =
          file.type || meta.mimeType
            ? { 'Content-Type': String(file.type || meta.mimeType) }
            : undefined;
        const putRes = await uploadWithProgress({
          url: String(meta.uploadUrl),
          method: 'PUT',
          headers,
          body: file,
        });
        if (putRes.status < 200 || putRes.status >= 300) {
          throw new Error(`对象存储上传失败（${putRes.status}）`);
        }

        setPendingUpload((prev) => (prev ? { ...prev, progress: 100 } : prev));
        const createRes = await fetch('/api/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: meta.sourceId,
            notebookId,
            filename: file.name,
            fileUrl: meta.fileUrl,
            mime: meta.mimeType ?? file.type,
          }),
        });
        const created = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          throw new Error(created?.error ?? `创建来源记录失败（${createRes.status}）`);
        }
      };

      const tryDirectFirst = async (): Promise<boolean> => {
        const getRes = await fetch('/api/sources/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notebookId,
            filename: file.name,
            mimeType: file.type,
          }),
        });
        const meta = await getRes.json().catch(() => ({}));
        if (!getRes.ok || !meta?.uploadUrl || !meta?.sourceId || !meta?.fileUrl) {
          return false;
        }
        if (!isHttpUrl(String(meta.uploadUrl))) {
          return false;
        }
        try {
          await uploadViaDirect({
            uploadUrl: String(meta.uploadUrl),
            sourceId: String(meta.sourceId),
            fileUrl: String(meta.fileUrl),
            mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : undefined,
          });
          return true;
        } catch (error) {
          if (file.size > LARGE_FILE_DIRECT_UPLOAD_THRESHOLD) {
            throw error;
          }
          return false;
        }
      };

      const usedDirect = await tryDirectFirst();
      if (!usedDirect) {
        await uploadViaServer();
      }
      setPendingUpload((prev) => (prev ? { ...prev, progress: 100 } : prev));
      await fetchSources(false);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        alert('上传超时（60秒），请检查对象存储配置后重试');
      } else {
        alert(err instanceof Error ? err.message : '上传请求失败，请稍后重试');
      }
    } finally {
      setTimeout(() => {
        setPendingUpload((prev) => (prev?.id === tempUploadId ? null : prev));
      }, 240);
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

  const loadOriginalSource = async (sourceId: string) => {
    if (readOnly || hydratingSourceId) return;
    setHydratingSourceId(sourceId);
    setHydrateStatus('正在加载原文并写入知识库…');
    try {
      const res = await fetch(`/api/sources/${sourceId}/load-original`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHydrateStatus(data?.error ?? '加载原文失败，请手动下载后上传');
        return;
      }
      setHydrateStatus('原文已开始处理，完成后会显示为普通文档来源。');
      await fetchSources(false);
    } finally {
      setHydratingSourceId(null);
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

  const addWebSources = async () => {
    if (readOnly) return;
    const topic = webTopic.trim();
    if (!topic || webSearching) return;
    setWebSearching(true);
    setWebSearchStatus('联网检索中，正在抓取来源…');
    try {
      const res = await fetch('/api/sources/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId,
          topic,
          limit: MAX_WEB_SOURCES,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWebSearchStatus(data?.error ?? '联网检索失败');
        return;
      }
      const added = Number(data?.added ?? 0);
      const skipped = Number(data?.skipped ?? 0);
      setWebSearchStatus(
        `联网检索完成，新增 ${added} 条来源${skipped > 0 ? `，跳过 ${skipped} 条重复来源` : ''}`
      );
      await fetchSources(false);
    } finally {
      setWebSearching(false);
    }
  };

  const askPaperInsight = () => {
    window.dispatchEvent(
      new CustomEvent('chat-send-message', {
        detail: { message: '论文对比洞察' },
      })
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          知识库
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={askPaperInsight}
            className="h-7 rounded-full border border-gray-300 px-2 text-[11px] text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            title="论文对比洞察"
          >
            论文对比洞察
          </button>
          <Button variant="ghost" size="icon" onClick={() => void fetchSources(false)} aria-label="Refresh">
            <RefreshIcon />
          </Button>
        </div>
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
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/msword,.doc,text/x-python,.py,application/zip,.zip"
          className="hidden"
          onChange={uploadFile}
          disabled={uploading || readOnly}
        />
        {!readOnly && (
          <>
            <Button
              className="h-9 w-full bg-black text-xs text-white hover:bg-black/90"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? '上传中…' : '上传 PDF / Word / Python / Skills ZIP'}
            </Button>
            <div className="space-y-1">
              <div className="relative h-9 w-full">
                <input
                  value={webTopic}
                  onChange={(e) => setWebTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addWebSources();
                    }
                  }}
                  placeholder="联网检索，请输入你想要进一步拓展的内容"
                  className="h-9 w-full rounded-md border border-black bg-white px-3 pr-16 text-xs outline-none transition focus:border-black dark:border-black dark:bg-gray-900"
                  disabled={webSearching}
                />
                <button
                  type="button"
                  className="absolute bottom-1 right-1 top-1 rounded bg-black px-3 text-[11px] text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void addWebSources()}
                  disabled={webSearching || !webTopic.trim()}
                >
                  {webSearching ? '检索中…' : '检索'}
                </button>
              </div>
              {webSearchStatus ? (
                <p
                  className={`text-[11px] ${
                    webSearching
                      ? 'text-blue-600'
                      : webSearchStatus.includes('失败')
                        ? 'text-red-600'
                        : 'text-gray-500'
                  }`}
                >
                  {webSearchStatus}
                </p>
              ) : null}
            </div>
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
              {hydrateStatus ? (
                <p
                  className={`text-[11px] ${
                    /失败/i.test(hydrateStatus) ? 'text-red-600' : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {hydrateStatus}
                </p>
              ) : null}
              <div className="pt-1">
                <p className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  来源
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {researchState?.sourceStats
                    ? `数量：${sources.length}（初始 ${researchState.sourceStats.totalBefore} -> 清洗后 ${researchState.sourceStats.totalAfter}）`
                    : `数量：${sources.length}`}
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      <ScrollArea className="flex-1 p-2">
        {loading ? (
          <div className="p-2">
            <ShinyText text="Loading..." className="text-xs text-gray-500 dark:text-gray-400" />
          </div>
        ) : sources.length === 0 && !pendingUpload ? (
          <p className="p-2 text-xs text-gray-500 dark:text-gray-400">
            {readOnly ? '该共享 notebook 暂无可用来源。' : '还没有来源文件，先上传一个。'}
          </p>
        ) : (
          <ul className="space-y-2">
            {pendingUpload ? (
              <li key={pendingUpload.id}>
                <Card className="border-gray-200/80 bg-white/70 p-2 dark:border-gray-800 dark:bg-gray-900/60">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-gray-400" />
                      <p className="truncate text-xs font-medium" title={pendingUpload.filename}>
                        {pendingUpload.filename}
                      </p>
                    </div>
                    <Badge variant="secondary" className="uppercase">
                      上传中
                    </Badge>
                  </div>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-200"
                      style={{ width: `${pendingUpload.progress}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                    <span>正在上传文件…</span>
                    <span>{pendingUpload.progress}%</span>
                  </div>
                </Card>
              </li>
            ) : null}
            {sources.map((s) => (
              <li key={s.id}>
                <Card className="group border-gray-200/80 bg-white/70 p-2 dark:border-gray-800 dark:bg-gray-900/60">
                  {(() => {
                    const statusMeta = getSourceStatusMeta(s.status);
                    const isWebSource = s.sourceType === '联网检索';
                    const hostname = isWebSource ? extractHostname(s.fileUrl) : '';
                    const isRunning = s.status === 'PENDING' || s.status === 'PROCESSING';
                    const showStatus = isRunning || s.status === 'FAILED';
                    const shouldShowLoadOriginal = isWebSource && (s.chunkCount ?? 0) <= 1;
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
                          {shouldShowLoadOriginal ? (
                            <button
                              type="button"
                              onClick={() => void loadOriginalSource(s.id)}
                              disabled={Boolean(hydratingSourceId)}
                              className="inline-flex h-6 items-center gap-1 rounded border border-gray-300 px-2 text-[11px] text-gray-600 transition hover:bg-gray-100 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                            >
                              <DownloadIcon />
                              <span>{hydratingSourceId === s.id ? '处理中…' : '加载原文'}</span>
                            </button>
                          ) : (
                            <Badge variant="outline">{s.chunkCount ?? 0} chunks</Badge>
                          )}
                        </div>
                        {showStatus ? (
                          <p className={`mt-1 text-[11px] ${statusMeta.colorClass}`}>
                            {statusMeta.label}
                            {s.errorMessage ? ` — ${s.errorMessage}` : ''}
                          </p>
                        ) : null}
                        {isWebSource && (
                          <div className="mt-1 overflow-hidden transition-all duration-300 ease-out max-h-0 opacity-0 group-hover:max-h-44 group-hover:opacity-100">
                            <div className="rounded-md border border-gray-200 bg-gray-50 p-2 text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-300">
                              <div className="flex items-center gap-1 text-gray-700 dark:text-gray-200">
                                <InfoIcon />
                                <span>查看来源信息</span>
                              </div>
                              <p className="mt-1 truncate">域名：{hostname || '未知'}</p>
                              <p className="mt-1 truncate">时间：{formatTime(s.createdAt)}</p>
                              <p className="mt-1">
                                此来源当前仅为摘要。点击“加载原文”可自动下载并入库；若失败，请前往下载后再上传，可支持全文分析。
                              </p>
                              {s.fileUrl ? (
                                <a
                                  href={s.fileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 block truncate text-blue-600 underline dark:text-blue-400"
                                  onClick={(event) => event.stopPropagation()}
                                  title={s.fileUrl}
                                >
                                  来源链接：{s.fileUrl}
                                </a>
                              ) : null}
                            </div>
                          </div>
                        )}
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

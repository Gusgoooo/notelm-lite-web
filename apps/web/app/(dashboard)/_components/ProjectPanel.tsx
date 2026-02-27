'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { isAdminEmail } from '@/lib/admin';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import ShinyText from '@/components/ShinyText';

type Notebook = {
  id: string;
  title: string;
  description: string;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
};

type MarketNotebook = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  publishedAt: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  isMine?: boolean;
};

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '未发布';
  try {
    return new Date(value).toLocaleString('zh-CN');
  } catch {
    return value;
  }
}

export function ProjectPanel() {
  const router = useRouter();
  const { data: session } = useSession();

  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [market, setMarket] = useState<MarketNotebook[]>([]);

  const [loadingMine, setLoadingMine] = useState(true);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [researchTopic, setResearchTopic] = useState('');
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([
    '想研究AIGC和设计',
    '教育领域AI应用',
    '乡村振兴相关',
    '新媒体传播',
  ]);
  const [loadingSuggestedTopics, setLoadingSuggestedTopics] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [bootstrapError, setBootstrapError] = useState('');
  const [bootstrapStep, setBootstrapStep] = useState<0 | 1 | 2 | 3>(0);
  const [bootstrapHint, setBootstrapHint] = useState('');
  const [bootstrapProgress, setBootstrapProgress] = useState(0);
  const [bootstrapElapsed, setBootstrapElapsed] = useState(0);

  const bootstrapControllerRef = useRef<AbortController | null>(null);
  const bootstrapRunningRef = useRef(false);

  const fetchMine = async () => {
    setLoadingMine(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch('/api/notebooks', { cache: 'no-store', signal: controller.signal });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        const message =
          [data?.error, data?.detail].filter(Boolean).join(' — ') ||
          `加载 notebooks 失败 (${res.status})`;
        setError(message);
        setNotebooks([]);
        return;
      }
      setNotebooks(Array.isArray(data) ? data : []);
    } catch (e) {
      setNotebooks([]);
      if (e instanceof Error && e.name === 'AbortError') {
        setError('加载 notebooks 超时（15s），请检查数据库连接');
      } else {
        setError(e instanceof Error ? e.message : '加载 notebooks 失败');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setLoadingMine(false);
    }
  };

  const fetchMarket = async () => {
    setLoadingMarket(true);
    try {
      const res = await fetch('/api/notebooks/market', { cache: 'no-store' });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        setMarket([]);
        return;
      }
      setMarket(Array.isArray(data) ? data : []);
    } catch {
      setMarket([]);
    } finally {
      setLoadingMarket(false);
    }
  };

  const fetchSuggestedTopics = async () => {
    setLoadingSuggestedTopics(true);
    try {
      const res = await fetch('/api/notebooks/bootstrap/recommendations', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const topics = Array.isArray(data?.topics)
        ? data.topics
            .filter((item: unknown) => typeof item === 'string')
            .map((item: string) => item.trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];
      if (topics.length > 0) setSuggestedTopics(topics);
    } catch {
      // ignore and use fallback
    } finally {
      setLoadingSuggestedTopics(false);
    }
  };

  useEffect(() => {
    void Promise.all([fetchMine(), fetchMarket()]);
    void fetchSuggestedTopics();
  }, []);

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
    const target = bootstrapStep === 1 ? 34 : bootstrapStep === 2 ? 76 : bootstrapStep === 3 ? 100 : 0;
    const timer = window.setInterval(() => {
      setBootstrapProgress((prev) => {
        if (prev >= target) return prev;
        const delta = Math.max(1, Math.round((target - prev) / 10));
        return Math.min(target, prev + delta);
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [bootstrapOpen, bootstrapStep]);

  const closeBootstrapModal = (abort = true) => {
    if (abort) {
      bootstrapRunningRef.current = false;
      bootstrapControllerRef.current?.abort();
    }
    setBootstrapOpen(false);
    setBootstrapError('');
    setBootstrapStep(0);
    setBootstrapHint('');
    setBootstrapProgress(0);
    setBootstrapElapsed(0);
  };

  const createNotebook = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError([data?.error, data?.detail].filter(Boolean).join(' — ') || `创建失败 (${res.status})`);
        return;
      }
      router.push(`/?notebookId=${encodeURIComponent(data.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setCreating(false);
    }
  };

  const renameNotebook = async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/notebooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    });
    if (res.ok) {
      const updated = await res.json();
      setNotebooks((prev) => prev.map((n) => (n.id === id ? { ...n, title: updated.title } : n)));
      setEditingId(null);
    }
  };

  const deleteNotebook = async (id: string) => {
    const res = await fetch(`/api/notebooks/${id}`, { method: 'DELETE' });
    if (res.ok) setNotebooks((prev) => prev.filter((n) => n.id !== id));
  };

  const createNotebookFromTopic = async () => {
    const topic = researchTopic.trim();
    if (!topic) {
      setError('请先输入研究方向');
      return;
    }

    bootstrapRunningRef.current = true;
    setBootstrapOpen(true);
    setBootstrapError('');
    setBootstrapStep(1);
    setBootstrapHint('开始联网检索相关论文（最多 20 个来源），稍后您也可以自己上传论文补充。');

    try {
      const firstController = new AbortController();
      bootstrapControllerRef.current = firstController;
      const createRes = await fetch('/api/notebooks/bootstrap/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
        signal: firstController.signal,
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createData?.notebookId) {
        throw new Error(createData?.error ?? '创建并检索来源失败');
      }
      if (!bootstrapRunningRef.current) return;

      const notebookId = String(createData.notebookId);
      setBootstrapStep(2);
      setBootstrapHint('分析并延展研究方向中…');

      const secondController = new AbortController();
      bootstrapControllerRef.current = secondController;
      const dirRes = await fetch('/api/notebooks/bootstrap/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notebookId, topic }),
        signal: secondController.signal,
      });
      const dirData = await dirRes.json().catch(() => ({}));
      if (!dirRes.ok) {
        throw new Error(dirData?.error ?? '研究方向生成失败');
      }
      if (!bootstrapRunningRef.current) return;

      setBootstrapStep(3);
      setBootstrapHint('已完成，正在进入研究空间…');
      setBootstrapProgress(100);
      closeBootstrapModal(false);
      router.push(`/?notebookId=${encodeURIComponent(notebookId)}`);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return;
      }
      setBootstrapError(e instanceof Error ? e.message : '初始化失败，请稍后重试');
    } finally {
      bootstrapRunningRef.current = false;
      bootstrapControllerRef.current = null;
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="mx-auto max-w-7xl p-6 md:p-8">
        <div className="mb-4 flex items-start justify-end gap-4">
          <div className="text-right">
            {session?.user?.email && (
              <div className="group inline-flex flex-col items-end">
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{session.user.email}</p>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="mt-1 hidden text-xs text-gray-500 underline hover:text-gray-700 group-hover:block dark:text-gray-400 dark:hover:text-gray-200"
                >
                  退出登录
                </button>
              </div>
            )}
            {isAdminEmail(session?.user?.email) && (
              <Link
                href="/admin/settings"
                className="mb-1 block text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Agent 管理后台
              </Link>
            )}
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="space-y-6">
          <section>
            <div className="mx-auto max-w-[900px]">
              <h1 className="text-center text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                研脉Notebook·万物皆可研究
              </h1>
              <form
                className="relative mx-auto mt-4 w-full max-w-[860px]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createNotebookFromTopic();
                }}
              >
              <textarea
                value={researchTopic}
                onChange={(event) => setResearchTopic(event.target.value)}
                placeholder="请简单输入你感兴趣的研究方向"
                className="h-[128px] w-full resize-none rounded-[20px] border border-gray-200 bg-gray-50 px-4 pb-12 pt-4 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-300 focus:bg-white dark:border-gray-700 dark:bg-gray-900/80 dark:text-gray-100 dark:focus:border-gray-600 dark:focus:bg-gray-900"
              />
              <button
                type="submit"
                disabled={!researchTopic.trim() || bootstrapStep === 1 || bootstrapStep === 2}
                className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="新建Note"
                title="新建Note"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M12 19V6" />
                  <path d="m6 12 6-6 6 6" />
                </svg>
              </button>
              </form>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {loadingSuggestedTopics ? (
                  <ShinyText text="正在生成推荐研究方向..." className="text-xs text-gray-500 dark:text-gray-400" />
                ) : (
                  suggestedTopics.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setResearchTopic(preset)}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {preset}
                  </button>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-800 dark:bg-gray-900/40">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">我的Notebook</h2>
              <Button size="sm" onClick={createNotebook} disabled={creating}>
                {creating ? '创建中…' : '新建空白notebook'}
              </Button>
            </div>

            {loadingMine ? (
              <ShinyText text="Loading notebooks..." className="text-sm text-gray-500 dark:text-gray-400" />
            ) : notebooks.length === 0 ? (
              <Card className="border-dashed bg-white/60 dark:bg-gray-900/40">
                <CardContent className="p-10 text-center text-sm text-gray-500 dark:text-gray-400">
                  还没有 notebook，先创建一个开始使用。
                </CardContent>
              </Card>
            ) : (
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {notebooks.map((nb) => (
                  <li key={nb.id}>
                    <Card
                      className="group h-full cursor-pointer transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
                      onClick={() => router.push(`/?notebookId=${encodeURIComponent(nb.id)}`)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {editingId === nb.id ? (
                              <Input
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onBlur={() => void renameNotebook(nb.id, editTitle)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void renameNotebook(nb.id, editTitle);
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <CardTitle className="truncate">{nb.title}</CardTitle>
                            )}
                          </div>

                          <details
                            className="relative z-20"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <summary className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200">
                              <MoreIcon />
                            </summary>
                            <div className="absolute right-0 top-8 w-28 rounded-md border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(nb.id);
                                  setEditTitle(nb.title);
                                }}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                              >
                                <EditIcon />
                                重命名
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteNotebook(nb.id)}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                              >
                                <TrashIcon />
                                删除
                              </button>
                            </div>
                          </details>
                        </div>

                        <div className="mt-1 flex items-center gap-2">
                          <CardDescription>创建于 {formatTime(nb.createdAt)}</CardDescription>
                          {nb.isPublished ? (
                            <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-300">
                              已发布
                            </span>
                          ) : null}
                        </div>
                        {nb.description ? (
                          <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{nb.description}</p>
                        ) : (
                          <p className="line-clamp-2 text-xs text-gray-400 dark:text-gray-500">暂无简介</p>
                        )}
                      </CardHeader>
                      <CardContent className="p-0" />
                      <CardFooter className="mt-auto justify-end pt-2">
                        <span className="text-xs text-gray-400 opacity-0 transition group-hover:opacity-100 dark:text-gray-500">
                          点击进入
                        </span>
                      </CardFooter>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-800 dark:bg-gray-900/40">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">知识库市场</h2>
            </div>

            {loadingMarket ? (
              <ShinyText text="Loading market..." className="text-sm text-gray-500 dark:text-gray-400" />
            ) : market.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">市场里还没有可浏览的公开 notebook。</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {market.map((nb) => (
                  <li key={nb.id}>
                    <Card className="h-full">
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-2">
                          <CardTitle className="truncate">{nb.title}</CardTitle>
                          {nb.isMine ? (
                            <span className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-medium text-gray-700 dark:bg-white/10 dark:text-gray-200">
                              我发布的
                            </span>
                          ) : null}
                        </div>
                        <CardDescription>
                          发布者 {nb.ownerName?.trim() || nb.ownerEmail?.trim() || '匿名用户'} · {formatTime(nb.publishedAt)}
                        </CardDescription>
                        <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                          {nb.description?.trim() || '暂无简介'}
                        </p>
                      </CardHeader>
                      <CardFooter>
                        <Button size="sm" onClick={() => router.push(`/?notebookId=${encodeURIComponent(nb.id)}`)}>
                          打开并查看
                        </Button>
                      </CardFooter>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {bootstrapOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">正在创建研究 Notebook</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{bootstrapHint}</p>
              </div>
              <button
                type="button"
                onClick={() => closeBootstrapModal(true)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                aria-label="关闭进程"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="relative h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-500 to-indigo-500 transition-all duration-500"
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
              {[
                '开始联网检索相关论文（最多20个来源）',
                '分析并延展研究方向',
                '完成',
              ].map((label, idx) => {
                const stepNumber = (idx + 1) as 1 | 2 | 3;
                const done = bootstrapStep > stepNumber;
                const running = bootstrapStep === stepNumber;
                return (
                  <div
                    key={label}
                    className={`flex items-center gap-2 rounded border px-2 py-2 text-xs ${
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
              <Button variant="ghost" onClick={() => closeBootstrapModal(true)}>
                退出进程
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

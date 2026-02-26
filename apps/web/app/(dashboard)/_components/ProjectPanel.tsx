'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { isAdminEmail } from '@/lib/admin';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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
};

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
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

  const fetchMine = async () => {
    setLoadingMine(true);
    try {
      const res = await fetch('/api/notebooks', { cache: 'no-store' });
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
      setError(e instanceof Error ? e.message : '加载 notebooks 失败');
    } finally {
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

  useEffect(() => {
    void Promise.all([fetchMine(), fetchMarket()]);
  }, []);

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

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="mx-auto max-w-7xl p-6 md:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 md:text-3xl">
              Panel
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              管理我的 notebook，并浏览知识库市场中的公开内容。
            </p>
          </div>
          <div className="text-right">
            {session?.user?.email && (
              <p className="mb-2 truncate text-xs text-gray-500 dark:text-gray-400">{session.user.email}</p>
            )}
            {isAdminEmail(session?.user?.email) && (
              <Link
                href="/admin/settings"
                className="mb-1 block text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Agent 管理后台
              </Link>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={() => signOut({ callbackUrl: '/login' })}
            >
              退出登录
            </Button>
          </div>
        </div>

        <div className="mb-5 flex items-center gap-3">
          <Button onClick={createNotebook} disabled={creating}>
            {creating ? '创建中…' : '新建 Notebook'}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => void Promise.all([fetchMine(), fetchMarket()])}
            aria-label="Refresh"
          >
            <RefreshIcon />
          </Button>
        </div>

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="grid min-h-[calc(100vh-210px)] grid-rows-[2fr_1fr] gap-6">
          <section className="rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-gray-800 dark:bg-gray-900/40">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">我的 Notes</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">管理自己的 notebooks</p>
            </div>

            {loadingMine ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading notebooks…</p>
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
                    <Card className="h-full">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
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
                            />
                          ) : (
                            <CardTitle className="truncate">{nb.title}</CardTitle>
                          )}
                          {nb.isPublished ? (
                            <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-300">
                              已发布
                            </span>
                          ) : null}
                        </div>
                        <CardDescription>创建于 {formatTime(nb.createdAt)}</CardDescription>
                        {nb.description ? (
                          <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{nb.description}</p>
                        ) : null}
                      </CardHeader>
                      <CardContent />
                      <CardFooter className="mt-auto gap-2">
                        <Button size="sm" onClick={() => router.push(`/?notebookId=${encodeURIComponent(nb.id)}`)}>
                          打开
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditingId(nb.id);
                            setEditTitle(nb.title);
                          }}
                        >
                          重命名
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void deleteNotebook(nb.id)}>
                          删除
                        </Button>
                      </CardFooter>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white/70 p-4 dark:border-gray-800 dark:bg-gray-900/40">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">知识库市场</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">浏览别人分享的 notebooks</p>
            </div>

            {loadingMarket ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading market…</p>
            ) : market.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">市场里还没有可浏览的公开 notebook。</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {market.map((nb) => (
                  <li key={nb.id}>
                    <Card className="h-full">
                      <CardHeader className="pb-2">
                        <CardTitle className="truncate">{nb.title}</CardTitle>
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
    </div>
  );
}

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
  createdAt: string;
};

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function ProjectPanel() {
  const router = useRouter();
  const { data: session } = useSession();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const fetchNotebooks = async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('/api/notebooks', {
        signal: controller.signal,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotebooks([]);
        setError(
          [data?.error, data?.detail].filter(Boolean).join(' — ') ||
            `加载 notebooks 失败 (${res.status})`
        );
        return;
      }
      setNotebooks(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setError('加载 notebooks 超时（8s），请检查 web 服务与数据库连接');
      } else {
        setError(e instanceof Error ? e.message : '加载 notebooks 失败');
      }
      setNotebooks([]);
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchNotebooks();
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
      <div className="mx-auto max-w-6xl p-6 md:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 md:text-3xl">
              Project Panel
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              新建或管理 notebooks，点击后进入问答工作台。
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
            {creating ? '创建中…' : 'New Notebook'}
          </Button>
          <Button variant="secondary" size="icon" onClick={() => void fetchNotebooks()} aria-label="Refresh">
            <RefreshIcon />
          </Button>
        </div>

        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading notebooks…</p>
        ) : notebooks.length === 0 ? (
          <Card className="border-dashed bg-white/60 dark:bg-gray-900/40">
            <CardContent className="p-10 text-center text-sm text-gray-500 dark:text-gray-400">
              还没有 notebook，先创建一个开始使用。
            </CardContent>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {notebooks.map((nb) => (
              <li key={nb.id}>
                <Card className="h-full">
                  <CardHeader className="pb-2">
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
                    <CardDescription>
                      Created {new Date(nb.createdAt).toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent />
                  <CardFooter className="mt-auto gap-2">
                    <Button
                      size="sm"
                      onClick={() => router.push(`/?notebookId=${encodeURIComponent(nb.id)}`)}
                    >
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
      </div>
    </div>
  );
}

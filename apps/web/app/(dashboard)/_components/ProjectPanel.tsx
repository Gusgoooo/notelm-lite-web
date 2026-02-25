'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { isAdminEmail } from '@/lib/admin';

type Notebook = {
  id: string;
  title: string;
  createdAt: string;
};

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
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
    if (res.ok) {
      setNotebooks((prev) => prev.filter((n) => n.id !== id));
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-gray-50/40 dark:bg-gray-900/30">
      <div className="max-w-6xl mx-auto p-6 md:p-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-gray-100">
              Project Panel
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              新建或管理你的 notebooks，点击后进入问答工作台。
            </p>
          </div>
          <div className="text-right">
            {session?.user?.email && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{session.user.email}</p>
            )}
            {isAdminEmail(session?.user?.email) && (
              <Link
                href="/admin/settings"
                className="block mb-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Agent 管理后台
              </Link>
            )}
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            >
              退出登录
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={createNotebook}
            disabled={creating}
            className="px-4 py-2 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-sm font-medium disabled:opacity-50"
          >
            {creating ? '创建中…' : '+ New notebook'}
          </button>
          <button
            type="button"
            onClick={() => fetchNotebooks()}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshIcon />
          </button>
        </div>

        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading notebooks…</p>
        ) : notebooks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500 dark:text-gray-400 bg-white/60 dark:bg-gray-800/40">
            还没有 notebook，先创建一个开始使用。
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {notebooks.map((nb) => (
              <li
                key={nb.id}
                className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col gap-3"
              >
                {editingId === nb.id ? (
                  <input
                    className="w-full py-2 px-3 text-sm border rounded bg-white dark:bg-gray-800"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => renameNotebook(nb.id, editTitle)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void renameNotebook(nb.id, editTitle);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <h3 className="text-sm font-medium truncate text-gray-900 dark:text-gray-100">
                    {nb.title}
                  </h3>
                )}

                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Created {new Date(nb.createdAt).toLocaleString()}
                </p>

                <div className="mt-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => router.push(`/?notebookId=${encodeURIComponent(nb.id)}`)}
                    className="px-3 py-1.5 rounded bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-xs font-medium"
                  >
                    打开
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(nb.id);
                      setEditTitle(nb.title);
                    }}
                    className="px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700 text-xs hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteNotebook(nb.id)}
                    className="px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700 text-xs hover:text-red-600"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

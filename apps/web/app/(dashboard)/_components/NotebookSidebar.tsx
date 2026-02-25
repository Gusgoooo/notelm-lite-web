'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

type Notebook = { id: string; title: string; createdAt: string };

export function NotebookSidebar() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const notebookIdFromUrl = searchParams.get('notebookId');
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(notebookIdFromUrl);
  useEffect(() => {
    setSelectedId(notebookIdFromUrl);
  }, [notebookIdFromUrl]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const fetchNotebooks = async () => {
    const res = await fetch('/api/notebooks');
    if (res.ok) {
      const data = await res.json();
      setNotebooks(data);
    }
  };

  useEffect(() => {
    fetchNotebooks();
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
      if (res.ok) {
        const nb = data;
        setNotebooks((prev) => [nb, ...prev]);
        setSelectedId(nb.id);
        router.push(`/?notebookId=${encodeURIComponent(nb.id)}`);
      } else {
        setError([data?.error, data?.detail].filter(Boolean).join(' — ') || `创建失败 (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setCreating(false);
    }
  };

  const renameNotebook = async (id: string, title: string) => {
    const res = await fetch(`/api/notebooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      const updated = await res.json();
      setNotebooks((prev) =>
        prev.map((n) => (n.id === id ? { ...n, title: updated.title } : n))
      );
      setEditingId(null);
    }
  };

  const deleteNotebook = async (id: string) => {
    const res = await fetch(`/api/notebooks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setNotebooks((prev) => prev.filter((n) => n.id !== id));
      if (selectedId === id) setSelectedId(null);
    }
  };

  const startEdit = (nb: Notebook) => {
    setEditingId(nb.id);
    setEditTitle(nb.title);
  };

  const submitEdit = (id: string) => {
    if (editTitle.trim()) renameNotebook(id, editTitle.trim());
    else setEditingId(null);
  };

  return (
    <>
      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          Notebooks
        </h2>
        <button
          type="button"
          onClick={createNotebook}
          disabled={creating}
          className="w-full py-2 px-3 rounded-md bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium disabled:opacity-50"
        >
          {creating ? 'Creating…' : '+ New notebook'}
        </button>
        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
      <ul className="flex-1 overflow-auto p-2 space-y-0.5">
        {notebooks.map((nb) => (
          <li key={nb.id} className="group flex items-center gap-1 rounded-md">
            {editingId === nb.id ? (
              <input
                className="flex-1 min-w-0 py-1.5 px-2 text-sm border rounded bg-white dark:bg-gray-800"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => submitEdit(nb.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitEdit(nb.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                autoFocus
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(nb.id);
                    router.push(notebookIdFromUrl === nb.id ? '/' : `/?notebookId=${encodeURIComponent(nb.id)}`);
                  }}
                  onDoubleClick={() => startEdit(nb)}
                  className={`flex-1 min-w-0 text-left py-2 px-3 rounded text-sm truncate ${
                    selectedId === nb.id
                      ? 'bg-gray-200 dark:bg-gray-700'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {nb.title}
                </button>
                <div className="opacity-0 group-hover:opacity-100 flex shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(nb)}
                    className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xs"
                    aria-label="Rename"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteNotebook(nb.id)}
                    className="p-1 text-gray-500 hover:text-red-600 text-xs"
                    aria-label="Delete"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {selectedId && (
        <div className="p-2 border-t border-gray-200 dark:border-gray-800">
          <Link
            href={`/dev/sources?notebookId=${encodeURIComponent(selectedId)}`}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            View sources
          </Link>
        </div>
      )}
      <div className="p-2 border-t border-gray-200 dark:border-gray-800">
        {session?.user?.email && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate" title={session.user.email}>
            {session.user.email}
          </p>
        )}
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mt-0.5"
        >
          退出登录
        </button>
      </div>
    </>
  );
}

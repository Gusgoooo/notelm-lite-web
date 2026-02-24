"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { parseJsonResponse } from "@/lib/api";

const DEV_USER_ID = process.env.NEXT_PUBLIC_DEV_USER_ID ?? "dev-user";

interface Notebook {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

function apiHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-User-Id": DEV_USER_ID,
  };
}

export default function NotebooksPage() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  const fetchNotebooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notebooks", {
        headers: apiHeaders(),
      });
      if (!res.ok) throw new Error(res.statusText);
      const data = await parseJsonResponse<Notebook[]>(res);
      setNotebooks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notebooks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotebooks();
  }, [fetchNotebooks]);

  const createNotebook = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim() || "Untitled";
    setTitle("");
    try {
      const res = await fetch("/api/notebooks", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ title: t }),
      });
      if (!res.ok) throw new Error(res.statusText);
      await fetchNotebooks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    }
  };

  const deleteNotebook = async (id: string) => {
    try {
      const res = await fetch(`/api/notebooks/${id}`, {
        method: "DELETE",
        headers: apiHeaders(),
      });
      if (!res.ok) throw new Error(res.statusText);
      await fetchNotebooks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <nav className="mb-6">
        <Link href="/" className="text-slate-600 hover:text-slate-900">
          ← Home
        </Link>
      </nav>
      <h1 className="text-2xl font-semibold mb-4">Notebooks</h1>

      <form onSubmit={createNotebook} className="flex gap-2 mb-6">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Notebook title"
          className="flex-1 border border-slate-300 rounded px-3 py-2"
        />
        <button
          type="submit"
          className="bg-slate-800 text-white rounded px-4 py-2 hover:bg-slate-700"
        >
          Create
        </button>
      </form>

      {error && (
        <p className="text-red-600 text-sm mb-4" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : notebooks.length === 0 ? (
        <p className="text-slate-500">No notebooks yet. Create one above.</p>
      ) : (
        <ul className="space-y-2">
          {notebooks.map((nb) => (
            <li
              key={nb.id}
              className="flex items-center justify-between border border-slate-200 rounded px-3 py-2"
            >
              <Link href={`/notebooks/${nb.id}`} className="font-medium hover:underline">
                {nb.title}
              </Link>
              <span className="flex items-center gap-2">
                <Link
                  href={`/notebooks/${nb.id}`}
                  className="text-slate-600 hover:text-slate-900 text-sm"
                >
                  Open
                </Link>
                <button
                type="button"
                onClick={() => deleteNotebook(nb.id)}
                  className="text-red-600 hover:text-red-800 text-sm"
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

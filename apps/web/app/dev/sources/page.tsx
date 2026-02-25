'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';

type Source = {
  id: string;
  notebookId: string;
  filename: string;
  fileUrl: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function DevSourcesContent() {
  const searchParams = useSearchParams();
  const notebookId = searchParams.get('notebookId');
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const fetchSources = async (showLoading = false) => {
    if (!notebookId) return;
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/sources?notebookId=${encodeURIComponent(notebookId)}`);
      const data = await res.json();
      setSources(Array.isArray(data) ? data : []);
      setLastUpdatedAt(new Date());
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources(true);
  }, [notebookId]);

  useEffect(() => {
    if (!notebookId) return;
    const timer = setInterval(() => {
      const hasInflight = sources.some((s) => s.status === 'PENDING' || s.status === 'PROCESSING');
      if (hasInflight) void fetchSources(false);
    }, 3000);
    return () => clearInterval(timer);
  }, [notebookId, sources]);

  const requeue = async (id: string) => {
    await fetch(`/api/sources/${id}/requeue`, { method: 'POST' });
    await fetchSources(false);
  };

  if (!notebookId) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Add ?notebookId=... to the URL, or select a notebook and open Sources.</p>
        <Link href="/" className="text-blue-600 hover:underline mt-2 inline-block">Back to app</Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-4">
        <Link href="/" className="text-blue-600 hover:underline">Back to app</Link>
        <h1 className="text-lg font-semibold">Sources (notebook: {notebookId})</h1>
        <button
          type="button"
          onClick={() => fetchSources(false)}
          className="h-7 w-7 inline-flex items-center justify-center rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
        {lastUpdatedAt && (
          <span className="text-xs text-gray-500">
            updated {lastUpdatedAt.toLocaleTimeString()}
          </span>
        )}
      </div>
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-4 p-3 rounded border border-gray-200 dark:border-gray-700"
            >
              <div className="min-w-0">
                <span className="font-medium truncate block">{s.filename}</span>
                <span className={`text-sm ${
                  s.status === 'READY'
                    ? 'text-green-600'
                    : s.status === 'FAILED'
                      ? 'text-red-600'
                      : s.status === 'PROCESSING'
                        ? 'text-blue-600'
                        : 'text-gray-500'
                }`}>
                  {s.status}
                  {s.errorMessage ? ` — ${s.errorMessage}` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => requeue(s.id)}
                className="shrink-0 py-1 px-2 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                Re-queue
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && sources.length === 0 && (
        <p className="text-gray-500">No sources yet. Upload a PDF from the app.</p>
      )}
    </div>
  );
}

export default function DevSourcesPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <DevSourcesContent />
    </Suspense>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { parseJsonResponse } from "@/lib/api";

const DEV_USER_ID = process.env.NEXT_PUBLIC_DEV_USER_ID ?? "dev-user";

interface Source {
  id: string;
  notebookId: string;
  type: string;
  title: string;
  originalName?: string;
  status: string;
  errorMessage?: string;
  chunkCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface Notebook {
  id: string;
  title: string;
}

interface SearchItem {
  chunkId: string;
  sourceId: string;
  segmentId: string | null;
  pageOrIndex: number | null;
  snippet: string | null;
  text: string;
}

interface CitationShape {
  chunkId: string;
  sourceId: string;
  pageOrIndex: number | null;
  snippet: string | null;
}

interface AskResponse {
  mode: "llm" | "evidence";
  answer: string | null;
  citations: CitationShape[];
  evidence: CitationShape[];
}

function apiHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-User-Id": DEV_USER_ID,
  };
}

function StatusPill({
  status,
  errorMessage,
}: {
  status: string;
  errorMessage?: string;
}) {
  const styles: Record<string, string> = {
    processing: "bg-amber-100 text-amber-800",
    ready: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    pending: "bg-slate-100 text-slate-800",
  };
  const cls = styles[status] ?? "bg-slate-100 text-slate-800";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
      title={errorMessage}
    >
      {status}
    </span>
  );
}

export default function NotebookWorkspacePage() {
  const params = useParams();
  const id = params.id as string;
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Search (left)
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedChunkIds, setSelectedChunkIds] = useState<Set<string>>(new Set());

  // Note (right) – client-side only for now
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");

  // Ask (bottom)
  const [question, setQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const fetchNotebook = useCallback(async () => {
    const res = await fetch("/api/notebooks", { headers: apiHeaders() });
    if (!res.ok) return;
    const list = await parseJsonResponse<{ id: string; title: string }[]>(res);
    const nb = list.find((n) => n.id === id);
    setNotebook(nb ?? null);
  }, [id]);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sources?notebookId=${encodeURIComponent(id)}`,
        { headers: apiHeaders() }
      );
      if (!res.ok) throw new Error(res.statusText);
      const data = await parseJsonResponse<Source[]>(res);
      setSources(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sources");
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      await fetchNotebook();
      if (cancelled) return;
      await fetchSources();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchNotebook, fetchSources]);

  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchResults([]);
    setAskError(null);
    try {
      const res = await fetch(
        `/api/search?notebookId=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}&k=15`,
        { headers: apiHeaders() }
      );
      if (!res.ok) throw new Error(res.statusText);
      const data = await parseJsonResponse<{ items: SearchItem[] }>(res);
      setSearchResults(data.items ?? []);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }, [id, searchQuery]);

  const toggleChunk = useCallback((chunkId: string) => {
    setSelectedChunkIds((prev) => {
      const next = new Set(prev);
      if (next.has(chunkId)) next.delete(chunkId);
      else next.add(chunkId);
      return next;
    });
  }, []);

  const selectedCitations: CitationShape[] = searchResults.filter((r) =>
    selectedChunkIds.has(r.chunkId)
  ).map((r) => ({
    chunkId: r.chunkId,
    sourceId: r.sourceId,
    pageOrIndex: r.pageOrIndex,
    snippet: r.snippet,
  }));

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    setAskLoading(true);
    setAskResult(null);
    setAskError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ notebookId: id, question: q }),
      });
      if (!res.ok) throw new Error(res.statusText);
      const data = await parseJsonResponse<AskResponse>(res);
      setAskResult(data);
    } catch (e) {
      setAskError(e instanceof Error ? e.message : "Ask failed");
    } finally {
      setAskLoading(false);
    }
  }, [id, question]);

  const onUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement;
    if (!fileInput?.files?.length) return;
    const file = fileInput.files[0];
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are allowed.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("notebookId", id);
      body.append("file", file);
      const res = await fetch("/api/sources/upload", {
        method: "POST",
        headers: apiHeaders(),
        body,
      });
      if (!res.ok) {
        const data = await parseJsonResponse<{ error?: string }>(res).catch(
          () => ({})
        );
        throw new Error(data?.error ?? res.statusText);
      }
      await fetchSources();
      fileInput.value = "";
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  if (loading && !notebook) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  if (!notebook) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-red-600">Notebook not found.</p>
        <Link
          href="/notebooks"
          className="text-slate-600 hover:underline mt-2 inline-block"
        >
          ← Back to notebooks
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/notebooks"
            className="text-slate-600 hover:text-slate-900 text-sm"
          >
            ← Notebooks
          </Link>
          <h1 className="text-lg font-semibold">{notebook.title}</h1>
        </div>
        {error && (
          <p className="text-red-600 text-sm" role="alert">
            {error}
          </p>
        )}
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Left: search + result list */}
        <aside className="w-80 shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-100">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Search sources
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Search in notebook…"
                className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={runSearch}
                disabled={searching}
                className="bg-slate-700 text-white rounded px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-50"
              >
                {searching ? "…" : "Search"}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {searchResults.length === 0 && !searching && (
              <p className="text-slate-500 text-sm p-2">
                Enter a query and search to see chunks. Select items to add them
                to the note citations.
              </p>
            )}
            {searchResults.length > 0 && (
              <ul className="space-y-1">
                {searchResults.map((item) => (
                  <li key={item.chunkId} className="flex gap-2 items-start">
                    <input
                      type="checkbox"
                      checked={selectedChunkIds.has(item.chunkId)}
                      onChange={() => toggleChunk(item.chunkId)}
                      className="mt-1.5 shrink-0"
                    />
                    <div className="min-w-0 text-sm">
                      <span className="text-slate-500 text-xs">
                        p.{item.pageOrIndex ?? "—"}
                      </span>{" "}
                      <span className="text-slate-800 line-clamp-3">
                        {item.snippet ?? item.text}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="p-2 border-t border-slate-100">
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600 hover:text-slate-800">
                Upload PDF
              </summary>
              <form onSubmit={onUpload} className="mt-2 flex flex-wrap gap-2">
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  className="text-sm max-w-full"
                />
                <button
                  type="submit"
                  disabled={uploading}
                  className="bg-slate-700 text-white rounded px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
              </form>
              {uploadSuccess && (
                <p className="text-green-600 text-xs mt-1">Uploaded.</p>
              )}
              {sources.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  {sources.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className="truncate">{s.title}</span>
                      <StatusPill status={s.status} errorMessage={s.errorMessage} />
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </div>
        </aside>

        {/* Right: note panel */}
        <section className="flex-1 flex flex-col min-w-0 border-r border-slate-200 bg-white">
          <div className="p-4 border-b border-slate-100">
            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Note title"
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-medium placeholder:text-slate-400"
            />
          </div>
          <div className="flex-1 p-4 min-h-0">
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Note body…"
              className="w-full h-full min-h-[120px] border border-slate-200 rounded px-3 py-2 text-sm resize-none"
            />
          </div>
          <div className="shrink-0 border-t border-slate-200 p-4">
            <h3 className="text-sm font-medium text-slate-700 mb-2">
              Citations ({selectedCitations.length})
            </h3>
            {selectedCitations.length === 0 ? (
              <p className="text-slate-500 text-sm">
                Select chunks from search results to add citations.
              </p>
            ) : (
              <ul className="space-y-2 max-h-40 overflow-y-auto">
                {selectedCitations.map((c, i) => (
                  <li
                    key={c.chunkId}
                    className="text-sm border-l-2 border-slate-200 pl-2 py-1"
                  >
                    <span className="text-slate-500 text-xs">
                      [{i + 1}] p.{c.pageOrIndex ?? "—"}
                    </span>{" "}
                    <span className="text-slate-700 line-clamp-2">
                      {c.snippet ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Bottom: Ask panel */}
      <footer className="shrink-0 border-t border-slate-200 bg-white p-4">
        <div className="max-w-4xl mx-auto">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Ask
          </label>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && ask()}
              placeholder="Ask a question about your sources…"
              className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={ask}
              disabled={askLoading}
              className="bg-slate-800 text-white rounded px-4 py-2 text-sm hover:bg-slate-700 disabled:opacity-50"
            >
              {askLoading ? "…" : "Ask"}
            </button>
          </div>
          {askError && (
            <p className="text-red-600 text-sm mb-2" role="alert">
              {askError}
            </p>
          )}
          {askResult && (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
              {askResult.mode === "evidence" && (
                <p className="text-amber-700 text-xs mb-2">
                  Evidence-only mode (no LLM answer).
                </p>
              )}
              {askResult.answer != null ? (
                <p className="text-slate-800 whitespace-pre-wrap mb-3">
                  {askResult.answer}
                </p>
              ) : null}
              <div>
                <span className="font-medium text-slate-700">Evidence / citations:</span>
                <ul className="mt-1 space-y-1">
                  {askResult.evidence.map((c, i) => (
                    <li
                      key={`${c.chunkId}-${i}`}
                      className="border-l-2 border-slate-300 pl-2 text-slate-600 line-clamp-2"
                    >
                      p.{c.pageOrIndex ?? "—"} {c.snippet ?? ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </footer>
    </main>
  );
}

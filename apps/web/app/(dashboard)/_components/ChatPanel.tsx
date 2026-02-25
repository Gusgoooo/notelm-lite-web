'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Citation = {
  sourceId: string;
  sourceTitle: string;
  pageStart?: number;
  pageEnd?: number;
  snippet: string;
  fullContent?: string;
  score?: number;
  distance?: number;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  createdAt?: string;
  conversationId?: string;
};

const HISTORY_PAGE_SIZE = 20;

function buildNoteTitleFromAnswer(content: string): string {
  const line = content
    .split('\n')
    .map((v) => v.trim())
    .find(Boolean);
  const cleaned = (line ?? '')
    .replace(/^#+\s*/, '')
    .replace(/[*_`~]/g, '')
    .trim();
  return cleaned ? cleaned.slice(0, 28) : '聊天摘录';
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="my-1 leading-6">{children}</p>,
        ul: ({ children }) => <ul className="my-1 list-disc pl-5 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="my-1 list-decimal pl-5 space-y-1">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        h1: ({ children }) => <h1 className="text-base font-semibold mt-2 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-semibold mt-2 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 dark:text-blue-400 underline"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[12px]">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="my-2 p-2 rounded bg-gray-200/70 dark:bg-gray-700/70 overflow-auto text-xs">
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function ChatPanel({ notebookId }: { notebookId: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [tailVersion, setTailVersion] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchHistoryPage = useCallback(
    async (page: number, reset: boolean) => {
      if (!notebookId) return;
      if (reset) setLoadingHistory(true);
      else setLoadingMore(true);
      try {
        const res = await fetch(
          `/api/chat/history?notebookId=${encodeURIComponent(notebookId)}&page=${page}&pageSize=${HISTORY_PAGE_SIZE}`,
          { cache: 'no-store' }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (reset) setMessages([]);
          setHistoryError(data?.error ?? '加载聊天历史失败');
          return;
        }
        setHistoryError('');
        const batch = Array.isArray(data?.messages) ? (data.messages as Message[]) : [];
        const chronological = [...batch].reverse();
        if (reset) {
          setMessages(chronological);
          setConversationId(
            typeof data?.latestConversationId === 'string' ? data.latestConversationId : null
          );
          setTailVersion((v) => v + 1);
        } else {
          setMessages((prev) => [...chronological, ...prev]);
        }
        setHasMore(Boolean(data?.hasMore));
        setHistoryPage(page);
      } finally {
        if (reset) setLoadingHistory(false);
        else setLoadingMore(false);
      }
    },
    [notebookId]
  );

  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setHasMore(false);
    setHistoryPage(0);
    setHistoryError('');
    if (notebookId) {
      void fetchHistoryPage(0, true);
    }
  }, [notebookId, fetchHistoryPage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tailVersion]);

  const send = async () => {
    const text = input.trim();
    if (!text || !notebookId || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }]);
    setTailVersion((v) => v + 1);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId,
          conversationId,
          userMessage: text,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: `Error: ${err.error ?? res.statusText}`,
          },
        ]);
        setTailVersion((v) => v + 1);
        return;
      }
      const data = await res.json();
      setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.answer,
          citations: Array.isArray(data.citations) ? data.citations : [],
        },
      ]);
      setTailVersion((v) => v + 1);
    } finally {
      setLoading(false);
    }
  };

  if (!notebookId) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="h-14 px-4 border-b border-gray-200 dark:border-gray-800 flex items-center">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Chat
          </h2>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
          Select a notebook to start chatting.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-14 px-4 border-b border-gray-200 dark:border-gray-800 flex items-center">
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Q&A
        </h2>
      </div>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {loadingHistory ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">Loading chat history…</p>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void fetchHistoryPage(historyPage + 1, false)}
                  disabled={loadingMore}
                  className="text-xs px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {loadingMore ? '加载中…' : '加载更早记录'}
                </button>
              </div>
            )}
            {historyError && (
              <p className="text-xs text-red-600 dark:text-red-400 text-center">{historyError}</p>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg p-3 max-w-[85%] ${
                  m.role === 'user'
                    ? 'bg-gray-200 dark:bg-gray-700 mr-0 ml-auto'
                    : 'bg-gray-100 dark:bg-gray-800 ml-0 mr-auto'
                }`}
              >
                <div className="text-sm">
                  <MarkdownContent content={m.content} />
                </div>
                {m.role === 'assistant' && (
                  <>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!notebookId) return;
                          const title = buildNoteTitleFromAnswer(m.content);
                          const content =
                            m.content +
                            (m.citations && m.citations.length > 0
                              ? '\n\n## Sources\n\n' +
                                m.citations
                                  .map(
                                    (c) =>
                                      `- **${c.sourceTitle}**${
                                        c.pageStart != null
                                          ? ` (p.${c.pageStart}${
                                              c.pageEnd != null && c.pageEnd !== c.pageStart
                                                ? `-${c.pageEnd}`
                                                : ''
                                            })`
                                          : ''
                                      }\n  ${c.snippet}`
                                  )
                                  .join('\n')
                              : '');
                          const res = await fetch(
                            `/api/notebooks/${encodeURIComponent(notebookId)}/notes`,
                            {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ title, content }),
                            }
                          );
                          if (res.ok) window.dispatchEvent(new CustomEvent('notes-updated'));
                        }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        保存到笔记
                      </button>
                    </div>
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          引用来源
                        </span>
                        <ul className="mt-1 space-y-1">
                          {m.citations.map((c, i) => (
                            <li key={i} className="text-xs">
                              <details className="group">
                                <summary className="cursor-pointer list-none flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:underline flex-wrap">
                                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-[11px] text-gray-700 dark:text-gray-300 shrink-0">
                                    {i + 1}
                                  </span>
                                  <span>{c.sourceTitle}</span>
                                  {c.pageStart != null && (
                                    <span className="text-gray-500 shrink-0">
                                      {c.pageEnd != null && c.pageEnd !== c.pageStart
                                        ? ` p.${c.pageStart}-${c.pageEnd}`
                                        : ` p.${c.pageStart}`}
                                    </span>
                                  )}
                                  {c.score != null && (
                                    <span
                                      className="text-gray-400 shrink-0"
                                      title="语义相关度（用于检索排序，不代表答案准确率）"
                                    >
                                      {(c.score * 100).toFixed(0)}%
                                    </span>
                                  )}
                                </summary>
                                <p className="mt-1 pl-4 text-gray-500 dark:text-gray-400 border-l-2 border-gray-200 dark:border-gray-600 whitespace-pre-wrap">
                                  {c.fullContent ?? c.snippet}
                                </p>
                              </details>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </>
        )}
        {loading && (
          <div className="rounded-lg p-3 max-w-[85%] ml-0 mr-auto bg-gray-100 dark:bg-gray-800 text-sm text-gray-500">
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your sources"
            className="flex-1 min-w-0 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2 rounded-md bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 text-sm font-medium disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import ShinyText from '@/components/ShinyText';

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

type InteractionOption = {
  label: string;
  value: string;
  description?: string;
};

type ChatInteraction = {
  type: 'choices';
  key: string;
  title: string;
  description?: string;
  options: InteractionOption[];
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  interaction?: ChatInteraction;
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
        ul: ({ children }) => <ul className="my-1 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-1 list-decimal space-y-1 pl-5">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        h1: ({ children }) => <h1 className="mb-1 mt-2 text-base font-semibold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-1 mt-2 text-sm font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline dark:text-blue-400"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-gray-200 px-1 py-0.5 text-[12px] dark:bg-gray-700">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="my-2 overflow-auto rounded bg-gray-200/70 p-2 text-xs dark:bg-gray-700/70">
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
  const [resolvedInteractions, setResolvedInteractions] = useState<Record<string, boolean>>({});
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
          setResolvedInteractions({});
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
    if (notebookId) void fetchHistoryPage(0, true);
  }, [notebookId, fetchHistoryPage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tailVersion]);

  const send = async (options?: {
    text?: string;
    interactionReply?: { key: string; value: string; label?: string };
  }) => {
    const text = (options?.text ?? input).trim();
    if (!text || !notebookId || loading) return;
    if (!options?.text) setInput('');
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
          interactionReply: options?.interactionReply ?? null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: 'assistant', content: `Error: ${err.error ?? res.statusText}` },
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
          interaction:
            data?.interaction &&
            data.interaction.type === 'choices' &&
            Array.isArray(data.interaction.options)
              ? (data.interaction as ChatInteraction)
              : undefined,
        },
      ]);
      setTailVersion((v) => v + 1);
    } finally {
      setLoading(false);
    }
  };

  if (!notebookId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 items-center border-b px-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            知识库问答
          </h2>
        </div>
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-gray-400 dark:text-gray-500">
          Select a notebook to start chatting.
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          知识库问答
        </h2>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="mx-auto flex w-2/3 flex-col gap-4">
          {loadingHistory ? (
            <div className="text-center">
              <ShinyText text="Loading chat history..." className="text-xs text-gray-500 dark:text-gray-400" />
            </div>
          ) : (
            <>
              {hasMore && (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void fetchHistoryPage(historyPage + 1, false)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? '加载中…' : '加载更早记录'}
                  </Button>
                </div>
              )}
              {historyError && (
                <p className="text-center text-xs text-red-600 dark:text-red-400">{historyError}</p>
              )}

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[92%] rounded-xl border p-3 shadow-sm ${
                    m.role === 'user'
                      ? 'ml-auto mr-0 border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-800'
                      : 'ml-0 mr-auto border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
                  }`}
                >
                  <div className="text-sm">
                    <MarkdownContent content={m.content} />
                  </div>
                  {m.role === 'assistant' && m.interaction && !resolvedInteractions[m.id] && (
                    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/60 p-2 dark:border-blue-900 dark:bg-blue-950/20">
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
                        {m.interaction.title}
                      </p>
                      {m.interaction.description && (
                        <p className="mt-1 text-[11px] text-blue-600/90 dark:text-blue-300/80">
                          {m.interaction.description}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.interaction.options.map((option) => (
                          <Button
                            key={`${m.id}-${option.value}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            className="h-7 text-xs"
                            onClick={() => {
                              setResolvedInteractions((prev) => ({ ...prev, [m.id]: true }));
                              void send({
                                text: `我选择：${option.label}`,
                                interactionReply: {
                                  key: m.interaction!.key,
                                  value: option.value,
                                  label: option.label,
                                },
                              });
                            }}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {m.role === 'assistant' && (
                    <>
                      <div className="mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-0 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
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
                        >
                          保存到笔记
                        </Button>
                      </div>
                      {m.citations && m.citations.length > 0 && (
                        <div className="mt-3 border-t pt-3">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">引用来源</span>
                          <ul className="mt-2 space-y-1">
                            {m.citations.map((c, i) => (
                              <li key={i} className="text-xs">
                                <details className="group">
                                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-gray-600 hover:underline dark:text-gray-300">
                                    <Badge variant="secondary" className="h-5 w-5 justify-center rounded-full px-0">
                                      {i + 1}
                                    </Badge>
                                    <span>{c.sourceTitle}</span>
                                    {c.pageStart != null && (
                                      <span className="text-gray-500">
                                        {c.pageEnd != null && c.pageEnd !== c.pageStart
                                          ? ` p.${c.pageStart}-${c.pageEnd}`
                                          : ` p.${c.pageStart}`}
                                      </span>
                                    )}
                                  </summary>
                                  <p className="mt-1 whitespace-pre-wrap border-l-2 border-gray-200 pl-4 text-gray-500 dark:border-gray-700 dark:text-gray-400">
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
            <div className="ml-0 mr-auto max-w-[92%] rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <ShinyText
                text="Thinking..."
                speed={2}
                spread={100}
                color="#9ca3af"
                shineColor="#ffffff"
                className="text-sm font-medium"
              />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <div className="border-t p-4">
        <div className="mx-auto w-2/3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex gap-2"
          >
            <Input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your sources"
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

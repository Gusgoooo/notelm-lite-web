'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
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

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  createdAt?: string;
  conversationId?: string;
};

const HISTORY_PAGE_SIZE = 20;
const DEFAULT_PYTHON_INPUT = `{
  "prices": [10, 11, 12, 13, 14]
}`;
const DEFAULT_PYTHON_CODE = `def main(data):
    prices = data.get("prices", [])
    if not prices:
        return {"error": "prices is empty"}

    avg = sum(prices) / len(prices)
    latest = prices[-1]
    change = latest - prices[0]
    return {
        "count": len(prices),
        "avg": round(avg, 4),
        "latest": latest,
        "change": round(change, 4),
    }

TOOL_OUTPUT = main(TOOL_INPUT)
`;

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
  const [tailVersion, setTailVersion] = useState(0);
  const [pythonOpen, setPythonOpen] = useState(false);
  const [pythonCode, setPythonCode] = useState(DEFAULT_PYTHON_CODE);
  const [pythonInput, setPythonInput] = useState(DEFAULT_PYTHON_INPUT);
  const [pythonSubmitting, setPythonSubmitting] = useState(false);
  const [pythonRunning, setPythonRunning] = useState(false);
  const [pythonError, setPythonError] = useState('');
  const [pythonJobId, setPythonJobId] = useState<string | null>(null);
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
    if (notebookId) void fetchHistoryPage(0, true);
  }, [notebookId, fetchHistoryPage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tailVersion]);

  useEffect(() => {
    setPythonJobId(null);
    setPythonRunning(false);
    setPythonSubmitting(false);
    setPythonError('');
  }, [notebookId]);

  const appendAssistantMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'assistant',
        content,
      },
    ]);
    setTailVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!pythonJobId) return;
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/scripts/jobs/${encodeURIComponent(pythonJobId)}`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!active || !res.ok) return;
        const status = typeof data?.status === 'string' ? data.status : '';
        if (status === 'PENDING' || status === 'RUNNING') return;

        setPythonJobId(null);
        setPythonRunning(false);

        if (status === 'SUCCEEDED') {
          const output = data?.output ?? {};
          const resultBlock = output?.result != null ? JSON.stringify(output.result, null, 2) : '{}';
          const stdout = typeof output?.stdout === 'string' && output.stdout.trim() ? output.stdout.trim() : '';
          const stderr = typeof output?.stderr === 'string' && output.stderr.trim() ? output.stderr.trim() : '';
          const summary = [
            '### Python 工具运行结果',
            '',
            '```json',
            resultBlock,
            '```',
          ];
          if (stdout) {
            summary.push('', 'stdout:', '```text', stdout, '```');
          }
          if (stderr) {
            summary.push('', 'stderr:', '```text', stderr, '```');
          }
          appendAssistantMessage(summary.join('\n'));
          return;
        }

        const failure = String(data?.errorMessage ?? 'Python 脚本执行失败');
        const traceback =
          typeof data?.output?.traceback === 'string' && data.output.traceback.trim()
            ? data.output.traceback.trim()
            : '';
        const body = traceback
          ? `Python 工具执行失败：${failure}\n\n\`\`\`text\n${traceback}\n\`\`\``
          : `Python 工具执行失败：${failure}`;
        appendAssistantMessage(body);
      } catch {
        // keep polling until timeout/next successful tick
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [appendAssistantMessage, pythonJobId]);

  const runPythonTool = async () => {
    if (!notebookId || pythonSubmitting || pythonRunning) return;
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = pythonInput.trim()
        ? (JSON.parse(pythonInput) as Record<string, unknown>)
        : {};
      if (!parsedInput || Array.isArray(parsedInput) || typeof parsedInput !== 'object') {
        setPythonError('输入 JSON 必须是对象（object）');
        return;
      }
    } catch {
      setPythonError('输入 JSON 格式不正确');
      return;
    }

    setPythonSubmitting(true);
    setPythonError('');
    try {
      const res = await fetch('/api/scripts/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notebookId,
          code: pythonCode,
          input: parsedInput,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data?.id !== 'string') {
        setPythonError(data?.error ?? '创建 Python 任务失败');
        return;
      }

      setPythonRunning(true);
      setPythonJobId(data.id);
      setPythonOpen(false);
      appendAssistantMessage('Python 工具任务已提交，正在沙箱中执行...');
    } finally {
      setPythonSubmitting(false);
    }
  };

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
        body: JSON.stringify({ notebookId, conversationId, userMessage: text }),
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
          {pythonRunning && (
            <div className="ml-0 mr-auto max-w-[92%] rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <ShinyText
                text="Python sandbox running..."
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPythonOpen(true)}
              disabled={loading || pythonSubmitting || pythonRunning}
            >
              Python 工具
            </Button>
            <Button type="submit" disabled={loading || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
      </div>
      {pythonOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Python 工具（沙箱执行）</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                脚本在隔离环境中运行，默认超时和内存限制会生效。使用 TOOL_INPUT 读取输入，设置 TOOL_OUTPUT 返回结果。
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs text-gray-600 dark:text-gray-300">输入 JSON</label>
                <Textarea
                  value={pythonInput}
                  onChange={(e) => setPythonInput(e.target.value)}
                  className="min-h-56 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs text-gray-600 dark:text-gray-300">Python 脚本</label>
                <Textarea
                  value={pythonCode}
                  onChange={(e) => setPythonCode(e.target.value)}
                  className="min-h-56 font-mono text-xs"
                />
              </div>
            </div>

            {pythonError ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{pythonError}</p> : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setPythonOpen(false)} disabled={pythonSubmitting}>
                取消
              </Button>
              <Button onClick={() => void runPythonTool()} disabled={pythonSubmitting || pythonRunning}>
                {pythonSubmitting ? '提交中…' : '运行脚本'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

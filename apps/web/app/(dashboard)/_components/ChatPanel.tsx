'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import ShinyText from '@/components/ShinyText';

type Citation = {
  sourceId: string;
  sourceTitle: string;
  pageStart?: number;
  pageEnd?: number;
  snippet: string;
  fullContent?: string;
  refNumber?: number;
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

type ResearchDirection = {
  id: string;
  title: string;
  researchQuestion: string;
  coreVariables: string;
  researchMethod: string;
  dataSourceAccess: string;
  difficultyStars: number;
  trendHeat: string;
};

type ResearchState = {
  topic: string;
  phase: 'collecting' | 'analyzing' | 'select_direction' | 'refining' | 'ready';
  directions: ResearchDirection[];
  selectedDirectionId?: string;
  starterQuestions?: string[];
  sourceStats?: {
    totalBefore: number;
    totalAfter: number;
  };
  createdAt: string;
  updatedAt: string;
};

type SelectionToastState = {
  text: string;
  x: number;
  y: number;
};

const HISTORY_PAGE_SIZE = 20;
const REPORT_ACTION_MARKER = '[[ACTION:REPORT]]';

function toTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function normalizeHistoryOrder(batch: Message[]): Message[] {
  return batch
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const ta = toTimestamp(a.message.createdAt);
      const tb = toTimestamp(b.message.createdAt);
      if (ta != null && tb != null && ta !== tb) return ta - tb;
      if (ta != null && tb == null) return -1;
      if (ta == null && tb != null) return 1;
      const roleA = a.message.role === 'user' ? 0 : 1;
      const roleB = b.message.role === 'user' ? 0 : 1;
      if (roleA !== roleB) return roleA - roleB;
      return a.index - b.index;
    })
    .map((item) => item.message);
}

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

function parseMessageActions(content: string): {
  displayContent: string;
  canConvertReport: boolean;
} {
  const canConvertReport = content.includes(REPORT_ACTION_MARKER);
  if (!canConvertReport) {
    return { displayContent: content, canConvertReport: false };
  }
  return {
    displayContent: content.replaceAll(REPORT_ACTION_MARKER, '').trim(),
    canConvertReport: true,
  };
}

function isRefineCompletedMessage(content: string): boolean {
  return /已完成资料重整，当前选题为：/i.test(content);
}

function normalizeForActionCheck(content: string): string {
  return content
    .replace(REPORT_ACTION_MARKER, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_\-\[\]()`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldShowRichAnswerActions(content: string): boolean {
  const plain = normalizeForActionCheck(content);
  if (!plain) return false;
  if (/^error:/i.test(plain)) return false;
  if (/无法回答|来源不足|没有足够信息|请稍后重试/i.test(plain)) return false;
  return plain.length >= 140;
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
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [researchState, setResearchState] = useState<ResearchState | null>(null);
  const [loadingResearchState, setLoadingResearchState] = useState(false);
  const [researchStateError, setResearchStateError] = useState('');
  const [selectingDirectionId, setSelectingDirectionId] = useState<string | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineStep, setRefineStep] = useState<0 | 1 | 2>(0);
  const [refineHint, setRefineHint] = useState('');
  const [refineError, setRefineError] = useState('');
  const [quickActionRunning, setQuickActionRunning] = useState<{ messageId: string; mode: 'report' | 'infographic' } | null>(null);
  const [selectionToast, setSelectionToast] = useState<SelectionToastState | null>(null);
  const [savingSelection, setSavingSelection] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  const selectionTimerRef = useRef<number | null>(null);

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
        const chronological = normalizeHistoryOrder(batch);
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

  const fetchResearchState = useCallback(async () => {
    if (!notebookId) return;
    setLoadingResearchState(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/research/state`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResearchStateError(data?.error ?? '加载研究状态失败');
        setResearchState(null);
        return;
      }
      setResearchStateError('');
      setResearchState((data?.state as ResearchState | null) ?? null);
    } finally {
      setLoadingResearchState(false);
    }
  }, [notebookId]);

  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setHasMore(false);
    setHistoryPage(0);
    setHistoryError('');
    setResearchState(null);
    setResearchStateError('');
    if (notebookId) {
      void fetchHistoryPage(0, true);
      void fetchResearchState();
    }
  }, [notebookId, fetchHistoryPage, fetchResearchState]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tailVersion]);

  useEffect(() => {
    if (!loading) {
      setThinkingSeconds(0);
      return;
    }
    const start = Date.now();
    const timer = window.setInterval(() => {
      setThinkingSeconds(Math.floor((Date.now() - start) / 1000));
    }, 200);
    return () => window.clearInterval(timer);
  }, [loading]);

  const createNote = useCallback(
    async (content: string, title?: string, emitUpdate = true) => {
      if (!notebookId) throw new Error('notebookId is required');
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title?.trim() || buildNoteTitleFromAnswer(content),
          content,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? '保存到笔记失败');
      }
      if (emitUpdate) {
        window.dispatchEvent(new CustomEvent('notes-updated'));
      }
      return data;
    },
    [notebookId]
  );

  useEffect(() => {
    const clearTimer = () => {
      if (selectionTimerRef.current != null) {
        window.clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = null;
      }
    };

    const getSelectionCandidate = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return null;
      }

      const text = selection.toString().replace(/\u00a0/g, ' ').trim();
      if (!text) {
        return null;
      }

      const range = selection.getRangeAt(0);
      const container = chatContentRef.current;
      const startElement =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      const endElement =
        range.endContainer.nodeType === Node.ELEMENT_NODE
          ? (range.endContainer as Element)
          : range.endContainer.parentElement;
      if (!container || !startElement || !endElement) {
        return null;
      }
      if (!container.contains(startElement) || !container.contains(endElement)) {
        return null;
      }

      const startRoot = startElement.closest('[data-assistant-message="true"]');
      const endRoot = endElement.closest('[data-assistant-message="true"]');
      if (!startRoot || !endRoot || startRoot !== endRoot) {
        return null;
      }

      const rects = Array.from(range.getClientRects());
      const tailRect = rects[rects.length - 1] ?? range.getBoundingClientRect();
      if (!tailRect.width && !tailRect.height) {
        return null;
      }

      const preferredY =
        tailRect.bottom + 38 <= window.innerHeight ? tailRect.bottom + 8 : tailRect.top - 40;

      return {
        text,
        x: Math.min(window.innerWidth - 148, Math.max(12, tailRect.right + 8)),
        y: Math.max(12, preferredY),
      } satisfies SelectionToastState;
    };

    const updateSelectionToast = () => {
      clearTimer();
      const candidate = getSelectionCandidate();
      if (!candidate) {
        setSelectionToast((prev) => (prev ? null : prev));
        return;
      }
      selectionTimerRef.current = window.setTimeout(() => {
        selectionTimerRef.current = null;
        const latest = getSelectionCandidate();
        setSelectionToast(latest);
      }, 300);
    };

    const clearSelectionToast = () => {
      clearTimer();
      setSelectionToast(null);
    };

    document.addEventListener('selectionchange', updateSelectionToast);
    window.addEventListener('scroll', clearSelectionToast, true);
    return () => {
      clearTimer();
      document.removeEventListener('selectionchange', updateSelectionToast);
      window.removeEventListener('scroll', clearSelectionToast, true);
    };
  }, []);

  const send = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
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
    },
    [conversationId, input, loading, notebookId]
  );

  useEffect(() => {
    const onChatSendMessage = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      const message = typeof detail?.message === 'string' ? detail.message.trim() : '';
      if (!message) return;
      void send(message);
    };
    window.addEventListener('chat-send-message', onChatSendMessage as EventListener);
    return () => window.removeEventListener('chat-send-message', onChatSendMessage as EventListener);
  }, [send]);

  const selectDirection = useCallback(
    async (direction: ResearchDirection) => {
      if (!notebookId || selectingDirectionId) return;
      setSelectingDirectionId(direction.id);
      setRefineOpen(true);
      setRefineError('');
      setRefineStep(1);
      setRefineHint('开始重新整理资料，正在筛选相关度更高的来源…');
      try {
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/research/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ directionId: direction.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error ?? '选题确认失败');
        }
        setRefineStep(2);
        setRefineHint('资料重整完成，正在刷新研究空间…');
        const nextState = researchState
          ? {
              ...researchState,
              phase: 'ready' as const,
              selectedDirectionId: direction.id,
              starterQuestions: Array.isArray(data?.starterQuestions) ? data.starterQuestions : [],
              sourceStats:
                data?.sourceStats && typeof data.sourceStats === 'object'
                  ? {
                      totalBefore: Number(data.sourceStats.totalBefore ?? 0),
                      totalAfter: Number(data.sourceStats.totalAfter ?? 0),
                    }
                  : researchState.sourceStats,
              updatedAt: new Date().toISOString(),
            }
          : null;
        if (nextState) setResearchState(nextState);
        window.dispatchEvent(
          new CustomEvent('notebook-title-updated', { detail: { title: `${direction.title} · 研究` } })
        );
        window.dispatchEvent(new CustomEvent('sources-updated'));
        await fetchHistoryPage(0, true);
        setRefineOpen(false);
        setRefineStep(0);
        setRefineHint('');
      } catch (e) {
        setRefineError(e instanceof Error ? e.message : '选题确认失败');
      } finally {
        setSelectingDirectionId(null);
      }
    },
    [notebookId, selectingDirectionId, researchState, fetchHistoryPage]
  );

  const generateArtifactFromAnswer = useCallback(
    async (message: Message, mode: 'report' | 'infographic') => {
      if (!notebookId || quickActionRunning) return;
      const parsed = parseMessageActions(message.content);
      const answerText = parsed.displayContent.trim();
      if (!answerText) return;
      const pendingId = `pending_${mode}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const pendingTitle = buildNoteTitleFromAnswer(answerText);
      window.dispatchEvent(
        new CustomEvent('notes-pending-add', {
          detail: { id: pendingId, mode, title: pendingTitle },
        })
      );

      const isReport = mode === 'report';
      setQuickActionRunning({ messageId: message.id, mode });
      try {
        const createData = await createNote(
          answerText,
          isReport ? '论文对比洞察' : '回答延展信息图',
          false
        );
        if (!createData?.id) {
          throw new Error('保存洞察素材失败');
        }
        const genRes = await fetch('/api/notes/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notebookId,
            noteIds: [String(createData.id)],
            mode,
          }),
        });
        const genData = await genRes.json().catch(() => ({}));
        if (!genRes.ok) {
          throw new Error(genData?.error ?? (isReport ? '转换报告失败' : '生成信息图失败'));
        }
        window.dispatchEvent(new CustomEvent('notes-pending-remove', { detail: { id: pendingId } }));
        window.dispatchEvent(new CustomEvent('notes-updated'));
      } catch (e) {
        window.dispatchEvent(new CustomEvent('notes-pending-remove', { detail: { id: pendingId } }));
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: `Error: ${e instanceof Error ? e.message : isReport ? '转换报告失败' : '生成信息图失败'}`,
          },
        ]);
        setTailVersion((v) => v + 1);
      } finally {
        setQuickActionRunning(null);
      }
    },
    [createNote, notebookId, quickActionRunning]
  );

  const renderResearchSection = () => {
    if (loadingResearchState) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900">
          <ShinyText text="正在准备研究空间..." className="text-xs text-gray-500 dark:text-gray-400" />
        </div>
      );
    }
    if (researchStateError) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
          {researchStateError}
        </div>
      );
    }
    if (!researchState) return null;

    if (researchState.phase === 'collecting' || researchState.phase === 'analyzing') {
      return (
        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300">
          {researchState.phase === 'collecting'
            ? '正在联网检索并整理论文来源…'
            : '正在分析来源并延展研究方向…'}
        </div>
      );
    }

    if (researchState.phase === 'select_direction' && researchState.directions.length > 0) {
      return (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">请选择一个研究方向开始深入探索</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              主题：{researchState.topic}。选中后会自动重整知识库来源并生成下一步研究建议。
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {researchState.directions.map((dir) => (
              <button
                key={dir.id}
                type="button"
                onClick={() => void selectDirection(dir)}
                disabled={Boolean(selectingDirectionId)}
                className={`rounded-lg border p-3 text-left transition ${
                  selectingDirectionId === dir.id
                    ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white dark:border-gray-700 dark:bg-gray-800/70 dark:hover:border-gray-600'
                }`}
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{dir.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">{dir.researchQuestion}</p>
                <div className="mt-2 space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                  <p>核心变量：{dir.coreVariables}</p>
                  <p>研究方法：{dir.researchMethod}</p>
                  <p>数据可得性：{dir.dataSourceAccess}</p>
                  <p>研究难度：{'⭐'.repeat(Math.max(1, Math.min(5, dir.difficultyStars || 3)))}</p>
                  <p>趋势热度：{dir.trendHeat}</p>
                </div>
                <p className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                  {selectingDirectionId === dir.id ? '正在确认…' : '选择此方向'}
                </p>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return null;
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
      <ScrollArea className="flex-1 p-4 pb-36">
        <div ref={chatContentRef} className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
          {renderResearchSection()}
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

              {messages.map((m) => {
                const parsed = parseMessageActions(m.content);
                const refineDone = isRefineCompletedMessage(parsed.displayContent);
                const showRichActions =
                  m.role === 'assistant' && !refineDone && shouldShowRichAnswerActions(parsed.displayContent);
                return (
                  <div
                    key={m.id}
                    data-assistant-message={m.role === 'assistant' ? 'true' : undefined}
                    className={`w-full max-w-[680px] rounded-xl border shadow-sm ${
                      m.role === 'user' ? 'px-3 py-2' : 'p-3'
                    } ${
                      m.role === 'user'
                        ? 'ml-auto mr-0 border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-800'
                        : 'ml-0 mr-auto border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
                    }`}
                  >
                    <div className="text-sm">
                      <MarkdownContent content={parsed.displayContent} />
                    </div>
                    {m.role === 'assistant' && (
                      <>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {!refineDone ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-0 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                              onClick={async () => {
                                if (!notebookId) return;
                                const content =
                                  parsed.displayContent +
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
                                await createNote(content, buildNoteTitleFromAnswer(parsed.displayContent));
                              }}
                            >
                              保存到笔记
                            </Button>
                          ) : null}
                        </div>
                        {refineDone &&
                        researchState?.phase === 'ready' &&
                        Array.isArray(researchState.starterQuestions) &&
                        researchState.starterQuestions.length > 0 ? (
                          <div className="mt-3 border-t pt-3">
                            <p className="text-xs text-gray-600 dark:text-gray-300">可继续探索的研究议题：</p>
                            <div className="mt-2 flex flex-col items-start gap-1.5">
                              {researchState.starterQuestions.slice(0, 3).map((q, idx) => (
                                <button
                                  key={`${idx}-${q}`}
                                  type="button"
                                  onClick={() => void send(q)}
                                  disabled={loading}
                                  className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[11px] text-gray-700 transition hover:bg-white disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                >
                                  {q}
                                </button>
                              ))}
                            </div>
                            <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                              您还可以直接问我问题，我会基于来源给您回答。
                            </p>
                          </div>
                        ) : null}
                        {showRichActions || parsed.canConvertReport ? (
                          <div className="mt-3 border-t pt-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {showRichActions ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void send('请基于你上一条回答，延展更多相关论点、对比视角与可继续研究的方向。')
                                  }
                                  disabled={loading}
                                  className="inline-flex h-7 items-center rounded-full border border-gray-300 bg-gray-50 px-3 text-[11px] text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                >
                                  延展更多论点
                                </button>
                              ) : null}
                              {(showRichActions || parsed.canConvertReport) ? (
                                <button
                                  type="button"
                                  onClick={() => void generateArtifactFromAnswer(m, 'report')}
                                  disabled={
                                    (quickActionRunning?.messageId === m.id && quickActionRunning.mode === 'report')
                                  }
                                  className="inline-flex h-7 items-center rounded-full border border-gray-300 bg-gray-50 px-3 text-[11px] text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                >
                                  {quickActionRunning?.messageId === m.id && quickActionRunning.mode === 'report' ? '生成中…' : '生成报告'}
                                </button>
                              ) : null}
                              {showRichActions ? (
                                <button
                                  type="button"
                                  onClick={() => void generateArtifactFromAnswer(m, 'infographic')}
                                  disabled={
                                    quickActionRunning?.messageId === m.id &&
                                    quickActionRunning.mode === 'infographic'
                                  }
                                  className="inline-flex h-7 items-center rounded-full border border-gray-300 bg-gray-50 px-3 text-[11px] text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                                >
                                  {quickActionRunning?.messageId === m.id &&
                                  quickActionRunning.mode === 'infographic'
                                    ? '生成中…'
                                    : '生成信息图帮助理解'}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                        {m.citations && m.citations.length > 0 && (
                          <div className="mt-3 border-t pt-3">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">引用来源</span>
                            <ul className="mt-2 space-y-1">
                              {m.citations.map((c, i) => (
                                <li key={i} className="text-xs">
                                  <details className="group">
                                    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-gray-600 hover:underline dark:text-gray-300">
                                      <Badge variant="secondary" className="h-5 w-5 justify-center rounded-full px-0">
                                        {c.refNumber ?? i + 1}
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
                );
              })}
            </>
          )}
          {loading && (
            <div className="ml-0 mr-auto w-full max-w-[680px] rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <ShinyText
                text={`Thinking... ${thinkingSeconds}s`}
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
      {selectionToast ? (
        <button
          type="button"
          className="fixed z-50 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-700 shadow-lg transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          style={{ left: selectionToast.x, top: selectionToast.y }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={async () => {
            if (savingSelection) return;
            setSavingSelection(true);
            try {
              const content = selectionToast.text.trim();
              if (!content) return;
              await createNote(content, buildNoteTitleFromAnswer(content));
              window.getSelection()?.removeAllRanges();
              setSelectionToast(null);
            } catch (error) {
              alert(error instanceof Error ? error.message : '保存到笔记失败');
            } finally {
              setSavingSelection(false);
            }
          }}
          disabled={savingSelection}
        >
          {savingSelection ? '添加中…' : '添加到笔记'}
        </button>
      ) : null}
      <div className="px-4 pb-4">
        <div className="mx-auto w-full max-w-[680px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="relative"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="请输入你的问题..."
              disabled={loading}
              className="h-[108px] w-full resize-none rounded-[20px] border border-gray-200 bg-gray-50 px-4 pb-12 pt-4 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-300 focus:bg-white dark:border-gray-700 dark:bg-gray-900/80 dark:text-gray-100 dark:focus:border-gray-600 dark:focus:bg-gray-900"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="absolute bottom-4 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
              aria-label="发送"
              title="发送"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M12 19V6" />
                <path d="m6 12 6-6 6 6" />
              </svg>
            </button>
          </form>
        </div>
      </div>
      {refineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">正在整理研究资料</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{refineHint}</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-500"
                style={{ width: `${refineStep === 1 ? 45 : refineStep === 2 ? 100 : 0}%` }}
              />
            </div>
            <div className="mt-4 space-y-2">
              {['开始重新整理资料', '完成'].map((label, idx) => {
                const stepNumber = (idx + 1) as 1 | 2;
                const done = refineStep > stepNumber;
                const running = refineStep === stepNumber;
                return (
                  <div
                    key={label}
                    className={`flex items-center gap-2 rounded border px-2 py-2 text-xs ${
                      done
                        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-300'
                        : running
                          ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300'
                          : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        done ? 'bg-green-600' : running ? 'bg-blue-600 animate-pulse' : 'bg-gray-400'
                      }`}
                    />
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
            {refineError ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{refineError}</p> : null}
            <div className="mt-4 flex justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  if (!selectingDirectionId) {
                    setRefineOpen(false);
                    setRefineStep(0);
                    setRefineHint('');
                    setRefineError('');
                  }
                }}
                disabled={Boolean(selectingDirectionId)}
              >
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

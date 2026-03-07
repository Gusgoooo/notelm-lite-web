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
  action?:
    | {
        type: 'create_doc' | 'update_doc';
        source: 'chat' | 'sources';
      }
    | undefined;
};

type ResearchDirection = {
  id: string;
  title: string;
  researchQuestion: string;
  evidenceCount?: number;
  evidenceSummary?: string;
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

type NotebookEntryMode = 'bootstrap' | null;

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

function sortCitations(citations: Citation[] | undefined): Citation[] {
  if (!Array.isArray(citations)) return [];
  return [...citations].sort((a, b) => {
    const ra = typeof a.refNumber === 'number' ? a.refNumber : Number.MAX_SAFE_INTEGER;
    const rb = typeof b.refNumber === 'number' ? b.refNumber : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.sourceTitle.localeCompare(b.sourceTitle, 'zh-CN');
  });
}

function normalizeGuideQuestion(raw: string): string {
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^[\d一二三四五六七八九十]+[.)、\s-]*/, '')
    .replace(/^[•·\-*]\s*/, '')
    .trim() ?? '';

  if (!cleaned) return '';
  const sentence = cleaned.match(/[^。！？!?]*[？?]/)?.[0]?.trim() ?? cleaned.replace(/[。;；]+$/g, '').trim();
  if (!sentence) return '';
  return /[？?]$/.test(sentence) ? sentence.replace(/\?$/, '？') : `${sentence}？`;
}

function getBootstrapGuideQuestions(state: ResearchState | null): string[] {
  if (!state) return [];
  const rawQuestions =
    state.phase === 'ready' && Array.isArray(state.starterQuestions) && state.starterQuestions.length > 0
      ? state.starterQuestions
      : state.directions.map((item) => item.researchQuestion || item.title);

  const questions: string[] = [];
  const seen = new Set<string>();
  for (const item of rawQuestions) {
    const normalized = normalizeGuideQuestion(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    questions.push(normalized);
    if (questions.length >= 3) break;
  }
  return questions;
}

const ACTION_PILL_CLASS =
  'inline-flex h-7 items-center rounded-full border border-gray-300 bg-gray-50 px-3 text-[11px] text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';
const SAVE_ACTION_PILL_CLASS =
  'inline-flex h-7 items-center rounded-full border border-blue-200 bg-blue-50 px-3 text-[11px] text-blue-700 transition hover:bg-blue-100 disabled:opacity-50';

function hasKnowledgeDocContent(content: string | undefined): boolean {
  if (!content) return false;
  return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length > 0;
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
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
        th: ({ children }) => (
          <th className="border-b border-gray-200 px-2 py-1 text-left font-semibold text-gray-700">{children}</th>
        ),
        td: ({ children }) => <td className="border-b border-gray-100 px-2 py-1 align-top">{children}</td>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline"
          >
            {children}
          </a>
        ),
        code: ({ children }) => <code className="rounded bg-gray-100 px-1 py-0.5 text-[12px]">{children}</code>,
        pre: ({ children }) => (
          <pre className="my-2 overflow-auto rounded bg-gray-100 p-2 text-xs">
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
  const [entryMode, setEntryMode] = useState<NotebookEntryMode>(null);
  const [starterQuestionLoading, setStarterQuestionLoading] = useState<string | null>(null);
  const [selectionToast, setSelectionToast] = useState<SelectionToastState | null>(null);
  const [savingSelection, setSavingSelection] = useState(false);
  const [knowledgeDocState, setKnowledgeDocState] = useState<{ exists: boolean; hasContent: boolean }>({
    exists: false,
    hasContent: false,
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const composingRef = useRef(false);
  const bootstrapDirectionsStartedRef = useRef<string | null>(null);

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

  const fetchKnowledgeDocState = useCallback(async () => {
    if (!notebookId) return;
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKnowledgeDocState({ exists: false, hasContent: false });
        return;
      }
      setKnowledgeDocState({
        exists: typeof data?.id === 'string',
        hasContent: hasKnowledgeDocContent(typeof data?.content === 'string' ? data.content : ''),
      });
    } catch {
      setKnowledgeDocState({ exists: false, hasContent: false });
    }
  }, [notebookId]);

  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setHasMore(false);
    setHistoryPage(0);
    setHistoryError('');
    setEntryMode(null);
    setResearchState(null);
    setResearchStateError('');
    setKnowledgeDocState({ exists: false, hasContent: false });
    bootstrapDirectionsStartedRef.current = null;
    if (notebookId) {
      try {
        const key = `notebook-entry:${notebookId}`;
        const nextMode = window.sessionStorage.getItem(key);
        if (nextMode === 'bootstrap') {
          setEntryMode('bootstrap');
        }
        window.sessionStorage.removeItem(key);
      } catch {
        // Ignore sessionStorage failures and continue without entry-specific UI.
      }
    }
    if (notebookId) {
      void fetchHistoryPage(0, true);
      void fetchResearchState();
      void fetchKnowledgeDocState();
    }
  }, [notebookId, fetchHistoryPage, fetchKnowledgeDocState, fetchResearchState]);

  useEffect(() => {
    const onKnowledgeDocSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ exists?: boolean; hasContent?: boolean }>).detail;
      if (typeof detail?.exists === 'boolean' || typeof detail?.hasContent === 'boolean') {
        setKnowledgeDocState((prev) => ({
          exists: typeof detail?.exists === 'boolean' ? detail.exists : prev.exists,
          hasContent: typeof detail?.hasContent === 'boolean' ? detail.hasContent : prev.hasContent,
        }));
        return;
      }
      void fetchKnowledgeDocState();
    };

    const onSourcesAdded = (event: Event) => {
      const detail = (event as CustomEvent<{ addedCount?: number }>).detail;
      const addedCount = Number(detail?.addedCount ?? 0);
      if (addedCount <= 0) return;
      const docActionType = knowledgeDocState.exists ? 'update_doc' : 'create_doc';
      const docVerb = docActionType === 'update_doc' ? '更新' : '创建';
      setMessages((prev) => [
        ...prev,
        {
          id: `source-hint-${Date.now()}`,
          role: 'assistant',
          content: `新增 ${addedCount} 个来源，您可以继续问答，也可以根据新增来源${docVerb}知识文档。`,
          action: {
            type: docActionType,
            source: 'sources',
          },
        },
      ]);
      setTailVersion((v) => v + 1);
    };

    window.addEventListener('knowledge-doc-saved', onKnowledgeDocSaved as EventListener);
    window.addEventListener('sources-added', onSourcesAdded as EventListener);
    return () => {
      window.removeEventListener('knowledge-doc-saved', onKnowledgeDocSaved as EventListener);
      window.removeEventListener('sources-added', onSourcesAdded as EventListener);
    };
  }, [fetchKnowledgeDocState, knowledgeDocState.exists]);

  useEffect(() => {
    if (!notebookId || entryMode !== 'bootstrap' || !researchState) return;
    if (researchState.phase !== 'analyzing') return;
    if (bootstrapDirectionsStartedRef.current === notebookId) return;
    bootstrapDirectionsStartedRef.current = notebookId;

    void fetch('/api/notebooks/bootstrap/directions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notebookId,
        topic: researchState.topic,
      }),
    })
      .catch(() => null)
      .finally(() => {
        void fetchResearchState();
      });
  }, [entryMode, fetchResearchState, notebookId, researchState]);

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

  const updateKnowledgeDocFromChat = useCallback(
    async (lastUserMessage: string, lastAssistantMessage: string) => {
      if (!notebookId) throw new Error('notebookId is required');
      window.dispatchEvent(new CustomEvent('knowledge-doc-expand'));
      window.dispatchEvent(
        new CustomEvent('knowledge-doc-pending-state', {
          detail: {
            active: true,
            label: '正在根据当前回答更新知识文档…',
          },
        })
      );
      try {
        const docRes = await fetch(
          `/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc`,
          { cache: 'no-store' }
        );
        const docData = await docRes.json().catch(() => ({}));
        const currentContent =
          typeof docData?.content === 'string'
            ? docData.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            : '';
        const updateRes = await fetch(
          `/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc/update-from-chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentContent,
              lastUserMessage,
              lastAssistantMessage,
            }),
          }
        );
        const updateData = await updateRes.json().catch(() => ({}));
        if (!updateRes.ok) {
          throw new Error(updateData?.error ?? '更新知识文档失败');
        }
        window.dispatchEvent(
          new CustomEvent('knowledge-doc-update-from-chat', {
            detail: { suggestedContent: updateData?.suggestedContent ?? '', autoApply: false },
          })
        );
      } finally {
        window.dispatchEvent(
          new CustomEvent('knowledge-doc-pending-state', {
            detail: { active: false },
          })
        );
      }
    },
    [notebookId]
  );

  const requestKnowledgeDocCreate = useCallback(() => {
    window.dispatchEvent(new CustomEvent('knowledge-doc-expand'));
    window.dispatchEvent(new CustomEvent('knowledge-doc-create-request'));
  }, []);

  const requestKnowledgeDocRefreshFromSources = useCallback(() => {
    window.dispatchEvent(new CustomEvent('knowledge-doc-expand'));
    window.dispatchEvent(
      new CustomEvent('knowledge-doc-generate-request', {
        detail: {
          scenario: 'auto',
          mode: knowledgeDocState.exists ? 'update' : 'create',
        },
      })
    );
  }, [knowledgeDocState.exists]);

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

      const range = selection.getRangeAt(0);
      const text = range.cloneContents().textContent?.replace(/\u00a0/g, ' ').trim() ?? '';
      if (!text) {
        return null;
      }

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

      selectionRangeRef.current = range.cloneRange();
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
        selectionRangeRef.current = null;
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

    document.addEventListener('mouseup', updateSelectionToast);
    document.addEventListener('keyup', updateSelectionToast);
    window.addEventListener('scroll', clearSelectionToast, true);
    return () => {
      clearTimer();
      document.removeEventListener('mouseup', updateSelectionToast);
      document.removeEventListener('keyup', updateSelectionToast);
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
        const normalizedCitations = Array.isArray(data.citations) ? data.citations : [];
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: data.answer,
            citations: normalizedCitations,
          },
        ]);
        window.dispatchEvent(
          new CustomEvent('knowledge-unit-trigger', {
            detail: {
              trigger: 'ON_ANSWER_GENERATED',
              user_question: text,
              assistant_answer: data.answer,
              citations: normalizedCitations,
            },
          })
        );
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

  const askBootstrapGuideQuestion = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || !notebookId || loading) return;
      setEntryMode(null);
      await send(text);
    },
    [loading, notebookId, send]
  );

  const askStarterQuestion = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || !notebookId || loading || starterQuestionLoading) return;
      setStarterQuestionLoading(text);
      try {
        await send(text);
      } finally {
        setStarterQuestionLoading(null);
      }
    },
    [loading, notebookId, send, starterQuestionLoading]
  );

  const renderResearchSection = () => {
    if (entryMode !== 'bootstrap') return null;

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
            ? '正在联网检索首批来源…'
            : '正在整理来源脉络，稍后会给出推荐问题…'}
        </div>
      );
    }

    const bootstrapQuestions = getBootstrapGuideQuestions(researchState);
    if (bootstrapQuestions.length > 0) {
      return (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">左侧知识库来源，主要探讨了以下几个问题：</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">主题：{researchState.topic}。点击任一问题后，会直接把该问题发送到当前对话。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {bootstrapQuestions.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => void askBootstrapGuideQuestion(question)}
                disabled={loading}
                className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-xs text-gray-700 transition hover:border-gray-300 hover:bg-white disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-200 dark:hover:border-gray-600"
              >
                {question}
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
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center px-3">
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
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center px-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          知识库问答
        </h2>
      </div>
      <ScrollArea className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-1">
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
                const messageAction = m.action
                  ? m.action
                  : m.role === 'assistant' && !/^error:/i.test(parsed.displayContent)
                    ? {
                        type: knowledgeDocState.exists ? 'update_doc' : 'create_doc',
                        source: 'chat' as const,
                      }
                    : null;
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
                        {!refineDone && messageAction ? (
                          <div className="mt-3 border-t pt-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {messageAction.type === 'update_doc' ? (
                                <button
                                  type="button"
                                  className={SAVE_ACTION_PILL_CLASS}
                                  onClick={async () => {
                                    if (messageAction.source === 'sources') {
                                      requestKnowledgeDocRefreshFromSources();
                                      return;
                                    }
                                    if (!notebookId) return;
                                    const idx = messages.findIndex((msg) => msg.id === m.id);
                                    const prevUser =
                                      idx > 0
                                        ? messages
                                            .slice(0, idx)
                                            .reverse()
                                            .find((msg) => msg.role === 'user')
                                        : null;
                                    await updateKnowledgeDocFromChat(
                                      prevUser?.content ?? '',
                                      parsed.displayContent +
                                        (m.citations && m.citations.length > 0
                                          ? '\n\n## Sources\n\n' +
                                            sortCitations(m.citations)
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
                                          : '')
                                    );
                                  }}
                                >
                                  更新知识文档
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={requestKnowledgeDocCreate}
                                  className={ACTION_PILL_CLASS}
                                >
                                  创建知识文档
                                </button>
                              )}
                            </div>
                          </div>
                        ) : null}
                        {refineDone &&
                        researchState?.phase === 'ready' &&
                        Array.isArray(researchState.starterQuestions) &&
                        researchState.starterQuestions.length > 0 ? (
                          <div className="mt-3 border-t pt-3">
                            <p className="text-xs text-gray-600 dark:text-gray-300">可继续探索的问题：</p>
                            <div className="mt-2 flex flex-col items-start gap-1.5">
                              {researchState.starterQuestions.slice(0, 3).map((q, idx) => (
                                <button
                                  key={`${idx}-${q}`}
                                  type="button"
                                  onClick={() => void askStarterQuestion(q)}
                                  disabled={loading || starterQuestionLoading === q}
                                  className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[11px] text-gray-700 transition hover:bg-white disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                >
                                  {starterQuestionLoading === q ? '正在补充来源并提问…' : q}
                                </button>
                              ))}
                            </div>
                            <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                              您还可以直接问我问题，我会基于来源给您回答。
                            </p>
                          </div>
                        ) : null}
                        {m.citations && m.citations.length > 0 && (
                          <div className="mt-3 border-t pt-3">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">引用来源</span>
                            <ul className="mt-2 space-y-1">
                              {sortCitations(m.citations).map((c, i) => (
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
              const content =
                (selectionRangeRef.current?.cloneContents().textContent ?? selectionToast.text).trim();
              if (!content) return;
              await updateKnowledgeDocFromChat('', content);
              setSelectionToast(null);
            } catch (error) {
              alert(error instanceof Error ? error.message : '更新知识文档失败');
            } finally {
              setSavingSelection(false);
            }
          }}
          disabled={savingSelection}
        >
          {savingSelection ? '更新中…' : '更新知识文档'}
        </button>
      ) : null}
      {!knowledgeDocState.exists && messages.some((message) => message.role === 'assistant') ? (
        <div className="shrink-0 px-3 pb-0 pt-1">
          <div className="mx-auto flex w-full max-w-[680px] items-center justify-between gap-3 rounded-[18px] bg-[#f5f6fb] px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800">当前来源已经可以整理成知识文档</p>
              <p className="mt-1 text-xs text-gray-500">点击创建后会展开右侧文档区，并可选择场景生成初稿。</p>
            </div>
            <button
              type="button"
              onClick={requestKnowledgeDocCreate}
              className="inline-flex h-9 shrink-0 items-center rounded-full bg-white px-4 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              创建知识文档
            </button>
          </div>
        </div>
      ) : null}
      <div className="shrink-0 bg-white px-3 pb-3 pt-2">
        <div className="mx-auto w-full max-w-[680px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="relative rounded-[24px] bg-[#f1f1f1] p-2"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onKeyDown={(e) => {
                const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
                const isComposing = composingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;
                if (isComposing) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="请输入你的问题..."
              disabled={loading}
              className="h-[104px] w-full resize-none rounded-[20px] border-0 bg-transparent px-4 pb-12 pt-4 text-sm text-gray-900 outline-none transition dark:text-gray-100"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
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
    </div>
  );
}

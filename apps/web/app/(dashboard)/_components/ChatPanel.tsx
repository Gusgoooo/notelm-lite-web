'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import ShinyText from '@/components/ShinyText';
import { isImeCommitRecentlyEnded, shouldIgnoreEnterForIme } from '@/lib/ime';
import { KnowledgeDocCreateButton } from './KnowledgeDocCreateButton';

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

type BootstrapGuidePayload = {
  lead: string;
  questions: string[];
};

type NotebookEntryMode = 'bootstrap' | null;

const HISTORY_PAGE_SIZE = 20;
const REPORT_ACTION_MARKER = '[[ACTION:REPORT]]';

function buildHighlightedMaterialsFromCitations(citations: Citation[] | undefined): string {
  const normalized = sortCitations(citations);
  if (normalized.length === 0) return '';
  return normalized
    .map(
      (citation) =>
        `- ${citation.sourceTitle}${
          citation.pageStart != null
            ? `（p.${citation.pageStart}${
                citation.pageEnd != null && citation.pageEnd !== citation.pageStart ? `-${citation.pageEnd}` : ''
              }）`
            : ''
        }：${citation.snippet}`
    )
    .join('\n');
}

function shouldSyncKnowledgeDocFromMessage(message: string): boolean {
  return /更新知识文档|更新知识库文档|同步到知识文档|写入知识文档|整理到知识文档|修改知识文档/i.test(message);
}

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

const SAVE_ACTION_PILL_CLASS =
  'inline-flex h-7 items-center rounded-[12px] border border-blue-200 bg-blue-50 px-3 text-[11px] text-blue-700 transition hover:bg-blue-100 disabled:opacity-50';

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === 'undefined') return;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function hasKnowledgeDocContent(content: string | undefined): boolean {
  if (!content) return false;
  return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length > 0;
}

function compactMarkdown(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

function MarkdownContent({ content }: { content: string }) {
  const normalizedContent = compactMarkdown(content);

  const markdownComponents = {
    p: ({ children }: { children?: ReactNode }) => <p className="my-1 leading-6">{children}</p>,
    ul: ({ children }: { children?: ReactNode }) => <ul className="my-1 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }: { children?: ReactNode }) => <ol className="my-1 list-decimal space-y-1 pl-5">{children}</ol>,
    li: ({ children }: { children?: ReactNode }) => <li>{children}</li>,
    h1: ({ children }: { children?: ReactNode }) => <h1 className="mb-1 mt-2 text-base font-semibold">{children}</h1>,
    h2: ({ children }: { children?: ReactNode }) => <h2 className="mb-1 mt-2 text-sm font-semibold">{children}</h2>,
    h3: ({ children }: { children?: ReactNode }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
    table: ({ children }: { children?: ReactNode }) => (
      <div className="my-2 overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: ReactNode }) => <thead className="bg-gray-50">{children}</thead>,
    th: ({ children }: { children?: ReactNode }) => (
      <th className="border-b border-gray-200 px-2 py-1 text-left font-semibold text-gray-700">{children}</th>
    ),
    td: ({ children }: { children?: ReactNode }) => <td className="border-b border-gray-100 px-2 py-1 align-top">{children}</td>,
    a: ({ children, href }: { children?: ReactNode; href?: string }) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 underline">
        {children}
      </a>
    ),
    code: ({ children }: { children?: ReactNode }) => (
      <code className="rounded bg-gray-100 px-1 py-0.5 text-[12px]">{children}</code>
    ),
    pre: ({ children }: { children?: ReactNode }) => (
      <pre className="my-2 overflow-auto rounded bg-gray-100 p-2 text-xs">{children}</pre>
    ),
  };

  return (
    <div className="space-y-3">
      {normalizedContent ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {normalizedContent}
        </ReactMarkdown>
      ) : null}
    </div>
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
  const [bootstrapTopic, setBootstrapTopic] = useState('');
  const [bootstrapGuide, setBootstrapGuide] = useState<BootstrapGuidePayload | null>(null);
  const [bootstrapGuideLoading, setBootstrapGuideLoading] = useState(false);
  const [bootstrapGuideError, setBootstrapGuideError] = useState('');
  const [starterQuestionLoading, setStarterQuestionLoading] = useState<string | null>(null);
  const [selectionToast, setSelectionToast] = useState<SelectionToastState | null>(null);
  const [savingSelection, setSavingSelection] = useState(false);
  const [selectionCopied, setSelectionCopied] = useState(false);
  const [knowledgeDocState, setKnowledgeDocState] = useState<{ exists: boolean; hasContent: boolean }>({
    exists: false,
    hasContent: false,
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  const selectionToastRef = useRef<HTMLDivElement>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const composingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const bootstrapGuideTopicRef = useRef('');

  const restoreSelectionRange = useCallback(() => {
    const selection = window.getSelection();
    const savedRange = selectionRangeRef.current?.cloneRange();
    if (!selection || !savedRange) return;
    try {
      selection.removeAllRanges();
      selection.addRange(savedRange);
      selectionRangeRef.current = savedRange.cloneRange();
    } catch {
      selectionRangeRef.current = null;
    }
  }, []);

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

  const fetchBootstrapGuide = useCallback(async (topic: string) => {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) return;
    setBootstrapGuideLoading(true);
    setBootstrapGuideError('');
    try {
      const res = await fetch('/api/notebooks/bootstrap/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: normalizedTopic }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBootstrapGuideError(data?.error ?? '加载引导问题失败');
        setBootstrapGuide(null);
        return;
      }
      const questions = Array.isArray(data?.questions)
        ? data.questions.filter((item: unknown): item is string => typeof item === 'string').slice(0, 3)
        : [];
      const lead = typeof data?.lead === 'string' ? data.lead.trim() : '';
      setBootstrapGuide(
        questions.length > 0
          ? {
              lead,
              questions,
            }
          : null
      );
    } finally {
      setBootstrapGuideLoading(false);
    }
  }, []);

  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setHasMore(false);
    setHistoryPage(0);
    setHistoryError('');
    setEntryMode(null);
    setResearchState(null);
    setResearchStateError('');
    setBootstrapTopic('');
    setBootstrapGuide(null);
    setBootstrapGuideLoading(false);
    setBootstrapGuideError('');
    setKnowledgeDocState({ exists: false, hasContent: false });
    bootstrapGuideTopicRef.current = '';
    if (notebookId) {
      try {
        const key = `notebook-entry:${notebookId}`;
        const nextMode = window.sessionStorage.getItem(key);
        if (nextMode === 'bootstrap') {
          setEntryMode('bootstrap');
        }
        const storedTopic = window.sessionStorage.getItem(`notebook-bootstrap-topic:${notebookId}`)?.trim() ?? '';
        setBootstrapTopic(storedTopic);
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
    if (entryMode !== 'bootstrap') return;
    const topic = (researchState?.topic ?? bootstrapTopic).trim();
    if (!topic) return;
    if (bootstrapGuideTopicRef.current === topic && bootstrapGuide) return;
    bootstrapGuideTopicRef.current = topic;
    void fetchBootstrapGuide(topic);
  }, [bootstrapGuide, bootstrapTopic, entryMode, fetchBootstrapGuide, researchState?.topic]);

  useEffect(() => {
    const onBootstrapReady = (event: Event) => {
      const detail = (event as CustomEvent<{ topic?: string }>).detail;
      const topic = typeof detail?.topic === 'string' ? detail.topic.trim() : '';
      if (topic) {
        setBootstrapTopic(topic);
        bootstrapGuideTopicRef.current = '';
        void fetchBootstrapGuide(topic);
      }
      void fetchResearchState();
    };

    window.addEventListener('bootstrap-research-ready', onBootstrapReady as EventListener);
    return () => window.removeEventListener('bootstrap-research-ready', onBootstrapReady as EventListener);
  }, [fetchBootstrapGuide, fetchResearchState]);

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
    async ({
      lastUserMessage,
      lastAssistantMessage,
      highlightedMaterials = '',
    }: {
      lastUserMessage: string;
      lastAssistantMessage: string;
      highlightedMaterials?: string;
    }) => {
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
        const currentContent = typeof docData?.content === 'string' ? docData.content : '';
        const updateRes = await fetch(
          `/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc/update-from-chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentContent,
              lastUserMessage,
              lastAssistantMessage,
              highlightedMaterials,
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
        x: Math.min(window.innerWidth - 248, Math.max(12, tailRect.right + 8)),
        y: Math.max(12, preferredY),
      } satisfies SelectionToastState;
    };

    const updateSelectionToast = (event?: MouseEvent | KeyboardEvent) => {
      const eventTarget = event?.target;
      if (
        eventTarget instanceof Node &&
        selectionToastRef.current &&
        selectionToastRef.current.contains(eventTarget)
      ) {
        restoreSelectionRange();
        return;
      }
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
      }, 140);
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
  }, [restoreSelectionRange]);

  useEffect(() => {
    if (!selectionToast || !selectionRangeRef.current) return;
    let frameA = 0;
    let frameB = 0;
    const timer = window.setTimeout(() => {
      restoreSelectionRange();
    }, 90);

    frameA = window.requestAnimationFrame(() => {
      restoreSelectionRange();
      frameB = window.requestAnimationFrame(() => {
        restoreSelectionRange();
      });
    });

    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
      window.clearTimeout(timer);
    };
  }, [restoreSelectionRange, selectionToast]);

  useEffect(() => {
    if (!selectionCopied) return;
    const timer = window.setTimeout(() => setSelectionCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [selectionCopied]);

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
        if (shouldSyncKnowledgeDocFromMessage(text)) {
          void updateKnowledgeDocFromChat({
            lastUserMessage: text,
            lastAssistantMessage: data.answer,
            highlightedMaterials: buildHighlightedMaterialsFromCitations(normalizedCitations),
          }).catch((error) => {
            console.error('Failed to sync knowledge document from chat command', error);
          });
        }
        setTailVersion((v) => v + 1);
      } finally {
        setLoading(false);
      }
    },
    [conversationId, input, loading, notebookId, updateKnowledgeDocFromChat]
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

    if (loadingResearchState || bootstrapGuideLoading) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs text-gray-500 dark:text-gray-400">正在准备引导问题...</p>
        </div>
      );
    }
    if (bootstrapGuideError && !bootstrapGuide) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
          {bootstrapGuideError}
        </div>
      );
    }
    if (researchStateError && !bootstrapGuide) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
          {researchStateError}
        </div>
      );
    }
    if (researchState && (researchState.phase === 'collecting' || researchState.phase === 'analyzing')) {
      return (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
          正在联网检索首批来源…
        </div>
      );
    }

    if (bootstrapGuide && bootstrapGuide.questions.length > 0) {
      return (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">不如先从这些问题开始：</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {bootstrapGuide.lead || `主题：${(researchState?.topic ?? bootstrapTopic).trim() || '当前任务'}。`}
              点击后会直接发到对话里，我会继续顺着你的回答往下追问。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {bootstrapGuide.questions.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => void askBootstrapGuideQuestion(question)}
                disabled={loading}
                className="rounded-[12px] border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-xs text-gray-700 transition hover:border-gray-300 hover:bg-white disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-600"
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
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="flex h-12 shrink-0 items-center px-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          知识库问答
        </h2>
      </div>
      <ScrollArea className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-1">
        <div ref={chatContentRef} className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
          {renderResearchSection()}
          {loadingHistory ? (
            <div className="text-center text-xs text-gray-500 dark:text-gray-400">Loading chat history...</div>
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
                    className={
                      m.role === 'user'
                        ? 'ml-auto mr-0 w-fit max-w-[240px] rounded-[20px] bg-[#f1f1f1] px-3 py-2 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                        : 'ml-0 mr-auto w-full max-w-[680px]'
                    }
                  >
                    <div className="text-sm">
                      <MarkdownContent content={parsed.displayContent} />
                    </div>
                    {m.role === 'assistant' && (
                      <>
                        {!refineDone && messageAction?.type === 'update_doc' ? (
                          <div className="mt-3">
                            <div className="flex flex-wrap items-center gap-2">
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
                                  await updateKnowledgeDocFromChat({
                                    lastUserMessage: prevUser?.content ?? '',
                                    lastAssistantMessage: parsed.displayContent,
                                    highlightedMaterials: buildHighlightedMaterialsFromCitations(m.citations),
                                  });
                                }}
                              >
                                更新知识文档
                              </button>
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
                                  className="rounded-[12px] border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[11px] text-gray-700 transition hover:bg-white disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
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
                        {!refineDone && messageAction?.type === 'create_doc' ? (
                          <div className="mt-3">
                            <KnowledgeDocCreateButton
                              onClick={requestKnowledgeDocCreate}
                              compact
                              className="h-7 px-3"
                            />
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {loading && (
            <div className="ml-0 mr-auto w-full max-w-[680px] py-1 text-sm text-gray-500 dark:text-gray-400">
              <ShinyText
                text={`Thinking... ${thinkingSeconds}s`}
                className="text-sm font-medium text-gray-500 dark:text-gray-400"
                speed={2.2}
                color="#9ca3af"
                shineColor="#ffffff"
              />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      {selectionToast ? (
        <div
          ref={selectionToastRef}
          className="fixed z-50 flex items-center gap-2 rounded-[14px] border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          style={{ left: selectionToast.x, top: selectionToast.y }}
          onPointerDown={(event) => {
            event.preventDefault();
            restoreSelectionRange();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            restoreSelectionRange();
          }}
          onMouseEnter={() => restoreSelectionRange()}
        >
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-[10px] border border-gray-200 bg-white px-3 text-[11px] font-medium text-gray-900 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            onPointerDown={(event) => {
              event.preventDefault();
              restoreSelectionRange();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              restoreSelectionRange();
            }}
            onClick={async () => {
              if (savingSelection) return;
              setSavingSelection(true);
              try {
                const content =
                  (selectionRangeRef.current?.cloneContents().textContent ?? selectionToast.text).trim();
                if (!content) return;
                await updateKnowledgeDocFromChat({
                  lastUserMessage: '',
                  lastAssistantMessage: '',
                  highlightedMaterials: content,
                });
                setSelectionToast(null);
              } catch (error) {
                alert(error instanceof Error ? error.message : '更新知识文档失败');
              } finally {
                setSavingSelection(false);
              }
            }}
            disabled={savingSelection}
          >
            {savingSelection ? '更新中…' : '更新到知识库'}
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-[10px] border border-gray-200 bg-white px-3 text-[11px] font-medium text-gray-900 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            onPointerDown={(event) => {
              event.preventDefault();
              restoreSelectionRange();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              restoreSelectionRange();
            }}
            onClick={async () => {
              const content =
                (selectionRangeRef.current?.cloneContents().textContent ?? selectionToast.text).trim();
              if (!content) return;
              try {
                await copyTextToClipboard(content);
                setSelectionCopied(true);
              } catch (error) {
                alert(error instanceof Error ? error.message : '复制失败');
              }
            }}
          >
            {selectionCopied ? '已复制' : '复制'}
          </button>
        </div>
      ) : null}
      <div className="relative z-10 shrink-0 bg-white px-3 pb-3 pt-2">
        <div className="mx-auto w-full max-w-[680px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (composingRef.current || isImeCommitRecentlyEnded(compositionEndedAtRef.current)) return;
              void send();
            }}
            className="relative rounded-[20px] bg-[#f1f1f1] p-2"
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
                compositionEndedAtRef.current = Date.now();
              }}
              onKeyDown={(e) => {
                const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
                if (
                  shouldIgnoreEnterForIme({
                    nativeEvent,
                    composing: composingRef.current,
                    lastCompositionEndAt: compositionEndedAtRef.current,
                  })
                ) {
                  return;
                }
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
              className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-[12px] bg-black text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
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

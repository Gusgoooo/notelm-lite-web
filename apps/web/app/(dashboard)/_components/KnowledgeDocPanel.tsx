'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import DiffMatchPatch from 'diff-match-patch';

type KnowledgeDocPanelProps = {
  notebookId: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      {collapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
    </svg>
  );
}

function stripHtml(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? div.innerText ?? '').replace(/\s+/g, ' ').trim();
}

function DiffView({
  oldText,
  newText,
  className,
}: {
  oldText: string;
  newText: string;
  className?: string;
}) {
  const dmp = new DiffMatchPatch();
  const diff = dmp.diff_main(oldText || '', newText || '');
  dmp.diff_cleanupSemantic(diff);

  return (
    <div className={className}>
      {diff.map((part, i) => {
        const [op, text] = part;
        if (!text) return null;
        if (op === 0) {
          return <span key={i}>{text}</span>;
        }
        if (op === -1) {
          return (
            <span key={i} className="bg-red-200 dark:bg-red-900/50 text-red-900 dark:text-red-100 line-through">
              {text}
            </span>
          );
        }
        return (
          <span key={i} className="bg-green-200 dark:bg-green-900/50 text-green-900 dark:text-green-100">
            {text}
          </span>
        );
      })}
    </div>
  );
}

export function KnowledgeDocPanel({
  notebookId,
  collapsed = false,
  onToggleCollapse,
}: KnowledgeDocPanelProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<{ previous: string; suggested: string } | null>(null);
  const [updatingFromChat, setUpdatingFromChat] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialContentRef = useRef<string | null>(null);

  const fetchDoc = useCallback(async () => {
    if (!notebookId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setContent('');
        return;
      }
      const html = typeof data?.content === 'string' ? data.content : '';
      setContent(html || '<p></p>');
      initialContentRef.current = html || '<p></p>';
    } finally {
      setLoading(false);
    }
  }, [notebookId]);

  useEffect(() => {
    void fetchDoc();
  }, [fetchDoc]);

  const saveDoc = useCallback(
    async (html: string) => {
      if (!notebookId || saving) return;
      setSaving(true);
      try {
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: html }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const next = typeof data?.content === 'string' ? data.content : html;
          initialContentRef.current = next;
        }
      } finally {
        setSaving(false);
      }
    },
    [notebookId, saving]
  );

  const editor = useEditor({
    extensions: [StarterKit],
    content,
    editable: !!notebookId && !pendingDiff,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        void saveDoc(html);
      }, 800);
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[200px] px-3 py-2 focus:outline-none text-gray-900 dark:text-gray-100',
      },
    },
  });

  useEffect(() => {
    if (!editor || loading) return;
    const current = editor.getHTML();
    const target = content || '<p></p>';
    if (target !== current && (initialContentRef.current === target || !initialContentRef.current)) {
      editor.commands.setContent(target, false);
    }
  }, [content, editor, loading]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ suggestedContent: string; autoApply?: boolean }>).detail;
      const suggested = typeof detail?.suggestedContent === 'string' ? detail.suggestedContent : '';
      if (!suggested) return;
      const previous = editor ? stripHtml(editor.getHTML()) : '';
      if (detail?.autoApply || autoUpdate) {
        setUpdatingFromChat(true);
        const newHtml = suggested
          .split(/\n\n+/)
          .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
          .join('');
        editor?.commands.setContent(newHtml || '<p></p>', false);
        void saveDoc(newHtml || '<p></p>');
        setPendingDiff(null);
        setUpdatingFromChat(false);
      } else {
        setPendingDiff({ previous, suggested });
      }
    };
    window.addEventListener('knowledge-doc-update-from-chat', onUpdate as EventListener);
    return () => window.removeEventListener('knowledge-doc-update-from-chat', onUpdate as EventListener);
  }, [autoUpdate, editor, saveDoc]);

  useEffect(() => {
    if (!autoUpdate || !notebookId || !editor) return;
    const onAnswer = async (event: Event) => {
      const detail = (event as CustomEvent<{ user_question?: string; assistant_answer?: string }>).detail;
      const userQ = typeof detail?.user_question === 'string' ? detail.user_question : '';
      const assistantA = typeof detail?.assistant_answer === 'string' ? detail.assistant_answer : '';
      if (!userQ.trim() && !assistantA.trim()) return;
      setUpdatingFromChat(true);
      try {
        const currentContent = stripHtml(editor.getHTML());
        const res = await fetch(
          `/api/notebooks/${encodeURIComponent(notebookId)}/knowledge-doc/update-from-chat`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentContent,
              lastUserMessage: userQ,
              lastAssistantMessage: assistantA,
            }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.suggestedContent) {
          setUpdatingFromChat(false);
          return;
        }
        const newHtml = (data.suggestedContent as string)
          .split(/\n\n+/)
          .map((p: string) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
          .join('');
        editor.commands.setContent(newHtml || '<p></p>', false);
        void saveDoc(newHtml || '<p></p>');
      } finally {
        setUpdatingFromChat(false);
      }
    };
    window.addEventListener('knowledge-unit-trigger', onAnswer as EventListener);
    return () => window.removeEventListener('knowledge-unit-trigger', onAnswer as EventListener);
  }, [autoUpdate, notebookId, editor, saveDoc]);

  const confirmPending = useCallback(() => {
    if (!pendingDiff || !editor) return;
    const newHtml = pendingDiff.suggested
      .split(/\n\n+/)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
    editor.commands.setContent(newHtml || '<p></p>', false);
    void saveDoc(newHtml || '<p></p>');
    setPendingDiff(null);
  }, [pendingDiff, editor, saveDoc]);

  const rejectPending = useCallback(() => {
    setPendingDiff(null);
  }, []);

  const openCreationPanel = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-creation-panel'));
  }, []);

  if (!notebookId) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex h-14 items-center justify-between px-3">
          {!collapsed ? (
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              知识文档
            </h2>
          ) : null}
          {onToggleCollapse ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              aria-label={collapsed ? '展开知识文档' : '收起知识文档'}
              title={collapsed ? '展开知识文档' : '收起知识文档'}
            >
              <CollapseIcon collapsed={collapsed} />
            </button>
          ) : null}
        </div>
        {collapsed ? null : (
          <div className="flex flex-1 items-center justify-center p-4 text-sm text-gray-400 dark:text-gray-500">
          请先选择 notebook
          </div>
        )}
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center px-2 py-3">
        <div className="flex h-8 w-full items-center justify-center">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label="展开知识文档"
            title="展开知识文档"
          >
            <CollapseIcon collapsed />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          知识文档
        </h2>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <span className="text-xs text-gray-600 dark:text-gray-400">自动更新</span>
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={(e) => setAutoUpdate(e.target.checked)}
              className="h-3.5 w-7 rounded-full border border-gray-300 bg-gray-200 dark:border-gray-600 dark:bg-gray-700 accent-gray-800"
            />
          </label>
          {onToggleCollapse ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              aria-label="收起知识文档"
              title="收起知识文档"
            >
              <CollapseIcon collapsed={false} />
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center p-4 text-xs text-gray-500 dark:text-gray-400">
          加载中…
        </div>
      ) : pendingDiff ? (
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
            <span className="text-xs text-gray-600 dark:text-gray-400">AI 建议修改（红=旧，绿=新）</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={rejectPending}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-300"
              >
                放弃
              </button>
              <button
                type="button"
                onClick={confirmPending}
                className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900"
              >
                确认修改
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
            <DiffView
              oldText={pendingDiff.previous}
              newText={pendingDiff.suggested}
              className="min-h-[120px]"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="min-h-[200px]">
            <EditorContent editor={editor} />
          </div>
          {saving && (
            <p className="px-3 pb-1 text-[10px] text-gray-400 dark:text-gray-500">保存中…</p>
          )}
        </div>
      )}

      {updatingFromChat && (
        <p className="px-3 py-1 text-xs text-blue-600 dark:text-blue-400">正在根据对话更新文档…</p>
      )}

      <div className="flex shrink-0 justify-center border-t border-gray-200 py-3 dark:border-gray-800">
        <button
          type="button"
          onClick={openCreationPanel}
          className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          去创作
        </button>
      </div>
    </div>
  );
}

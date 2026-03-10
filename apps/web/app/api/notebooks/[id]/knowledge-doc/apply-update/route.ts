import { NextResponse } from 'next/server';
import { and, db, eq, notes } from 'db';
import { applyDocPreviewPayload } from '@/lib/knowledge-doc-apply';
import {
  mergeAnswerIntoKnowledgeDoc,
  type QaMergeCitation,
} from '@/lib/knowledge-doc-qa-merge';
import { ensureKnowledgeDocMarkdown } from '@/lib/knowledge-doc-markdown';
import { getNotebookAccess } from '@/lib/notebook-access';
import { KNOWLEDGE_DOC_NOTE_TITLE } from '@/lib/knowledge-unit';

type AssistantMode = 'qa' | 'edit';
type EditApplyMode = 'patch' | 'replace';
type LastAssistantState = {
  mode: AssistantMode;
  responseText: string;
  previewContent?: string;
  sourceSupported?: boolean;
  activeDocId?: string;
  applyMode?: EditApplyMode;
};

function normalizeAssistantMode(value: unknown): AssistantMode | null {
  if (value === 'qa' || value === 'edit') return value;
  return null;
}

function normalizeEditApplyMode(value: unknown): EditApplyMode {
  return value === 'replace' ? 'replace' : 'patch';
}

function normalizeCitations(value: unknown): QaMergeCitation[] {
  if (!Array.isArray(value)) return [];
  const out: QaMergeCitation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const sourceTitle =
      typeof row.sourceTitle === 'string'
        ? row.sourceTitle
        : typeof row.source_title === 'string'
          ? row.source_title
          : '';
    const snippet = typeof row.snippet === 'string' ? row.snippet : '';
    if (!sourceTitle.trim() || !snippet.trim()) continue;
    out.push({
      sourceTitle: sourceTitle.trim(),
      snippet: snippet.trim(),
      pageStart: typeof row.pageStart === 'number' ? row.pageStart : undefined,
      pageEnd: typeof row.pageEnd === 'number' ? row.pageEnd : undefined,
      refNumber: typeof row.refNumber === 'number' ? row.refNumber : undefined,
    });
  }
  return out;
}

function toUserFacingBlockedSummary(blockedReason: string | undefined, fallbackSummary: string): string {
  if (blockedReason === 'INSUFFICIENT_SOURCES') {
    return '当前回答证据不足，暂未写入知识文档。请先补充来源后再更新。';
  }
  if (blockedReason === 'NO_EFFECTIVE_NEW_INFO') {
    return '本轮没有可写入的新增信息，知识文档保持不变。';
  }
  if (blockedReason === 'INVALID_MERGE_PAYLOAD') {
    return '本轮暂无可应用改动，知识文档保持不变。';
  }
  const normalized = fallbackSummary.trim();
  return normalized || '本轮没有可应用的更新，知识文档保持不变。';
}

function normalizeLastAssistantState(value: unknown, fallbackBody: Record<string, unknown>): LastAssistantState | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    const mode = normalizeAssistantMode(row.mode);
    const responseText = typeof row.responseText === 'string' ? row.responseText.trim() : '';
    if (mode && responseText) {
      return {
        mode,
        responseText,
        previewContent: typeof row.previewContent === 'string' ? row.previewContent : undefined,
        sourceSupported: typeof row.sourceSupported === 'boolean' ? row.sourceSupported : undefined,
        activeDocId: typeof row.activeDocId === 'string' ? row.activeDocId : undefined,
        applyMode: normalizeEditApplyMode(row.applyMode),
      };
    }
  }

  // Backward compatibility for old message payloads.
  const legacyIntent = fallbackBody.lastIntentType;
  if (legacyIntent === 'qa' || legacyIntent === 'doc_edit' || legacyIntent === 'doc_replace') {
    const previewPayload =
      fallbackBody.previewPayload && typeof fallbackBody.previewPayload === 'object'
        ? (fallbackBody.previewPayload as Record<string, unknown>)
        : {};
    const previewContent =
      typeof previewPayload.previewContent === 'string'
        ? previewPayload.previewContent
        : typeof previewPayload.suggestedContent === 'string'
          ? previewPayload.suggestedContent
          : typeof previewPayload.suggested_markdown === 'string'
            ? previewPayload.suggested_markdown
            : undefined;
    const sourceSupported =
      typeof previewPayload.sourceSupported === 'boolean'
        ? previewPayload.sourceSupported
        : typeof previewPayload.sourceSufficient === 'boolean'
          ? previewPayload.sourceSufficient
          : undefined;
    const responseText =
      typeof fallbackBody.lastAssistantMessage === 'string'
        ? fallbackBody.lastAssistantMessage.trim()
        : '';
    if (!responseText) return null;
    return {
      mode: legacyIntent === 'qa' ? 'qa' : 'edit',
      responseText,
      previewContent,
      sourceSupported,
      activeDocId: typeof fallbackBody.activeDocId === 'string' ? fallbackBody.activeDocId : undefined,
      applyMode: legacyIntent === 'doc_replace' ? 'replace' : 'patch',
    };
  }
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: notebookId } = await params;
  try {
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const lastState = normalizeLastAssistantState(body?.lastState, body);
    if (!lastState) {
      return NextResponse.json({ error: 'Invalid lastState' }, { status: 400 });
    }

    const [docRow] = await db
      .select({ id: notes.id, content: notes.content })
      .from(notes)
      .where(and(eq(notes.notebookId, notebookId), eq(notes.title, KNOWLEDGE_DOC_NOTE_TITLE)))
      .limit(1);
    const currentContent = ensureKnowledgeDocMarkdown(
      typeof docRow?.content === 'string' ? docRow.content : ''
    );

    if (lastState.mode === 'qa') {
      const citations = normalizeCitations(body?.citations);
      const mergeResult = mergeAnswerIntoKnowledgeDoc(
        lastState.responseText,
        currentContent,
        typeof lastState.sourceSupported === 'boolean'
          ? lastState.sourceSupported
          : citations.length > 0
      );
      if (!mergeResult.updated || !mergeResult.suggestedContent) {
        const blockedSummary = toUserFacingBlockedSummary(mergeResult.blockedReason, mergeResult.summary);
        console.info(
          '[knowledge-doc-apply]',
          JSON.stringify({
            userMessage: typeof body?.lastUserMessage === 'string' ? body.lastUserMessage : '',
            mode: lastState.mode,
            show_update_button: true,
            update_applied: false,
            update_summary: blockedSummary,
          })
        );
        return NextResponse.json({
          updated: false,
          changeType: mergeResult.changeType,
          changedSections: mergeResult.changedSections,
          summary: blockedSummary,
          blockedReason: mergeResult.blockedReason ?? null,
          candidateStats: mergeResult.candidateStats,
        });
      }
      console.info(
        '[knowledge-doc-apply]',
        JSON.stringify({
          userMessage: typeof body?.lastUserMessage === 'string' ? body.lastUserMessage : '',
          mode: lastState.mode,
          show_update_button: true,
          update_applied: true,
          update_summary: mergeResult.summary,
        })
      );
      return NextResponse.json({
        updated: true,
        suggestedContent: mergeResult.suggestedContent,
        changeType: mergeResult.changeType,
        changedSections: mergeResult.changedSections,
        summary: mergeResult.summary,
        blockedReason: null,
        candidateStats: mergeResult.candidateStats,
      });
    }

    const previewApply = applyDocPreviewPayload({
      lastIntentType: lastState.applyMode === 'replace' ? 'doc_replace' : 'doc_edit',
      previewPayload:
        typeof lastState.previewContent === 'string'
          ? { suggestedContent: lastState.previewContent }
          : body?.previewPayload,
      currentDocContent: currentContent,
    });
    if (!previewApply.updated || !previewApply.suggestedContent) {
      const blockedSummary = toUserFacingBlockedSummary(previewApply.blockedReason, previewApply.summary);
      console.info(
        '[knowledge-doc-apply]',
        JSON.stringify({
          userMessage: typeof body?.lastUserMessage === 'string' ? body.lastUserMessage : '',
          mode: lastState.mode,
          show_update_button: true,
          update_applied: false,
          update_summary: blockedSummary,
        })
      );
      return NextResponse.json({
        updated: false,
        changeType: previewApply.changeType,
        changedSections: [],
        summary: blockedSummary,
        blockedReason: previewApply.blockedReason ?? 'NO_EFFECTIVE_NEW_INFO',
      });
    }

    console.info(
      '[knowledge-doc-apply]',
      JSON.stringify({
        userMessage: typeof body?.lastUserMessage === 'string' ? body.lastUserMessage : '',
        mode: lastState.mode,
        show_update_button: true,
        update_applied: true,
        update_summary: previewApply.summary,
      })
    );
    return NextResponse.json({
      updated: true,
      suggestedContent: previewApply.suggestedContent,
      changeType: previewApply.changeType,
      changedSections: [],
      summary: previewApply.summary,
      blockedReason: null,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to apply knowledge document update' }, { status: 500 });
  }
}

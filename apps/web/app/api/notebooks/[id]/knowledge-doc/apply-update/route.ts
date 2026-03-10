import { NextResponse } from 'next/server';
import { and, db, eq, notes } from 'db';
import { applyDocPreviewPayload } from '@/lib/knowledge-doc-apply';
import { mergeQaAnswerIntoKnowledgeDoc, type QaMergeCitation } from '@/lib/knowledge-doc-qa-merge';
import { getNotebookAccess } from '@/lib/notebook-access';
import { KNOWLEDGE_DOC_NOTE_TITLE } from '@/lib/knowledge-unit';

type IntentType = 'qa' | 'doc_edit' | 'doc_replace';

function normalizeIntentType(value: unknown): IntentType | null {
  if (value === 'qa' || value === 'doc_edit' || value === 'doc_replace') return value;
  return null;
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

    const body = await request.json().catch(() => ({}));
    const lastIntentType = normalizeIntentType(body?.lastIntentType);
    if (!lastIntentType) {
      return NextResponse.json({ error: 'Invalid lastIntentType' }, { status: 400 });
    }

    const [docRow] = await db
      .select({ id: notes.id, content: notes.content })
      .from(notes)
      .where(and(eq(notes.notebookId, notebookId), eq(notes.title, KNOWLEDGE_DOC_NOTE_TITLE)))
      .limit(1);
    const currentContent = typeof docRow?.content === 'string' ? docRow.content : '';

    if (lastIntentType === 'qa') {
      const mergeResult = await mergeQaAnswerIntoKnowledgeDoc({
        answerPayload: {
          question: typeof body?.lastUserMessage === 'string' ? body.lastUserMessage : '',
          answer: typeof body?.lastAssistantMessage === 'string' ? body.lastAssistantMessage : '',
        },
        currentDocContent: currentContent,
        citations: normalizeCitations(body?.citations),
      });
      if (!mergeResult.updated || !mergeResult.suggestedContent) {
        const blockedSummary = toUserFacingBlockedSummary(mergeResult.blockedReason, mergeResult.summary);
        return NextResponse.json({
          updated: false,
          changeType: mergeResult.changeType,
          changedSections: mergeResult.changedSections,
          summary: blockedSummary,
          blockedReason: mergeResult.blockedReason ?? null,
          candidateStats: mergeResult.candidateStats,
        });
      }
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
      lastIntentType,
      previewPayload: body?.previewPayload,
      currentDocContent: currentContent,
    });
    if (!previewApply.updated || !previewApply.suggestedContent) {
      const blockedSummary = toUserFacingBlockedSummary(previewApply.blockedReason, previewApply.summary);
      return NextResponse.json({
        updated: false,
        changeType: previewApply.changeType,
        changedSections: [],
        summary: blockedSummary,
        blockedReason: previewApply.blockedReason ?? 'NO_EFFECTIVE_NEW_INFO',
      });
    }

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

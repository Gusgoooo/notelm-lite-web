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
        return NextResponse.json({
          updated: false,
          changeType: mergeResult.changeType,
          changedSections: mergeResult.changedSections,
          summary: mergeResult.summary,
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
      return NextResponse.json({
        updated: false,
        changeType: previewApply.changeType,
        changedSections: [],
        summary: previewApply.summary,
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

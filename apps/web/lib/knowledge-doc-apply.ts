import { normalizeKnowledgeDocMarkdown } from './knowledge-doc-markdown';

export type DocApplyIntentType = 'doc_edit' | 'doc_replace';

export type DocApplyPreviewResult = {
  updated: boolean;
  suggestedContent: string | null;
  changeType: 'minor_refinement' | 'new_fact' | 'none';
  summary: string;
  blockedReason?: 'NO_EFFECTIVE_NEW_INFO';
};

function extractSuggestedContent(previewPayload: unknown): string {
  if (!previewPayload || typeof previewPayload !== 'object') return '';
  const row = previewPayload as Record<string, unknown>;
  if (typeof row.suggestedContent === 'string') return row.suggestedContent;
  if (typeof row.suggested_markdown === 'string') return row.suggested_markdown;
  if (typeof row.previewMarkdown === 'string') return row.previewMarkdown;
  return '';
}

export function applyDocPreviewPayload(input: {
  lastIntentType: DocApplyIntentType;
  previewPayload: unknown;
  currentDocContent: string;
}): DocApplyPreviewResult {
  const normalizedCurrent = normalizeKnowledgeDocMarkdown(input.currentDocContent);
  const normalizedSuggested = normalizeKnowledgeDocMarkdown(extractSuggestedContent(input.previewPayload));
  if (!normalizedSuggested || normalizedSuggested === normalizedCurrent) {
    return {
      updated: false,
      suggestedContent: null,
      changeType: 'none',
      summary: '预览中没有可应用的新增内容，未写入知识文档。',
      blockedReason: 'NO_EFFECTIVE_NEW_INFO',
    };
  }

  return {
    updated: true,
    suggestedContent: normalizedSuggested,
    changeType: input.lastIntentType === 'doc_replace' ? 'new_fact' : 'minor_refinement',
    summary: input.lastIntentType === 'doc_replace' ? '已应用整篇替换预览。' : '已应用局部更新预览。',
  };
}

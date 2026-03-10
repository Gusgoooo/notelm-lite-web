import { describe, it, expect } from 'vitest';
import { applyDocPreviewPayload } from '../lib/knowledge-doc-apply.ts';
import { mergeAnswerIntoKnowledgeDoc } from '../lib/knowledge-doc-qa-merge.ts';

describe('knowledge doc update flow', () => {
  it('普通问答 -> 点击按钮后做最小增量更新', () => {
    const result = mergeAnswerIntoKnowledgeDoc(
      'RAG 的核心价值是让回答可追溯，并显著降低幻觉风险。',
      '# 核心概念\n\n## 核心要点\n- 向量检索',
      true
    );
    expect(result.updated).toBe(true);
    expect(result.suggestedContent).toContain('RAG');
    expect(result.changeType === 'new_concept' || result.changeType === 'new_fact' || result.changeType === 'minor_refinement').toBe(true);
  });

  it('普通问答但无新增 -> 点击按钮后不更新', () => {
    const result = mergeAnswerIntoKnowledgeDoc(
      '向量检索是当前文档已包含的核心要点。',
      '# 核心概念\n\n## 核心要点\n- 向量检索是当前文档已包含的核心要点',
      true
    );
    expect(result.updated).toBe(false);
    expect(result.blockedReason).toBe('NO_EFFECTIVE_NEW_INFO');
  });

  it('普通问答但来源不足 -> 点击按钮后不更新', () => {
    const result = mergeAnswerIntoKnowledgeDoc(
      '建议先小范围试点后再扩大。',
      '# 决策建议\n\n## 核心要点\n- 先确认目标',
      false
    );
    expect(result.updated).toBe(false);
    expect(result.blockedReason).toBe('INSUFFICIENT_SOURCES');
  });

  it('修改请求 -> 返回修改预览 -> 点击按钮后应用预览', () => {
    const result = applyDocPreviewPayload({
      lastIntentType: 'doc_edit',
      previewPayload: {
        suggestedContent: '# 目标\n\n## 核心要点\n- 新增一条执行要点',
      },
      currentDocContent: '# 目标\n\n## 核心要点\n- 原有要点',
    });
    expect(result.updated).toBe(true);
    expect(result.changeType).toBe('minor_refinement');
  });

  it('删除/精简类请求 -> 只做局部修改', () => {
    const result = applyDocPreviewPayload({
      lastIntentType: 'doc_edit',
      previewPayload: {
        suggestedContent: '# 报告\n\n## 背景\n- 保留核心背景\n\n## 方案\n- 仅保留关键动作',
      },
      currentDocContent:
        '# 报告\n\n## 背景\n- 保留核心背景\n- 删除冗余描述\n\n## 方案\n- 仅保留关键动作\n- 删除次要动作',
    });
    expect(result.updated).toBe(true);
    expect(result.changeType).toBe('minor_refinement');
  });

  it('替换类请求 -> 点击按钮后整体替换', () => {
    const result = applyDocPreviewPayload({
      lastIntentType: 'doc_replace',
      previewPayload: {
        suggested_markdown: '# 新版文档\n\n## 核心要点\n- 全量替换内容',
      },
      currentDocContent: '# 旧版文档\n\n## 核心要点\n- 旧内容',
    });
    expect(result.updated).toBe(true);
    expect(result.changeType).toBe('new_fact');
  });
});

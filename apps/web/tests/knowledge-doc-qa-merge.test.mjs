import { describe, it, expect } from 'vitest';
import { applyDocPreviewPayload } from '../lib/knowledge-doc-apply.ts';
import { mergeQaAnswerIntoKnowledgeDoc } from '../lib/knowledge-doc-qa-merge.ts';

describe('knowledge doc apply + qa merge', () => {
  it('qa 点击更新后执行最小增量写入', async () => {
    const result = await mergeQaAnswerIntoKnowledgeDoc(
      {
        answerPayload: {
          question: 'RAG 的核心价值是什么？',
          answer: 'RAG 的核心价值是让答案可追溯并降低幻觉。',
        },
        currentDocContent: '# 核心概念\n- 向量检索',
        citations: [
          {
            sourceTitle: 'paper-a',
            snippet: 'RAG improves factual grounding.',
            refNumber: 1,
          },
        ],
      },
      {
        chatFn: async () => ({
          content: JSON.stringify({
            source_sufficient: true,
            has_effective_new_info: true,
            updated_markdown: '# 核心概念\n- 向量检索\n- RAG 提升可追溯性并降低幻觉',
            change_type: 'new_fact',
            changed_sections: ['核心概念'],
            summary: '新增了 RAG 的事实性价值补充',
            candidates: [
              {
                category: 'new_fact',
                text: 'RAG 提升可追溯性并降低幻觉',
                target_section: '核心概念',
                action: 'insert',
              },
            ],
          }),
        }),
      }
    );
    expect(result.updated).toBe(true);
    expect(result.changeType).toBe('new_fact');
    expect(result.changedSections).toContain('核心概念');
  });

  it('qa 合并产出为无效格式时不应覆盖文档', async () => {
    const result = await mergeQaAnswerIntoKnowledgeDoc(
      {
        answerPayload: {
          question: '补充这个结论',
          answer: '补充一个执行建议。',
        },
        currentDocContent: '# 决策建议\n- 保留原内容',
        citations: [
          {
            sourceTitle: 'paper-a',
            snippet: 'keep original content',
            refNumber: 1,
          },
        ],
      },
      {
        chatFn: async () => ({
          content: JSON.stringify({
            source_sufficient: true,
            has_effective_new_info: true,
            updated_markdown: '<div><span>这是 HTML 不是 markdown</span></div>',
            change_type: 'minor_refinement',
            changed_sections: ['决策建议'],
            summary: '新增执行建议',
            candidates: [
              {
                category: 'minor_refinement',
                text: '新增执行建议',
                target_section: '决策建议',
                action: 'insert',
              },
            ],
          }),
        }),
      }
    );
    expect(result.updated).toBe(false);
    expect(result.blockedReason).toBe('INVALID_MERGE_PAYLOAD');
  });

  it('qa 点击更新但无新增时不更新', async () => {
    const result = await mergeQaAnswerIntoKnowledgeDoc(
      {
        answerPayload: {
          question: '再总结一次',
          answer: '核心结论与当前文档一致。',
        },
        currentDocContent: '# 核心结论\n- 当前文档已有该结论',
        citations: [
          {
            sourceTitle: 'paper-a',
            snippet: 'already covered fact',
            refNumber: 1,
          },
        ],
      },
      {
        chatFn: async () => ({
          content: JSON.stringify({
            source_sufficient: true,
            has_effective_new_info: false,
            updated_markdown: '# 核心结论\n- 当前文档已有该结论',
            change_type: 'none',
            changed_sections: [],
            summary: '无新增信息',
            candidates: [
              {
                category: 'duplicate',
                text: '当前文档已有该结论',
                target_section: '核心结论',
                action: 'skip',
              },
            ],
          }),
        }),
      }
    );
    expect(result.updated).toBe(false);
    expect(result.blockedReason).toBe('NO_EFFECTIVE_NEW_INFO');
  });

  it('qa 无来源时也可执行最小增量写入', async () => {
    const result = await mergeQaAnswerIntoKnowledgeDoc(
      {
        answerPayload: {
          question: '这个结论靠谱吗？',
          answer: '当前看法是先做小范围试点，再根据反馈扩大范围。',
        },
        currentDocContent: '# 决策建议\n- 先确认目标',
        citations: [],
      },
      {
        chatFn: async () => ({
          content: JSON.stringify({
            source_sufficient: false,
            has_effective_new_info: true,
            updated_markdown: '# 决策建议\n- 先确认目标\n- 先做小范围试点，再根据反馈扩大范围',
            change_type: 'minor_refinement',
            changed_sections: ['决策建议'],
            summary: '新增了试点推进的执行建议',
            candidates: [
              {
                category: 'minor_refinement',
                text: '先做小范围试点，再根据反馈扩大范围',
                target_section: '决策建议',
                action: 'insert',
              },
            ],
          }),
        }),
      }
    );
    expect(result.updated).toBe(true);
    expect(result.changeType).toBe('minor_refinement');
    expect(result.changedSections).toContain('决策建议');
  });

  it('doc_edit 点击按钮后应用局部更新', () => {
    const result = applyDocPreviewPayload({
      lastIntentType: 'doc_edit',
      previewPayload: {
        suggestedContent: '# 目标\n- 新增一条执行要点',
      },
      currentDocContent: '# 目标\n- 原有要点',
    });
    expect(result.updated).toBe(true);
    expect(result.changeType).toBe('minor_refinement');
  });

  it('doc_replace 点击按钮后应用整篇替换', () => {
    const result = applyDocPreviewPayload({
      lastIntentType: 'doc_replace',
      previewPayload: {
        suggested_markdown: '# 新版文档\n- 全量替换内容',
      },
      currentDocContent: '# 旧版文档\n- 旧内容',
    });
    expect(result.updated).toBe(true);
    expect(result.changeType).toBe('new_fact');
  });
});

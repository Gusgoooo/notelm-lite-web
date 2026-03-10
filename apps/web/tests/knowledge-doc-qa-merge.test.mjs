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

  it('当前文档为 HTML 时，增量更新不应破坏标题结构', () => {
    const htmlDoc = '<h1>项目文档</h1><h2>核心要点</h2><ul><li>已有要点</li></ul>';
    const result = mergeAnswerIntoKnowledgeDoc(
      '新增事实：本周转化率提升 12%，需要补充到核心要点。',
      htmlDoc,
      true
    );
    expect(result.updated).toBe(true);
    const next = result.suggestedContent ?? '';
    const h1Count = (next.match(/^#\s+/gm) ?? []).length;
    expect(h1Count).toBeLessThanOrEqual(1);
    expect(next).toContain('## 核心要点');
  });

  it('问答包含 Markdown 表格时，应保留表格结构并写入文档', () => {
    const answer = `关键指标如下：
| 指标 | 当前值 | 环比 |
| --- | --- | --- |
| 转化率 | 12.4% | +2.1% |
| 留存率 | 43% | +3% |`;
    const result = mergeAnswerIntoKnowledgeDoc(
      answer,
      '# 项目复盘\n\n## 关键事实\n- 上周已完成首轮测试',
      true
    );
    expect(result.updated).toBe(true);
    const next = result.suggestedContent ?? '';
    expect(next).toContain('| 指标 | 当前值 | 环比 |');
    expect(next).toContain('| 转化率 | 12.4% | +2.1% |');
  });

  it('增量更新不应过度保守，单轮可写入多条新增事实', () => {
    const answer =
      '新增事实1：A/B 测试样本量提升到 1200。新增事实2：注册转化率提升 9%。新增事实3：首日留存提升 5%。新增事实4：客服响应时长下降 18%。';
    const result = mergeAnswerIntoKnowledgeDoc(
      answer,
      '# 运营复盘\n\n## 关键事实\n- 已完成实验准备',
      true
    );
    expect(result.updated).toBe(true);
    const next = result.suggestedContent ?? '';
    const bulletCount = (next.match(/^- /gm) ?? []).length;
    expect(bulletCount).toBeGreaterThanOrEqual(3);
  });

  it('新增 Notion 对比话题时，应写入对比章节而非丢失', () => {
    const answer =
      '与 Notion 对比：NotebookLM 在来源追溯和引用链路上更强，但在通用项目管理协同上不如 Notion 灵活。';
    const result = mergeAnswerIntoKnowledgeDoc(
      answer,
      '# NotebookLM 调研\n\n## 核心结论\n- 已完成基础能力梳理',
      true
    );
    expect(result.updated).toBe(true);
    const next = result.suggestedContent ?? '';
    expect(next).toContain('## 与 Notion 对比');
    expect(next).toContain('Notion');
  });
});

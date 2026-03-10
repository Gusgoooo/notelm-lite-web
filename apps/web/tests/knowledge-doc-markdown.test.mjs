import { describe, it, expect } from 'vitest';
import { ensureKnowledgeDocMarkdown, markdownToKnowledgeDocHtml } from '../lib/knowledge-doc-markdown.ts';

describe('knowledge doc markdown bridge', () => {
  it('converts html content into normalized markdown', () => {
    const html = '<h1>项目文档</h1><h2>核心要点</h2><ul><li>已有要点</li></ul>';
    const md = ensureKnowledgeDocMarkdown(html);
    expect(md).toContain('# 项目文档');
    expect(md).toContain('## 核心要点');
    expect(md).toContain('- 已有要点');
    expect(md.includes('<h1>')).toBe(false);
    expect(md.includes('<li>')).toBe(false);
  });

  it('normalizes list-wrapped table rows into valid markdown table', () => {
    const raw = `## 对比结论

- | 维度 | NotebookLM | Notion |
- | --- | --- | --- |
- | 引用追溯 | 强 | 中 |`;
    const md = ensureKnowledgeDocMarkdown(raw);
    expect(md).toContain('| 维度 | NotebookLM | Notion |');
    expect(md).toContain('| --- | --- | --- |');
    expect(md).not.toContain('- | 维度 | NotebookLM | Notion |');
    const html = markdownToKnowledgeDocHtml(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>维度</th>');
  });

  it('injects separator row when table body is missing one', () => {
    const raw = `## 指标对比

| 指标 | 当前 | 目标 |
| 转化率 | 12% | 15% |`;
    const md = ensureKnowledgeDocMarkdown(raw);
    expect(md).toContain('| --- | --- | --- |');
    const html = markdownToKnowledgeDocHtml(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>12%</td>');
  });
});

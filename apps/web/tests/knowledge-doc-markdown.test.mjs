import { describe, it, expect } from 'vitest';
import { ensureKnowledgeDocMarkdown } from '../lib/knowledge-doc-markdown.ts';

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
});

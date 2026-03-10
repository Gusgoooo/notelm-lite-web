import { describe, it, expect } from 'vitest';
import { detectAssistantMode, detectEditApplyMode } from '../lib/assistant-mode.ts';

describe('assistant mode detect', () => {
  it('普通问答默认 qa', () => {
    expect(detectAssistantMode('这个结论为什么成立？')).toBe('qa');
  });

  it('包含修改意图词时返回 edit', () => {
    expect(detectAssistantMode('把这段改写得更正式一点')).toBe('edit');
    expect(detectAssistantMode('去掉上面那段并补进一条结论')).toBe('edit');
  });

  it('替换类请求识别为 replace 应用模式', () => {
    expect(detectEditApplyMode('原来的不要了，全部换成新的版本')).toBe('replace');
  });

  it('非替换编辑请求默认 patch 应用模式', () => {
    expect(detectEditApplyMode('把这段精简一下')).toBe('patch');
  });
});

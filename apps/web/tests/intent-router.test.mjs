import { describe, it, expect } from 'vitest';
import {
  INTENT_ROUTING_FALLBACK,
  parseIntentRoutingResultFromJson,
  routeIntent,
} from '../lib/intent-router.ts';

describe('intent router', () => {
  it('qa 返回完整问答路由并显示按钮', async () => {
    const output = await routeIntent({
      userMessage: '这个结论为什么成立？',
      hasActiveDoc: true,
      recentMessages: [],
    });
    expect(output.result.intent_type).toBe('qa');
    expect(output.result.answer_mode).toBe('source_grounded_only');
    expect(output.result.show_update_button).toBe(true);
  });

  it('doc_edit 返回预览编辑路由并显示按钮', async () => {
    const output = await routeIntent({
      userMessage: '把这段补充到右侧知识文档里',
      hasActiveDoc: true,
      recentMessages: [],
    });
    expect(output.result.intent_type).toBe('doc_edit');
    expect(output.result.answer_mode).toBe('preview_edit');
    expect(output.result.show_update_button).toBe(true);
  });

  it('doc_replace 返回整篇替换预览路由并显示按钮', async () => {
    const output = await routeIntent({
      userMessage: '原来的不要了，全部替换成这个版本',
      hasActiveDoc: true,
      recentMessages: [],
    });
    expect(output.result.intent_type).toBe('doc_replace');
    expect(output.result.answer_mode).toBe('preview_replace');
    expect(output.result.show_update_button).toBe(true);
  });

  it('router 非法 JSON fallback', () => {
    const output = parseIntentRoutingResultFromJson('not json', null);
    expect(output.validation.usedFallback).toBe(true);
    expect(output.result).toEqual(INTENT_ROUTING_FALLBACK);
  });
});


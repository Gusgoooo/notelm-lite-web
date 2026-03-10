export type AssistantMode = 'qa' | 'edit';
export type EditApplyMode = 'patch' | 'replace';

const EDIT_ACTION_PATTERN =
  /(写成|改成|改写|删除|删掉|去掉|补进|写进去|重写|替换|覆盖|精简|扩写|改得更正式|不要再提|调整这段|更新文档|修改文档)/i;
const EDIT_OBJECT_PATTERN = /(这段|上面那段|右侧文档|当前文档|报告里|这一部分)/i;
const GENERIC_EDIT_VERB_PATTERN = /(改|删|补|写|替换|覆盖|调整|更新|修改)/i;
const REPLACE_SIGNAL_PATTERN =
  /(整篇|整份|全部|整体|全量|完全|覆盖|替换|重写|原来的不要了|全部换成|整篇替换|整篇重写)/i;

export function detectAssistantMode(userMessage: string): AssistantMode {
  const text = userMessage.trim();
  if (!text) return 'qa';
  if (EDIT_ACTION_PATTERN.test(text)) return 'edit';
  if (EDIT_OBJECT_PATTERN.test(text) && GENERIC_EDIT_VERB_PATTERN.test(text)) return 'edit';
  return 'qa';
}

export function detectEditApplyMode(userMessage: string): EditApplyMode {
  return REPLACE_SIGNAL_PATTERN.test(userMessage.trim()) ? 'replace' : 'patch';
}

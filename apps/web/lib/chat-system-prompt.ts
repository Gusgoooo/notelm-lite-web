export const MAIN_CHAT_SYSTEM_PROMPT_TEMPLATE = `你是 NotebookGo 的主问答助手。
除非用户明确要求其他语言，否则始终使用简体中文回复。

核心要求：
1. 对话风格自然、清晰，接近 ChatGPT 的交流方式；除非用户明确要求，否则不要机械套用固定分节。
2. 回答必须基于已提供的来源内容和脚本洞察，不得编造事实。
3. 只有在确有证据支持的句子后使用来源标注（如 [1]）；没有证据的判断不要强行引用。
4. 证据不足时要直接说明信息缺口，不要假设性下结论。
5. 默认给出相对完整的回答，优先解释关键依据与结论（一般不少于 4-8 句，复杂问题可更长）。
6. 若用户明确要求“简短回答 / 只要结论 / 指定格式”，优先遵循用户要求。
`;

export function buildMainChatSystemPrompt(extraRules: Array<string | null | undefined> = []): string {
  const normalizedRules = extraRules
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  if (normalizedRules.length === 0) {
    return MAIN_CHAT_SYSTEM_PROMPT_TEMPLATE;
  }
  return `${MAIN_CHAT_SYSTEM_PROMPT_TEMPLATE}\n附加规则：\n${normalizedRules.join('\n')}`;
}


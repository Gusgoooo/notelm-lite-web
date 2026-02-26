import { readEnv, readSecretEnv } from '../utils/env.js';

type ProviderName = 'openai' | 'openrouter';

type ChatProviderConfig = {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
};

const OPENROUTER_CHAT_FALLBACK_MODELS = [
  'deepseek/deepseek-chat-v3-0324',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-chat',
  'qwen/qwen-2.5-72b-instruct',
  'qwen/qwen-2.5-7b-instruct',
  'qwen/qwen3-32b',
  'qwen/qwen3-14b',
  'moonshotai/kimi-k2',
  'mistralai/mistral-small-3.2-24b-instruct',
  'mistralai/mistral-nemo',
  'meta-llama/llama-3.3-70b-instruct',
  'meta-llama/llama-3.1-70b-instruct',
  'x-ai/grok-3-mini',
  'z-ai/glm-4.5-air',
  'openrouter/auto',
] as const;

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean))];
}

function getChatProviderOrder(): ProviderName[] {
  const mode = readEnv('CHAT_PROVIDER', 'auto').toLowerCase();
  if (mode === 'openrouter') return ['openrouter', 'openai'];
  if (mode === 'openai') return ['openai', 'openrouter'];
  return ['openai', 'openrouter'];
}

function getChatConfigs(): ChatProviderConfig[] {
  const order = getChatProviderOrder();
  const configs: ChatProviderConfig[] = [];
  for (const provider of order) {
    if (provider === 'openai') {
      const apiKey = readSecretEnv('OPENAI_API_KEY');
      if (!apiKey) continue;
      const baseUrl = readEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1');
      const models = uniqueNonEmpty([
        readEnv('OPENAI_CHAT_MODEL') || undefined,
        readEnv('CHAT_MODEL') || undefined,
        'gpt-4o-mini',
      ]);
      for (const model of models) configs.push({ name: 'openai', baseUrl, apiKey, model });
      continue;
    }
    const apiKey = readSecretEnv('OPENROUTER_API_KEY');
    if (!apiKey) continue;
    const baseUrl = readEnv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1');
    const models = uniqueNonEmpty([
      readEnv('OPENROUTER_CHAT_MODEL') || undefined,
      readEnv('CHAT_MODEL') || undefined,
      ...OPENROUTER_CHAT_FALLBACK_MODELS,
    ]);
    for (const model of models) configs.push({ name: 'openrouter', baseUrl, apiKey, model });
  }
  return configs;
}

function extractErrorMessage(payload: unknown): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object' &&
    'message' in payload.error &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message;
  }
  if (typeof payload === 'string') return payload;
  return 'Unknown chat API error';
}

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

async function requestChat(
  config: ChatProviderConfig,
  messages: ChatMessage[]
): Promise<{ content: string }> {
  const { baseUrl, apiKey, model } = config;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const raw = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = raw;
  }
  if (!response.ok) {
    throw new Error(`Chat API error: ${response.status} ${extractErrorMessage(json)}`);
  }
  if (json && typeof json === 'object' && 'error' in json) {
    throw new Error(`Chat API error: ${extractErrorMessage(json)}`);
  }
  const parsed = json as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = parsed.choices?.[0]?.message?.content ?? '';
  return { content };
}

export async function chat(messages: ChatMessage[]): Promise<{ content: string }> {
  const configs = getChatConfigs();
  if (configs.length === 0) {
    throw new Error('OPENAI_API_KEY or OPENROUTER_API_KEY is not set');
  }
  const errors: string[] = [];
  for (const config of configs) {
    try {
      return await requestChat(config, messages);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`[${config.name}:${config.model}] ${msg}`);
    }
  }
  throw new Error(`Chat API error: ${errors.join(' | ')}`);
}

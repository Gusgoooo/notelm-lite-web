type ProviderName = 'openai' | 'openrouter';

type EmbedProviderConfig = {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
};

const OPENROUTER_EMBEDDING_FALLBACK_MODELS = [
  'baai/bge-m3',
  'baai/bge-large-en-v1.5',
  'intfloat/e5-large-v2',
  'thenlper/gte-large',
  'sentence-transformers/all-mpnet-base-v2',
  'qwen/qwen3-embedding-8b',
  'qwen/qwen3-embedding-4b',
] as const;

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean))];
}

function getEmbeddingProviderOrder(): ProviderName[] {
  const mode = (process.env.EMBEDDING_PROVIDER ?? 'auto').trim().toLowerCase();
  if (mode === 'openrouter') return ['openrouter', 'openai'];
  if (mode === 'openai') return ['openai', 'openrouter'];
  return ['openai', 'openrouter'];
}

function getEmbeddingConfigs(): EmbedProviderConfig[] {
  const order = getEmbeddingProviderOrder();
  const configs: EmbedProviderConfig[] = [];
  for (const provider of order) {
    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
      if (!apiKey) continue;
      const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
      const models = uniqueNonEmpty([
        process.env.OPENAI_EMBEDDING_MODEL,
        process.env.EMBEDDING_MODEL,
        'text-embedding-3-small',
      ]);
      for (const model of models) configs.push({ name: 'openai', baseUrl, apiKey, model });
      continue;
    }
    const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? '';
    if (!apiKey) continue;
    const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
    const models = uniqueNonEmpty([
      process.env.OPENROUTER_EMBEDDING_MODEL,
      process.env.EMBEDDING_MODEL,
      ...OPENROUTER_EMBEDDING_FALLBACK_MODELS,
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
  return 'Unknown embedding API error';
}

function getEmbeddingDimensionsFromEnv(): number {
  const raw = process.env.EMBEDDING_DIMENSIONS;
  if (!raw) return 1536;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1536;
}

function resizeEmbedding(embedding: number[], targetDimensions: number): number[] {
  if (embedding.length === targetDimensions) return embedding;
  if (embedding.length > targetDimensions) return embedding.slice(0, targetDimensions);
  return [...embedding, ...new Array(targetDimensions - embedding.length).fill(0)];
}

async function requestEmbeddings(
  config: EmbedProviderConfig,
  texts: string[]
): Promise<number[][]> {
  const { baseUrl, apiKey, model } = config;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts.map((t) => t.replace(/\n/g, ' ').trim()),
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
    throw new Error(`Embedding API error: ${response.status} ${extractErrorMessage(json)}`);
  }
  if (json && typeof json === 'object' && 'error' in json) {
    throw new Error(`Embedding API error: ${extractErrorMessage(json)}`);
  }
  const parsed = json as { data?: Array<{ embedding: number[] }> };
  const data = parsed.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error('Unexpected embedding response shape');
  }
  return data.map((d) => d.embedding);
}

export function getEmbeddingDimensions(): number {
  return getEmbeddingDimensionsFromEnv();
}

export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  const configs = getEmbeddingConfigs();
  if (configs.length === 0) {
    throw new Error('OPENAI_API_KEY or OPENROUTER_API_KEY is not set');
  }
  const errors: string[] = [];
  const targetDimensions = getEmbeddingDimensionsFromEnv();
  for (const config of configs) {
    try {
      const embeddings = await requestEmbeddings(config, texts);
      return embeddings.map((embedding) => resizeEmbedding(embedding, targetDimensions));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`[${config.name}:${config.model}] ${msg}`);
    }
  }
  throw new Error(`Embedding API error: ${errors.join(' | ')}`);
}

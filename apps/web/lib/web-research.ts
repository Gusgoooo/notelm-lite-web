import { randomUUID } from 'crypto';
import { and, db, eq, inArray, sourceChunks, sources } from 'db';
import { createEmbeddings, getEmbeddingDimensions } from 'shared';
import { getAgentSettings } from '@/lib/agent-settings';

export type WebSource = {
  title: string;
  url: string;
  snippet: string;
};

const WEB_SOURCE_MIME = 'application/x-web-source';
const DEFAULT_SEARCH_MODELS = [
  'perplexity/sonar-pro',
  'perplexity/sonar-reasoning-pro',
  'openai/gpt-4o-search-preview',
  'openai/gpt-4o-mini-search-preview',
] as const;
const DEFAULT_TRANSLATE_MODEL = 'openai/gpt-4o-mini';

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const lines: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const obj = part as { type?: unknown; text?: unknown };
    if (obj.type === 'text' && typeof obj.text === 'string') lines.push(obj.text);
  }
  return lines.join('\n').trim();
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTitle(value: string, fallbackUrl: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed) return trimmed.slice(0, 120);
  try {
    const u = new URL(fallbackUrl);
    return u.hostname.slice(0, 120);
  } catch {
    return 'Web Source';
  }
}

function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1600);
}

function extractArxivId(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:abs|pdf)\/([^/]+?)(?:\.pdf)?$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function isPlaceholderArxivId(id: string): boolean {
  if (!id) return true;
  if (/^\d{4}\.0{4,5}$/i.test(id)) return true;
  if (/^test$/i.test(id)) return true;
  return false;
}

async function validateArxivSource(item: WebSource): Promise<boolean> {
  const arxivId = extractArxivId(item.url);
  if (!arxivId) return true;
  if (isPlaceholderArxivId(arxivId)) return false;

  try {
    const absUrl = `https://arxiv.org/abs/${arxivId}`;
    const response = await fetch(absUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; NotebookGoBot/1.0; +https://notebookgo.vercel.app)',
        accept: 'text/html,application/xhtml+xml',
      },
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const html = await response.text();
    if (/Article identifier ['"]?.+?['"]? not recognized/i.test(html)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function filterReachableWebSources(items: WebSource[]): Promise<WebSource[]> {
  const validated = await Promise.all(
    items.map(async (item) => ({
      item,
      ok: await validateArxivSource(item),
    }))
  );
  return validated.filter((row) => row.ok).map((row) => row.item);
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function tryParseJson(content: string): unknown {
  const raw = content.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      try {
        return JSON.parse(fenced.trim());
      } catch {
        return null;
      }
    }
    return null;
  }
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
  return 'Unknown error';
}

function extractSources(payload: unknown): WebSource[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = (payload as { sources?: unknown }).sources;
  if (!Array.isArray(raw)) return [];
  const out: WebSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === 'string' ? normalizeUrl(row.url) : null;
    if (!url) continue;
    const title = normalizeTitle(typeof row.title === 'string' ? row.title : '', url);
    const snippet = normalizeSnippet(typeof row.snippet === 'string' ? row.snippet : '');
    out.push({ title, url, snippet });
  }
  return out;
}

function extractSourcesFromLooseText(content: string): WebSource[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const out: WebSource[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const urlMatch = line.match(/https?:\/\/[^\s)>\]}",]+/i);
    if (!urlMatch?.[0]) continue;
    const url = normalizeUrl(urlMatch[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const markdownTitleMatch = line.match(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/i);
    const rawWithoutUrl = line
      .replace(urlMatch[0], ' ')
      .replace(/\[[^\]]+]\(.*?\)/g, ' ')
      .replace(/^[\-*+\d.)\s|]+/, ' ')
      .replace(/(?:^|\s)(url|链接|link)\s*[:：]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const title = normalizeTitle(markdownTitleMatch?.[1] ?? rawWithoutUrl, url);

    let snippet = '';
    const snippetMatch = line.match(/(?:snippet|summary|摘要|简介)\s*[:：]\s*(.+)$/i);
    if (snippetMatch?.[1]) {
      snippet = normalizeSnippet(snippetMatch[1]);
    } else if (rawWithoutUrl && rawWithoutUrl !== title) {
      snippet = normalizeSnippet(rawWithoutUrl);
    }

    out.push({ title, url, snippet });
  }

  return out;
}

function extractSourcesFromContent(content: string): WebSource[] {
  const strict = extractSources(tryParseJson(content));
  if (strict.length > 0) return strict;
  return extractSourcesFromLooseText(content);
}

function scoreWebSource(item: WebSource): number {
  const url = item.url.toLowerCase();
  const title = item.title.toLowerCase();
  const snippet = item.snippet.toLowerCase();
  let score = 0;
  if (url.includes('arxiv.org')) score += 100;
  if (url.endsWith('.pdf') || url.includes('.pdf?')) score += 50;
  if (url.includes('/pdf/')) score += 30;
  if (url.includes('doi.org')) score += 18;
  if (url.includes('acm.org') || url.includes('ieee.org') || url.includes('springer') || url.includes('sciencedirect')) score += 16;
  if (/paper|论文|研究|study|preprint|journal|conference/.test(`${title} ${snippet}`)) score += 12;
  if (/download|full\s*text|全文|pdf/.test(`${url} ${snippet}`)) score += 10;
  return score;
}

async function requestOpenRouterText(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
    }),
  });

  const raw = await response.text();
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // fall back to raw text below
  }
  if (!response.ok) {
    throw new Error(`[${input.model}] ${response.status} ${extractErrorMessage(parsed)}`);
  }

  if (typeof parsed === 'object' && parsed) {
    const messageContent = extractTextFromContent(
      (parsed as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
    );
    if (messageContent) return messageContent;
  }

  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  throw new Error(`[${input.model}] empty response`);
}

async function translateSnippetsToChinese(input: {
  apiKey: string;
  baseUrl: string;
  sources: WebSource[];
}): Promise<WebSource[]> {
  const candidates = input.sources.filter((item) => item.snippet && !containsCjk(item.snippet));
  if (candidates.length === 0) return input.sources;

  try {
    const model = (process.env.OPENROUTER_TRANSLATE_MODEL ?? DEFAULT_TRANSLATE_MODEL).trim() || DEFAULT_TRANSLATE_MODEL;
    const text = await requestOpenRouterText({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model,
      systemPrompt:
        'You translate research snippets into concise Simplified Chinese. Return ONLY JSON: {"items":[{"url":"https://...","snippet":"中文摘要"}]}.',
      userPrompt:
        `Translate the following snippets into concise Simplified Chinese.\n` +
        `Keep meanings accurate. If a snippet is too short, keep it short. Return JSON only.\n\n` +
        JSON.stringify(
          {
            items: candidates.map((item) => ({
              url: item.url,
              snippet: item.snippet,
            })),
          },
          null,
          2
        ),
    });

    const payload = tryParseJson(text);
    const translated = Array.isArray((payload as { items?: unknown })?.items)
      ? ((payload as { items: Array<Record<string, unknown>> }).items ?? [])
      : [];
    const translatedMap = new Map<string, string>();
    for (const item of translated) {
      if (!item || typeof item !== 'object') continue;
      const url = typeof item.url === 'string' ? normalizeUrl(item.url) : null;
      const snippet = typeof item.snippet === 'string' ? normalizeSnippet(item.snippet) : '';
      if (!url || !snippet) continue;
      translatedMap.set(url, snippet);
    }

    if (translatedMap.size === 0) return input.sources;
    return input.sources.map((item) => ({
      ...item,
      snippet: translatedMap.get(item.url) ?? item.snippet,
    }));
  } catch {
    return input.sources;
  }
}

export async function searchWebViaOpenRouter(input: {
  topic: string;
  limit: number;
}): Promise<WebSource[]> {
  const settings = await getAgentSettings();
  const apiKey = settings.openrouterApiKey.trim();
  const baseUrl = settings.openrouterBaseUrl.trim() || 'https://openrouter.ai/api/v1';
  if (!apiKey) throw new Error('OpenRouter API key is not configured');

  const configuredPrimary = (process.env.OPENROUTER_SEARCH_MODEL ?? '').trim();
  const configuredFallbacks = (process.env.OPENROUTER_SEARCH_FALLBACK_MODELS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const models = uniqueNonEmpty([
    configuredPrimary || DEFAULT_SEARCH_MODELS[0],
    ...configuredFallbacks,
    ...DEFAULT_SEARCH_MODELS,
  ]);

  const aggregated: WebSource[] = [];
  const errors: string[] = [];

  for (const model of models) {
    try {
      const messageContent = await requestOpenRouterText({
        apiKey,
        baseUrl,
        model,
        systemPrompt:
          'You are a web research assistant. Prefer returning JSON with this shape: {"sources":[{"title":"...","url":"https://...","snippet":"..."}]}. If some fields are unavailable, keep them empty instead of omitting results. Prefer Chinese and English sources.',
        userPrompt:
          `Topic: ${input.topic}\n` +
          `Find up to ${input.limit} reliable, diverse web sources.\n` +
          `Requirements:\n` +
          `1) URL should be a direct page URL.\n` +
          `2) prioritize research papers / research reports when possible.\n` +
          `3) strongly prefer sources with downloadable full text.\n` +
          `4) prefer arXiv (arxiv.org) when relevant, because the paper can usually be downloaded.\n` +
          `5) avoid duplicates and spam.\n` +
          `6) return JSON if possible, but do not drop results only because formatting is difficult.\n` +
          `7) if a snippet is unavailable, return an empty string instead of omitting the source.\n` +
          `8) do not invent placeholder/example links; never return fake arXiv ids such as 2007.00000.`,
      });
      const fetched = extractSourcesFromContent(messageContent);
      if (fetched.length === 0) {
        errors.push(`[${model}] no parsable sources`);
        continue;
      }
      aggregated.push(...fetched);
      const uniqueCount = new Set(aggregated.map((item) => item.url)).size;
      if (uniqueCount >= input.limit) break;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `[${model}] search failed`);
    }
  }

  if (aggregated.length === 0) {
    throw new Error(
      errors.length > 0
        ? `Web search failed: ${errors.join(' | ')}`
        : 'Web search failed: no sources returned'
    );
  }

  const translated = await translateSnippetsToChinese({
    apiKey,
    baseUrl,
    sources: aggregated,
  });
  const reachable = await filterReachableWebSources(translated);

  reachable.sort((a, b) => scoreWebSource(b) - scoreWebSource(a));
  const unique = new Map<string, WebSource>();
  for (const item of reachable) {
    if (!unique.has(item.url)) {
      unique.set(item.url, {
        ...item,
        snippet: item.snippet || '',
      });
    }
    if (unique.size >= input.limit) break;
  }
  const final = Array.from(unique.values()).slice(0, input.limit);
  if (final.length === 0) {
    throw new Error('Web search failed: returned links were invalid or unreachable');
  }
  return final;
}

export async function ingestWebSources(input: {
  notebookId: string;
  topic: string;
  fetched: WebSource[];
  limit: number;
}): Promise<{ added: number; skipped: number }> {
  const urls = input.fetched.map((s) => s.url);
  const existing = urls.length
    ? await db
        .select({ fileUrl: sources.fileUrl })
        .from(sources)
        .where(and(eq(sources.notebookId, input.notebookId), inArray(sources.fileUrl, urls)))
    : [];
  const existingSet = new Set(existing.map((r) => r.fileUrl));
  const candidates = input.fetched
    .filter((item) => !existingSet.has(item.url))
    .slice(0, input.limit);

  if (candidates.length === 0) {
    return { added: 0, skipped: input.fetched.length };
  }

  const chunkTexts = candidates.map(
    (item) =>
      `【联网检索来源】\n主题：${input.topic}\n标题：${item.title}\nURL：${item.url}\n摘要：${
        item.snippet || '（检索结果未附摘要，建议打开原始来源查看）'
      }`
  );
  const vectors = await createEmbeddings(chunkTexts);
  const dimensions = getEmbeddingDimensions();
  const now = new Date();

  const sourceRows = candidates.map((item, idx) => {
    const sourceId = `src_${randomUUID()}`;
    const chunkId = `chk_${randomUUID()}`;
    const vector = vectors[idx];
    return {
      source: {
        id: sourceId,
        notebookId: input.notebookId,
        filename: item.title,
        fileUrl: item.url,
        mime: WEB_SOURCE_MIME,
        status: 'READY' as const,
        errorMessage: null,
        createdAt: now,
      },
      chunk: {
        id: chunkId,
        sourceId,
        chunkIndex: 0,
        content: chunkTexts[idx],
        pageStart: 1,
        pageEnd: 1,
        embedding:
          Array.isArray(vector) && vector.length === dimensions
            ? (vector as unknown as number[])
            : null,
        createdAt: now,
      },
    };
  });

  await db.transaction(async (tx) => {
    await tx.insert(sources).values(sourceRows.map((row) => row.source));
    await tx.insert(sourceChunks).values(
      sourceRows
        .filter((row) => row.chunk.embedding)
        .map((row) => ({
          ...row.chunk,
          embedding: row.chunk.embedding as unknown as number[],
        }))
    );
  });

  return { added: sourceRows.length, skipped: input.fetched.length - sourceRows.length };
}

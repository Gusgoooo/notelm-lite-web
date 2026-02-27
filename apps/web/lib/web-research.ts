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
    if (!snippet) continue;
    out.push({ title, url, snippet });
  }
  return out;
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

export async function searchWebViaOpenRouter(input: {
  topic: string;
  limit: number;
}): Promise<WebSource[]> {
  const settings = await getAgentSettings();
  const apiKey = settings.openrouterApiKey.trim();
  const baseUrl = settings.openrouterBaseUrl.trim() || 'https://openrouter.ai/api/v1';
  const model = (process.env.OPENROUTER_SEARCH_MODEL ?? 'openai/gpt-4o-search-preview').trim();
  if (!apiKey) throw new Error('OpenRouter API key is not configured');

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a web research assistant. Search the public web and return ONLY JSON with this shape: {"sources":[{"title":"...","url":"https://...","snippet":"..."}]}. No markdown. Prefer Chinese and English sources.',
        },
        {
          role: 'user',
          content:
            `Topic: ${input.topic}\n` +
            `Find up to ${input.limit} reliable, diverse web sources.\n` +
            `Requirements:\n` +
            `1) URL must be direct page URL.\n` +
            `2) snippet must be Simplified Chinese.\n` +
            `3) prioritize research papers / research reports when possible.\n` +
            `4) strongly prefer sources with downloadable full text.\n` +
            `5) prefer arXiv (arxiv.org) when relevant, because the paper can usually be downloaded.\n` +
            `6) avoid duplicates and spam.\n` +
            `7) return JSON only.`,
        },
      ],
    }),
  });

  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Web search model response is not JSON: ${raw.slice(0, 180)}`);
  }
  if (!response.ok) {
    const message =
      typeof parsed === 'object' &&
      parsed &&
      'error' in parsed &&
      parsed.error &&
      typeof parsed.error === 'object' &&
      'message' in parsed.error &&
      typeof parsed.error.message === 'string'
        ? parsed.error.message
        : `HTTP ${response.status}`;
    throw new Error(`Web search failed: ${message}`);
  }
  const messageContent = extractTextFromContent(
    (parsed as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
  );
  const contentJson = tryParseJson(messageContent);
  const fetched = extractSources(contentJson);
  fetched.sort((a, b) => scoreWebSource(b) - scoreWebSource(a));
  const unique = new Map<string, WebSource>();
  for (const item of fetched) {
    if (!unique.has(item.url)) unique.set(item.url, item);
    if (unique.size >= input.limit) break;
  }
  return Array.from(unique.values()).slice(0, input.limit);
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
      `【联网检索来源】\n主题：${input.topic}\n标题：${item.title}\nURL：${item.url}\n摘要：${item.snippet}`
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

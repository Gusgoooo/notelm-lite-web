import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { and, db, eq, inArray, sourceChunks, sources } from 'db';
import { createEmbeddings, getEmbeddingDimensions } from 'shared';
import { getNotebookAccess } from '@/lib/notebook-access';
import { getAgentSettings } from '@/lib/agent-settings';

type WebSource = {
  title: string;
  url: string;
  snippet: string;
};

const MAX_WEB_SOURCES = 20;
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
    // Support ```json ... ``` output
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

async function searchWebViaOpenRouter(input: {
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
            'You are a web research assistant. Search the public web and return ONLY JSON with this shape: {"sources":[{"title":"...","url":"https://...","snippet":"..."}]}. No markdown. Prefer Chinese and English sources. Do not return Japanese sources unless the user explicitly asks for Japanese.',
        },
        {
          role: 'user',
          content:
            `Topic: ${input.topic}\n` +
            `Find up to ${input.limit} reliable, diverse web sources.\n` +
            `Requirements:\n` +
            `1) URL must be direct page URL.\n` +
            `2) snippet must be Simplified Chinese.\n` +
            `3) avoid duplicates and spam.\n` +
            `4) prioritize Chinese/English websites, avoid Japanese websites unless topic requires Japanese.\n` +
            `5) return JSON only.`,
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
  const sources = extractSources(contentJson);
  const unique = new Map<string, WebSource>();
  for (const item of sources) {
    if (!unique.has(item.url)) unique.set(item.url, item);
    if (unique.size >= input.limit) break;
  }
  return Array.from(unique.values()).slice(0, input.limit);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId.trim() : '';
    const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
    const limitRaw = Number.parseInt(String(body?.limit ?? MAX_WEB_SOURCES), 10);
    const limit = Math.max(1, Math.min(MAX_WEB_SOURCES, Number.isFinite(limitRaw) ? limitRaw : MAX_WEB_SOURCES));

    if (!notebookId) {
      return NextResponse.json({ error: 'notebookId is required' }, { status: 400 });
    }
    if (!topic) {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 });
    }

    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json({ error: '该 notebook 来源为只读，请先保存为我的 notebook' }, { status: 403 });
    }

    const fetched = await searchWebViaOpenRouter({ topic, limit });
    if (fetched.length === 0) {
      return NextResponse.json({ error: '联网检索未返回可用来源，请更换话题重试' }, { status: 409 });
    }

    const urls = fetched.map((s) => s.url);
    const existing = await db
      .select({ fileUrl: sources.fileUrl })
      .from(sources)
      .where(and(eq(sources.notebookId, notebookId), inArray(sources.fileUrl, urls)));
    const existingSet = new Set(existing.map((r) => r.fileUrl));
    const candidates = fetched.filter((row) => !existingSet.has(row.url)).slice(0, limit);
    if (candidates.length === 0) {
      return NextResponse.json({ added: 0, skipped: fetched.length, sources: [] });
    }

    const chunkTexts = candidates.map(
      (item) =>
        `【联网检索来源】\n主题：${topic}\n标题：${item.title}\nURL：${item.url}\n摘要：${item.snippet}`
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
          notebookId,
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
        sourceType: '联网检索',
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

    return NextResponse.json({
      added: sourceRows.length,
      skipped: fetched.length - sourceRows.length,
      sources: sourceRows.map((row) => ({
        ...row.source,
        chunkCount: row.chunk.embedding ? 1 : 0,
        sourceType: row.sourceType,
      })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '联网检索失败' },
      { status: 500 }
    );
  }
}

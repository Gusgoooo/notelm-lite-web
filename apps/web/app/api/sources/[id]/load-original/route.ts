import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { db, eq, sources } from 'db';
import { getStorage } from 'shared';
import { getNotebookAccess } from '@/lib/notebook-access';

const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;

function normalizeMimeByFilename(filename: string, mimeType: string | null | undefined): string {
  const declared = (mimeType ?? '').toLowerCase().trim();
  const lowerName = filename.toLowerCase();
  if (declared.includes('application/pdf') || lowerName.endsWith('.pdf')) return 'application/pdf';
  if (
    declared.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
    lowerName.endsWith('.docx')
  ) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (declared.includes('application/msword') || lowerName.endsWith('.doc')) return 'application/msword';
  return 'application/octet-stream';
}

function extensionFromMime(mime: string): 'pdf' | 'docx' | 'doc' {
  if (mime.includes('application/pdf')) return 'pdf';
  if (mime.includes('officedocument.wordprocessingml.document')) return 'docx';
  return 'doc';
}

function isDocumentMime(mime: string): boolean {
  return (
    mime.includes('application/pdf') ||
    mime.includes('application/msword') ||
    mime.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  );
}

function detectMimeFromBuffer(buffer: Buffer, fallbackMime: string): string {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('utf8') === '%PDF-') {
    return 'application/pdf';
  }
  return fallbackMime;
}

function getArxivPdfUrl(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:abs|html)\/([^/?#]+)/i);
    if (!match?.[1]) return null;
    return `https://arxiv.org/pdf/${match[1]}.pdf`;
  } catch {
    return null;
  }
}

function toAbsoluteUrl(base: string, maybeRelative: string): string | null {
  try {
    const resolved = new URL(maybeRelative, base);
    if (!/^https?:$/.test(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function guessFilenameFromUrl(urlValue: string, ext: string): string {
  try {
    const url = new URL(urlValue);
    const last = url.pathname.split('/').filter(Boolean).pop() || '';
    if (last && /\.[a-z0-9]{2,6}$/i.test(last)) return decodeURIComponent(last).slice(0, 180);
  } catch {
    // ignore
  }
  return `source_${Date.now()}.${ext}`;
}

function extractDocCandidateLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<a[^>]+href=["']([^"']+\.(?:pdf|docx?|PDF|DOCX?)(?:\?[^"']*)?)["'][^>]*>/gi,
    /(https?:\/\/[^\s"'<>]+\.(?:pdf|docx?|PDF|DOCX?)(?:\?[^\s"'<>]*)?)/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const url = toAbsoluteUrl(pageUrl, match[1]);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= 12) return out;
    }
  }
  return out;
}

async function downloadBuffer(urlValue: string): Promise<{ buffer: Buffer; mime: string; finalUrl: string }> {
  const res = await fetch(urlValue, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (compatible; NotebookGoBot/1.0; +https://notebookgo.vercel.app)',
      accept:
        'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,*/*',
    },
  });
  if (!res.ok) {
    throw new Error(`下载失败（${res.status}）`);
  }
  const mime = (res.headers.get('content-type') ?? '').toLowerCase();
  const finalUrl = res.url || urlValue;
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength <= 0) throw new Error('下载结果为空');
  if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`原文过大（>${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)}MB）`);
  }
  return { buffer: Buffer.from(arrayBuffer), mime, finalUrl };
}

async function resolveOriginalFile(urlValue: string): Promise<{
  buffer: Buffer;
  mime: string;
  filename: string;
}> {
  const arxivPdfUrl = getArxivPdfUrl(urlValue);
  if (arxivPdfUrl) {
    try {
      const arxivDoc = await downloadBuffer(arxivPdfUrl);
      const arxivMime = detectMimeFromBuffer(
        arxivDoc.buffer,
        normalizeMimeByFilename(arxivDoc.finalUrl, arxivDoc.mime)
      );
      if (isDocumentMime(arxivMime)) {
        return {
          buffer: arxivDoc.buffer,
          mime: arxivMime,
          filename: guessFilenameFromUrl(arxivDoc.finalUrl, extensionFromMime(arxivMime)),
        };
      }
    } catch {
      // fallback to generic flow
    }
  }

  const first = await downloadBuffer(urlValue);
  const firstMime = detectMimeFromBuffer(
    first.buffer,
    normalizeMimeByFilename(first.finalUrl, first.mime)
  );
  if (isDocumentMime(firstMime)) {
    const ext = extensionFromMime(firstMime);
    return {
      buffer: first.buffer,
      mime: firstMime,
      filename: guessFilenameFromUrl(first.finalUrl, ext),
    };
  }

  const html = first.buffer.toString('utf-8');
  const candidates = extractDocCandidateLinks(html, first.finalUrl || urlValue);
  for (const candidate of candidates) {
    try {
      const next = await downloadBuffer(candidate);
      const nextMime = detectMimeFromBuffer(
        next.buffer,
        normalizeMimeByFilename(next.finalUrl, next.mime)
      );
      if (!isDocumentMime(nextMime)) continue;
      const ext = extensionFromMime(nextMime);
      return {
        buffer: next.buffer,
        mime: nextMime,
        filename: guessFilenameFromUrl(next.finalUrl, ext),
      };
    } catch {
      // try next candidate
    }
  }

  throw new Error('未找到可下载的 PDF/Word 原文，请手动下载后上传');
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const [source] = await db.select().from(sources).where(eq(sources.id, id));
    if (!source) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }

    const access = await getNotebookAccess(source.notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json({ error: '该 notebook 来源为只读，请先保存为我的 notebook' }, { status: 403 });
    }
    const sourceMime = (source.mime ?? '').toLowerCase();
    if (!sourceMime.includes('application/x-web-source') && !sourceMime.includes('application/x-websearch-source')) {
      return NextResponse.json({ error: '仅联网检索来源支持加载原文' }, { status: 400 });
    }

    const resolved = await resolveOriginalFile(source.fileUrl);
    const ext = extensionFromMime(resolved.mime);
    const sourceId = `src_${randomUUID()}`;
    const key = `${source.notebookId}/${sourceId}.${ext}`;
    const now = new Date();

    await db.insert(sources).values({
      id: sourceId,
      notebookId: source.notebookId,
      filename: source.filename,
      fileUrl: key,
      mime: resolved.mime,
      status: 'PROCESSING',
      errorMessage: null,
      createdAt: now,
    });

    const storage = getStorage();
    await storage.upload(key, resolved.buffer);
    await db
      .update(sources)
      .set({
        status: 'PENDING',
        errorMessage: null,
      })
      .where(eq(sources.id, sourceId));

    const [created] = await db.select().from(sources).where(eq(sources.id, sourceId));
    return NextResponse.json({
      ok: true,
      source: created,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '加载原文失败' },
      { status: 500 }
    );
  }
}

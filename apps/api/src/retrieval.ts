import { prisma } from "./db.js";

export interface RetrievalItem {
  chunkId: string;
  sourceId: string;
  segmentId: string | null;
  pageOrIndex: number | null;
  snippet: string | null;
  text: string;
}

/**
 * Retrieve chunks in the notebook whose text matches q (ILIKE), ordered by created_at desc, limit k.
 */
export async function retrieveChunks(
  notebookId: string,
  q: string,
  k: number
): Promise<RetrievalItem[]> {
  const chunks = await prisma.chunk.findMany({
    where: {
      source: { notebookId },
      text: { contains: q, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    take: k,
    select: {
      id: true,
      sourceId: true,
      segmentId: true,
      pageOrIndex: true,
      snippet: true,
      text: true,
    },
  });
  return chunks.map((c) => ({
    chunkId: c.id,
    sourceId: c.sourceId,
    segmentId: c.segmentId ?? null,
    pageOrIndex: c.pageOrIndex ?? null,
    snippet: c.snippet ?? null,
    text: c.text,
  }));
}

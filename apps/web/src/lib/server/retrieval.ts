import { sql } from "./db";

export interface RetrievalItem {
  chunkId: string;
  sourceId: string;
  segmentId: string | null;
  pageOrIndex: number | null;
  snippet: string | null;
  text: string;
}

export async function retrieveChunks(
  notebookId: string,
  q: string,
  k: number
): Promise<RetrievalItem[]> {
  const rows = await sql`
    SELECT c.id, c.source_id, c.segment_id, c.page_or_index, c.snippet, c.text
    FROM "Chunk" c
    JOIN "Source" s ON s.id = c.source_id
    WHERE s.notebook_id = ${notebookId}
      AND c.text ILIKE ${"%" + q + "%"}
    ORDER BY c.created_at DESC
    LIMIT ${k}
  `;
  return rows.map((r) => ({
    chunkId: r.id as string,
    sourceId: r.source_id as string,
    segmentId: (r.segment_id as string | null) ?? null,
    pageOrIndex: (r.page_or_index as number | null) ?? null,
    snippet: (r.snippet as string | null) ?? null,
    text: r.text as string,
  }));
}

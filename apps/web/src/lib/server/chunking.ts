import { createHash } from "node:crypto";
import { sql } from "./db";

const CHUNK_SIZE_TARGET = 800;
const CHUNK_OVERLAP = 120;
const SNIPPET_MAX_LEN = 200;

function chunkText(
  text: string,
  sizeTarget = CHUNK_SIZE_TARGET,
  overlap = CHUNK_OVERLAP
): Array<{ text: string; charStart: number; charEnd: number }> {
  const chunks: Array<{ text: string; charStart: number; charEnd: number }> = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + sizeTarget, text.length);
    chunks.push({ text: text.slice(start, end), charStart: start, charEnd: end });
    start = end - (end < text.length ? overlap : 0);
  }
  return chunks;
}

export async function chunkSource(sourceId: string): Promise<number> {
  const segments = await sql`
    SELECT id, segment_index, text
    FROM "SourceSegment"
    WHERE source_id = ${sourceId}
    ORDER BY segment_index ASC
  `;

  const existingRows = await sql`
    SELECT text_hash, chunk_index FROM "Chunk" WHERE source_id = ${sourceId}
  `;
  const existingHashes = new Set(existingRows.map((r) => r.text_hash as string));
  const nextIndex =
    existingRows.length === 0
      ? 0
      : Math.max(...existingRows.map((r) => r.chunk_index as number)) + 1;

  const now = Date.now();
  let chunkIndex = nextIndex;
  let created = 0;

  for (const seg of segments) {
    const rawText = (seg.text as string) ?? "";
    const parts =
      rawText.length > 0
        ? chunkText(rawText)
        : [{ text: "", charStart: 0, charEnd: 0 }];

    for (const part of parts) {
      const textHash = createHash("sha256").update(part.text).digest("hex");
      if (existingHashes.has(textHash)) continue;
      existingHashes.add(textHash);

      const chunkId = `chunk-${sourceId}-${chunkIndex}`;
      const snippet =
        part.text.length > SNIPPET_MAX_LEN
          ? part.text.slice(0, SNIPPET_MAX_LEN).trim() + "…"
          : part.text.trim();

      await sql`
        INSERT INTO "Chunk" (id, source_id, segment_id, chunk_index, text, text_hash, char_start, char_end, page_or_index, snippet, created_at, updated_at)
        VALUES (
          ${chunkId}, ${sourceId}, ${seg.id as string}, ${chunkIndex},
          ${part.text}, ${textHash}, ${part.charStart}, ${part.charEnd},
          ${seg.segment_index as number}, ${snippet || null}, ${now}, ${now}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      created++;
      chunkIndex++;
    }
  }

  return created;
}

import { createHash } from "node:crypto";
import { chunkText, CHUNK_SIZE_TARGET, CHUNK_OVERLAP } from "@notelm/core";
import { prisma } from "./db.js";

const SNIPPET_MAX_LEN = 200;

/**
 * Chunk a source from its segments. Creates Chunk rows with sourceId, segmentId,
 * chunkIndex, text, textHash, pageOrIndex, charStart, charEnd, snippet.
 * Incremental: skips creating a chunk if one already exists for this source with the same textHash.
 */
export async function chunkSource(sourceId: string): Promise<number> {
  const segments = await prisma.sourceSegment.findMany({
    where: { sourceId },
    orderBy: { segmentIndex: "asc" },
  });

  const existing = await prisma.chunk.findMany({
    where: { sourceId },
    select: { textHash: true, chunkIndex: true },
  });
  const existingHashes = new Set(existing.map((c) => c.textHash));
  const nextIndex =
    existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.chunkIndex)) + 1;

  const now = BigInt(Date.now());
  let chunkIndex = nextIndex;
  let created = 0;

  for (const seg of segments) {
    const rawText = seg.text ?? "";
    const parts = rawText.length > 0
      ? chunkText(rawText, { sizeTarget: CHUNK_SIZE_TARGET, overlap: CHUNK_OVERLAP })
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

      await prisma.chunk.create({
        data: {
          id: chunkId,
          sourceId,
          segmentId: seg.id,
          chunkIndex,
          text: part.text,
          textHash,
          charStart: part.charStart,
          charEnd: part.charEnd,
          pageOrIndex: seg.segmentIndex,
          snippet: snippet || null,
          createdAt: now,
          updatedAt: now,
        },
      });
      created++;
      chunkIndex++;
    }
  }

  return created;
}

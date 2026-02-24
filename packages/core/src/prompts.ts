/** Grounded prompt builders for chat and artifacts. */

export const GROUNDED_SYSTEM_RULES = [
  "Use only the retrieved chunks as evidence. Do not use external knowledge.",
  "Never cite anything that is not in the provided chunks.",
  "If evidence is insufficient, say so and suggest what sources are needed.",
  "If sources conflict, present both views and cite each.",
].join("\n");

export interface RetrievedChunk {
  chunkId: string;
  text: string;
  sourceId: string;
  sourceTitle?: string;
  pageOrIndex?: number;
  snippet?: string;
}

export function buildGroundedContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] (chunk_id=${c.chunkId}, source=${c.sourceId}${c.pageOrIndex != null ? `, page=${c.pageOrIndex}` : ""})\n${c.text}`
    )
    .join("\n\n");
}

export function buildGroundedSystemPrompt(): string {
  return `${GROUNDED_SYSTEM_RULES}\n\nFormat your answer with citations at the end of each paragraph using footnotes: [^c1] [^c2] etc.`;
}

/** Chunking utilities: split text into chunks with location anchors. */

export const CHUNK_SIZE_TARGET = 800;
export const CHUNK_OVERLAP = 120;

export interface ChunkLocation {
  segmentType: "pdf_page" | "web_para" | "md_section";
  segmentIndex: number;
  charStart?: number;
  charEnd?: number;
  pageOrIndex?: number;
  anchor?: string;
}

export interface Chunk {
  id: string;
  sourceId: string;
  segmentId?: string;
  chunkIndex: number;
  text: string;
  textHash: string;
  location: ChunkLocation;
  snippet?: string;
  tokenCount?: number;
}

/**
 * Split text into overlapping chunks with optional location metadata.
 */
export function chunkText(
  text: string,
  options: {
    sizeTarget?: number;
    overlap?: number;
    location?: Omit<ChunkLocation, "charStart" | "charEnd">;
  } = {}
): Array<{ text: string; charStart: number; charEnd: number }> {
  const sizeTarget = options.sizeTarget ?? CHUNK_SIZE_TARGET;
  const overlap = options.overlap ?? CHUNK_OVERLAP;
  const chunks: Array<{ text: string; charStart: number; charEnd: number }> = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + sizeTarget, text.length);
    chunks.push({
      text: text.slice(start, end),
      charStart: start,
      charEnd: end,
    });
    start = end - (end < text.length ? overlap : 0);
  }
  return chunks;
}

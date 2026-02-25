export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
  minChunkSize?: number;
}

export interface ChunkResult {
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
}

const DEFAULT_CHUNK_SIZE = 2400;
const DEFAULT_CHUNK_OVERLAP = 450;
const DEFAULT_MIN_CHUNK_SIZE = 200;

export class ChunkingService {
  private defaultOptions: Required<ChunkOptions> = {
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    minChunkSize: DEFAULT_MIN_CHUNK_SIZE,
    separators: [
      '\n\n\n',
      '\n\n',
      '\n',
      '。',
      '.',
      '！',
      '!',
      '？',
      '?',
      '；',
      ';',
      '，',
      ',',
      ' ',
    ],
  };

  chunk(text: string, options?: ChunkOptions): ChunkResult[] {
    const opts = { ...this.defaultOptions, ...options };
    const { chunkSize, chunkOverlap, separators, minChunkSize } = opts;
    const cleanedText = this.preprocessText(text);
    if (!cleanedText || cleanedText.length === 0) return [];
    if (cleanedText.length <= minChunkSize) {
      return [
        {
          content: cleanedText,
          index: 0,
          startOffset: 0,
          endOffset: cleanedText.length,
          tokenCount: this.estimateTokens(cleanedText),
        },
      ];
    }
    const chunks: ChunkResult[] = [];
    let currentStart = 0;
    while (currentStart < cleanedText.length) {
      let currentEnd = Math.min(currentStart + chunkSize, cleanedText.length);
      if (currentEnd < cleanedText.length) {
        const searchEnd = currentEnd;
        const searchStart = Math.max(
          currentStart + Math.floor(chunkSize * 0.5),
          currentStart
        );
        let bestSplitPos = -1;
        let bestSeparatorPriority = separators.length;
        for (let i = searchEnd; i >= searchStart; i--) {
          for (let j = 0; j < separators.length; j++) {
            const sep = separators[j];
            if (cleanedText.slice(i, i + sep.length) === sep) {
              if (j < bestSeparatorPriority) {
                bestSplitPos = i + sep.length;
                bestSeparatorPriority = j;
              }
              break;
            }
          }
          if (bestSeparatorPriority <= 2) break;
        }
        if (bestSplitPos > currentStart) currentEnd = bestSplitPos;
      }
      const content = cleanedText.slice(currentStart, currentEnd).trim();
      if (content.length >= minChunkSize) {
        chunks.push({
          content,
          index: chunks.length,
          startOffset: currentStart,
          endOffset: currentEnd,
          tokenCount: this.estimateTokens(content),
        });
      }
      currentStart = Math.max(currentEnd - chunkOverlap, currentStart + 1);
    }
    return chunks;
  }

  private preprocessText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0;
    let chineseChars = 0;
    let otherChars = 0;
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0x3040 && code <= 0x309f) ||
        (code >= 0x30a0 && code <= 0x30ff) ||
        (code >= 0xac00 && code <= 0xd7af)
      ) {
        chineseChars++;
      } else {
        otherChars++;
      }
    }
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }
}

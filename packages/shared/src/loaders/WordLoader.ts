import type {
  IDocumentLoader,
  DocumentLoadResult,
  LoadOptions,
  PageInfo,
} from './types.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class WordLoader implements IDocumentLoader {
  readonly supportedMimeTypes = [
    DOCX_MIME,
    'application/msword', // .doc
  ];
  readonly supportedExtensions = ['docx', 'doc'];

  async loadFromBuffer(
    buffer: Buffer,
    options?: LoadOptions
  ): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options };
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const fullText = typeof result.value === 'string' ? result.value : '';
    const cleanText = this.cleanText(fullText);
    if (!cleanText.trim()) {
      return {
        content: '',
        mimeType: DOCX_MIME,
        structure: undefined,
        metadata: { messages: result.messages },
      };
    }
    const pages: PageInfo[] = [];
    if (opts.preserveStructure) {
      const chunkLen = Math.max(1, Math.ceil(cleanText.length / 1));
      pages.push({
        pageNumber: 1,
        content: cleanText,
        startOffset: 0,
        endOffset: cleanText.length,
      });
    }
    return {
      content: cleanText,
      mimeType: DOCX_MIME,
      structure:
        opts.preserveStructure && pages.length > 0
          ? { type: 'pages' as const, pages }
          : undefined,
      metadata: { messages: result.messages },
    };
  }

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase();
    return (
      this.supportedMimeTypes.includes(lower) ||
      lower.endsWith('.docx') ||
      lower.endsWith('.doc')
    );
  }

  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }
}

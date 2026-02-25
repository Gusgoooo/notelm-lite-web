import type {
  IDocumentLoader,
  DocumentLoadResult,
  LoadOptions,
  PageInfo,
} from './types.js';

export class TextLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['text/plain'];
  readonly supportedExtensions = ['txt', 'md'];

  async loadFromBuffer(
    buffer: Buffer,
    options?: LoadOptions
  ): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options };
    const content = this.cleanText(buffer.toString('utf-8'));
    const pages: PageInfo[] = [];
    if (opts.preserveStructure) {
      pages.push({
        pageNumber: 1,
        content,
        startOffset: 0,
        endOffset: content.length,
      });
    }
    return {
      content,
      mimeType: 'text/plain',
      structure:
        opts.preserveStructure && pages.length > 0
          ? { type: 'pages' as const, pages }
          : undefined,
    };
  }

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase();
    return (
      this.supportedMimeTypes.includes(lower) ||
      lower.endsWith('.txt') ||
      lower.endsWith('.md')
    );
  }

  private cleanText(text: string): string {
    return text
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }
}

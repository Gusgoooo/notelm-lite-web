import type {
  IDocumentLoader,
  DocumentLoadResult,
  LoadOptions,
  PageInfo,
} from './types.js';

export class PdfLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['application/pdf'];
  readonly supportedExtensions = ['pdf'];

  async loadFromBuffer(
    buffer: Buffer,
    options?: LoadOptions
  ): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options };
    const pdfParse = (await import('pdf-parse')).default;
    // pdf-parse may emit this known non-fatal warning repeatedly for some PDFs.
    const originalLog = console.log;
    const originalWarn = console.warn;
    const shouldSuppress = (args: unknown[]) =>
      args.some((a) =>
        String(a).includes('Ran out of space in font private use area')
      );
    console.log = (...args: unknown[]) => {
      if (shouldSuppress(args)) return;
      originalLog(...(args as []));
    };
    console.warn = (...args: unknown[]) => {
      if (shouldSuppress(args)) return;
      originalWarn(...(args as []));
    };
    const data = await pdfParse(buffer).finally(() => {
      console.log = originalLog;
      console.warn = originalWarn;
    });
    const fullText = typeof data.text === 'string' ? data.text : '';
    const numpages = Number(data.numpages) || 1;
    const cleanText = this.cleanPDFText(fullText);
    const pages: PageInfo[] = [];
    if (opts.preserveStructure && numpages > 0) {
      const chunkLen = Math.max(1, Math.ceil(cleanText.length / numpages));
      let offset = 0;
      for (let p = 1; p <= numpages; p++) {
        const end = p === numpages ? cleanText.length : offset + chunkLen;
        const content = cleanText.slice(offset, end).trim();
        pages.push({
          pageNumber: p,
          content,
          startOffset: offset,
          endOffset: end,
        });
        offset = end;
      }
    }
    return {
      content: cleanText,
      mimeType: 'application/pdf',
      structure: opts.preserveStructure
        ? { type: 'pages' as const, pages }
        : undefined,
      metadata: {
        pageCount: numpages,
        info: data.info,
      },
    };
  }

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase();
    return (
      this.supportedMimeTypes.includes(lower) || lower.endsWith('.pdf')
    );
  }

  private cleanPDFText(text: string): string {
    return text
      .replace(/[ \t]+/g, ' ')
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

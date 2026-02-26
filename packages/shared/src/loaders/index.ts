import type { IDocumentLoader } from './types.js';
import { PdfLoader } from './PdfLoader.js';
import { WordLoader } from './WordLoader.js';
import { TextLoader } from './TextLoader.js';

const pdfLoader = new PdfLoader();
const wordLoader = new WordLoader();
const textLoader = new TextLoader();

const loadersByMime: Record<string, IDocumentLoader> = {
  'application/pdf': pdfLoader,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    wordLoader,
  'application/msword': wordLoader,
  'text/plain': textLoader,
  'text/x-python': textLoader,
  'application/x-python-code': textLoader,
};

export function getLoaderForMime(mime: string | null): IDocumentLoader {
  const normalized = (mime || '').toLowerCase().trim();
  const loader = loadersByMime[normalized];
  if (loader) return loader;
  return pdfLoader;
}

export { PdfLoader } from './PdfLoader.js';
export { WordLoader } from './WordLoader.js';
export { TextLoader } from './TextLoader.js';

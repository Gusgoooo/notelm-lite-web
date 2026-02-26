import type { IDocumentLoader } from './types.js';
import { PdfLoader } from './PdfLoader.js';
import { WordLoader } from './WordLoader.js';
import { TextLoader } from './TextLoader.js';
import { ZipSkillLoader } from './ZipSkillLoader.js';

const pdfLoader = new PdfLoader();
const wordLoader = new WordLoader();
const textLoader = new TextLoader();
const zipSkillLoader = new ZipSkillLoader();

const loadersByMime: Record<string, IDocumentLoader> = {
  'application/pdf': pdfLoader,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    wordLoader,
  'application/msword': wordLoader,
  'text/plain': textLoader,
  'text/x-python': textLoader,
  'text/x-python-script': textLoader,
  'text/python': textLoader,
  'application/x-python-code': textLoader,
  'application/zip': zipSkillLoader,
  'application/x-zip-compressed': zipSkillLoader,
};

const loadersByExtension: Record<string, IDocumentLoader> = {
  pdf: pdfLoader,
  doc: wordLoader,
  docx: wordLoader,
  txt: textLoader,
  md: textLoader,
  py: textLoader,
  zip: zipSkillLoader,
};

function getExtension(filename: string | null | undefined): string {
  if (!filename) return '';
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return '';
  return filename.slice(idx + 1).toLowerCase().trim();
}

function isGenericMime(mime: string): boolean {
  return (
    mime === 'application/octet-stream' ||
    mime === 'binary/octet-stream' ||
    mime === 'application/unknown'
  );
}

export function getLoaderForMime(mime: string | null, filename?: string | null): IDocumentLoader {
  const normalized = (mime || '').toLowerCase().trim();
  if (normalized && !isGenericMime(normalized)) {
    const loader = loadersByMime[normalized];
    if (loader) return loader;
  }
  const ext = getExtension(filename);
  if (ext) {
    const extLoader = loadersByExtension[ext];
    if (extLoader) return extLoader;
  }
  return pdfLoader;
}

export { PdfLoader } from './PdfLoader.js';
export { WordLoader } from './WordLoader.js';
export { TextLoader } from './TextLoader.js';
export { ZipSkillLoader } from './ZipSkillLoader.js';

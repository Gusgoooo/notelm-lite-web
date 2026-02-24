/** Citations protocol: cite keys, footnote format, machine-readable citation objects. */

export interface CitationRecord {
  citeKey: string;
  chunkId: string;
  score?: number;
  sourceId: string;
  pageOrIndex?: number;
  anchor?: string;
  snippet?: string;
}

/** Footnote format in assistant text: [^c1] [^c2] */
export const CITATION_FOOTNOTE_REGEX = /\[\^([a-z0-9]+)\]/gi;

export function parseCitationKeys(content: string): string[] {
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  CITATION_FOOTNOTE_REGEX.lastIndex = 0;
  while ((m = CITATION_FOOTNOTE_REGEX.exec(content)) !== null) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

export function formatFootnote(citeKey: string): string {
  return `[^${citeKey}]`;
}

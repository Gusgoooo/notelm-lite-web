export interface PageInfo {
  pageNumber: number;
  content: string;
  startOffset: number;
  endOffset: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentStructure {
  type: 'flat' | 'pages' | 'sections';
  pages?: PageInfo[];
}

export interface DocumentLoadResult {
  content: string;
  title?: string;
  mimeType: string;
  structure?: DocumentStructure;
  metadata?: Record<string, unknown>;
}

export interface LoadOptions {
  preserveStructure?: boolean;
  password?: string;
}

export interface IDocumentLoader {
  readonly supportedMimeTypes: string[];
  readonly supportedExtensions: string[];
  loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult>;
  canLoad(filePathOrMimeType: string): boolean;
}

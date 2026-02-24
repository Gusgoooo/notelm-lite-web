/** Provider interfaces: LLM, Embedding, optional Storage. */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  generate(messages: LLMMessage[]): Promise<string>;
  generateJSON?<T>(messages: LLMMessage[]): Promise<T>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

export interface StorageProvider {
  get(path: string): Promise<Buffer | null>;
  put(path: string, data: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
}

import { mkdir, writeFile, readFile } from 'fs/promises';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { StorageAdapter } from './types.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, '../../../../');

function resolveBaseDir(baseDir: string): string {
  return isAbsolute(baseDir) ? baseDir : resolve(repoRoot, baseDir);
}

export function createFilesystemStorage(
  baseDir: string = process.env.UPLOADS_DIR ?? 'uploads'
): StorageAdapter {
  const resolvedBaseDir = resolveBaseDir(baseDir);
  return {
    async getUploadUrl(key: string): Promise<string> {
      return key;
    },
    async getDownloadUrl(key: string): Promise<string> {
      return join(resolvedBaseDir, key);
    },
    async upload(key: string, body: Buffer): Promise<void> {
      const path = join(resolvedBaseDir, key);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, body);
    },
    async download(key: string): Promise<Buffer> {
      const path = join(resolvedBaseDir, key);
      return readFile(path);
    },
  };
}

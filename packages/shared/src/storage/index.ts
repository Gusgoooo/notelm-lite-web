import type { StorageAdapter } from './types.js';
import { createFilesystemStorage } from './filesystem.js';
import { createS3Storage } from './s3.js';

let _storage: StorageAdapter | null = null;

function envBool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function getStorage(): StorageAdapter {
  if (!_storage) {
    const type = process.env.STORAGE_TYPE ?? 'filesystem';
    if (type === 's3') {
      const bucket = process.env.S3_BUCKET ?? '';
      const region = process.env.S3_REGION ?? 'us-east-1';
      if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_TYPE=s3');
      _storage = createS3Storage({
        bucket,
        region,
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: envBool('S3_FORCE_PATH_STYLE', false),
      });
    } else {
      const dir = process.env.UPLOADS_DIR ?? './uploads';
      _storage = createFilesystemStorage(dir);
    }
  }
  return _storage;
}

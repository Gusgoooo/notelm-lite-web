import type { StorageAdapter } from './types.js';
import { createFilesystemStorage } from './filesystem.js';
import { createS3Storage } from './s3.js';
import { readEnv } from '../utils/env.js';

let _storage: StorageAdapter | null = null;

function envBool(name: string, fallback = false): boolean {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function getStorage(): StorageAdapter {
  if (!_storage) {
    const type = readEnv('STORAGE_TYPE', 'filesystem').toLowerCase();
    if (type === 's3') {
      const bucket = readEnv('S3_BUCKET');
      const region = readEnv('S3_REGION', 'us-east-1');
      if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_TYPE=s3');
      _storage = createS3Storage({
        bucket,
        region,
        accessKeyId: readEnv('S3_ACCESS_KEY_ID') || undefined,
        secretAccessKey: readEnv('S3_SECRET_ACCESS_KEY') || undefined,
        endpoint: readEnv('S3_ENDPOINT') || undefined,
        forcePathStyle: envBool('S3_FORCE_PATH_STYLE', false),
      });
    } else {
      const dir = readEnv('UPLOADS_DIR', './uploads');
      _storage = createFilesystemStorage(dir);
    }
  }
  return _storage;
}

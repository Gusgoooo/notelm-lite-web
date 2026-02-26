import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageAdapter } from './types.js';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

function normalizeObjectKey(input: string, bucket: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  let key = trimmed;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const url = new URL(trimmed);
      key = url.pathname || '';
    }
  } catch {
    key = trimmed;
  }

  key = key.replace(/^\/+/, '');
  const bucketPrefix = `${bucket}/`;
  if (key.startsWith(bucketPrefix)) {
    key = key.slice(bucketPrefix.length);
  }
  return key;
}

function isNoSuchKeyError(error: unknown): boolean {
  const err = error as { name?: string; Code?: string; code?: string; message?: string };
  const name = String(err?.name ?? '').toLowerCase();
  const code = String(err?.Code ?? err?.code ?? '').toLowerCase();
  const message = String(err?.message ?? '').toLowerCase();
  return (
    name.includes('nosuchkey') ||
    code.includes('nosuchkey') ||
    message.includes('specified key does not exist') ||
    message.includes('no such key')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createS3Storage(config: S3StorageConfig): StorageAdapter {
  const client = new S3Client({
    region: config.region,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined,
    endpoint: config.endpoint,
    // Keep virtual-host style as default for better compatibility (e.g. OSS).
    // Override via env when a provider requires path-style access.
    forcePathStyle: config.forcePathStyle ?? false,
  });

  const bucket = config.bucket;

  return {
    async getUploadUrl(key: string): Promise<string> {
      const normalizedKey = normalizeObjectKey(key, bucket);
      const command = new PutObjectCommand({ Bucket: bucket, Key: normalizedKey });
      return getSignedUrl(client, command, { expiresIn: 3600 });
    },
    async getDownloadUrl(key: string): Promise<string> {
      const normalizedKey = normalizeObjectKey(key, bucket);
      const command = new GetObjectCommand({ Bucket: bucket, Key: normalizedKey });
      return getSignedUrl(client, command, { expiresIn: 3600 });
    },
    async upload(key: string, body: Buffer): Promise<void> {
      const normalizedKey = normalizeObjectKey(key, bucket);
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: normalizedKey, Body: body })
      );
    },
    async download(key: string): Promise<Buffer> {
      const normalizedKey = normalizeObjectKey(key, bucket);
      const maxAttempts = 4;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const res = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: normalizedKey })
          );
          const body = res.Body;
          if (!body) throw new Error(`Empty body for key ${normalizedKey}`);
          const chunks: Uint8Array[] = [];
          for await (const chunk of body as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
          }
          return Buffer.concat(chunks);
        } catch (error) {
          if (!isNoSuchKeyError(error) || attempt === maxAttempts) {
            throw error;
          }
          await sleep(600 * attempt);
        }
      }
      throw new Error(`Failed to download key ${normalizedKey}`);
    },
  };
}

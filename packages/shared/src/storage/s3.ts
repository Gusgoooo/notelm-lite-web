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
      const command = new PutObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn: 3600 });
    },
    async getDownloadUrl(key: string): Promise<string> {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn: 3600 });
    },
    async upload(key: string, body: Buffer): Promise<void> {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body })
      );
    },
    async download(key: string): Promise<Buffer> {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      const body = res.Body;
      if (!body) throw new Error(`Empty body for key ${key}`);
      const chunks: Uint8Array[] = [];
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
  };
}

export interface StorageAdapter {
  /** Get a presigned URL for upload (S3) or a path for direct upload (filesystem). */
  getUploadUrl(key: string): Promise<string>;

  /** Get URL or path to download the file. */
  getDownloadUrl(key: string): Promise<string>;

  /** Upload buffer to key. Used by server-side multipart handler. */
  upload(key: string, body: Buffer): Promise<void>;

  /** Download file as Buffer. Used by worker. */
  download(key: string): Promise<Buffer>;
}

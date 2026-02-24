import { put as blobPut } from "@vercel/blob";

/**
 * Upload a buffer to Vercel Blob and return the public URL.
 * Requires BLOB_READ_WRITE_TOKEN env var.
 */
export async function put(pathname: string, buffer: Buffer): Promise<string> {
  const blob = await blobPut(pathname, buffer, { access: "public" });
  return blob.url;
}

export function isStoredUriUrl(uri: string): boolean {
  return uri.startsWith("http://") || uri.startsWith("https://");
}

export async function get(uri: string): Promise<Buffer> {
  if (!isStoredUriUrl(uri)) {
    throw new Error("Only URL-based storage is supported");
  }
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Failed to fetch stored file: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

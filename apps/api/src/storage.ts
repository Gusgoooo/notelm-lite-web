import * as fs from "node:fs";
import * as path from "node:path";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();

export type StorageProvider = "local" | "blob" | "s3";

function resolveProvider(): StorageProvider {
  if (STORAGE_PROVIDER === "blob") return "blob";
  if (STORAGE_PROVIDER === "s3") return "s3";
  return "local";
}

const provider = resolveProvider();

/**
 * Store a file and return the stored URI (public URL for blob, relative path for local).
 */
export async function put(pathname: string, buffer: Buffer): Promise<string> {
  if (provider === "local") {
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    const absolutePath = path.join(UPLOAD_DIR, pathname);
    await fs.promises.writeFile(absolutePath, buffer);
    return path.relative(process.cwd(), absolutePath);
  }
  if (provider === "blob") {
    const { put: blobPut } = await import("@vercel/blob");
    const blob = await blobPut(pathname, buffer, { access: "public" });
    return blob.url;
  }
  throw new Error(`Unsupported STORAGE_PROVIDER: ${provider}`);
}

/**
 * Resolve whether a stored URI is a remote URL (e.g. Vercel Blob) or a local path.
 */
export function isStoredUriUrl(uri: string): boolean {
  return uri.startsWith("http://") || uri.startsWith("https://");
}

/**
 * Read file content by stored URI. For URLs (blob), fetches; for local paths, reads from disk.
 */
export async function get(uri: string): Promise<Buffer> {
  if (isStoredUriUrl(uri)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Failed to fetch stored file: ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  const absolutePath = path.isAbsolute(uri) ? uri : path.resolve(process.cwd(), uri);
  return fs.promises.readFile(absolutePath);
}

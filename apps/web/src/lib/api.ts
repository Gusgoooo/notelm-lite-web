export async function parseJsonResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Expected JSON but got "${contentType}". Body head: ${text.slice(0, 200)}`
    );
  }
  return JSON.parse(text) as T;
}

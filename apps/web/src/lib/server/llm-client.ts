export const LLM_ERROR_CODES = {
  LLM_CONFIG: "LLM_CONFIG",
  LLM_NETWORK: "LLM_NETWORK",
  LLM_REGION: "LLM_REGION",
  LLM_UNAVAILABLE: "LLM_UNAVAILABLE",
} as const;

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: keyof typeof LLM_ERROR_CODES
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export async function generateCompletion(
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const baseUrl = (
    process.env.LLM_BASE_URL ?? "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL ?? "gpt-3.5-turbo";

  if (!apiKey) {
    throw new LLMError("LLM_API_KEY is not set", "LLM_CONFIG");
  }

  const url = `${baseUrl}/chat/completions`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: false }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LLMError(`Network error: ${msg}`, "LLM_NETWORK");
  }

  const text = await res.text();

  if (res.status === 403 || res.status === 451) {
    throw new LLMError(`Region or access denied: ${text.slice(0, 200)}`, "LLM_REGION");
  }
  if (res.status === 401 || res.status === 402) {
    throw new LLMError(`Invalid or missing API key / quota: ${text.slice(0, 200)}`, "LLM_CONFIG");
  }
  if (!res.ok) {
    throw new LLMError(`LLM error ${res.status}: ${text.slice(0, 200)}`, "LLM_UNAVAILABLE");
  }

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new LLMError("Invalid JSON from LLM", "LLM_UNAVAILABLE");
  }
  return data.choices?.[0]?.message?.content ?? "";
}
